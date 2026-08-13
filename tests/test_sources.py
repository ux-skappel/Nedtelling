"""Tester for lagstyrke, autopilot og oddsomregning. Ingen nettverk."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from fplbot.deadline import decide, hours_until, unavailable_players
from fplbot.model import ProjectionModel
from fplbot.scoring import MID
from fplbot.sources.elite import EliteView
from fplbot.sources.odds import implied_probabilities, normalise, split_goals
from fplbot.strength import LEAGUE_GOALS_PER_TEAM, fit_team_strength
from fplbot.transfers import TransferPlan
from tests.test_model import make_bootstrap, make_element, make_fixtures


def played_season(strong: int, weak: int, rounds: int = 20) -> list[dict]:
    """Lager en historikk der ett lag vinner stort hver eneste gang."""
    fixtures = []
    for event in range(1, rounds + 1):
        home_is_strong = event % 2 == 1
        fixtures.append(
            {
                "event": event,
                "finished": True,
                "team_h": strong if home_is_strong else weak,
                "team_a": weak if home_is_strong else strong,
                "team_h_score": 4 if home_is_strong else 0,
                "team_a_score": 0 if home_is_strong else 4,
                "team_h_difficulty": 3,
                "team_a_difficulty": 3,
            }
        )
    return fixtures


def test_strength_finds_the_better_team():
    strength = fit_team_strength(played_season(1, 2), [1, 2], current_event=20)
    assert strength.attack[1] > strength.attack[2]
    assert strength.defence[1] < strength.defence[2]  # lavt tall = slipper inn lite


def test_strength_beats_fdr_once_results_exist():
    strength = fit_team_strength(played_season(1, 2), [1, 2], current_event=20)
    scored, conceded = strength.expected_goals(1, 2, is_home=True, difficulty=3)
    assert scored > LEAGUE_GOALS_PER_TEAM
    assert conceded < LEAGUE_GOALS_PER_TEAM


def test_strength_falls_back_to_fdr_without_results():
    strength = fit_team_strength([], [1, 2], current_event=0)
    easy = strength.expected_goals(1, 2, is_home=True, difficulty=2)
    hard = strength.expected_goals(1, 2, is_home=True, difficulty=5)
    assert easy[0] > hard[0]  # lett kamp gir flere mål
    assert easy[1] < hard[1]  # og færre baklengs


def test_strength_ratings_stay_bounded():
    strength = fit_team_strength(played_season(1, 2, rounds=38), [1, 2], current_event=38)
    for rating in list(strength.attack.values()) + list(strength.defence.values()):
        assert 0.3 < rating < 3.0


def test_model_uses_strength_for_clean_sheets():
    """Et lag med sterkt forsvar skal gi høyere clean sheet-sannsynlighet."""
    fixtures = make_fixtures()
    model = ProjectionModel(
        make_bootstrap([make_element(1, MID)]),
        fixtures,
        blend_ppg=0.0,
    )
    fixture = model.by_id(1).fixtures[1][0]
    assert 0.0 < fixture.clean_sheet_probability < 1.0
    assert fixture.attack_multiplier > 0


def test_set_piece_taker_projects_higher():
    plain = make_element(1, MID, minutes=200, starts=2)
    taker = make_element(2, MID, minutes=200, starts=2, penalties_order=1)
    model = ProjectionModel(make_bootstrap([plain, taker]), make_fixtures(), blend_ppg=0.0)
    assert model.by_id(2).xp[1] > model.by_id(1).xp[1]
    assert model.by_id(2).set_pieces == "P"
    assert model.by_id(1).set_pieces == ""


def test_established_taker_gets_smaller_premium():
    """Premien skal krympe når xG-en allerede rommer straffene.

    Premien er en rate per 90 minutter, så veteranen henter mer ut av den i rene
    poeng bare fordi han spiller mer. Det er per spilte minutt premien skal være
    større for den vi har sett lite til.
    """
    rookie_plain = make_element(1, MID, minutes=200, starts=2)
    rookie_taker = make_element(2, MID, minutes=200, starts=2, penalties_order=1)
    veteran_plain = make_element(3, MID, minutes=3000, starts=34)
    veteran_taker = make_element(4, MID, minutes=3000, starts=34, penalties_order=1)
    model = ProjectionModel(
        make_bootstrap([rookie_plain, rookie_taker, veteran_plain, veteran_taker]),
        make_fixtures(),
        blend_ppg=0.0,
    )
    rookie_gain = model.by_id(2).xp[1] - model.by_id(1).xp[1]
    veteran_gain = model.by_id(4).xp[1] - model.by_id(3).xp[1]
    assert rookie_gain > 0 and veteran_gain > 0
    rookie_rate = rookie_gain / model.by_id(2).expected_minutes
    veteran_rate = veteran_gain / model.by_id(4).expected_minutes
    assert rookie_rate > veteran_rate


def test_elite_nudge_is_capped():
    """Elite-eierskap skal flytte anslaget litt, aldri snu det."""
    element = make_element(1, MID, minutes=3000, starts=34, selected_by_percent="1.0")
    without = ProjectionModel(make_bootstrap([element]), make_fixtures(), blend_ppg=0.0)
    elite = EliteView(event=5, managers=100, ownership={1: 100.0})
    with_elite = ProjectionModel(
        make_bootstrap([make_element(1, MID, minutes=3000, starts=34, selected_by_percent="1.0")]),
        make_fixtures(),
        blend_ppg=0.0,
        elite=elite,
    )
    base = without.by_id(1).p_start
    nudged = with_elite.by_id(1).p_start
    assert nudged >= base
    assert nudged <= base * 1.11
    assert with_elite.by_id(1).elite_edge == pytest.approx(99.0)


def test_elite_view_counts_shares():
    view = EliteView(event=3, managers=4, ownership={7: 75.0}, captaincy={7: 50.0})
    assert view.owned_by(7) == 75.0
    assert view.captained_by(7) == 50.0
    assert view.owned_by(99) == 0.0
    assert view.edge(7, 20.0) == 55.0


# ------------------------------------------------------------------- autopilot


@pytest.fixture
def squad_model() -> ProjectionModel:
    elements = [make_element(i, MID) for i in range(1, 4)]
    return ProjectionModel(make_bootstrap(elements), make_fixtures(), blend_ppg=0.0)


def make_plan(model, gain: float, hits: int = 0) -> TransferPlan:
    out = [model.by_id(1)]
    incoming = [model.by_id(2)]
    return TransferPlan(
        out=out,
        incoming=incoming,
        hits=hits,
        bank_after=0,
        value_before=100.0,
        value_after=100.0 + gain + hits * 4,
    )


def test_hours_until_reads_fpl_timestamp():
    now = datetime(2026, 8, 21, 12, 0, tzinfo=timezone.utc)
    assert hours_until("2026-08-21T17:30:00Z", now) == pytest.approx(5.5)
    assert hours_until("", now) == float("inf")


def test_autopilot_sleeps_outside_the_window(squad_model):
    squad = [squad_model.by_id(i) for i in (1, 2, 3)]
    plan = make_plan(squad_model, gain=10.0)
    far_away = datetime(2026, 8, 1, tzinfo=timezone.utc)
    squad_model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    decision = decide(squad_model, squad, plan, within_hours=3.0, now=far_away)
    assert not decision.in_window
    assert not decision.should_transfer


def test_autopilot_acts_on_a_big_enough_gain(squad_model):
    squad = [squad_model.by_id(i) for i in (1, 2, 3)]
    squad_model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    now = datetime(2026, 8, 21, 15, 30, tzinfo=timezone.utc)
    decision = decide(squad_model, squad, make_plan(squad_model, 5.0), min_gain=1.0, now=now)
    assert decision.in_window
    assert decision.should_transfer


def test_autopilot_holds_back_on_a_small_gain(squad_model):
    squad = [squad_model.by_id(i) for i in (1, 2, 3)]
    squad_model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    now = datetime(2026, 8, 21, 15, 30, tzinfo=timezone.utc)
    decision = decide(squad_model, squad, make_plan(squad_model, 0.2), min_gain=1.0, now=now)
    assert decision.in_window
    assert not decision.should_transfer
    assert decision.blocked


def test_autopilot_refuses_hits_unless_allowed(squad_model):
    squad = [squad_model.by_id(i) for i in (1, 2, 3)]
    squad_model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    now = datetime(2026, 8, 21, 15, 30, tzinfo=timezone.utc)
    plan = make_plan(squad_model, gain=5.0, hits=1)
    assert not decide(squad_model, squad, plan, now=now).should_transfer
    assert decide(squad_model, squad, plan, allow_hits=True, now=now).should_transfer


def test_autopilot_replaces_an_injured_player_even_for_little_gain():
    elements = [
        make_element(1, MID, status="i", chance_of_playing_next_round=0),
        make_element(2, MID),
        make_element(3, MID),
    ]
    model = ProjectionModel(make_bootstrap(elements), make_fixtures(), blend_ppg=0.0)
    model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    squad = [model.by_id(i) for i in (1, 2, 3)]
    assert unavailable_players(squad) == [model.by_id(1)]
    now = datetime(2026, 8, 21, 15, 30, tzinfo=timezone.utc)
    decision = decide(model, squad, make_plan(model, 0.1), min_gain=5.0, now=now)
    assert decision.should_transfer


def test_autopilot_does_nothing_without_a_plan(squad_model):
    squad = [squad_model.by_id(i) for i in (1, 2, 3)]
    squad_model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    now = datetime(2026, 8, 21, 15, 30, tzinfo=timezone.utc)
    decision = decide(squad_model, squad, None, now=now)
    assert not decision.should_transfer
    assert decision.reasons


# ------------------------------------------------------------------------ odds


def test_implied_probabilities_remove_the_margin():
    probabilities = implied_probabilities({"home": 2.0, "draw": 4.0, "away": 4.0})
    assert sum(probabilities.values()) == pytest.approx(1.0)
    assert probabilities["home"] > probabilities["away"]


def test_split_goals_favours_the_favourite():
    home, away = split_goals(3.0, home_win=0.7, away_win=0.1)
    assert home > away
    assert home + away == pytest.approx(3.0)
    even_home, even_away = split_goals(3.0, home_win=0.4, away_win=0.4)
    assert even_home == pytest.approx(even_away)


def test_team_name_aliases():
    assert normalise("Tottenham Hotspur") == "spurs"
    assert normalise("Arsenal") == "arsenal"


def test_deadline_window_boundary(squad_model):
    """Fristen som akkurat har gått skal ikke regnes som innenfor vinduet."""
    squad = [squad_model.by_id(i) for i in (1, 2, 3)]
    squad_model.events[0]["deadline_time"] = "2026-08-21T17:30:00Z"
    just_missed = datetime(2026, 8, 21, 17, 31, tzinfo=timezone.utc)
    decision = decide(squad_model, squad, make_plan(squad_model, 9.0), now=just_missed)
    assert not decision.in_window


def test_recency_weighting_prefers_recent_form():
    """Et lag som nettopp har snudd formen skal vurderes ut fra de nye kampene."""
    old = played_season(1, 2, rounds=10)
    for fixture in old:
        fixture["event"] = fixture["event"]  # kamper 1-10: lag 1 vinner stort
    recent = []
    for event in range(11, 21):  # kamper 11-20: lag 2 vinner stort
        recent.append(
            {
                "event": event,
                "finished": True,
                "team_h": 2,
                "team_a": 1,
                "team_h_score": 4,
                "team_a_score": 0,
                "team_h_difficulty": 3,
                "team_a_difficulty": 3,
            }
        )
    strength = fit_team_strength(old + recent, [1, 2], current_event=20)
    assert strength.attack[2] > strength.attack[1]


def test_hours_until_handles_past_deadlines():
    now = datetime(2026, 8, 22, tzinfo=timezone.utc)
    assert hours_until("2026-08-21T17:30:00Z", now) < 0
    later = now + timedelta(hours=2)
    assert hours_until("2026-08-23T00:00:00Z", later) > 0
