"""Historiske sesongdata, satt sammen slik de så ut på et gitt tidspunkt.

FPL sitt eget API serverer bare inneværende sesong, så historikken hentes fra
det åpne arkivet til vaastav/Fantasy-Premier-League, som har en rad per spiller
per runde helt tilbake til 2016/17.

Hele poenget med modulen er ordet *snapshot*: for å teste modellen ærlig må den
bare få se det som fantes før runden ble spilt. `Season.snapshot(k)` bygger
derfor et bootstrap-objekt av rundene til og med k-1, med resultatene fra runde
k og utover maskert bort. Ser du et tall i et snapshot, var det kjent på det
tidspunktet.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from pathlib import Path

import requests

from ..api import DEFAULT_CACHE_DIR
from ..scoring import DEF, FWD, GKP, MID

ARCHIVE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
POSITION_CODES = {"GK": GKP, "GKP": GKP, "DEF": DEF, "MID": MID, "FWD": FWD}
# Grovt anslag på antall managere, brukt til å gjøre eierskap om til prosent.
ESTIMATED_MANAGERS = 10_000_000


def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def previous_season(season: str) -> str:
    """2025-26 -> 2024-25."""
    start = int(season.split("-")[0])
    return f"{start - 1}-{str(start)[-2:]}"


def download(season: str, filename: str, cache_dir: Path | None = None) -> str:
    """Henter en fil fra arkivet, og mellomlagrer den på disk."""
    cache_dir = Path(cache_dir or DEFAULT_CACHE_DIR) / "history" / season
    cache_file = cache_dir / filename.replace("/", "_")
    if cache_file.exists():
        return cache_file.read_text(encoding="utf8")

    url = f"{ARCHIVE}/{season}/{filename}"
    response = requests.get(url, timeout=120)
    if not response.ok:
        raise RuntimeError(f"Fant ikke {url} ({response.status_code})")
    cache_dir.mkdir(parents=True, exist_ok=True)
    text = response.content.decode("utf8", errors="replace")
    cache_file.write_text(text, encoding="utf8")
    return text


@dataclass
class PlayerRow:
    """En spillers innsats i én kamp."""

    element: int
    name: str
    position: int
    team: int
    event: int
    minutes: int
    starts: int
    points: int
    value: int
    expected_goals: float
    expected_assists: float
    defensive_contribution: float
    saves: int
    bonus: int
    yellow_cards: int
    selected: int


@dataclass
class Season:
    season: str
    rows: list[PlayerRow]
    fixtures: list[dict]
    team_names: dict[int, str] = field(default_factory=dict)
    _by_event: dict[int, list[PlayerRow]] = field(default_factory=dict)
    _by_element: dict[int, list[PlayerRow]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for row in self.rows:
            self._by_event.setdefault(row.event, []).append(row)
            self._by_element.setdefault(row.element, []).append(row)

    @property
    def events(self) -> list[int]:
        return sorted(self._by_event)

    def rows_for(self, event: int) -> list[PlayerRow]:
        return self._by_event.get(event, [])

    def actual_points(self, element: int, event: int) -> int:
        """Faktiske poeng i runden. Dobbeltrunder summeres."""
        return sum(r.points for r in self._by_event.get(event, []) if r.element == element)

    def actual_minutes(self, element: int, event: int) -> int:
        return sum(r.minutes for r in self._by_event.get(event, []) if r.element == element)

    # ------------------------------------------------------------------ snapshot

    def snapshot(self, event: int, prior: Season | None = None) -> tuple[dict, list[dict]]:
        """Bygger bootstrap og fixtures slik de så ut rett før runden.

        Før runde 1 finnes det ingen data fra inneværende sesong. Da brukes
        fjorårets totaler, akkurat som FPL selv gjør fram til sesongstart.
        """
        if event <= 1 and prior is not None:
            elements = prior._aggregate(through=max(prior.events), price_season=self)
            games_played = len(prior.events)
        else:
            elements = self._aggregate(through=event - 1, price_season=self)
            games_played = event - 1

        events = [
            {
                "id": ev,
                "deadline_time": "",
                "finished": ev < event and games_played > 0,
                "is_next": ev == event,
                "is_current": ev == event - 1,
            }
            for ev in range(1, max(self.events) + 1)
        ]
        bootstrap = {
            "events": events,
            "teams": [
                {"id": team_id, "short_name": name[:3].upper(), "name": name}
                for team_id, name in sorted(self.team_names.items())
            ],
            "elements": elements,
            "element_types": [],
        }
        return bootstrap, self._masked_fixtures(event)

    def _masked_fixtures(self, event: int) -> list[dict]:
        """Skjuler resultatene fra runden vi står foran og alt som kommer etter."""
        masked = []
        for fixture in self.fixtures:
            copy = dict(fixture)
            if fixture.get("event") is None or fixture["event"] >= event:
                copy["finished"] = False
                copy["team_h_score"] = None
                copy["team_a_score"] = None
            masked.append(copy)
        return masked

    def _aggregate(self, through: int, price_season: Season) -> list[dict]:
        """Summerer alt en spiller har gjort til og med en gitt runde."""
        totals: dict[int, dict] = {}
        for row in self.rows:
            if row.event > through:
                continue
            entry = totals.setdefault(
                row.element,
                {
                    "name": row.name,
                    "position": row.position,
                    "team": row.team,
                    "minutes": 0,
                    "starts": 0,
                    "points": 0,
                    "xg": 0.0,
                    "xa": 0.0,
                    "dc": 0.0,
                    "saves": 0,
                    "bonus": 0,
                    "cards": 0,
                    "appearances": 0,
                    "selected": 0,
                    "value": row.value,
                    "last_event": row.event,
                },
            )
            entry["minutes"] += row.minutes
            entry["starts"] += row.starts
            entry["points"] += row.points
            entry["xg"] += row.expected_goals
            entry["xa"] += row.expected_assists
            entry["dc"] += row.defensive_contribution
            entry["saves"] += row.saves
            entry["bonus"] += row.bonus
            entry["cards"] += row.yellow_cards
            entry["appearances"] += 1 if row.minutes > 0 else 0
            if row.event >= entry["last_event"]:
                entry["last_event"] = row.event
                entry["selected"] = row.selected
                entry["value"] = row.value

        # Navnene knytter sesongene sammen når prisene skal hentes fra riktig år.
        price_by_name = {}
        if price_season is not self:
            for row in price_season.rows:
                if row.event == 1:
                    price_by_name[row.name] = (row.element, row.value, row.team, row.position)

        elements = []
        for element_id, entry in totals.items():
            per_90 = max(entry["minutes"], 1) / 90.0
            element_key, cost = element_id, entry["value"]
            team, position = entry["team"], entry["position"]
            if price_by_name:
                match = price_by_name.get(entry["name"])
                if match is None:
                    continue  # spilleren finnes ikke i sesongen vi tester
                element_key, cost, team, position = match

            first, _, last = entry["name"].partition(" ")
            elements.append(
                {
                    "id": element_key,
                    "web_name": last or first,
                    "first_name": first,
                    "second_name": last,
                    "team": team,
                    "element_type": position,
                    "now_cost": cost,
                    "status": "a",
                    "news": "",
                    "chance_of_playing_next_round": None,
                    "selected_by_percent": str(100.0 * entry["selected"] / ESTIMATED_MANAGERS),
                    "form": "0.0",
                    "points_per_game": str(
                        entry["points"] / entry["appearances"] if entry["appearances"] else 0.0
                    ),
                    "total_points": entry["points"],
                    "minutes": entry["minutes"],
                    "starts": entry["starts"],
                    "bonus": entry["bonus"],
                    "yellow_cards": entry["cards"],
                    "expected_goals_per_90": str(entry["xg"] / per_90),
                    "expected_assists_per_90": str(entry["xa"] / per_90),
                    "defensive_contribution_per_90": str(entry["dc"] / per_90),
                    "saves_per_90": str(entry["saves"] / per_90),
                    "removed": False,
                    # Arkivet har ikke dødballroller per runde, og å hente dem fra
                    # fasiten ville vært å se inn i framtiden. De står derfor tomme,
                    # og backtesten undervurderer modellen litt på dette punktet.
                    "penalties_order": None,
                    "direct_freekicks_order": None,
                    "corners_and_indirect_freekicks_order": None,
                }
            )
        return elements


def prior_profile(prior: Season, current: Season) -> dict[int, dict]:
    """Fjorårets rater, nøklet på spiller-ID-ene i sesongen vi tester.

    ID-ene endrer seg mellom sesonger, så spillerne kobles på navn. De som ikke
    matcher, får ingen historikk - det er den forsiktige feilen å gjøre.
    """
    id_by_name = {}
    for row in current.rows:
        id_by_name.setdefault(row.name, row.element)

    totals: dict[str, dict] = {}
    for row in prior.rows:
        entry = totals.setdefault(
            row.name,
            {"minutes": 0, "starts": 0, "xg": 0.0, "xa": 0.0, "dc": 0.0,
             "saves": 0, "bonus": 0, "cards": 0, "events": set()},
        )
        entry["minutes"] += row.minutes
        entry["starts"] += row.starts
        entry["xg"] += row.expected_goals
        entry["xa"] += row.expected_assists
        entry["dc"] += row.defensive_contribution
        entry["saves"] += row.saves
        entry["bonus"] += row.bonus
        entry["cards"] += row.yellow_cards
        entry["events"].add(row.event)

    profile: dict[int, dict] = {}
    for name, entry in totals.items():
        element_id = id_by_name.get(name)
        if element_id is None or entry["minutes"] <= 0:
            continue
        per_90 = entry["minutes"] / 90.0
        profile[element_id] = {
            "minutes": float(entry["minutes"]),
            "starts": float(entry["starts"]),
            # Bare rundene spilleren faktisk var med i spillet. Deler vi på alle
            # 38, straffer vi alle som var skadet eller signerte i januar.
            "games": float(len(entry["events"])),
            "xg90": entry["xg"] / per_90,
            "xa90": entry["xa"] / per_90,
            "dc90": entry["dc"] / per_90,
            "saves90": entry["saves"] / per_90,
            "bonus90": entry["bonus"] / per_90,
            "cards90": entry["cards"] / per_90,
        }
    return profile


def load_season(season: str, cache_dir: Path | None = None) -> Season:
    """Laster ned og leser en sesong fra arkivet."""
    fixtures = _read_fixtures(download(season, "fixtures.csv", cache_dir))
    team_by_fixture = {f["id"]: (f["team_h"], f["team_a"]) for f in fixtures}

    text = download(season, "gws/merged_gw.csv", cache_dir)
    rows: list[PlayerRow] = []
    team_names: dict[int, str] = {}
    for record in csv.DictReader(io.StringIO(text)):
        fixture_id = _to_int(record.get("fixture"))
        sides = team_by_fixture.get(fixture_id)
        if not sides:
            continue
        was_home = str(record.get("was_home", "")).strip().lower() in ("true", "1")
        team_id = sides[0] if was_home else sides[1]
        team_names.setdefault(team_id, record.get("team", "") or f"Lag {team_id}")

        rows.append(
            PlayerRow(
                element=_to_int(record.get("element")),
                name=record.get("name", ""),
                position=POSITION_CODES.get(record.get("position", ""), MID),
                team=team_id,
                event=_to_int(record.get("GW")),
                minutes=_to_int(record.get("minutes")),
                starts=_to_int(record.get("starts")),
                points=_to_int(record.get("total_points")),
                value=_to_int(record.get("value")),
                expected_goals=_to_float(record.get("expected_goals")),
                expected_assists=_to_float(record.get("expected_assists")),
                defensive_contribution=_to_float(record.get("defensive_contribution")),
                saves=_to_int(record.get("saves")),
                bonus=_to_int(record.get("bonus")),
                yellow_cards=_to_int(record.get("yellow_cards")),
                selected=_to_int(record.get("selected")),
            )
        )
    return Season(season=season, rows=rows, fixtures=fixtures, team_names=team_names)


def _read_fixtures(text: str) -> list[dict]:
    fixtures = []
    for record in csv.DictReader(io.StringIO(text)):
        event = record.get("event")
        fixtures.append(
            {
                "id": _to_int(record.get("id")),
                "event": _to_int(event) if event not in ("", None) else None,
                "team_h": _to_int(record.get("team_h")),
                "team_a": _to_int(record.get("team_a")),
                "team_h_score": (
                    _to_int(record.get("team_h_score"))
                    if record.get("team_h_score") not in ("", None)
                    else None
                ),
                "team_a_score": (
                    _to_int(record.get("team_a_score"))
                    if record.get("team_a_score") not in ("", None)
                    else None
                ),
                "team_h_difficulty": _to_int(record.get("team_h_difficulty"), 3),
                "team_a_difficulty": _to_int(record.get("team_a_difficulty"), 3),
                "finished": str(record.get("finished", "")).strip().lower() in ("true", "1"),
            }
        )
    return fixtures
