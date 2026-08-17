"""Den forhåndsregistrerte historiske testen av V1A.

Kjører tre armer over fire sesonger og rapporterer utfallet mekanisk etter
kriteriene i V1A_PREREG.md seksjon 8, uten skjønn:

    TEST 1   V1A-0 mot grunnlinjen     - gir troppsreglene verdi når spillernes
                                         forventning er identisk?
    TEST 2   V1A-1 mot V1A-0           - gir omprisingen inkrementell verdi?
    TEST 3   V1A-1 mot grunnlinjen     - hva er samlet praktisk verdi?

Armene er ikke sekvensavhengige. Alle tre kjøres uansett hva de andre viser.

    python scripts/run_v1a_test.py --out data/v1a.json
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.appearance import ARM_MEAN_PRESERVING, ARM_STRUCTURAL
from fplbot.backtest.engine import run_backtest
from fplbot.backtest.history import load_season, previous_season

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]

# Akseptansekriterier, fryst i preregistreringen seksjon 8. Ikke rør.
PASS_THRESHOLD = 10.0
FAIL_THRESHOLD = 5.0
CONSISTENCY_REQUIRED = 3  # av fire sesonger med positiv delta

BOOTSTRAP_DRAWS = 10_000
BLOCK_SIZE = 4

BUCKETS = [(0.0, 0.10), (0.10, 0.25), (0.25, 0.50), (0.50, 1.00), (1.00, float("inf"))]


# ------------------------------------------------------------------ kjøringene


def run_arm(season_name: str, arm: str | None):
    season = load_season(season_name)
    try:
        prior = load_season(previous_season(season_name))
    except RuntimeError:
        prior = None
    decisions: list = []
    result = run_backtest(
        season,
        prior=prior,
        min_gain=1.0,
        max_transfers=2,
        horizon=5,
        arm=arm,
        decisions=decisions if arm else None,
        label=arm or "baseline",
    )
    return result, decisions


# --------------------------------------------------------------- statistikken


def paired_gameweek_deltas(left, right) -> list[float]:
    """Paret differanse per runde. Rundene er de samme; troppene er ikke."""
    by_event = {gw.event: gw.net_points for gw in right.gameweeks}
    return [
        float(gw.net_points - by_event[gw.event])
        for gw in left.gameweeks
        if gw.event in by_event
    ]


def block_bootstrap(per_season: dict[str, list[float]], seed: int = 20260817):
    """Blokkbootstrap med runden som udelelig enhet, blokker på 4 innen sesong.

    Beslutninger innenfor samme runde deler kamper, form og modelltilstand, og
    troppen bæres videre mellom runder. Blokker på 4 fanger begge deler; enkelt-
    rundetrekning ville gitt et altfor smalt intervall.
    """
    rng = random.Random(seed)
    seasons = list(per_season)
    totals = []
    for _ in range(BOOTSTRAP_DRAWS):
        season_total = 0.0
        for name in seasons:
            series = per_season[name]
            if not series:
                continue
            blocks = [
                series[start : start + BLOCK_SIZE] for start in range(0, len(series), BLOCK_SIZE)
            ]
            drawn: list[float] = []
            while len(drawn) < len(series):
                drawn.extend(blocks[rng.randrange(len(blocks))])
            season_total += sum(drawn[: len(series)])
        totals.append(season_total / len(seasons))
    totals.sort()
    low = totals[int(0.025 * len(totals))]
    high = totals[int(0.975 * len(totals)) - 1]
    return low, high


def verdict(mean_delta: float, seasons_positive: int, seasons: int, gates_ok: bool) -> str:
    """Kriteriene anvendt mekanisk. Ingen skjønnsmessig oppgradering."""
    if mean_delta < FAIL_THRESHOLD:
        return "FAIL"
    consistent = seasons_positive >= min(CONSISTENCY_REQUIRED, seasons)
    if mean_delta >= PASS_THRESHOLD and consistent and gates_ok:
        return "PASS"
    return "INCONCLUSIVE"


def compare(name: str, results_left: dict, results_right: dict, gates_ok: bool = True) -> dict:
    per_season_deltas = {}
    season_totals = {}
    for season_name in results_left:
        left, right = results_left[season_name], results_right[season_name]
        per_season_deltas[season_name] = paired_gameweek_deltas(left, right)
        season_totals[season_name] = left.total_points - right.total_points

    values = list(season_totals.values())
    mean_delta = statistics.fmean(values)
    positive = sum(1 for v in values if v > 0)
    all_rounds = [d for series in per_season_deltas.values() for d in series]
    low, high = block_bootstrap(per_season_deltas)

    return {
        "name": name,
        "verdict": verdict(mean_delta, positive, len(values), gates_ok),
        "season_totals": season_totals,
        "mean_season_delta": mean_delta,
        "seasons_positive": positive,
        "seasons": len(values),
        "mean_round_delta": statistics.fmean(all_rounds) if all_rounds else 0.0,
        "median_round_delta": statistics.median(all_rounds) if all_rounds else 0.0,
        "share_rounds_positive": (
            sum(1 for d in all_rounds if d > 0) / len(all_rounds) if all_rounds else 0.0
        ),
        "bootstrap_ci": [low, high],
        "rounds": len(all_rounds),
    }


# ------------------------------------------------------------- diagnostikken


def divergence(decisions: list) -> dict:
    lineup = [d for d in decisions if d.kind == "lineup"]
    transfer = [d for d in decisions if d.kind == "transfer"]
    counts = {
        "rounds_with_any_change": len({(d.season, d.event) for d in decisions}),
        "transfers_changed": len(transfer),
        "captain_changed": sum(1 for d in lineup if "kaptein" in d.reason),
        "vice_changed": sum(1 for d in lineup if "visekaptein" in d.reason),
        "starting_xi_changed": sum(1 for d in lineup if "starter mot benk" in d.reason),
        "bench_order_changed": sum(1 for d in lineup if "benkerekkefølge" in d.reason),
    }
    realized = [d.realized_delta for d in lineup if d.realized_delta is not None]
    counts["lineup_decisions"] = len(lineup)
    counts["realized_positive"] = sum(1 for d in realized if d > 0)
    counts["realized_negative"] = sum(1 for d in realized if d < 0)
    counts["realized_zero"] = sum(1 for d in realized if d == 0)
    counts["realized_total"] = sum(realized)

    by_reason: dict[str, dict] = {}
    for decision in lineup:
        if decision.realized_delta is None:
            continue
        entry = by_reason.setdefault(decision.reason, {"count": 0, "realized": 0, "predicted": 0.0})
        entry["count"] += 1
        entry["realized"] += decision.realized_delta
        entry["predicted"] += decision.predicted_delta
    counts["by_reason"] = by_reason
    return counts


def calibration(decisions: list) -> list[dict]:
    """Predikert beslutningsfordel mot realisert. Diagnostikk, ikke noe å tune på."""
    rows = []
    usable = [d for d in decisions if d.kind == "lineup" and d.realized_delta is not None]
    for low, high in BUCKETS:
        inside = [d for d in usable if low <= d.predicted_delta < high]
        if not inside:
            continue
        rows.append(
            {
                "bucket": f"{low:.2f}-{high:.2f}" if high != float("inf") else f">{low:.2f}",
                "count": len(inside),
                "mean_predicted": statistics.fmean(d.predicted_delta for d in inside),
                "mean_realized": statistics.fmean(float(d.realized_delta) for d in inside),
            }
        )
    return rows


# ------------------------------------------------------------------ rapporten


def main() -> int:
    parser = argparse.ArgumentParser(description="Forhåndsregistrert V1A-test")
    parser.add_argument("--out", default="data/v1a.json")
    parser.add_argument("--seasons", nargs="*", default=SEASONS)
    args = parser.parse_args()

    arms = {"baseline": None, "v1a-0": ARM_MEAN_PRESERVING, "v1a-1": ARM_STRUCTURAL}
    results: dict[str, dict] = {label: {} for label in arms}
    logs: dict[str, list] = {label: [] for label in arms}

    for season_name in args.seasons:
        for label, arm in arms.items():
            result, decisions = run_arm(season_name, arm)
            results[label][season_name] = result
            logs[label].extend(decisions)
            print(
                f"  {season_name}  {label:<9}{result.total_points:>5} poeng "
                f"({result.total_transfers} bytter, {result.total_hits} hits)",
                flush=True,
            )

    tests = [
        compare("V1A-0 vs baseline", results["v1a-0"], results["baseline"]),
        compare("V1A-1 inkrementelt (mot V1A-0)", results["v1a-1"], results["v1a-0"]),
        compare("V1A-1 vs baseline", results["v1a-1"], results["baseline"]),
    ]

    print("\n" + "=" * 72)
    print("UTFALL")
    print("=" * 72)
    for test in tests:
        print(f"  {test['name']:<34}{test['verdict']}")

    print("\nPOLICYRESULTAT")
    print(f"  {'Sesong':<10}{'baseline':>10}{'V1A-0':>10}{'V1A-1':>10}"
          f"{'Δ0':>8}{'Δ1':>8}{'Δ1-0':>8}")
    for season_name in args.seasons:
        base = results["baseline"][season_name].total_points
        zero = results["v1a-0"][season_name].total_points
        one = results["v1a-1"][season_name].total_points
        print(
            f"  {season_name:<10}{base:>10}{zero:>10}{one:>10}"
            f"{zero - base:>+8}{one - base:>+8}{one - zero:>+8}"
        )

    print("\nUSIKKERHET")
    for test in tests:
        low, high = test["bootstrap_ci"]
        print(
            f"  {test['name']:<34} snitt/sesong {test['mean_season_delta']:>+7.1f}   "
            f"runde {test['mean_round_delta']:>+5.2f} median {test['median_round_delta']:>+5.2f}   "
            f"positive runder {test['share_rounds_positive']:.0%}   "
            f"KI [{low:+.1f}, {high:+.1f}]"
        )

    print("\nBESLUTNINGSDIVERGENS")
    diagnostics = {}
    for label in ("v1a-0", "v1a-1"):
        counts = divergence(logs[label])
        diagnostics[label] = counts
        rounds = sum(len(results[label][s].gameweeks) for s in args.seasons)
        print(f"\n  {label} mot grunnlinjen, over {rounds} runder")
        print(f"    runder med endret beslutning   {counts['rounds_with_any_change']}")
        print(f"    bytter endret                  {counts['transfers_changed']}")
        print(f"    kaptein endret                 {counts['captain_changed']}")
        print(f"    visekaptein endret             {counts['vice_changed']}")
        print(f"    startellever endret            {counts['starting_xi_changed']}")
        print(f"    benkerekkefølge endret         {counts['bench_order_changed']}")
        print(
            f"    realisert av endrede valg:     "
            f"+{counts['realized_positive']} / -{counts['realized_negative']} / "
            f"0:{counts['realized_zero']}   sum {counts['realized_total']:+d}"
        )
        if counts["by_reason"]:
            print(f"    {'årsak':<28}{'antall':>8}{'predikert':>12}{'realisert':>12}")
            for reason, entry in sorted(
                counts["by_reason"].items(), key=lambda kv: -abs(kv[1]["realized"])
            ):
                print(
                    f"    {reason:<28}{entry['count']:>8}"
                    f"{entry['predicted']:>+12.1f}{entry['realized']:>+12d}"
                )

    print("\nPREDIKERT MOT REALISERT BESLUTNINGSFORDEL")
    calibrations = {}
    for label in ("v1a-0", "v1a-1"):
        rows = calibration(logs[label])
        calibrations[label] = rows
        print(f"\n  {label}")
        print(
            f"    {'predikert fordel':<20}{'antall':>8}"
            f"{'snitt predikert':>18}{'snitt realisert':>18}"
        )
        for row in rows:
            print(
                f"    {row['bucket']:<20}{row['count']:>8}"
                f"{row['mean_predicted']:>+18.3f}{row['mean_realized']:>+18.3f}"
            )

    payload = {
        "tests": tests,
        "policy": {
            label: {s: results[label][s].total_points for s in args.seasons} for label in arms
        },
        "divergence": diagnostics,
        "calibration": calibrations,
        "decisions": {label: [d.to_dict() for d in logs[label]] for label in ("v1a-0", "v1a-1")},
    }
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf8")
    print(f"\nSkrev {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
