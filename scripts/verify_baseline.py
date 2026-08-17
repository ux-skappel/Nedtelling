"""Grunnlinjens fingeravtrykk, for bit-for-bit-regresjon før V1A kjøres.

V1A skal endre nøyaktig én ting: hvordan en tropp evalueres. Flytter grunnlinjen
seg samtidig, har vi endret to variabler og kan ikke tilskrive noe som helst.

Skriptet kjører grunnlinjen slik den er frosset i V1A_PREREG.md seksjon 3 og
skriver et kanonisk fingeravtrykk: sesongtotaler, og per runde kaptein, bytter,
startellever, benk, troppsverdi og bank. Kjøres det på to commits skal filene
være identiske ned til siste tegn.

    python scripts/verify_baseline.py --out data/baseline_fingerprint.json

Sammenlikning mot en tidligere commit:

    git worktree add /tmp/pre <hash>
    python /tmp/pre/scripts/verify_baseline.py --out /tmp/pre.json
    python scripts/verify_baseline.py --out /tmp/now.json
    cmp /tmp/pre.json /tmp/now.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.backtest.engine import run_backtest
from fplbot.backtest.history import load_season, previous_season

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]

# Referansetallene fra V1A_PREREG.md seksjon 3. Målt før V1A ble påbegynt.
FROZEN_TOTALS = {"2022-23": 1963, "2023-24": 2277, "2024-25": 2184, "2025-26": 2307}


def fingerprint(season_name: str) -> dict:
    season = load_season(season_name)
    try:
        prior = load_season(previous_season(season_name))
    except RuntimeError:
        prior = None

    result = run_backtest(season, prior=prior, min_gain=1.0, max_transfers=2, horizon=5)
    weeks = []
    for gameweek in result.gameweeks:
        weeks.append(
            {
                "event": gameweek.event,
                "points": gameweek.points,
                "net_points": gameweek.net_points,
                "hits": gameweek.hits,
                "transfers": gameweek.transfers,
                "captain": gameweek.captain,
                "captain_points": gameweek.captain_points,
                "bench_points": gameweek.bench_points,
                "autosubs": gameweek.autosubs,
                "squad_value": gameweek.squad_value,
                "bank": gameweek.bank,
                # Troppsutviklingen: hvem som sto på banen, hvem på benken, i rekkefølge.
                "starters": [p["name"] for p in gameweek.starters],
                "bench": [p["name"] for p in gameweek.bench],
                "moves": [f"{m['out']}->{m['in']}" for m in gameweek.moves],
            }
        )
    return {
        "season": season_name,
        "total_points": result.total_points,
        "total_transfers": result.total_transfers,
        "total_hits": result.total_hits,
        "gameweeks": weeks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fingeravtrykk av grunnlinjen")
    parser.add_argument("--out", default="data/baseline_fingerprint.json")
    parser.add_argument("--seasons", nargs="*", default=SEASONS)
    args = parser.parse_args()

    runs = []
    failures = []
    for name in args.seasons:
        data = fingerprint(name)
        runs.append(data)
        expected = FROZEN_TOTALS.get(name)
        status = "ok"
        if expected is not None and data["total_points"] != expected:
            status = f"AVVIK (ventet {expected})"
            failures.append(name)
        print(f"  {name}  {data['total_points']:>5} poeng  {status}", flush=True)

    payload = json.dumps({"runs": runs}, ensure_ascii=False, sort_keys=True, indent=None)
    digest = hashlib.sha256(payload.encode("utf8")).hexdigest()
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(payload, encoding="utf8")

    print(f"\nsha256 {digest}")
    print(f"skrev {output}")
    if failures:
        print(f"\nGRUNNLINJEN HAR FLYTTET SEG: {', '.join(failures)}. Testen stopper.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
