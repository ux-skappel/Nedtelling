"""Kjører mange backtester med varierte forutsetninger, og oversetter til rank.

Backtesten er deterministisk: samme sesong og samme innstillinger gir samme
svar hver gang. Skal tusen kjøringer bety noe, må noe ekte variere. To ting
gjør det her:

* **Innstillingene.** Byttegrense, horisont og maks antall bytter trekkes
  tilfeldig. Det speiler at jeg valgte standardverdiene med skjønn, ikke fasit.
* **Anslagene.** Modellens xP forstyrres med støy. Det speiler at modellen er
  omtrent riktig, ikke nøyaktig riktig.

Spredningen som kommer ut er altså et *følsomhetsspenn*: hvor mye utfallet
avhenger av valg jeg tok på sviktende grunnlag. Det er ikke et anslag på hvor
mye flaks svinger en FPL-sesong.

    python scripts/run_simulation.py --runs 1000 --out data/simulation.json
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.backtest.engine import run_backtest
from fplbot.backtest.history import load_season, previous_season
from fplbot.backtest.rank import build_curves, season_key
from fplbot.model import ProjectionModel

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]

# Rommet av innstillinger et fornuftig menneske kunne valgt.
MIN_GAINS = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
HORIZONS = [2, 3, 4, 5, 6, 7, 8]
MAX_TRANSFERS = [1, 2]
# Standardavvik på støyen som legges på hvert anslag, i poeng.
NOISE_LEVELS = [0.0, 0.2, 0.4, 0.6, 0.8]


def noisy(sigma: float, seed: int):
    """Legger tilfeldig støy på anslagene, som om modellen var litt annerledes."""
    if sigma <= 0:
        return None
    rng = random.Random(seed)

    def override(model: ProjectionModel, event: int, season) -> None:
        for player in model.players.values():
            for gameweek, projection in player.xp.items():
                player.xp[gameweek] = max(0.0, projection + rng.gauss(0.0, sigma))

    return override


def run_season(job: tuple[str, int, int]) -> list[dict]:
    """Kjører alle simuleringene for én sesong, med delt modell-cache."""
    season_name, runs, seed = job
    season = load_season(season_name)
    try:
        prior = load_season(previous_season(season_name))
    except RuntimeError:
        prior = None

    rng = random.Random(seed)
    cache: dict = {}
    results = []
    started = time.time()

    for index in range(runs):
        settings = {
            "min_gain": rng.choice(MIN_GAINS),
            "horizon": rng.choice(HORIZONS),
            "max_transfers": rng.choice(MAX_TRANSFERS),
            "noise": rng.choice(NOISE_LEVELS),
        }
        result = run_backtest(
            season,
            prior=prior,
            horizon=settings["horizon"],
            min_gain=settings["min_gain"],
            max_transfers=settings["max_transfers"],
            projection_override=noisy(settings["noise"], seed=rng.randrange(1 << 30)),
            model_cache=cache,
        )
        results.append(
            {
                "season": season_name,
                **settings,
                "total_points": result.total_points,
                "transfers": result.total_transfers,
                "hit_cost": result.total_hits * 4,
                "bench_points": sum(gw.bench_points for gw in result.gameweeks),
            }
        )
        if (index + 1) % 25 == 0:
            pace = (time.time() - started) / (index + 1)
            print(
                f"  {season_name}: {index + 1}/{runs} kjøringer "
                f"({pace:.1f}s per kjøring)",
                flush=True,
            )
    return results


def summarise(results: list[dict], curves: dict) -> dict:
    """Regner ut fordeling og plassering per sesong."""
    by_season: dict[str, list[dict]] = {}
    for record in results:
        by_season.setdefault(record["season"], []).append(record)

    summary = {}
    for season, records in sorted(by_season.items()):
        totals = sorted(r["total_points"] for r in records)
        curve = curves.get(season_key(season))

        def at(percentile: float, values: list[int] = totals) -> int:
            index = min(len(values) - 1, int(percentile / 100 * len(values)))
            return values[index]

        best = max(records, key=lambda r: r["total_points"])
        summary[season] = {
            "runs": len(records),
            "median": statistics.median(totals),
            "mean": round(statistics.mean(totals), 1),
            "stdev": round(statistics.pstdev(totals), 1) if len(totals) > 1 else 0.0,
            "min": totals[0],
            "max": totals[-1],
            "p10": at(10),
            "p25": at(25),
            "p75": at(75),
            "p90": at(90),
            "totals": totals,
            "best_settings": {
                key: best[key] for key in ("min_gain", "horizon", "max_transfers", "noise")
            },
            "managers": curve.managers if curve else None,
            "rank": {
                key: (curve.rank_for(value) if curve else None)
                for key, value in (
                    ("median", statistics.median(totals)),
                    ("p10", at(10)),
                    ("p90", at(90)),
                    ("best", totals[-1]),
                    ("worst", totals[0]),
                )
            },
            "percentile_median": (
                round(curve.percentile_for(statistics.median(totals)), 2) if curve else None
            ),
        }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Simuler mange sesonger med boten")
    parser.add_argument("--runs", type=int, default=1000, help="totalt antall kjøringer")
    parser.add_argument("--seasons", nargs="*", default=SEASONS)
    parser.add_argument("--out", default="data/simulation.json")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--rank-samples", type=int, default=600)
    args = parser.parse_args()

    print("Bygger rangeringskurver fra ekte lag ...")
    curves = build_curves(samples=args.rank_samples)
    print(f"  {len(curves)} sesonger, {sum(c.samples for c in curves.values())} datapunkter\n")

    per_season = args.runs // len(args.seasons)
    jobs = [(season, per_season, 1000 + i) for i, season in enumerate(args.seasons)]
    print(f"Kjører {per_season} simuleringer per sesong ({per_season * len(jobs)} totalt) ...\n")

    started = time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = [record for batch in pool.map(run_season, jobs) for record in batch]

    summary = summarise(results, curves)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "runs": results,
                "summary": summary,
                "curves": {
                    season: {"points": curve.points, "ranks": curve.ranks}
                    for season, curve in curves.items()
                    if curve.samples >= 40
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf8",
    )

    print(f"\nFerdig på {(time.time() - started) / 60:.1f} minutter.\n")
    header = f"{'Sesong':<10}{'Median':>8}{'Spenn':>16}{'Rank (median)':>16}{'Topp 1000?':>12}"
    print(header)
    print("-" * len(header))
    for season, stats in summary.items():
        rank = stats["rank"]["median"]
        best_rank = stats["rank"]["best"]
        low, high = stats["p10"], stats["p90"]
        spread = f"{low}-{high}"
        rank_text = f"{rank:,}".replace(",", " ") if rank else "-"
        best_text = f"{best_rank:,}".replace(",", " ") if best_rank else "-"
        print(
            f"{season:<10}{stats['median']:>8.0f}{spread:>16}{rank_text:>16}{best_text:>12}"
        )
    print(f"\nSkrev {output} ({output.stat().st_size // 1024} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
