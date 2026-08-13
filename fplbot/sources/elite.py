"""Hva de beste managerne faktisk gjør.

Dette er kilden folk egentlig er ute etter når de ser FPL-innhold på YouTube:
hvem de som ligger øverst på verdensrankingen eier, hvem de har som kaptein, og
hva de bytter inn. Vi henter det direkte fra toppen av "Overall"-ligaen i stedet
for å gå veien om noen som forteller om det.

Eierandelen blant eliten sammenliknet med eierandelen blant alle sier noe
modellen ikke fanger opp på egen hånd: at de som gjør det best vet noe om
oppstillinger, rotasjon og roller som ikke står i statistikken ennå.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..api import DEFAULT_CACHE_DIR, FplApi, FplError

# Liga-ID-en til "Overall", altså alle spillere i hele verden.
OVERALL_LEAGUE = 314
MANAGERS_PER_PAGE = 50
# Liten pause mellom kall så vi ikke maser på FPL sine servere.
REQUEST_PAUSE = 0.25


@dataclass
class EliteView:
    """Eierskap blant topp-managerne for én gameweek."""

    event: int
    managers: int
    ownership: dict[int, float] = field(default_factory=dict)
    captaincy: dict[int, float] = field(default_factory=dict)

    def owned_by(self, player_id: int) -> float:
        return self.ownership.get(player_id, 0.0)

    def captained_by(self, player_id: int) -> float:
        return self.captaincy.get(player_id, 0.0)

    def edge(self, player_id: int, overall_ownership: float) -> float:
        """Differansen mellom elite-eierskap og eierskap blant alle, i prosentpoeng.

        Positivt tall: eliten er tyngre inne enn folket. Negativt: de har hoppet
        av, ofte før statistikken viser hvorfor.
        """
        return self.owned_by(player_id) - overall_ownership

    def top(self, limit: int = 15) -> list[tuple[int, float]]:
        return sorted(self.ownership.items(), key=lambda item: -item[1])[:limit]


def _cache_file(event: int, managers: int) -> Path:
    return DEFAULT_CACHE_DIR / f"elite_{event}_{managers}.json"


def fetch_elite_view(
    api: FplApi,
    event: int,
    managers: int = 100,
    use_cache: bool = True,
) -> EliteView | None:
    """Henter uttakene til de beste managerne og teller opp eierskapet.

    Returnerer None før sesongen har kommet i gang, siden rankingen da er tom.
    """
    if event < 1:
        return None

    cache = _cache_file(event, managers)
    if use_cache and cache.exists():
        data = json.loads(cache.read_text())
        return EliteView(
            event=data["event"],
            managers=data["managers"],
            ownership={int(k): v for k, v in data["ownership"].items()},
            captaincy={int(k): v for k, v in data["captaincy"].items()},
        )

    entry_ids = _top_entry_ids(api, managers)
    if not entry_ids:
        return None

    owned: dict[int, int] = {}
    captained: dict[int, int] = {}
    counted = 0
    for entry_id in entry_ids:
        try:
            picks = api.entry_picks(entry_id, event)["picks"]
        except (FplError, KeyError):
            continue  # laget kan være slettet eller uten uttak denne runden
        counted += 1
        for pick in picks:
            element = pick["element"]
            owned[element] = owned.get(element, 0) + 1
            if pick.get("is_captain"):
                captained[element] = captained.get(element, 0) + 1
        time.sleep(REQUEST_PAUSE)

    if not counted:
        return None

    view = EliteView(
        event=event,
        managers=counted,
        ownership={pid: 100.0 * n / counted for pid, n in owned.items()},
        captaincy={pid: 100.0 * n / counted for pid, n in captained.items()},
    )
    if use_cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(
            json.dumps(
                {
                    "event": view.event,
                    "managers": view.managers,
                    "ownership": view.ownership,
                    "captaincy": view.captaincy,
                }
            )
        )
    return view


def _top_entry_ids(api: FplApi, managers: int) -> list[int]:
    entry_ids: list[int] = []
    page = 1
    while len(entry_ids) < managers:
        try:
            standings = api.league_standings(OVERALL_LEAGUE, page)
        except FplError:
            break
        results = standings.get("standings", {}).get("results", [])
        if not results:
            break
        entry_ids.extend(row["entry"] for row in results)
        if not standings.get("standings", {}).get("has_next"):
            break
        page += 1
        time.sleep(REQUEST_PAUSE)
    return entry_ids[:managers]
