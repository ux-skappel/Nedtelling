"""Kjører backtesten over flere sesonger og byttepolicyer, og lagrer JSON.

Resultatet mater dashboardet. Hver kombinasjon av sesong og policy kjøres som
en egen prosess, siden de er helt uavhengige av hverandre.

    python scripts/run_backtests.py --out data/backtests.json
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.backtest.engine import run_backtest
from fplbot.backtest.history import load_season, previous_season

# Sesonger der arkivet har xG, xA og starter. Eldre sesonger mangler dem.
SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]

# Policyen dashboardet viser laguttak for, runde for runde.
DETAILED_POLICY = "standard"

# Policyene vi vil sammenlikne. "Hold" bytter aldri, og viser hvor mye
# bytteregelen egentlig er verdt.
POLICIES = [
    {"label": "hold", "min_gain": 10_000.0, "horizon": 5, "max_transfers": 1},
    {"label": "forsiktig", "min_gain": 2.5, "horizon": 5, "max_transfers": 1},
    {"label": "standard", "min_gain": 1.0, "horizon": 5, "max_transfers": 2},
    {"label": "aktiv", "min_gain": 0.0, "horizon": 5, "max_transfers": 2},
    {"label": "kort sikt", "min_gain": 1.0, "horizon": 2, "max_transfers": 2},
    {"label": "lang sikt", "min_gain": 1.0, "horizon": 8, "max_transfers": 2},
]


def run_one(job: tuple[str, dict]) -> dict:
    season_name, policy = job
    season = load_season(season_name)
    try:
        prior = load_season(previous_season(season_name))
    except RuntimeError:
        prior = None

    result = run_backtest(
        season,
        prior=prior,
        horizon=policy["horizon"],
        min_gain=policy["min_gain"],
        max_transfers=policy["max_transfers"],
        label=policy["label"],
    )
    print(
        f"  {season_name} / {policy['label']:<10} {result.total_points:5} poeng "
        f"({result.total_transfers} bytter)",
        flush=True,
    )
    data = result.to_dict()
    if policy["label"] != DETAILED_POLICY:
        # Laguttak per runde er tungt. Vi tar det bare med for policyen
        # dashboardet lar deg bla i.
        for gameweek in data["gameweeks"]:
            gameweek["starters"] = []
            gameweek["bench"] = []
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Kjør backtester og lagre JSON")
    parser.add_argument("--out", default="data/backtests.json")
    parser.add_argument("--seasons", nargs="*", default=SEASONS)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    jobs = [(season, policy) for season in args.seasons for policy in POLICIES]
    print(f"Kjører {len(jobs)} backtester på {args.workers} prosesser ...\n")

    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(run_one, jobs))

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"runs": results}, ensure_ascii=False), encoding="utf8")
    print(f"\nSkrev {len(results)} kjøringer til {output} ({output.stat().st_size // 1024} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
