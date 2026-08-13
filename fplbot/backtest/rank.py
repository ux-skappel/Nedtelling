"""Oversetter en poengsum til plassering i verden.

FPL har ingen tabell over «hvor mange poeng ga hvilken rank». Men hvert lag
husker sine tidligere sesonger, med både poengsum og plassering. Henter vi noen
hundre tilfeldige lag, får vi like mange ekte punkter på kurven.

Merk at skjevhet i utvalget ikke forkludrer kurven: hvert par av poeng og rank
er sant uansett hvilket lag det kom fra. Utvalget bestemmer bare hvilken del av
kurven vi dekker, ikke hvor den ligger.

Kurvene er svært ulike fra sesong til sesong - 2419 poeng ga plass 4 119 i
2025/26, mens 2502 poeng bare ga plass 120 612 i 2024/25 - så de må holdes
adskilt.
"""

from __future__ import annotations

import bisect
import json
import math
import random
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import requests

from ..api import BASE, DEFAULT_CACHE_DIR, USER_AGENT

# Lag-ID-ene er delt i bånd så vi treffer både gamle og nye lag. Uten dette
# ville nesten alle trukne lag vært nye, og de eldste sesongene stått tomme.
ID_BANDS = [(1, 1_000_000), (1_000_000, 3_000_000), (3_000_000, 6_000_000),
            (6_000_000, 9_000_000), (9_000_000, 12_000_000)]
WORKERS = 8


@dataclass
class RankCurve:
    """Punkter på kurven for én sesong, sortert fra flest poeng til færrest."""

    season: str
    points: list[int] = field(default_factory=list)
    ranks: list[int] = field(default_factory=list)

    @property
    def samples(self) -> int:
        return len(self.points)

    @property
    def managers(self) -> int:
        """Anslag på hvor mange som spilte, fra den svakeste ranken vi så."""
        return max(self.ranks) if self.ranks else 0

    def rank_for(self, total: float) -> int | None:
        """Anslår plassering for en poengsum, ved å interpolere i log(rank).

        Rank faller eksponentielt med poeng, så interpolasjonen gjøres på
        logaritmen. Utenfor punktene vi har, låses svaret til ytterpunktet.
        """
        if not self.points:
            return None
        ascending = self.points[::-1]
        index = bisect.bisect_left(ascending, total)
        if index <= 0:
            return self.ranks[-1]
        if index >= len(ascending):
            return self.ranks[0]

        low_points, high_points = ascending[index - 1], ascending[index]
        low_rank = self.ranks[len(ascending) - index]
        high_rank = self.ranks[len(ascending) - index - 1]
        if high_points == low_points:
            return min(low_rank, high_rank)

        share = (total - low_points) / (high_points - low_points)
        log_rank = math.log(max(1, low_rank)) + share * (
            math.log(max(1, high_rank)) - math.log(max(1, low_rank))
        )
        return max(1, round(math.exp(log_rank)))

    def percentile_for(self, total: float) -> float | None:
        """Hvor stor andel av feltet du slår, i prosent."""
        rank = self.rank_for(total)
        if rank is None or not self.managers:
            return None
        return 100.0 * (1.0 - rank / self.managers)


def _fetch_history(session: requests.Session, entry_id: int) -> list[dict]:
    try:
        response = session.get(f"{BASE}/entry/{entry_id}/history/", timeout=20)
        if not response.ok:
            return []
        return response.json().get("past", [])
    except (requests.RequestException, ValueError):
        return []


def build_curves(
    samples: int = 600,
    seed: int = 7,
    workers: int = WORKERS,
    cache_file: Path | None = None,
) -> dict[str, RankCurve]:
    """Trekker tilfeldige lag og bygger én kurve per sesong."""
    cache_file = Path(cache_file or DEFAULT_CACHE_DIR / f"rank_curves_{samples}.json")
    if cache_file.exists():
        stored = json.loads(cache_file.read_text())
        return {
            season: RankCurve(season=season, points=data["points"], ranks=data["ranks"])
            for season, data in stored.items()
        }

    rng = random.Random(seed)
    entry_ids = []
    per_band = max(1, samples // len(ID_BANDS))
    for low, high in ID_BANDS:
        entry_ids.extend(rng.randint(low, high - 1) for _ in range(per_band))

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})

    pairs: dict[str, list[tuple[int, int]]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for past in pool.map(lambda entry: _fetch_history(session, entry), entry_ids):
            for record in past:
                total, rank = record.get("total_points"), record.get("rank")
                if total and rank:
                    pairs.setdefault(record["season_name"], []).append((int(total), int(rank)))

    curves: dict[str, RankCurve] = {}
    for season, observations in pairs.items():
        observations.sort(key=lambda item: -item[0])
        curves[season] = RankCurve(
            season=season,
            points=[p for p, _ in observations],
            ranks=[r for _, r in observations],
        )

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(
            {s: {"points": c.points, "ranks": c.ranks} for s, c in curves.items()},
            ensure_ascii=False,
        )
    )
    return curves


def season_key(season: str) -> str:
    """Gjør «2025-26» om til «2025/26», som er formatet FPL bruker."""
    return season.replace("-", "/")
