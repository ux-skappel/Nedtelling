"""Forensisk revisjon av P(0 minutter). Ingen modellendring, ingen ny backtest.

Etter at V1A feilet ble den foreløpige konklusjonen «evaluatoren er eksakt,
altså ligger feilen i inputet». Den slutningen er for sterk: numerisk
eksakthet gjelder *for den spesifiserte sannsynlighetsmodellen*, og sier
ingenting om målet er riktig definert eller om uavhengighetsantakelsen holder.

Skriptet måler tre ting før noen ny hypotese formuleres:

1. Er `P(0)` og fasiten i det hele tatt samme hendelse? Strukturelle nuller
   (ingen kamp, ikke registrert, sluttet i ligaen) skal ikke blandes med
   rotasjonsrisiko.
2. Er problemet kalibrering eller diskriminering? En modell kan ha helt feil
   skala og likevel rangere risiko riktig - da er et kalibreringslag nok. Klarer
   den ikke å skille i det hele tatt, trengs en ny minuttmodell.
3. Hvor kommer de -134 parete poengene fra, og hvor mye av sesongeffekten er
   direkte mekanisme mot senere troppsdivergens?

    python scripts/p0_forensic.py --stage table
    python scripts/p0_forensic.py --stage report
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.appearance import ARM_MEAN_PRESERVING, ARM_STRUCTURAL, build_states
from fplbot.backtest.engine import run_backtest
from fplbot.backtest.history import load_season, previous_season
from fplbot.model import ProjectionModel
from fplbot.scoring import POSITION_NAME
from fplbot.strength import fit_team_strength

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]
SCRATCH = Path(os.environ.get("FPLBOT_SCRATCH", "/tmp/fplbot-forensic"))
TABLE = SCRATCH / "p0_table.json"
SQUADS = SCRATCH / "p0_squads.json"


# ---------------------------------------------------------------- måldefinisjon


def build_table(season_name: str) -> list[dict]:
    """Én rad per (spiller, runde) der modellen faktisk lager et anslag.

    Anslaget bygges av det samme snapshotet backtesten brukte, for den runden
    beslutningen ble tatt i - altså `event` som førstkommende runde. Ingen
    framtidig informasjon.
    """
    season = load_season(season_name)
    try:
        prior = load_season(previous_season(season_name))
    except RuntimeError:
        prior = None

    # Har spilleren i det hele tatt en rad i arkivet for runden? Det skiller
    # «spilte 0 minutter» fra «fantes ikke i datagrunnlaget».
    rows_by_key: dict[tuple[int, int], list] = defaultdict(list)
    for row in season.rows:
        rows_by_key[(row.element, row.event)].append(row)

    table = []
    for event in range(1, max(season.events) + 1):
        bootstrap, fixtures = season.snapshot(event, prior=prior)
        finished = [e["id"] for e in bootstrap["events"] if e["finished"]]
        strength = fit_team_strength(
            fixtures, [t["id"] for t in bootstrap["teams"]], max(finished) if finished else 0
        )
        model = ProjectionModel(bootstrap, fixtures, strength=strength)

        for player in model.players.values():
            states = build_states(player, event, ARM_MEAN_PRESERVING)
            structural = build_states(player, event, ARM_STRUCTURAL)
            archive = rows_by_key.get((player.id, event), [])
            minutes = sum(r.minutes for r in archive)
            table.append(
                {
                    "season": season_name,
                    "event": event,
                    "element": player.id,
                    "position": player.position,
                    "p_start": round(player.p_start, 6),
                    "p_sub": round(player.p_sub, 6),
                    "p0": round(states.p_zero, 6),
                    "expected_minutes": round(player.expected_minutes, 3),
                    "scalar_xp": round(player.xp.get(event, 0.0), 4),
                    "ev0": round(states.mean, 4),
                    "ev1": round(structural.mean, 4),
                    "scheduled": len(player.fixtures.get(event, [])),
                    "has_row": bool(archive),
                    "minutes": minutes,
                    "starts": sum(r.starts for r in archive),
                    "cost": player.cost,
                }
            )
    return table


def label_target(table: list[dict]) -> None:
    """Setter `y0` etter den strenge definisjonen, og merker strukturelle nuller.

        y0 = 1  hvis spilleren har minst én arkivrad for runden og summen av
                minutter over rundens kamper er nøyaktig 0
        y0 = 0  hvis han har minst én rad og spilte minst ett minutt
        y0 = None (ekskludert) hvis han ikke har rad i det hele tatt

    Den siste gruppa er strukturelle nuller: laget hadde ikke kamp, spilleren var
    ikke registrert, eller han hadde forlatt ligaen. De sier ingenting om
    rotasjonsrisiko, og å telle dem som blank blander to helt ulike hendelser.

    Dobbeltrunder summeres, slik at `y0 = 1` betyr null minutter i *begge*
    kampene. Det er riktig for autobytter: FPL bytter bare inn hvis spilleren
    ikke kom på banen i det hele tatt.
    """
    for row in table:
        if not row["has_row"]:
            row["y0"] = None
            row["excluded"] = "ingen arkivrad"
        elif row["scheduled"] == 0:
            row["y0"] = None
            row["excluded"] = "ingen berammet kamp i snapshotet"
        else:
            row["y0"] = 1 if row["minutes"] == 0 else 0
            row["excluded"] = None


def mark_absence_runs(table: list[dict]) -> None:
    """Skiller isolerte nuller fra sammenhengende fravær.

    En skade gir typisk en serie påfølgende nuller; rotasjon gir spredte
    enkeltnuller. Arkivet har ingen skadestatus per runde, så dette er den beste
    tilgjengelige proxyen for hvor mye av fraværet som var kjennbart ved fristen.
    """
    by_player: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in table:
        by_player[(row["season"], row["element"])].append(row)

    for rows in by_player.values():
        rows.sort(key=lambda r: r["event"])
        for index, row in enumerate(rows):
            row["run_length"] = 0
            row["run_position"] = None
            if row["y0"] != 1:
                continue
            length = 1
            back = index - 1
            while back >= 0 and rows[back]["y0"] == 1:
                length += 1
                back -= 1
            offset = index - back - 1
            forward = index + 1
            while forward < len(rows) and rows[forward]["y0"] == 1:
                length += 1
                forward += 1
            row["run_length"] = length
            row["run_position"] = offset


# ------------------------------------------------------------------- metrikker


def brier(rows) -> float:
    return statistics.fmean((r["p0"] - r["y0"]) ** 2 for r in rows)


def log_loss(rows, floor: float = 1e-6) -> float:
    total = 0.0
    for row in rows:
        p = min(1.0 - floor, max(floor, row["p0"]))
        total += -(row["y0"] * math.log(p) + (1 - row["y0"]) * math.log(1 - p))
    return total / len(rows)


def auc(rows) -> float:
    """Sannsynligheten for at en tilfeldig blank rangeres over en tilfeldig ikke-blank.

    Regnes med rangmetoden, som håndterer like anslag riktig. 0,5 er ingen
    diskriminering; 1,0 er perfekt rangering.
    """
    ordered = sorted(rows, key=lambda r: r["p0"])
    ranks: dict[int, float] = {}
    index = 0
    while index < len(ordered):
        stop = index
        while stop + 1 < len(ordered) and ordered[stop + 1]["p0"] == ordered[index]["p0"]:
            stop += 1
        average = (index + stop) / 2.0 + 1.0
        for position in range(index, stop + 1):
            ranks[id(ordered[position])] = average
        index = stop + 1
    positives = [r for r in rows if r["y0"] == 1]
    negatives = [r for r in rows if r["y0"] == 0]
    if not positives or not negatives:
        return float("nan")
    rank_sum = sum(ranks[id(r)] for r in positives)
    n_pos, n_neg = len(positives), len(negatives)
    return (rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def logit(p: float, floor: float = 1e-6) -> float:
    p = min(1.0 - floor, max(floor, p))
    return math.log(p / (1.0 - p))


def calibration_line(rows) -> tuple[float, float]:
    """Intercept og slope fra en enkel regresjon av utfall på logit(anslag).

    Ikke en full logistisk regresjon - det ville krevd iterasjon vi ikke trenger.
    Minste kvadrat på (logit(p), y) gir samme kvalitative avlesning: slope godt
    under 1 betyr at anslagene er for spredte, slope over 1 at de er for flate,
    og intercept forteller om nivået er forskjøvet.
    """
    xs = [logit(r["p0"]) for r in rows]
    ys = [float(r["y0"]) for r in rows]
    mean_x, mean_y = statistics.fmean(xs), statistics.fmean(ys)
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance == 0:
        return float("nan"), float("nan")
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True)) / variance
    return mean_y - slope * mean_x, slope


def summarise(rows, label: str) -> dict:
    usable = [r for r in rows if r["y0"] is not None]
    if len(usable) < 50:
        return {"label": label, "n": len(usable)}
    intercept, slope = calibration_line(usable)
    return {
        "label": label,
        "n": len(usable),
        "mean_p0": statistics.fmean(r["p0"] for r in usable),
        "actual": statistics.fmean(r["y0"] for r in usable),
        "brier": brier(usable),
        "log_loss": log_loss(usable),
        "auc": auc(usable),
        "sharpness": statistics.pstdev([r["p0"] for r in usable]),
        "intercept": intercept,
        "slope": slope,
    }


BANDS = [
    (0.00, 0.01),
    (0.01, 0.05),
    (0.05, 0.10),
    (0.10, 0.20),
    (0.20, 0.40),
    (0.40, 0.60),
    (0.60, 0.80),
    (0.80, 1.01),
]


def reliability(rows) -> list[dict]:
    out = []
    usable = [r for r in rows if r["y0"] is not None]
    for low, high in BANDS:
        inside = [r for r in usable if low <= r["p0"] < high]
        if not inside:
            continue
        predicted = statistics.fmean(r["p0"] for r in inside)
        actual = statistics.fmean(r["y0"] for r in inside)
        out.append(
            {
                "band": f"{low:.2f}-{high:.2f}",
                "n": len(inside),
                "predicted": predicted,
                "actual": actual,
                "error": predicted - actual,
            }
        )
    return out


# ------------------------------------------------------- tropper og divergens


def collect_squads() -> dict:
    """Kjører grunnlinjen og V1A-0 på nytt for å fange spiller-ID-ene per runde.

    Dette er ikke en ny policytest: koden er deterministisk og gir nøyaktig
    samme poeng som før. Kjøringen finnes bare for å registrere *hvilke*
    spillere som var i troppen og hvilke beslutningen faktisk gjaldt, som ikke
    ble logget første gang.
    """
    out: dict = {}
    for season_name in SEASONS:
        season = load_season(season_name)
        try:
            prior = load_season(previous_season(season_name))
        except RuntimeError:
            prior = None

        squads: dict[str, dict] = {}

        def record(tag, squads=squads):
            def hook(gameweek):
                squads.setdefault(str(gameweek.event), {})[tag] = {
                    "starters": [p["name"] for p in gameweek.starters],
                    "bench": [p["name"] for p in gameweek.bench],
                    "points": gameweek.points,
                }

            return hook

        base = run_backtest(season, prior=prior, on_gameweek=record("baseline"))
        decisions: list = []
        arm = run_backtest(
            season,
            prior=prior,
            arm=ARM_MEAN_PRESERVING,
            decisions=decisions,
            on_gameweek=record("v1a-0"),
        )
        out[season_name] = {
            "baseline_total": base.total_points,
            "v1a0_total": arm.total_points,
            "gameweeks": squads,
            "decisions": [d.to_dict() for d in decisions],
        }
        print(
            f"  {season_name}: baseline {base.total_points}, "
            f"v1a-0 {arm.total_points}",
            flush=True,
        )
    return out


# --------------------------------------------------------------------- utskrift


def print_reliability(title: str, rows) -> None:
    print(f"\n{title}")
    print(f"  {'anslag':<14}{'n':>9}{'predikert':>12}{'faktisk':>10}{'avvik':>9}")
    for band in reliability(rows):
        print(
            f"  {band['band']:<14}{band['n']:>9,}{band['predicted']:>12.3f}"
            f"{band['actual']:>10.3f}{band['error']:>+9.3f}".replace(",", " ")
        )


def print_summary(title: str, groups: list[tuple[str, list]]) -> None:
    print(f"\n{title}")
    print(
        f"  {'gruppe':<26}{'n':>9}{'pred':>8}{'faktisk':>9}"
        f"{'Brier':>9}{'logloss':>9}{'AUC':>8}{'skarphet':>10}{'slope':>8}"
    )
    for label, rows in groups:
        s = summarise(rows, label)
        if s.get("n", 0) < 50:
            continue
        print(
            f"  {s['label']:<26}{s['n']:>9,}{s['mean_p0']:>8.3f}{s['actual']:>9.3f}"
            f"{s['brier']:>9.4f}{s['log_loss']:>9.3f}{s['auc']:>8.3f}"
            f"{s['sharpness']:>10.3f}{s['slope']:>8.3f}".replace(",", " ")
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Forensisk revisjon av P(0)")
    parser.add_argument("--stage", choices=["table", "squads", "report"], default="report")
    args = parser.parse_args()

    if args.stage == "table":
        table = []
        for name in SEASONS:
            rows = build_table(name)
            table.extend(rows)
            print(f"  {name}: {len(rows):,} spiller-runder".replace(",", " "), flush=True)
        label_target(table)
        mark_absence_runs(table)
        TABLE.parent.mkdir(parents=True, exist_ok=True)
        TABLE.write_text(json.dumps(table), encoding="utf8")
        print(f"Skrev {TABLE} ({TABLE.stat().st_size // 1024} kB)")
        return 0

    if args.stage == "squads":
        SQUADS.parent.mkdir(parents=True, exist_ok=True)
        SQUADS.write_text(json.dumps(collect_squads()), encoding="utf8")
        print(f"Skrev {SQUADS}")
        return 0

    table = json.loads(TABLE.read_text(encoding="utf8"))
    report(table)
    return 0


def report(table: list[dict]) -> None:
    total = len(table)
    excluded = Counter(r["excluded"] for r in table if r["excluded"])
    usable = [r for r in table if r["y0"] is not None]

    print("=" * 78)
    print("1. MÅLDEFINISJON OG KONTAMINASJON")
    print("=" * 78)
    print(f"  spiller-runder i modellens univers      {total:,}".replace(",", " "))
    for reason, count in excluded.most_common():
        print(f"    ekskludert, {reason:<34}{count:>10,}".replace(",", " "))
    print(f"  brukbare observasjoner                  {len(usable):,}".replace(",", " "))

    # Hva skjer om vi gjør feilen: teller manglende rad som blank?
    naive = [
        dict(r, y0=1 if r["minutes"] == 0 else 0)
        for r in table
        if r["scheduled"] > 0
    ]
    print("\n  Effekten av å blande strukturelle nuller inn i målet:")
    print(f"    naiv definisjon (manglende rad = blank)  n={len(naive):,}  "
          f"faktisk andel {statistics.fmean(r['y0'] for r in naive):.3f}".replace(",", " "))
    print(f"    streng definisjon                        n={len(usable):,}  "
          f"faktisk andel {statistics.fmean(r['y0'] for r in usable):.3f}".replace(",", " "))

    print("\n" + "=" * 78)
    print("2. KALIBRERING OG DISKRIMINERING")
    print("=" * 78)
    print_reliability("Reliabilitet, streng definisjon, hele universet", usable)
    print_reliability(
        "Til sammenlikning: naiv definisjon (den som ga 0,004 mot 0,158)", naive
    )

    print_summary(
        "Samlede metrikker",
        [("streng definisjon", usable), ("naiv definisjon", naive)],
    )

    print("\n" + "=" * 78)
    print("3. SEGMENTER")
    print("=" * 78)
    print_summary(
        "Per sesong",
        [(s, [r for r in usable if r["season"] == s]) for s in SEASONS],
    )
    print_summary(
        "Per posisjon",
        [
            (POSITION_NAME[p], [r for r in usable if r["position"] == p])
            for p in (1, 2, 3, 4)
        ],
    )
    periods = [("GW1-5", 1, 5), ("GW6-15", 6, 15), ("GW16-25", 16, 25), ("GW26-38", 26, 38)]
    print_summary(
        "Per sesongfase",
        [
            (name, [r for r in usable if low <= r["event"] <= high])
            for name, low, high in periods
        ],
    )
    minute_bands = [(0, 15), (15, 30), (30, 45), (45, 60), (60, 75), (75, 91)]
    print_summary(
        "Per forventet spilletid",
        [
            (
                f"{low}-{high} min",
                [r for r in usable if low <= r["expected_minutes"] < high],
            )
            for low, high in minute_bands
        ],
    )
    roles = [
        ("sikker starter  p>=0.85", lambda r: r["p_start"] >= 0.85),
        ("sannsynlig      0.6-0.85", lambda r: 0.60 <= r["p_start"] < 0.85),
        ("usikker         0.3-0.6", lambda r: 0.30 <= r["p_start"] < 0.60),
        ("benk/rotasjon   p<0.3", lambda r: r["p_start"] < 0.30),
    ]
    print_summary(
        "Per anslått rolle",
        [(name, [r for r in usable if test(r)]) for name, test in roles],
    )

    print("\n" + "=" * 78)
    print("4. OVERSELVSIKKERHET I P0-AVBILDNINGEN")
    print("=" * 78)
    values = sorted(r["p0"] for r in usable)
    def pct(q):
        return values[min(len(values) - 1, int(q * len(values)))]
    print(f"  min {values[0]:.4f}   p10 {pct(0.10):.3f}   p25 {pct(0.25):.3f}   "
          f"median {pct(0.50):.3f}   p75 {pct(0.75):.3f}   p90 {pct(0.90):.3f}   "
          f"maks {values[-1]:.3f}")
    for threshold in (0.005, 0.01, 0.02, 0.05):
        group = [r for r in usable if r["p0"] < threshold]
        if not group:
            continue
        print(
            f"  P0 < {threshold:<6.3f} n={len(group):>7,}  "
            f"({len(group) / len(usable):>5.1%})  faktisk blankeandel "
            f"{statistics.fmean(r['y0'] for r in group):.3f}".replace(",", " ")
        )

    print("\n" + "=" * 78)
    print("5. SAMMENHENGENDE FRAVÆR — SKADE ELLER ROTASJON?")
    print("=" * 78)
    blanks = [r for r in usable if r["y0"] == 1]
    runs = Counter()
    for row in blanks:
        length = row["run_length"]
        key = "1 runde" if length == 1 else "2 runder" if length == 2 else (
            "3-5 runder" if length <= 5 else "6+ runder"
        )
        runs[key] += 1
    print(
        f"  {len(blanks):,} blanke spiller-runder fordelt på fraværets lengde:".replace(
            ",", " "
        )
    )
    for key in ("1 runde", "2 runder", "3-5 runder", "6+ runder"):
        if runs[key]:
            share = runs[key] / len(blanks)
            print(f"    {key:<12}{runs[key]:>9,}  ({share:>5.1%})".replace(",", " "))
    inside = sum(1 for r in blanks if (r["run_position"] or 0) > 0)
    print(f"  blanke som ikke er første runde i sitt fravær: {inside:,} "
          f"({inside / len(blanks):.1%})".replace(",", " "))

    print("\n" + "=" * 78)
    print("6. DELER GRUNNLINJEN SAMME INPUT?")
    print("=" * 78)
    corr_rows = [r for r in usable if r["scalar_xp"] > 0]
    print("  scalar xP bygges av de samme p_start/p_sub: "
          "expected_minutes = p_start*start_minutes + p_sub*18")
    print(f"  spiller-runder med xP > 0: {len(corr_rows):,}".replace(",", " "))
    for name, low, high in [("p0 < 0.05", 0.0, 0.05), ("p0 0.05-0.2", 0.05, 0.2),
                            ("p0 0.2-0.5", 0.2, 0.5), ("p0 >= 0.5", 0.5, 1.01)]:
        group = [r for r in corr_rows if low <= r["p0"] < high]
        if len(group) < 50:
            continue
        mean_xp = statistics.fmean(r["scalar_xp"] for r in group)
        rate = statistics.fmean(r["y0"] for r in group)
        print(
            f"    {name:<14} n={len(group):>7,}  snitt xP {mean_xp:>5.2f}"
            f"   faktisk blankeandel {rate:.3f}".replace(",", " ")
        )

    print("\n" + "=" * 78)
    print("7. V1A-1 STANDALONE-EV")
    print("=" * 78)
    diffs = [r["ev1"] - r["ev0"] for r in table]
    nonzero = [d for d in diffs if abs(d) > 1e-9]
    print(f"  spiller-runder totalt              {len(diffs):,}".replace(",", " "))
    print(f"  der V1A-1 != V1A-0                 {len(nonzero):,} "
          f"({len(nonzero) / len(diffs):.1%})".replace(",", " "))
    if nonzero:
        absolute = sorted(abs(d) for d in nonzero)
        print(f"  snitt differanse (med fortegn)     {statistics.fmean(nonzero):+.4f}")
        print(f"  snitt absoluttdifferanse           {statistics.fmean(absolute):.4f}")
        print(f"  maks absoluttdifferanse            {absolute[-1]:.4f}")
        for q in (0.5, 0.9, 0.99):
            print(f"  p{int(q * 100)} absoluttdifferanse            "
                  f"{absolute[min(len(absolute) - 1, int(q * len(absolute)))]:.4f}")
        positive = sum(1 for d in nonzero if d > 0)
        print(f"  andel der V1A-1 er høyere           {positive / len(nonzero):.1%}")


if __name__ == "__main__":
    raise SystemExit(main())
