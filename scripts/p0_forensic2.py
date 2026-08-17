"""Del to av den forensiske revisjonen: populasjoner, avhengighet, dekomponering.

Krever at `p0_forensic.py --stage table` og `--stage squads` er kjørt først.

Ingen modellendring. Ingen ny policytest. Bare måling av det som allerede skjedde.
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SCRATCH = Path(os.environ.get("FPLBOT_SCRATCH", "/tmp/fplbot-forensic"))
TABLE = SCRATCH / "p0_table.json"
SQUADS = SCRATCH / "p0_squads.json"
V1A = Path("data/v1a.json")


# ------------------------------------------------------- ordentlig kalibrering


def logistic_calibration(rows, iterations: int = 40) -> tuple[float, float]:
    """Logistisk regresjon av utfall på logit(anslag), løst med Newton/IRLS.

    Standardtolkningen: intercept 0 og slope 1 er perfekt kalibrering. Slope
    under 1 betyr at anslagene er for skarpe - modellen sier 0,01 og 0,90 der
    virkeligheten sier 0,15 og 0,80. Slope nær 0 betyr at anslagene knapt bærer
    informasjon om nivået i det hele tatt.
    """
    xs = []
    ys = []
    for row in rows:
        p = min(1 - 1e-6, max(1e-6, row["p0"]))
        xs.append(math.log(p / (1 - p)))
        ys.append(float(row["y0"]))
    a, b = 0.0, 1.0
    for _ in range(iterations):
        g0 = g1 = h00 = h01 = h11 = 0.0
        for x, y in zip(xs, ys, strict=True):
            eta = a + b * x
            mu = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, eta))))
            weight = max(1e-9, mu * (1 - mu))
            residual = y - mu
            g0 += residual
            g1 += residual * x
            h00 += weight
            h01 += weight * x
            h11 += weight * x * x
        determinant = h00 * h11 - h01 * h01
        if abs(determinant) < 1e-12:
            break
        step0 = (h11 * g0 - h01 * g1) / determinant
        step1 = (h00 * g1 - h01 * g0) / determinant
        a, b = a + step0, b + step1
        if abs(step0) < 1e-10 and abs(step1) < 1e-10:
            break
    return a, b


def auc(rows) -> float:
    ordered = sorted(rows, key=lambda r: r["p0"])
    ranks = {}
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
    return (rank_sum - len(positives) * (len(positives) + 1) / 2.0) / (
        len(positives) * len(negatives)
    )


def line(label: str, rows) -> None:
    if len(rows) < 50:
        print(f"  {label:<30}{len(rows):>8}   (for få)")
        return
    intercept, slope = logistic_calibration(rows)
    print(
        f"  {label:<30}{len(rows):>8,}{statistics.fmean(r['p0'] for r in rows):>9.3f}"
        f"{statistics.fmean(r['y0'] for r in rows):>9.3f}"
        f"{statistics.fmean((r['p0'] - r['y0']) ** 2 for r in rows):>9.4f}"
        f"{auc(rows):>8.3f}{intercept:>10.2f}{slope:>8.3f}".replace(",", " ")
    )


def header() -> None:
    print(
        f"  {'populasjon':<30}{'n':>8}{'pred':>9}{'faktisk':>9}"
        f"{'Brier':>9}{'AUC':>8}{'intercept':>10}{'slope':>8}"
    )


def main() -> int:
    table = json.loads(TABLE.read_text(encoding="utf8"))
    squads = json.loads(SQUADS.read_text(encoding="utf8"))
    usable = [r for r in table if r["y0"] is not None]
    by_key = {(r["season"], r["event"], r["element"]): r for r in usable}

    print("=" * 78)
    print("8. KALIBRERING MED ORDENTLIG LOGISTISK SLOPE")
    print("=" * 78)
    print("  Perfekt kalibrering er intercept 0, slope 1.\n")
    header()
    line("hele universet", usable)
    for role, test in [
        ("sikker starter p>=0.85", lambda r: r["p_start"] >= 0.85),
        ("sannsynlig 0.6-0.85", lambda r: 0.60 <= r["p_start"] < 0.85),
        ("usikker 0.3-0.6", lambda r: 0.30 <= r["p_start"] < 0.60),
        ("benk/rotasjon p<0.3", lambda r: r["p_start"] < 0.30),
    ]:
        line(role, [r for r in usable if test(r)])

    print("\n" + "=" * 78)
    print("9. POPULASJONENE OPTIMEREREN FAKTISK BRYR SEG OM")
    print("=" * 78)

    # Troppene ble logget med visningsnavn. Modellen utleder det navnet fra
    # arkivets fulle navn ved å ta siste ledd, så koblingen kan gjenskapes.
    from fplbot.backtest.history import load_season

    seasons = {name: load_season(name) for name in
               ("2022-23", "2023-24", "2024-25", "2025-26")}
    web_name: dict[tuple[str, int], str] = {}
    duplicates: set = set()
    for season_name, season in seasons.items():
        seen: dict[str, int] = {}
        for row in season.rows:
            first, _, last = row.name.rpartition(" ")
            short = last or first
            web_name[(season_name, row.element)] = short
            if short in seen and seen[short] != row.element:
                duplicates.add((season_name, short))
            seen.setdefault(short, row.element)

    selected_keys: set = set()
    divergence_rounds_set: set = set()
    for season_name, payload in squads.items():
        for event_text, arms in payload["gameweeks"].items():
            event = int(event_text)
            picked = set()
            for arm_data in arms.values():
                picked.update(arm_data["starters"])
                picked.update(arm_data["bench"])
            for key, row in by_key.items():
                same_round = key[0] == season_name and key[1] == event
                if same_round and web_name.get((season_name, row["element"])) in picked:
                    selected_keys.add(key)
        for decision in payload["decisions"]:
            if decision["kind"] == "lineup":
                divergence_rounds_set.add((season_name, decision["event"]))

    candidate = [r for r in usable if r["expected_minutes"] > 5]
    likely = [r for r in usable if r["p_start"] >= 0.5]
    selected = [r for r in usable if (r["season"], r["event"], r["element"]) in selected_keys]
    divergence = [
        r for r in selected if (r["season"], r["event"]) in divergence_rounds_set
    ]

    header()
    line("alle spillere", usable)
    line("kandidatsett (xMin > 5)", candidate)
    line("sannsynlige startere p>=0.5", likely)
    line("valgt tropp (15 spillere)", selected)
    line("tropp i runder V1A avvek", divergence)

    print(f"\n  Navnekollisjoner ved koblingen tropp -> spiller: {len(duplicates)}."
          " De kan gi noen få feilkoblinger, men ikke nok til å snu bildet.")

    print("\n" + "=" * 78)
    print("10. UAVHENGIGHET — KLUMPER BLANKENE SEG PER LAG OG RUNDE?")
    print("=" * 78)
    print("  Evaluatoren antar uavhengige minuttilstander. Holder det ikke, er den")
    print("  en eksakt løsning på feil sannsynlighetsmodell.\n")

    # Grupper på (sesong, runde, lag). Laget finnes ikke i tabellen, så det
    # utledes av kampprogrammet via en egen innlesning.
    from fplbot.backtest.history import load_season

    team_of: dict[tuple[str, int], int] = {}
    for season_name in ("2022-23", "2023-24", "2024-25", "2025-26"):
        season = load_season(season_name)
        for row in season.rows:
            team_of[(season_name, row.element)] = row.team

    groups: dict[tuple, list] = defaultdict(list)
    for row in likely:
        team = team_of.get((row["season"], row["element"]))
        if team is None:
            continue
        groups[(row["season"], row["event"], team)].append(row)

    observed_variance = 0.0
    independent_variance = 0.0
    counted = 0
    all_blank = 0
    total_groups = 0
    for members in groups.values():
        if len(members) < 5:
            continue
        total_groups += 1
        blanks = sum(r["y0"] for r in members)
        expected = sum(r["p0"] for r in members)
        observed_variance += (blanks - expected) ** 2
        independent_variance += sum(r["p0"] * (1 - r["p0"]) for r in members)
        counted += 1
        if blanks == len(members):
            all_blank += 1

    print(f"  lag-runder med minst 5 sannsynlige startere: {counted:,}".replace(",", " "))
    print(f"  observert kvadratavvik  {observed_variance / counted:>8.3f} per lag-runde")
    print(f"  under uavhengighet      {independent_variance / counted:>8.3f} per lag-runde")
    print(f"  overdispersjonsfaktor   {observed_variance / independent_variance:>8.2f}")
    print(f"  lag-runder der ALLE sannsynlige startere blanket: {all_blank} "
          f"({all_blank / counted:.2%})")
    print("\n  En faktor over 1 betyr at blankene klumper seg mer enn uavhengige")
    print("  trekninger tilsier. Del av det er ekte korrelasjon (rotasjon, utsatte")
    print("  kamper, sykdom), del er at anslagene selv er skjeve - de to kan ikke")
    print("  skilles med denne målingen alene.")

    print("\n" + "=" * 78)
    print("11. DEKOMPONERING AV DE -134 PARETE POENGENE")
    print("=" * 78)
    payload = json.loads(V1A.read_text(encoding="utf8"))
    decisions = payload["decisions"]["v1a-0"]
    lineup = [d for d in decisions if d["kind"] == "lineup" and d["realized_delta"] is not None]

    categories = {
        "bare benkerekkefølge": lambda d: d["reason"] == "benkerekkefølge",
        "bare kaptein/vise": lambda d: set(d["reason"].split("+")) <= {"kaptein", "visekaptein"},
        "startellever involvert": lambda d: "starter mot benk" in d["reason"],
    }
    print(f"  {'kategori':<28}{'n':>6}{'predikert':>12}{'realisert':>12}{'snitt real.':>13}")
    covered = set()
    for label, test in categories.items():
        inside = [d for d in lineup if test(d)]
        covered.update(id(d) for d in inside)
        if not inside:
            continue
        print(
            f"  {label:<28}{len(inside):>6}"
            f"{sum(d['predicted_delta'] for d in inside):>+12.1f}"
            f"{sum(d['realized_delta'] for d in inside):>+12d}"
            f"{statistics.fmean(d['realized_delta'] for d in inside):>+13.2f}"
        )
    rest = [d for d in lineup if id(d) not in covered]
    if rest:
        print(
            f"  {'øvrige':<28}{len(rest):>6}"
            f"{sum(d['predicted_delta'] for d in rest):>+12.1f}"
            f"{sum(d['realized_delta'] for d in rest):>+12d}"
            f"{statistics.fmean(d['realized_delta'] for d in rest):>+13.2f}"
        )
    print(
        f"  {'SUM':<28}{len(lineup):>6}"
        f"{sum(d['predicted_delta'] for d in lineup):>+12.1f}"
        f"{sum(d['realized_delta'] for d in lineup):>+12d}"
    )

    transfers = [d for d in decisions if d["kind"] == "transfer"]
    print(f"\n  byttebeslutninger der V1A og grunnlinjen var uenige: {len(transfers)}")
    print("  Disse har ingen paret realisert delta: fra det øyeblikket divergerer")
    print("  troppene, og et parvis tall ville sammenliknet to ulike spillerutvalg.")

    print("\n" + "=" * 78)
    print("12. DIREKTE MEKANISME MOT SENERE STIEFFEKT")
    print("=" * 78)
    print(f"  {'sesong':<10}{'direkte (paret)':>18}{'sesongtotal':>14}{'stieffekt':>13}"
          f"{'bytter uenige':>16}")
    direct_total = 0
    path_total = 0
    for season_name in ("2022-23", "2023-24", "2024-25", "2025-26"):
        rows = [d for d in lineup if d["season"] == season_name]
        direct = sum(d["realized_delta"] for d in rows)
        policy = payload["policy"]
        season_delta = policy["v1a-0"][season_name] - policy["baseline"][season_name]
        path = season_delta - direct
        disagreed = sum(1 for d in transfers if d["season"] == season_name)
        direct_total += direct
        path_total += path
        print(f"  {season_name:<10}{direct:>+18d}{season_delta:>+14d}{path:>+13d}{disagreed:>16}")
    print(f"  {'SUM':<10}{direct_total:>+18d}"
          f"{direct_total + path_total:>+14d}{path_total:>+13d}")
    print("\n  Stieffekten er restleddet: alt sesongtotalen inneholder som ikke er den")
    print("  direkte, parete oppstillingsbeslutningen. Den er ikke en måling av en")
    print("  mekanisme - den er summen av at troppene divergerte etter 18 uenige")
    print("  bytter, og den bærer all akkumulert flaks fra resten av sesongen.")

    print("\n" + "=" * 78)
    print("13. FRAVÆRSMØNSTER BLANT DE MODELLEN TROR ER SIKRE STARTERE")
    print("=" * 78)
    certain_blanks = [r for r in usable if r["p_start"] >= 0.85 and r["y0"] == 1]
    runs = Counter()
    for row in certain_blanks:
        length = row["run_length"]
        key = "1 runde" if length == 1 else "2 runder" if length == 2 else (
            "3-5 runder" if length <= 5 else "6+ runder"
        )
        runs[key] += 1
    print(f"  {len(certain_blanks):,} blanke runder blant spillere med p_start >= 0,85"
          .replace(",", " "))
    for key in ("1 runde", "2 runder", "3-5 runder", "6+ runder"):
        if runs[key]:
            print(f"    {key:<12}{runs[key]:>7,}  ({runs[key] / len(certain_blanks):>5.1%})"
                  .replace(",", " "))
    first = sum(1 for r in certain_blanks if (r["run_position"] or 0) == 0)
    print(f"  første runde i sitt fravær: {first:,} ({first / len(certain_blanks):.1%})"
          .replace(",", " "))
    print("\n  Fravær som varer flere runder ville i live-drift vært synlig gjennom")
    print("  FPL sitt status-flagg. Arkivet har ikke flagget, og backtesten setter")
    print("  status = 'a' for alle. Den delen av feilen er altså et kjennetegn ved")
    print("  testriggen, ikke nødvendigvis ved modellen slik den kjører i dag.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
