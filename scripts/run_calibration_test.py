"""Tester H4: hjelper kandidathale-kalibrering beslutningene ende-til-ende?

Forhåndsregistrerte kriterier (addendum A, seksjon 12, steg 0):

    1. Skjevhet i topp 15 under +0,25 på holdout.
    2. Sesongpoeng ikke dårligere enn uten kalibrering.

Walk-forward. Korreksjonen læres av 2022-23 og 2023-24, justeres mot 2024-25,
og 2025-26 røres ikke før til slutt. Ingen korreksjon estimeres på de
observasjonene den evalueres på.

    python scripts/run_calibration_test.py
"""

from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.backtest.engine import run_backtest
from fplbot.backtest.history import Season, load_season, previous_season
from fplbot.calibration import DEFAULT_BANDS, BandedCalibrator, as_projection_override
from fplbot.model import ProjectionModel
from fplbot.strength import fit_team_strength

TRAIN = ["2022-23", "2023-24"]
DEV = "2024-25"
HOLDOUT = "2025-26"


def observations(season: Season, prior: Season | None, start: int = 2):
    """(anslag, fasit, rangering) for hver spiller i hver runde."""
    rows = []
    for event in range(start, max(season.events) + 1):
        bootstrap, fixtures = season.snapshot(event, prior=prior)
        finished = [e["id"] for e in bootstrap["events"] if e["finished"]]
        strength = fit_team_strength(
            fixtures, [t["id"] for t in bootstrap["teams"]], max(finished) if finished else 0
        )
        model = ProjectionModel(bootstrap, fixtures, strength=strength)
        candidates = [p for p in model.players.values() if p.expected_minutes > 5]
        candidates.sort(key=lambda p: -p.xp.get(event, 0.0))
        for rank, player in enumerate(candidates, start=1):
            rows.append(
                (player.xp.get(event, 0.0), float(season.actual_points(player.id, event)), rank)
            )
    return rows


def band_bias(rows, calibrator: BandedCalibrator | None = None) -> dict[str, float]:
    """Skjevhet per sjikt: anslag minus fasit. Positivt = overvurdert."""
    grouped: dict[str, list[float]] = {}
    for predicted, actual, rank in rows:
        band = None
        for low, high in DEFAULT_BANDS:
            if low <= rank <= high:
                band = f"{low}-{high}"
                break
        if band is None:
            continue
        value = calibrator.correct(predicted, rank) if calibrator else predicted
        grouped.setdefault(band, []).append(value - actual)
    return {band: statistics.mean(diffs) for band, diffs in grouped.items()}


def load(name: str) -> tuple[Season, Season | None]:
    season = load_season(name)
    try:
        prior = load_season(previous_season(name))
    except RuntimeError:
        prior = None
    return season, prior


def main() -> int:
    parser = argparse.ArgumentParser(description="Test H4: kandidathale-kalibrering")
    parser.add_argument("--out", default="data/calibrator.json")
    args = parser.parse_args()

    print("Lærer korreksjon av " + " og ".join(TRAIN) + " ...")
    training = []
    for name in TRAIN:
        season, prior = load(name)
        training.extend(observations(season, prior))
    calibrator = BandedCalibrator().fit(training)
    print(f"  {len(training)} observasjoner")
    for band in DEFAULT_BANDS:
        key = f"{band[0]}-{band[1]}"
        count = calibrator.counts.get(key, 0)
        fitted = "ja" if key in calibrator.curves else "nei (for få)"
        print(f"  sjikt {key:<10}{count:>7} obs   tilpasset: {fitted}")

    # Hvor mye flytter korreksjonen et typisk anslag i hvert sjikt?
    print("\nKorreksjonens virkning på et anslag på 5,0 poeng:")
    for band in DEFAULT_BANDS:
        rank = band[0]
        shift = calibrator.shift_at(rank, 5.0)
        print(f"  sjikt {band[0]}-{band[1]:<8} {shift:+.2f}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    calibrator.save(Path(args.out))

    print("\n" + "=" * 68)
    for name in (DEV, HOLDOUT):
        label = "utvikling" if name == DEV else "HOLDOUT"
        season, prior = load(name)
        rows = observations(season, prior)

        before = band_bias(rows)
        after = band_bias(rows, calibrator)
        print(f"\n{name} ({label}) — skjevhet per sjikt")
        print(f"  {'Sjikt':<12}{'Før':>9}{'Etter':>9}")
        print("  " + "-" * 30)
        for band in DEFAULT_BANDS:
            key = f"{band[0]}-{band[1]}"
            if key in before:
                print(f"  {key:<12}{before[key]:>+9.2f}{after[key]:>+9.2f}")

        cache: dict = {}
        base = run_backtest(season, prior=prior, model_cache=cache)
        tuned = run_backtest(
            season,
            prior=prior,
            model_cache=cache,
            projection_override=as_projection_override(calibrator),
        )
        delta = tuned.total_points - base.total_points
        print(f"\n  Sesongpoeng: {base.total_points} → {tuned.total_points} ({delta:+d})")

        top = after.get("1-15", 0.0)
        criterion_1 = "OPPFYLT" if top < 0.25 else "IKKE OPPFYLT"
        criterion_2 = "OPPFYLT" if delta >= 0 else "IKKE OPPFYLT"
        print(f"  Kriterium 1 (skjevhet topp 15 < +0,25): {top:+.2f} — {criterion_1}")
        print(f"  Kriterium 2 (poeng ikke dårligere):     {delta:+d} — {criterion_2}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
