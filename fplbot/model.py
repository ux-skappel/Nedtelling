"""Modell for forventede poeng (xP) per spiller per gameweek.

Modellen bygger på rater per 90 minutter fra FPL sine egne data (xG, xA,
defensive contributions, redninger, bonus), justert for forventet spilletid,
skadestatus, motstander (FDR) og hjemme/borte. Rater krympes mot snittet for
posisjonen når spilleren har lite spilletid bak seg, slik at innbyttere med to
gode kamper ikke seiler til topps.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median

from . import scoring
from .scoring import DEF, FWD, GKP, MID

# Antall minutter som skal til før en spillers egne rater teller fullt ut.
RATE_SHRINK_MINUTES = 450.0
# Hvor mye "kampbevis" som skal til før vi tror på spillerens egen startandel.
ROLE_EVIDENCE_GAMES = 10.0
# Sannsynligheten for å nå 60 minutter gitt at man starter, og som innbytter.
P60_GIVEN_START = 0.85
P60_GIVEN_SUB = 0.03
SUB_MINUTES = 18.0
DEFAULT_START_MINUTES = 75.0

STATUS_AVAILABILITY = {
    "a": 1.00,  # tilgjengelig
    "d": 0.75,  # tvilsom
    "i": 0.0,   # skadet
    "s": 0.0,   # utestengt
    "u": 0.0,   # utilgjengelig
    "n": 0.0,   # ikke i troppen
}


def _f(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def expected_conceded_penalty(lam: float) -> float:
    """E[floor(baklengsmål / 2)] for en Poisson-fordelt kamp."""
    if lam <= 0:
        return 0.0
    total = 0.0
    pmf = math.exp(-lam)
    for k in range(10):
        if k > 0:
            pmf *= lam / k
        total += (k // 2) * pmf
    return total


@dataclass
class Fixture:
    event: int
    opponent: int
    opponent_short: str
    is_home: bool
    difficulty: int

    def label(self) -> str:
        name = self.opponent_short if self.is_home else self.opponent_short.lower()
        return f"{name}({self.difficulty})"


@dataclass
class Player:
    id: int
    name: str
    full_name: str
    team: int
    team_short: str
    position: int
    cost: int  # i tideler av millioner, slik FPL lagrer det
    status: str
    news: str
    selected_by: float
    availability: float
    expected_minutes: float
    p_start: float
    p_sub: float
    start_minutes: float
    form: float
    points_per_game: float
    total_points: int
    minutes: int
    xp: dict[int, float] = field(default_factory=dict)
    fixtures: dict[int, list[Fixture]] = field(default_factory=dict)

    @property
    def price(self) -> float:
        return self.cost / 10.0

    @property
    def position_name(self) -> str:
        return scoring.POSITION_NAME[self.position]

    def xp_over(self, events: list[int]) -> float:
        return sum(self.xp.get(ev, 0.0) for ev in events)

    def weighted_xp(self, events: list[int], decay: float = 0.86) -> float:
        """xP over horisonten der kamper langt fram teller mindre."""
        return sum(self.xp.get(ev, 0.0) * decay**i for i, ev in enumerate(events))

    def fixture_string(self, events: list[int]) -> str:
        parts = []
        for ev in events:
            fixtures = self.fixtures.get(ev, [])
            parts.append("+".join(f.label() for f in fixtures) if fixtures else "-")
        return " ".join(parts)


class ProjectionModel:
    def __init__(
        self,
        bootstrap: dict,
        fixtures: list[dict],
        blend_ppg: float = 0.25,
    ) -> None:
        self.bootstrap = bootstrap
        self.raw_fixtures = fixtures
        self.blend_ppg = blend_ppg
        self.teams = {t["id"]: t for t in bootstrap["teams"]}
        self.events = bootstrap["events"]
        self.games_basis = self._games_basis()
        self._fixtures_by_team = self._index_fixtures()
        self._priors = self._position_priors()
        self.players: dict[int, Player] = {}
        self._build_players()

    # ------------------------------------------------------------------ oppsett

    def _games_basis(self) -> int:
        """Antall kamper totalene i bootstrap er basert på.

        Før sesongstart står fjorårets tall igjen (38 kamper). Underveis i
        sesongen nullstilles de, og vi teller ferdigspilte gameweeks.
        """
        finished = sum(1 for e in self.events if e.get("finished"))
        return finished if finished > 0 else 38

    def next_event(self) -> int:
        for event in self.events:
            if event.get("is_next"):
                return event["id"]
        for event in self.events:
            if not event.get("finished"):
                return event["id"]
        return self.events[-1]["id"]

    def current_event(self) -> int | None:
        for event in self.events:
            if event.get("is_current"):
                return event["id"]
        return None

    def deadline(self, event_id: int) -> str:
        for event in self.events:
            if event["id"] == event_id:
                return event.get("deadline_time", "")
        return ""

    def horizon(self, length: int, start: int | None = None) -> list[int]:
        start = start or self.next_event()
        last = self.events[-1]["id"]
        return [ev for ev in range(start, min(last, start + length - 1) + 1)]

    def _index_fixtures(self) -> dict[int, dict[int, list[Fixture]]]:
        index: dict[int, dict[int, list[Fixture]]] = {t: {} for t in self.teams}
        for fixture in self.raw_fixtures:
            event = fixture.get("event")
            if event is None:
                continue  # kamp uten fastsatt runde
            home, away = fixture["team_h"], fixture["team_a"]
            index[home].setdefault(event, []).append(
                Fixture(
                    event=event,
                    opponent=away,
                    opponent_short=self.teams[away]["short_name"],
                    is_home=True,
                    difficulty=fixture.get("team_h_difficulty") or 3,
                )
            )
            index[away].setdefault(event, []).append(
                Fixture(
                    event=event,
                    opponent=home,
                    opponent_short=self.teams[home]["short_name"],
                    is_home=False,
                    difficulty=fixture.get("team_a_difficulty") or 3,
                )
            )
        return index

    def _position_priors(self) -> dict[int, dict[str, float]]:
        """Median-rater per posisjon blant spillere med reell spilletid."""
        priors: dict[int, dict[str, float]] = {}
        keys = {
            "xg90": "expected_goals_per_90",
            "xa90": "expected_assists_per_90",
            "dc90": "defensive_contribution_per_90",
            "saves90": "saves_per_90",
        }
        for position in (GKP, DEF, MID, FWD):
            pool = [
                e
                for e in self.bootstrap["elements"]
                if e["element_type"] == position and e["minutes"] >= 900
            ]
            if not pool:
                pool = [e for e in self.bootstrap["elements"] if e["element_type"] == position]
            if not pool:
                # Ingen spillere på posisjonen i det hele tatt (kan skje i testdata).
                priors[position] = dict.fromkeys([*keys, "bonus90", "cards90"], 0.0)
                continue
            prior = {name: median([_f(e[key]) for e in pool]) for name, key in keys.items()}
            prior["bonus90"] = median(
                [_f(e["bonus"]) / max(1.0, e["minutes"] / 90.0) for e in pool]
            )
            prior["cards90"] = median(
                [_f(e["yellow_cards"]) / max(1.0, e["minutes"] / 90.0) for e in pool]
            )
            priors[position] = prior
        return priors

    # ----------------------------------------------------------------- spillere

    def _availability(self, element: dict) -> float:
        chance = element.get("chance_of_playing_next_round")
        if chance is not None:
            return max(0.0, min(1.0, chance / 100.0))
        return STATUS_AVAILABILITY.get(element.get("status", "a"), 0.5)

    def _price_share(self, element: dict) -> float:
        """Hvor dyr spilleren er i forhold til andre på samme posisjon (0-1)."""
        position = element["element_type"]
        pool = [e["now_cost"] for e in self.bootstrap["elements"] if e["element_type"] == position]
        if not pool:
            return 0.5
        cheapest, dearest = min(pool), max(pool)
        return (element["now_cost"] - cheapest) / max(1, dearest - cheapest)

    def _role(self, element: dict) -> tuple[float, float, float]:
        """Anslår (startsannsynlighet, innbyttersannsynlighet, minutter ved start).

        Startandelen er det viktigste tallet i hele modellen: en spiller som
        starter halvparten av kampene er verdt omtrent halvparten av en som
        spiller alt. Vi bruker faktiske starter der vi har dem, og prisen som
        holdepunkt for nysignerte uten historikk i Premier League.
        """
        starts = _f(element.get("starts"))
        minutes = _f(element["minutes"])
        games = float(self.games_basis)

        observed_start_rate = min(1.0, starts / games) if games else 0.0
        # Minutter utover det starterne står for må komme fra innhopp.
        start_minutes = min(90.0, minutes / starts) if starts >= 3 else DEFAULT_START_MINUTES
        sub_minutes = max(0.0, minutes - starts * start_minutes)
        observed_sub_rate = min(1.0, (sub_minutes / SUB_MINUTES) / games) if games else 0.0

        # Vekt egne tall mot prisbasert forventning ut fra hvor mye vi har sett.
        evidence = min(1.0, (starts + minutes / 90.0) / ROLE_EVIDENCE_GAMES)
        share = self._price_share(element)
        prior_start_rate = 0.10 + 0.60 * share

        p_start = evidence * observed_start_rate + (1 - evidence) * prior_start_rate
        p_sub = evidence * observed_sub_rate + (1 - evidence) * 0.20
        p_sub = min(p_sub, max(0.0, 1.0 - p_start))
        return p_start, p_sub, start_minutes

    def _rate(self, element: dict, key: str, prior_key: str) -> float:
        """Spillerens egen rate krympet mot posisjonssnittet."""
        minutes = _f(element["minutes"])
        weight = minutes / (minutes + RATE_SHRINK_MINUTES)
        own = _f(element.get(key))
        prior = self._priors[element["element_type"]][prior_key]
        return weight * own + (1 - weight) * prior

    def _build_players(self) -> None:
        for element in self.bootstrap["elements"]:
            if element.get("removed"):
                continue
            team = self.teams[element["team"]]
            availability = self._availability(element)
            p_start, p_sub, start_minutes = self._role(element)
            p_start *= availability
            p_sub *= availability
            expected_minutes = p_start * start_minutes + p_sub * SUB_MINUTES
            player = Player(
                id=element["id"],
                name=element["web_name"],
                full_name=f"{element['first_name']} {element['second_name']}",
                team=element["team"],
                team_short=team["short_name"],
                position=element["element_type"],
                cost=element["now_cost"],
                status=element.get("status", "a"),
                news=element.get("news", "") or "",
                selected_by=_f(element.get("selected_by_percent")),
                availability=availability,
                expected_minutes=expected_minutes,
                p_start=p_start,
                p_sub=p_sub,
                start_minutes=start_minutes,
                form=_f(element.get("form")),
                points_per_game=_f(element.get("points_per_game")),
                total_points=int(element.get("total_points") or 0),
                minutes=int(element.get("minutes") or 0),
            )
            player.fixtures = self._fixtures_by_team.get(player.team, {})
            self._project(player, element)
            self.players[player.id] = player

    # ------------------------------------------------------------- projeksjonen

    def _project(self, player: Player, element: dict) -> None:
        minutes_played = _f(element["minutes"])
        confidence = minutes_played / (minutes_played + RATE_SHRINK_MINUTES)

        xg90 = self._rate(element, "expected_goals_per_90", "xg90")
        xa90 = self._rate(element, "expected_assists_per_90", "xa90")
        dc90 = self._rate(element, "defensive_contribution_per_90", "dc90")
        saves90 = self._rate(element, "saves_per_90", "saves90")

        per_90 = max(1.0, minutes_played / 90.0)
        prior = self._priors[player.position]
        bonus90 = confidence * (_f(element["bonus"]) / per_90) + (1 - confidence) * prior["bonus90"]
        cards90 = (
            confidence * (_f(element["yellow_cards"]) / per_90)
            + (1 - confidence) * prior["cards90"]
        )

        last = self.events[-1]["id"]
        for event in range(self.next_event(), last + 1):
            fixtures = player.fixtures.get(event, [])
            total = 0.0
            for fixture in fixtures:
                total += self._project_fixture(
                    player, fixture, xg90, xa90, dc90, saves90, bonus90, cards90
                )
            if total and self.blend_ppg > 0:
                total = self._blend_with_ppg(player, element, fixtures, total, confidence)
            player.xp[event] = round(total, 3)

    def _project_fixture(
        self,
        player: Player,
        fixture: Fixture,
        xg90: float,
        xa90: float,
        dc90: float,
        saves90: float,
        bonus90: float,
        cards90: float,
    ) -> float:
        """Forventede poeng i én kamp, delt i tilfellene start og innhopp."""
        rates = (xg90, xa90, dc90, saves90, bonus90, cards90)
        points = 0.0
        if player.p_start > 0:
            points += player.p_start * self._points_if_playing(
                player, fixture, player.start_minutes, P60_GIVEN_START, rates
            )
        if player.p_sub > 0:
            points += player.p_sub * self._points_if_playing(
                player, fixture, SUB_MINUTES, P60_GIVEN_SUB, rates
            )
        return points

    def _points_if_playing(
        self,
        player: Player,
        fixture: Fixture,
        minutes: float,
        p_sixty: float,
        rates: tuple[float, ...],
    ) -> float:
        xg90, xa90, dc90, saves90, bonus90, cards90 = rates
        share = minutes / 90.0
        position = player.position

        attack = scoring.fdr_lookup(scoring.ATTACK_BY_FDR, fixture.difficulty)
        attack *= scoring.HOME_ATTACK_BOOST if fixture.is_home else scoring.AWAY_ATTACK_BOOST

        points = scoring.appearance_points(p_sixty)
        points += xg90 * share * attack * scoring.GOAL_POINTS[position]
        points += xa90 * share * attack * scoring.ASSIST_POINTS

        if scoring.CLEAN_SHEET_POINTS[position] > 0:
            clean_sheet = scoring.fdr_lookup(scoring.CLEAN_SHEET_BY_FDR, fixture.difficulty)
            clean_sheet *= (
                scoring.HOME_CLEAN_SHEET_BOOST
                if fixture.is_home
                else scoring.AWAY_CLEAN_SHEET_BOOST
            )
            points += p_sixty * min(1.0, clean_sheet) * scoring.CLEAN_SHEET_POINTS[position]

        if position in (GKP, DEF):
            conceded = scoring.fdr_lookup(scoring.CONCEDED_BY_FDR, fixture.difficulty)
            conceded *= 0.92 if fixture.is_home else 1.08
            points -= expected_conceded_penalty(conceded * share)

        if position == GKP:
            points += (saves90 * share) / scoring.SAVES_PER_POINT

        threshold = scoring.DEFCON_THRESHOLD[position]
        if threshold < 90:
            points += scoring.DEFCON_POINTS * scoring.poisson_at_least(dc90 * share, threshold)

        points += bonus90 * share * (0.6 + 0.4 * attack)
        points -= cards90 * share

        return points

    def _blend_with_ppg(
        self,
        player: Player,
        element: dict,
        fixtures: list[Fixture],
        model_points: float,
        confidence: float,
    ) -> float:
        """Trekker projeksjonen mot spillerens faktiske poengsnitt.

        Modellen kan bomme på spillere som scorer mer enn xG tilsier, eller som
        henter poeng på måter modellen ikke ser. Snittet fungerer som anker.
        """
        minutes_per_game = _f(element["minutes"]) / self.games_basis
        if minutes_per_game <= 0:
            return model_points
        # Rollen kan ha endret seg, men snittet skal ikke skaleres vilt opp.
        minutes_ratio = min(1.3, player.expected_minutes / minutes_per_game)
        anchor = 0.0
        for fixture in fixtures:
            attack = scoring.fdr_lookup(scoring.ATTACK_BY_FDR, fixture.difficulty)
            anchor += player.points_per_game * minutes_ratio * (0.65 + 0.35 * attack)
        weight = self.blend_ppg * confidence
        return (1 - weight) * model_points + weight * anchor

    # ------------------------------------------------------------------- oppslag

    def by_id(self, player_id: int) -> Player:
        return self.players[player_id]

    def available(self, min_availability: float = 0.5) -> list[Player]:
        return [p for p in self.players.values() if p.availability >= min_availability]

    def ranked(self, events: list[int], position: int | None = None) -> list[Player]:
        pool = [
            p
            for p in self.players.values()
            if position is None or p.position == position
        ]
        return sorted(pool, key=lambda p: p.xp_over(events), reverse=True)

    def explain(self, player: Player, events: list[int]) -> str:
        lines = [
            f"{player.name} ({player.team_short}, {player.position_name}, {player.price:.1f}m)",
            f"  status: {player.status} tilgjengelighet {player.availability:.0%}"
            + (f" - {player.news}" if player.news else ""),
            (
                f"  forventet spilletid: {player.expected_minutes:.0f} min "
                f"(starter {player.p_start:.0%}, innhopp {player.p_sub:.0%})"
            ),
            f"  poengsnitt i fjor/hittil: {player.points_per_game:.1f} på {player.minutes} min",
        ]
        for event in events:
            fixtures = player.fixtures.get(event, [])
            label = "+".join(f.label() for f in fixtures) if fixtures else "blank"
            lines.append(f"  GW{event}: {player.xp.get(event, 0.0):.2f} xP mot {label}")
        return "\n".join(lines)
