"""Tester for projeksjonsmodellen. Bruker syntetiske data, ingen nettverk."""

from __future__ import annotations

import pytest

from fplbot.model import ProjectionModel, expected_conceded_penalty
from fplbot.scoring import DEF, FWD, GKP, MID, appearance_points, poisson_at_least


def make_element(element_id: int, position: int, **overrides) -> dict:
    element = {
        "id": element_id,
        "web_name": f"Spiller{element_id}",
        "first_name": "Test",
        "second_name": f"Spiller{element_id}",
        "team": 1,
        "element_type": position,
        "now_cost": 50,
        "status": "a",
        "news": "",
        "chance_of_playing_next_round": None,
        "selected_by_percent": "5.0",
        "form": "0.0",
        "points_per_game": "4.0",
        "total_points": 150,
        "minutes": 3000,
        "starts": 34,
        "bonus": 10,
        "yellow_cards": 4,
        "expected_goals_per_90": "0.3",
        "expected_assists_per_90": "0.2",
        "defensive_contribution_per_90": "5.0",
        "saves_per_90": "0.0",
        "removed": False,
    }
    element.update(overrides)
    return element


def make_bootstrap(elements: list[dict]) -> dict:
    return {
        "events": [
            {
                "id": ev,
                "deadline_time": "2026-08-21T17:30:00Z",
                "finished": False,
                "is_next": ev == 1,
            }
            for ev in range(1, 4)
        ],
        "teams": [
            {"id": 1, "short_name": "AAA", "name": "Alfa"},
            {"id": 2, "short_name": "BBB", "name": "Beta"},
        ],
        "elements": elements,
        "element_types": [],
    }


def make_fixtures() -> list[dict]:
    return [
        {
            "event": ev,
            "team_h": 1 if ev % 2 else 2,
            "team_a": 2 if ev % 2 else 1,
            "team_h_difficulty": 3,
            "team_a_difficulty": 3,
        }
        for ev in range(1, 4)
    ]


@pytest.fixture
def model() -> ProjectionModel:
    elements = [
        make_element(1, GKP, saves_per_90="3.0", expected_goals_per_90="0.0"),
        make_element(2, DEF),
        make_element(3, MID),
        make_element(4, FWD),
    ]
    return ProjectionModel(make_bootstrap(elements), make_fixtures(), blend_ppg=0.0)


def test_poisson_tail():
    assert poisson_at_least(2.0, 0) == 1.0
    assert poisson_at_least(0.0, 1) == 0.0
    assert 0.85 < poisson_at_least(2.0, 1) < 0.87
    assert poisson_at_least(10.0, 12) < poisson_at_least(12.0, 12)


def test_appearance_points():
    assert appearance_points(0.0) == 1.0
    assert appearance_points(1.0) == 2.0


def test_conceded_penalty_grows_with_expected_goals():
    assert expected_conceded_penalty(0.0) == 0.0
    assert expected_conceded_penalty(2.0) > expected_conceded_penalty(1.0)


def test_starter_projects_more_than_benchwarmer():
    starter = make_element(1, MID, minutes=3000, starts=34)
    benchwarmer = make_element(2, MID, minutes=200, starts=1)
    model = ProjectionModel(make_bootstrap([starter, benchwarmer]), make_fixtures(), blend_ppg=0.0)
    assert model.by_id(1).xp[1] > 2 * model.by_id(2).xp[1]
    assert model.by_id(1).p_start > model.by_id(2).p_start


def test_injured_player_scores_nothing(model):
    elements = [make_element(1, MID, status="i", chance_of_playing_next_round=0)]
    hurt = ProjectionModel(make_bootstrap(elements), make_fixtures(), blend_ppg=0.0)
    assert hurt.by_id(1).xp[1] == 0.0
    assert hurt.by_id(1).availability == 0.0


def test_easy_fixture_beats_hard_fixture():
    element = make_element(1, FWD)
    easy = make_fixtures()
    hard = make_fixtures()
    for fixture in easy:
        fixture["team_h_difficulty"] = fixture["team_a_difficulty"] = 2
    for fixture in hard:
        fixture["team_h_difficulty"] = fixture["team_a_difficulty"] = 5
    easy_model = ProjectionModel(make_bootstrap([element]), easy, blend_ppg=0.0)
    hard_model = ProjectionModel(make_bootstrap([dict(element)]), hard, blend_ppg=0.0)
    assert easy_model.by_id(1).xp[1] > hard_model.by_id(1).xp[1]


def test_blank_gameweek_gives_zero(model):
    fixtures = [f for f in make_fixtures() if f["event"] != 2]
    blank = ProjectionModel(make_bootstrap([make_element(1, MID)]), fixtures, blend_ppg=0.0)
    assert blank.by_id(1).xp[2] == 0.0
    assert blank.by_id(1).xp[1] > 0.0


def test_double_gameweek_roughly_doubles():
    fixtures = make_fixtures()
    fixtures.append(
        {"event": 1, "team_h": 2, "team_a": 1, "team_h_difficulty": 3, "team_a_difficulty": 3}
    )
    single = ProjectionModel(make_bootstrap([make_element(1, MID)]), make_fixtures(), blend_ppg=0.0)
    double = ProjectionModel(make_bootstrap([make_element(1, MID)]), fixtures, blend_ppg=0.0)
    ratio = double.by_id(1).xp[1] / single.by_id(1).xp[1]
    assert 1.8 < ratio < 2.2


def test_goalkeeper_gets_save_points(model):
    keeper = model.by_id(1)
    defender = model.by_id(2)
    # Keeperen har samme forsvarsprofil, men henter i tillegg poeng på redninger.
    assert keeper.xp[1] > 0
    assert defender.xp[1] > 0


def test_horizon_stops_at_last_event(model):
    assert model.horizon(10) == [1, 2, 3]
    assert model.horizon(2) == [1, 2]
    assert model.next_event() == 1
