"""Kalibrering av anslag betinget på hvor høyt modellen rangerte spilleren.

Målt over 2025/26 overvurderer modellen sine egne topp 15 med +0,54 poeng per
spiller per runde, mens sjiktet 31-60 treffer på null. Det er optimizer's curse:
optimereren plukker nettopp de spillerne der feilen peker oppover, så global
kalibrering skjuler problemet i stedet for å vise det.

Modulen lærer én monoton korreksjon per rangeringssjikt. Monoton fordi et høyere
anslag aldri skal bli korrigert ned under et lavere - vi vil justere nivået, ikke
snu rekkefølgen.

Hypotese H4: kalibrering betinget på predikert rangering, estimert ut av utvalg,
forbedrer beslutninger ende-til-ende. Den kan være feil. De ekstreme anslagene
kan være ekte signal som tilfeldigvis bommet, og da skal korreksjonen forkastes.
"""

from __future__ import annotations

import bisect
import json
from dataclasses import dataclass, field
from pathlib import Path

# Sjikt etter modellens egen rangering innenfor runden.
DEFAULT_BANDS: tuple[tuple[int, int], ...] = (
    (1, 15),
    (16, 30),
    (31, 60),
    (61, 150),
    (151, 10_000),
)
# Under dette antall observasjoner stoler vi ikke på et sjikt.
MIN_SAMPLES = 200


def isotonic_fit(pairs: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Monoton tilpasning med Pool Adjacent Violators.

    Tar (anslag, fasit) og returnerer en stigende trappefunksjon som
    knekkpunkter. Ingen avhengigheter; algoritmen er kort nok til å eies selv.
    """
    if not pairs:
        return []
    ordered = sorted(pairs)
    # Hver blokk er [sum av y, antall, siste x].
    blocks: list[list[float]] = []
    for x, y in ordered:
        blocks.append([y, 1.0, x])
        # Slå sammen bakover så lenge snittet synker.
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            last = blocks.pop()
            blocks[-1][0] += last[0]
            blocks[-1][1] += last[1]
            blocks[-1][2] = last[2]
    return [(block[2], block[0] / block[1]) for block in blocks]


def isotonic_apply(curve: list[tuple[float, float]], value: float) -> float:
    """Slår opp i trappefunksjonen, med lineær interpolasjon mellom knekkpunkter."""
    if not curve:
        return value
    xs = [x for x, _ in curve]
    if value <= xs[0]:
        return curve[0][1]
    if value >= xs[-1]:
        return curve[-1][1]
    index = bisect.bisect_left(xs, value)
    x0, y0 = curve[index - 1]
    x1, y1 = curve[index]
    if x1 == x0:
        return y1
    share = (value - x0) / (x1 - x0)
    return y0 + share * (y1 - y0)


@dataclass
class BandedCalibrator:
    """Én monoton korreksjon per rangeringssjikt."""

    bands: tuple[tuple[int, int], ...] = DEFAULT_BANDS
    curves: dict[str, list[tuple[float, float]]] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)

    @staticmethod
    def _key(band: tuple[int, int]) -> str:
        return f"{band[0]}-{band[1]}"

    def band_for(self, rank: int) -> tuple[int, int] | None:
        for band in self.bands:
            if band[0] <= rank <= band[1]:
                return band
        return None

    def fit(self, observations: list[tuple[float, float, int]]) -> BandedCalibrator:
        """Lærer av (anslag, fasit, rangering i runden)."""
        grouped: dict[str, list[tuple[float, float]]] = {}
        for predicted, actual, rank in observations:
            band = self.band_for(rank)
            if band is None:
                continue
            grouped.setdefault(self._key(band), []).append((predicted, actual))

        for key, pairs in grouped.items():
            self.counts[key] = len(pairs)
            # For få observasjoner: la sjiktet stå urørt i stedet for å gjette.
            if len(pairs) >= MIN_SAMPLES:
                self.curves[key] = isotonic_fit(pairs)
        return self

    def correct(self, predicted: float, rank: int) -> float:
        band = self.band_for(rank)
        if band is None:
            return predicted
        curve = self.curves.get(self._key(band))
        if not curve:
            return predicted
        return isotonic_apply(curve, predicted)

    def shift_at(self, rank: int, predicted: float) -> float:
        """Hvor mye korreksjonen flytter et anslag. Negativt = krympet ned."""
        return self.correct(predicted, rank) - predicted

    # ------------------------------------------------------------------ lagring

    def to_dict(self) -> dict:
        return {
            "bands": [list(b) for b in self.bands],
            "curves": {k: [list(p) for p in v] for k, v in self.curves.items()},
            "counts": self.counts,
        }

    @classmethod
    def from_dict(cls, data: dict) -> BandedCalibrator:
        calibrator = cls(bands=tuple(tuple(b) for b in data["bands"]))
        calibrator.curves = {
            k: [(p[0], p[1]) for p in v] for k, v in data.get("curves", {}).items()
        }
        calibrator.counts = data.get("counts", {})
        return calibrator

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict()), encoding="utf8")

    @classmethod
    def load(cls, path: Path) -> BandedCalibrator:
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf8")))


def as_projection_override(calibrator: BandedCalibrator):
    """Pakker kalibratoren som en projection_override for backtesten.

    Rangeringen regnes innenfor hver runde for seg, slik den ble lært.
    """

    def override(model, event: int, season) -> None:
        candidates = [p for p in model.players.values() if p.expected_minutes > 5]
        # Korriger hver runde i horisonten mot rangeringen i nettopp den runden.
        horizon = sorted({gw for p in candidates for gw in p.xp})
        for gameweek in horizon:
            ordered = sorted(candidates, key=lambda p: -p.xp.get(gameweek, 0.0))
            for rank, player in enumerate(ordered, start=1):
                current = player.xp.get(gameweek)
                if current is not None:
                    player.xp[gameweek] = max(0.0, calibrator.correct(current, rank))

    return override
