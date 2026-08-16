"""Undersøker hvorfor bedre snittbom kan gi færre poeng.

Global MAE måles over ~600 spillere. Optimereren bryr seg bare om de 15 den
kjøper, og de plukkes fra toppen av anslagene. Hvis modellen systematisk
overvurderer nettopp de høyest rangerte, vil global MAE se bra ut mens laget
blir dårligere - lærebokeksempelet på optimizer's curse.

Skriptet segmenterer prediksjonene etter hvor høyt modellen rangerte spilleren
den runden, og måler skjevhet og treff i hvert sjikt.

    python scripts/analyse_calibration.py --season 2025-26
"""

from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.backtest.history import load_season, previous_season, prior_profile
from fplbot.model import ProjectionModel
from fplbot.strength import fit_team_strength

# Sjikt etter modellens egen rangering samme runde.
BANDS = [(1, 15), (16, 30), (31, 60), (61, 150), (151, 10_000)]


def collect(season, prior, use_prior_stats: bool, start: int = 2):
    """Samler (anslag, fasit, rangering) for hver spiller i hver runde."""
    priors = prior_profile(prior, season) if (prior and use_prior_stats) else {}
    rows = []
    for event in range(start, max(season.events) + 1):
        bootstrap, fixtures = season.snapshot(event, prior=prior)
        finished = [e["id"] for e in bootstrap["events"] if e["finished"]]
        strength = fit_team_strength(
            fixtures, [t["id"] for t in bootstrap["teams"]], max(finished) if finished else 0
        )
        model = ProjectionModel(
            bootstrap, fixtures, strength=strength, prior_stats=priors or None
        )
        # Bare spillere som i det hele tatt er aktuelle å eie.
        candidates = [p for p in model.players.values() if p.expected_minutes > 5]
        candidates.sort(key=lambda p: -p.xp.get(event, 0.0))
        for rank, player in enumerate(candidates, start=1):
            rows.append((player.xp.get(event, 0.0), season.actual_points(player.id, event), rank))
    return rows


def summarise(rows, label: str) -> None:
    print(f"\n{label}")
    print(f"  {'Sjikt':<14}{'Antall':>8}{'Anslag':>9}{'Fasit':>8}{'Skjevhet':>10}{'Bom':>7}")
    print("  " + "-" * 56)
    for low, high in BANDS:
        band = [(p, a) for p, a, r in rows if low <= r <= high]
        if not band:
            continue
        predicted = statistics.mean(p for p, _ in band)
        actual = statistics.mean(a for _, a in band)
        error = statistics.mean(abs(p - a) for p, a in band)
        name = f"topp {low}-{high}" if high < 10_000 else f"{low}+"
        print(
            f"  {name:<14}{len(band):>8}{predicted:>9.2f}{actual:>8.2f}"
            f"{predicted - actual:>+10.2f}{error:>7.2f}"
        )
    everything = [(p, a) for p, a, _ in rows]
    print(
        f"  {'ALLE':<14}{len(everything):>8}"
        f"{statistics.mean(p for p, _ in everything):>9.2f}"
        f"{statistics.mean(a for _, a in everything):>8.2f}"
        f"{statistics.mean(p - a for p, a in everything):>+10.2f}"
        f"{statistics.mean(abs(p - a) for p, a in everything):>7.2f}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Kalibrering per rangeringssjikt")
    parser.add_argument("--season", default="2025-26")
    args = parser.parse_args()

    season = load_season(args.season)
    try:
        prior = load_season(previous_season(args.season))
    except RuntimeError:
        prior = None

    print(f"Sesong {args.season}. Skjevhet = anslag minus fasit; positivt = overvurdert.")
    summarise(collect(season, prior, use_prior_stats=False), "UTEN fjorårsdata (dagens standard)")
    summarise(
        collect(season, prior, use_prior_stats=True),
        "MED fjorårsdata (målt 128 poeng svakere)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
