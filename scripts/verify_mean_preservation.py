"""Test D i full skala: middelbevaring for V1A-0 over hele historikken.

Invarianten som gjør V1A-0 til en ren ablasjon:

    | Sum over tilstander av P(tilstand)*E[poeng|tilstand], minus skalar xP |  <  1e-9

Holder den ikke, har tilstandsdekomposisjonen endret spillerverdier, og enhver
forskjell i sesongpoeng kan ikke lenger tilskrives regelevalueringen alene.

Kjøres over hvert spiller-runde-par i hele det historiske universet, ikke på
stikkprøver. Forventning: null brudd. Ellers stopper testen.

    python scripts/verify_mean_preservation.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.appearance import (
    ARM_MEAN_PRESERVING,
    ARM_STRUCTURAL,
    MEAN_TOLERANCE,
    build_states,
)
from fplbot.backtest.history import load_season, previous_season
from fplbot.model import ProjectionModel
from fplbot.strength import fit_team_strength

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]
HORIZON = 5


def sweep(season_name: str) -> dict:
    season = load_season(season_name)
    try:
        prior = load_season(previous_season(season_name))
    except RuntimeError:
        prior = None

    checked = 0
    violations = 0
    worst = 0.0
    total_error = 0.0
    mass_worst = 0.0
    flattened = 0
    # Hvor langt V1A-1 flytter forventningen. Ikke en invariant, men det er
    # nøyaktig det som utgjør den inkrementelle armen, så det måles her.
    drift_total = 0.0
    drift_worst = 0.0
    drift_relative = 0.0
    drift_count = 0

    for event in range(1, max(season.events) + 1):
        bootstrap, fixtures = season.snapshot(event, prior=prior)
        finished = [e["id"] for e in bootstrap["events"] if e["finished"]]
        strength = fit_team_strength(
            fixtures, [t["id"] for t in bootstrap["teams"]], max(finished) if finished else 0
        )
        model = ProjectionModel(bootstrap, fixtures, strength=strength)
        last = model.events[-1]["id"]
        horizon = list(range(event, min(last, event + HORIZON - 1) + 1))

        for player in model.players.values():
            for gameweek in horizon:
                scalar = player.xp.get(gameweek, 0.0)
                states = build_states(player, gameweek, ARM_MEAN_PRESERVING)
                checked += 1
                mass_worst = max(mass_worst, abs(states.mass() - 1.0))
                if states.p_played <= 0.0:
                    continue
                error = abs(states.mean - scalar)
                worst = max(worst, error)
                total_error += error
                if error >= MEAN_TOLERANCE:
                    violations += 1
                if states.ev_partial == states.ev_sixty and scalar != 0.0:
                    flattened += 1

                structural = build_states(player, gameweek, ARM_STRUCTURAL)
                drift = structural.mean - states.mean
                drift_total += drift
                if abs(drift) > abs(drift_worst):
                    drift_worst = drift
                if abs(scalar) > 0.5:
                    drift_relative += drift / scalar
                    drift_count += 1

    return {
        "season": season_name,
        "checked": checked,
        "violations": violations,
        "max_abs_error": worst,
        "mean_abs_error": total_error / max(1, checked),
        "max_mass_error": mass_worst,
        "flattened": flattened,
        "v1a1_mean_drift": drift_total / max(1, checked),
        "v1a1_max_drift": drift_worst,
        "v1a1_relative_drift": drift_relative / max(1, drift_count),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Test D over hele historikken")
    parser.add_argument("--seasons", nargs="*", default=SEASONS)
    args = parser.parse_args()

    print("Test D - middelbevaring for V1A-0\n")
    print(f"  {'Sesong':<10}{'Spiller-runder':>16}{'Brudd':>8}{'Maks avvik':>14}{'Snitt':>12}")
    print("  " + "-" * 60)

    total_violations = 0
    total_checked = 0
    rows = []
    for name in args.seasons:
        row = sweep(name)
        rows.append(row)
        total_violations += row["violations"]
        total_checked += row["checked"]
        print(
            f"  {row['season']:<10}{row['checked']:>16,}{row['violations']:>8}"
            f"{row['max_abs_error']:>14.2e}{row['mean_abs_error']:>12.2e}".replace(",", " ")
        )

    print("\n  Sannsynlighetsmasse (test C), største avvik fra 1:")
    for row in rows:
        print(f"    {row['season']}  {row['max_mass_error']:.2e}")

    print("\n  V1A-1: hvor langt den strukturelle armen flytter forventningen")
    print(f"    {'Sesong':<10}{'snitt poeng':>14}{'maks':>10}{'snitt relativt':>18}")
    for row in rows:
        print(
            f"    {row['season']:<10}{row['v1a1_mean_drift']:>+14.4f}"
            f"{row['v1a1_max_drift']:>+10.3f}{row['v1a1_relative_drift']:>+17.2%}"
        )

    print(f"\n  Utflatede spiller-runder (ikke-monoton uten utflating): "
          f"{sum(r['flattened'] for r in rows):,}".replace(",", " "))

    print(f"\nTotalt {total_checked:,} spiller-runder, {total_violations} brudd".replace(",", " "))
    if total_violations:
        print("\nSTOPP. Middelbevaring feiler; ingen historisk policytest skal kjøres.")
        return 1
    print("Test D bestått.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
