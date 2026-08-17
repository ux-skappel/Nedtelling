"""Tester for kandidathale-kalibrering. Ingen nettverk."""

from __future__ import annotations

from itertools import pairwise

import pytest

from fplbot.calibration import (
    DEFAULT_BANDS,
    BandedCalibrator,
    isotonic_apply,
    isotonic_fit,
)


def test_isotonic_is_monotone():
    """Utdata skal aldri synke selv om inndata gjør det."""
    pairs = [(1.0, 5.0), (2.0, 1.0), (3.0, 4.0), (4.0, 2.0), (5.0, 9.0)]
    curve = isotonic_fit(pairs)
    values = [isotonic_apply(curve, x) for x in [1.0, 2.0, 3.0, 4.0, 5.0]]
    assert all(a <= b + 1e-9 for a, b in pairwise(values))


def test_isotonic_reproduces_already_monotone_data():
    pairs = [(1.0, 1.0), (2.0, 2.0), (3.0, 3.0)]
    curve = isotonic_fit(pairs)
    for x, y in pairs:
        assert isotonic_apply(curve, x) == pytest.approx(y)


def test_isotonic_averages_a_violation():
    """To punkter som bryter monotonien slås sammen til snittet."""
    curve = isotonic_fit([(1.0, 10.0), (2.0, 0.0)])
    assert isotonic_apply(curve, 1.0) == pytest.approx(5.0)
    assert isotonic_apply(curve, 2.0) == pytest.approx(5.0)


def test_isotonic_clamps_outside_the_fitted_range():
    curve = isotonic_fit([(2.0, 2.0), (4.0, 4.0)])
    assert isotonic_apply(curve, 0.0) == pytest.approx(2.0)
    assert isotonic_apply(curve, 99.0) == pytest.approx(4.0)


def test_isotonic_handles_empty_input():
    assert isotonic_fit([]) == []
    assert isotonic_apply([], 3.0) == 3.0


def test_calibrator_learns_to_shrink_an_overconfident_band():
    """Et sjikt som systematisk overvurderer skal korrigeres ned."""
    observations = []
    for i in range(400):
        # Topp 15 anslås til 6 men scorer 4.
        observations.append((6.0 + (i % 5) * 0.1, 4.0, 1 + i % 15))
        # Sjiktet 31-60 treffer.
        observations.append((3.0 + (i % 5) * 0.1, 3.0, 31 + i % 30))
    calibrator = BandedCalibrator().fit(observations)
    assert calibrator.shift_at(1, 6.0) < -1.0
    assert abs(calibrator.shift_at(40, 3.0)) < 0.3


def test_calibrator_leaves_thin_bands_alone():
    """Under grensen for antall observasjoner skal sjiktet stå urørt."""
    observations = [(6.0, 1.0, 1) for _ in range(10)]
    calibrator = BandedCalibrator().fit(observations)
    assert calibrator.correct(6.0, 1) == 6.0


def test_band_lookup_covers_every_rank():
    calibrator = BandedCalibrator()
    for rank in [1, 15, 16, 30, 31, 60, 61, 150, 151, 5000]:
        assert calibrator.band_for(rank) is not None
    assert calibrator.band_for(99_999) is None


def test_calibrator_survives_a_round_trip(tmp_path):
    observations = [(5.0 + (i % 7) * 0.1, 3.0, 1 + i % 15) for i in range(400)]
    calibrator = BandedCalibrator().fit(observations)
    path = tmp_path / "cal.json"
    calibrator.save(path)
    restored = BandedCalibrator.load(path)
    assert restored.correct(5.0, 1) == pytest.approx(calibrator.correct(5.0, 1))
    assert restored.bands == DEFAULT_BANDS


def test_override_preserves_ordering_within_a_band():
    """Korreksjonen skal justere nivå, ikke snu rekkefølgen innad i et sjikt."""
    observations = [(6.0 + (i % 9) * 0.2, 4.0 + (i % 9) * 0.15, 1 + i % 15) for i in range(500)]
    calibrator = BandedCalibrator().fit(observations)
    values = [calibrator.correct(v, 5) for v in [6.0, 6.4, 6.8, 7.2]]
    assert all(a <= b + 1e-9 for a, b in pairwise(values))
