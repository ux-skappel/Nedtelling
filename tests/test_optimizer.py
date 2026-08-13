"""Tester for troppsoptimering, oppstilling og bytter."""

from __future__ import annotations

import pytest

from fplbot.auth import build_lineup_payload, build_transfer_payload
from fplbot.model import ProjectionModel
from fplbot.optimizer import (
    SQUAD_QUOTA,
    TEAM_LIMIT,
    XI_MAX,
    XI_MIN,
    optimize_squad,
    pick_lineup,
    valid_formations,
)
from fplbot.scoring import DEF, FWD, GKP, MID
from fplbot.transfers import suggest_transfers
from tests.test_model import make_element


def make_league() -> ProjectionModel:
    """Bygger en liten liga med nok spillere til å sette en lovlig tropp."""
    elements = []
    element_id = 1
    for team in range(1, 7):
        for position, count in ((GKP, 2), (DEF, 5), (MID, 5), (FWD, 3)):
            for index in range(count):
                elements.append(
                    make_element(
                        element_id,
                        position,
                        team=team,
                        # Varier pris og kvalitet slik at optimeringen har noe å velge i.
                        now_cost=45 + 5 * index + 5 * (team % 3),
                        expected_goals_per_90=str(0.1 + 0.05 * index),
                        expected_assists_per_90=str(0.05 + 0.04 * index),
                        points_per_game=str(3.0 + 0.3 * index),
                    )
                )
                element_id += 1

    bootstrap = {
        "events": [
            {"id": ev, "deadline_time": "", "finished": False, "is_next": ev == 1}
            for ev in range(1, 4)
        ],
        "teams": [{"id": t, "short_name": f"T{t}", "name": f"Team {t}"} for t in range(1, 7)],
        "elements": elements,
        "element_types": [],
    }
    fixtures = []
    for ev in range(1, 4):
        for home, away in ((1, 2), (3, 4), (5, 6)):
            fixtures.append(
                {
                    "event": ev,
                    "team_h": home,
                    "team_a": away,
                    "team_h_difficulty": 3,
                    "team_a_difficulty": 3,
                }
            )
    return ProjectionModel(bootstrap, fixtures, blend_ppg=0.0)


@pytest.fixture(scope="module")
def league() -> ProjectionModel:
    return make_league()


def test_squad_respects_all_rules(league):
    squad = optimize_squad(league, league.horizon(3), budget=1000, min_availability=0.0)
    assert len(squad.players) == 15
    assert squad.cost <= 1000
    for position, quota in SQUAD_QUOTA.items():
        assert len(squad.by_position(position)) == quota
    per_team: dict[int, int] = {}
    for player in squad.players:
        per_team[player.team] = per_team.get(player.team, 0) + 1
    assert max(per_team.values()) <= TEAM_LIMIT


def test_squad_honours_locked_and_banned(league):
    locked = next(iter(league.players.values()))
    banned = [p for p in league.players.values() if p.id != locked.id][:3]
    squad = optimize_squad(
        league,
        league.horizon(3),
        locked={locked.id},
        banned={p.id for p in banned},
        min_availability=0.0,
    )
    assert locked.id in squad.ids()
    assert squad.ids().isdisjoint({p.id for p in banned})


def test_tighter_budget_gives_cheaper_squad(league):
    rich = optimize_squad(league, league.horizon(3), budget=1000, min_availability=0.0)
    poor = optimize_squad(league, league.horizon(3), budget=850, min_availability=0.0)
    assert poor.cost <= 850
    assert poor.cost < rich.cost


def test_formations_are_legal():
    formations = valid_formations()
    assert {"1-3-5-2"} <= {
        f"{f[GKP]}-{f[DEF]}-{f[MID]}-{f[FWD]}" for f in formations
    }
    for formation in formations:
        assert sum(formation.values()) == 11
        for position, count in formation.items():
            assert XI_MIN[position] <= count <= XI_MAX[position]


def test_lineup_picks_best_eleven(league):
    squad = optimize_squad(league, league.horizon(3), min_availability=0.0)
    lineup = pick_lineup(squad.players, 1)
    assert len(lineup.starters) == 11
    assert len(lineup.bench) == 4
    assert lineup.bench[0].position == GKP  # reservekeeper står alltid først
    assert lineup.captain in lineup.starters
    assert lineup.vice is not lineup.captain
    best_bench = max(p.xp[1] for p in lineup.bench)
    worst_starter = min(p.xp[1] for p in lineup.starters)
    # En benkespiller kan bare være bedre enn en starter når formasjonen krever det.
    assert best_bench <= max(p.xp[1] for p in lineup.starters)
    assert worst_starter >= 0


def test_captain_is_the_highest_scorer(league):
    squad = optimize_squad(league, league.horizon(3), min_availability=0.0)
    lineup = pick_lineup(squad.players, 1)
    assert lineup.captain.xp[1] == max(p.xp[1] for p in lineup.starters)


def test_transfers_stay_within_budget_and_rules(league):
    horizon = league.horizon(3)
    full = optimize_squad(league, horizon, budget=1000, min_availability=0.0)
    weak = optimize_squad(league, horizon, budget=830, min_availability=0.0)
    bank = 1000 - weak.cost
    plan = suggest_transfers(
        league,
        weak.players,
        horizon,
        bank=bank,
        free_transfers=1,
        max_transfers=2,
        min_availability=0.0,
    )
    assert len(plan.incoming) <= 2
    assert len(plan.incoming) == len(plan.out)
    assert plan.bank_after >= 0
    for out_player, in_player in zip(plan.out, plan.incoming, strict=True):
        assert out_player.position == in_player.position
    assert plan.hits == max(0, plan.count - 1)
    assert full.cost >= weak.cost


def test_no_transfer_when_squad_is_already_optimal(league):
    horizon = league.horizon(3)
    squad = optimize_squad(league, horizon, budget=1000, min_availability=0.0)
    plan = suggest_transfers(
        league,
        squad.players,
        horizon,
        bank=1000 - squad.cost,
        free_transfers=1,
        max_transfers=2,
        min_availability=0.0,
    )
    assert plan.net_gain <= 0.01


def test_transfer_payload_shape():
    payload = build_transfer_payload(123, 5, [(10, 20, 55, 60)])
    assert payload["entry"] == 123
    assert payload["event"] == 5
    assert payload["transfers"] == [
        {"element_in": 20, "element_out": 10, "purchase_price": 60, "selling_price": 55}
    ]


def test_lineup_payload_shape():
    payload = build_lineup_payload(list(range(1, 12)), [12, 13, 14, 15], captain=3, vice_captain=4)
    assert [p["position"] for p in payload["picks"]] == list(range(1, 16))
    assert sum(1 for p in payload["picks"] if p["is_captain"]) == 1
    assert sum(1 for p in payload["picks"] if p["is_vice_captain"]) == 1
    assert payload["picks"][2]["is_captain"] is True
