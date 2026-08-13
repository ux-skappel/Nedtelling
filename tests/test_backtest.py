"""Tester for backtesten. Bruker syntetiske sesongdata, ingen nedlasting."""

from __future__ import annotations

import pytest

from fplbot.backtest.engine import apply_autosubs, selling_price
from fplbot.backtest.history import PlayerRow, Season, previous_season, prior_profile
from fplbot.model import ProjectionModel
from fplbot.scoring import DEF, FWD, GKP, MID


def make_row(element: int, event: int, position: int, **overrides) -> PlayerRow:
    values = {
        "element": element,
        "name": f"Spiller {element}",
        "position": position,
        "team": 1,
        "event": event,
        "minutes": 90,
        "starts": 1,
        "points": 5,
        "value": 50,
        "expected_goals": 0.3,
        "expected_assists": 0.2,
        "defensive_contribution": 5.0,
        "saves": 0,
        "bonus": 1,
        "yellow_cards": 0,
        "selected": 100_000,
    }
    values.update(overrides)
    return PlayerRow(**values)


def make_season(name: str = "2025-26", events: int = 4) -> Season:
    rows = []
    for event in range(1, events + 1):
        for element, position in ((1, GKP), (2, DEF), (3, MID), (4, FWD)):
            rows.append(make_row(element, event, position))
    fixtures = [
        {
            "id": event,
            "event": event,
            "team_h": 1,
            "team_a": 2,
            "team_h_score": 2,
            "team_a_score": 1,
            "team_h_difficulty": 3,
            "team_a_difficulty": 3,
            "finished": True,
        }
        for event in range(1, events + 1)
    ]
    return Season(
        season=name, rows=rows, fixtures=fixtures, team_names={1: "Alfa", 2: "Beta"}
    )


def test_previous_season_naming():
    assert previous_season("2025-26") == "2024-25"
    assert previous_season("2020-21") == "2019-20"


def test_selling_price_follows_fpl_rules():
    assert selling_price(50, 50) == 50  # ingen endring
    assert selling_price(50, 45) == 45  # fall tas fullt ut
    assert selling_price(50, 54) == 52  # halve stigningen, rundet ned
    assert selling_price(50, 53) == 51  # 1.5 rundes ned til 1


def test_snapshot_hides_the_future():
    """Et snapshot for runde 3 skal ikke inneholde noe fra runde 3 eller senere."""
    season = make_season(events=4)
    bootstrap, fixtures = season.snapshot(3)

    # Bare de to første rundene skal telle med i totalene.
    element = next(e for e in bootstrap["elements"] if e["id"] == 3)
    assert element["minutes"] == 180
    assert element["total_points"] == 10

    for fixture in fixtures:
        if fixture["event"] >= 3:
            assert fixture["finished"] is False
            assert fixture["team_h_score"] is None
        else:
            assert fixture["team_h_score"] == 2

    assert [e["id"] for e in bootstrap["events"] if e["finished"]] == [1, 2]


def test_snapshot_grows_with_the_season():
    season = make_season(events=4)
    early = next(e for e in season.snapshot(2)[0]["elements"] if e["id"] == 3)
    late = next(e for e in season.snapshot(4)[0]["elements"] if e["id"] == 3)
    assert late["minutes"] > early["minutes"]
    assert late["total_points"] > early["total_points"]


def test_snapshot_feeds_the_model():
    season = make_season(events=4)
    bootstrap, fixtures = season.snapshot(3)
    model = ProjectionModel(bootstrap, fixtures, blend_ppg=0.0)
    assert model.next_event() == 3
    assert model.games_basis == 2
    assert model.by_id(3).xp[3] > 0


def test_actual_points_sums_double_gameweeks():
    season = make_season(events=2)
    season.rows.append(make_row(3, 2, MID, points=7))
    season = Season(
        season=season.season,
        rows=season.rows,
        fixtures=season.fixtures,
        team_names=season.team_names,
    )
    assert season.actual_points(3, 2) == 12  # 5 + 7
    assert season.actual_points(3, 1) == 5


def test_prior_profile_counts_only_games_the_player_was_in():
    """En spiller som kom i januar skal ikke straffes for høsten."""
    current = make_season("2025-26", events=2)
    rows = [make_row(1, event, MID) for event in range(30, 39)]  # ni runder
    for row in rows:
        row.name = "Spiller 3"  # samme navn som en spiller i current
    prior = Season(
        season="2024-25", rows=rows, fixtures=current.fixtures, team_names={1: "Alfa"}
    )
    profile = prior_profile(prior, current)
    assert profile[3]["games"] == 9
    assert profile[3]["starts"] == 9
    assert profile[3]["xg90"] == pytest.approx(0.3, abs=0.01)


def test_prior_profile_skips_unmatched_names():
    current = make_season("2025-26", events=2)
    prior = Season(
        season="2024-25",
        rows=[make_row(99, 1, MID)],  # "Spiller 99" finnes ikke i current
        fixtures=current.fixtures,
        team_names={1: "Alfa"},
    )
    assert prior_profile(prior, current) == {}


# ------------------------------------------------------------------- autobytter


class FakeSeason:
    """Minimal sesong der vi styrer hvem som spilte."""

    def __init__(self, minutes: dict[int, int]) -> None:
        self._minutes = minutes

    def actual_minutes(self, element: int, event: int) -> int:
        return self._minutes.get(element, 0)


def make_player(model: ProjectionModel, player_id: int):
    return model.players[player_id]


@pytest.fixture
def squad_model() -> ProjectionModel:
    """Ellever pluss benk, med kjente posisjoner."""
    from tests.test_model import make_bootstrap, make_element, make_fixtures

    layout = [
        (1, GKP), (2, GKP),
        (3, DEF), (4, DEF), (5, DEF), (6, DEF), (7, DEF),
        (8, MID), (9, MID), (10, MID), (11, MID), (12, MID),
        (13, FWD), (14, FWD), (15, FWD),
    ]
    elements = [make_element(pid, position) for pid, position in layout]
    return ProjectionModel(make_bootstrap(elements), make_fixtures(), blend_ppg=0.0)


def test_autosub_replaces_a_blanking_starter(squad_model):
    starters = [squad_model.by_id(i) for i in [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15]]
    bench = [squad_model.by_id(i) for i in [2, 6, 7, 12]]
    # Alle spilte, bortsett fra midtbanespiller 11.
    minutes = {i: 90 for i in range(1, 16)}
    minutes[11] = 0
    final, swaps = apply_autosubs(starters, bench, FakeSeason(minutes), event=1)
    assert swaps == 1
    assert squad_model.by_id(11) not in final
    assert len(final) == 11


def test_autosub_keeps_the_formation_legal(squad_model):
    """Med bare tre forsvarere igjen kan ikke en forsvarer byttes ut mot en spiss."""
    starters = [squad_model.by_id(i) for i in [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15]]
    # Benken har bare reservekeeper og en midtbanespiller å tilby.
    bench = [squad_model.by_id(2), squad_model.by_id(12)]
    minutes = {i: 90 for i in range(1, 16)}
    minutes[3] = 0  # en av de tre forsvarerne spilte ikke
    final, _ = apply_autosubs(starters, bench, FakeSeason(minutes), event=1)
    goalkeepers = sum(1 for p in final if p.position == GKP)
    assert goalkeepers == 1
    # Å sette inn midtbanespilleren ville gitt to forsvarere, som er ulovlig.
    assert squad_model.by_id(3) in final


def test_autosub_only_swaps_keeper_for_keeper(squad_model):
    starters = [squad_model.by_id(i) for i in [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15]]
    bench = [squad_model.by_id(i) for i in [2, 6, 7, 12]]
    minutes = {i: 90 for i in range(1, 16)}
    minutes[1] = 0  # keeperen spilte ikke
    final, swaps = apply_autosubs(starters, bench, FakeSeason(minutes), event=1)
    assert swaps == 1
    assert squad_model.by_id(2) in final  # reservekeeperen kom inn
    assert sum(1 for p in final if p.position == GKP) == 1


def test_autosub_does_nothing_when_everyone_played(squad_model):
    starters = [squad_model.by_id(i) for i in [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15]]
    bench = [squad_model.by_id(i) for i in [2, 6, 7, 12]]
    minutes = {i: 90 for i in range(1, 16)}
    final, swaps = apply_autosubs(starters, bench, FakeSeason(minutes), event=1)
    assert swaps == 0
    assert final == starters


def test_autosub_cannot_use_a_benchwarmer_who_also_blanked(squad_model):
    starters = [squad_model.by_id(i) for i in [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15]]
    bench = [squad_model.by_id(i) for i in [2, 6, 7, 12]]
    minutes = {i: 90 for i in range(1, 16)}
    minutes[11] = 0
    for benched in (6, 7, 12):
        minutes[benched] = 0
    final, swaps = apply_autosubs(starters, bench, FakeSeason(minutes), event=1)
    assert swaps == 0
    assert squad_model.by_id(11) in final


# -------------------------------------------------------------------- revisjon


def test_audit_passes_on_clean_snapshots():
    from fplbot.backtest.audit import audit_season

    report = audit_season(make_season(events=5))
    assert report.clean
    assert report.events_checked == 4


def test_audit_catches_a_planted_result_leak():
    """Revisjonen må selv kunne fange lekkasje vi planter med vilje."""
    from fplbot.backtest.audit import audit_season

    season = make_season(events=5)
    original = season._masked_fixtures

    def leaky(event: int):
        # Later som resultatene fra kommende runder allerede er kjent.
        fixtures = original(event)
        for fixture in fixtures:
            fixture["finished"] = True
            fixture["team_h_score"] = 2
        return fixtures

    season._masked_fixtures = leaky
    report = audit_season(season)
    assert not report.clean
    assert any("resultat" in f or "ferdigspilt" in f for f in report.findings)


def test_audit_catches_a_planted_totals_leak():
    """Totaler som rommer runden vi står foran skal slå ut."""
    from fplbot.backtest.audit import audit_season

    season = make_season(events=5)
    original = season._aggregate

    def leaky(through: int, price_season):
        return original(through=through + 1, price_season=price_season)

    season._aggregate = leaky
    report = audit_season(season)
    assert not report.clean
    assert any("summen av rundene før" in f for f in report.findings)


def test_controls_change_the_projections():
    from fplbot.backtest import controls
    from tests.test_model import make_bootstrap, make_element, make_fixtures

    model = ProjectionModel(
        make_bootstrap([make_element(1, MID)]), make_fixtures(), blend_ppg=0.0
    )
    season = make_season(events=3)

    before = model.by_id(1).xp[1]
    controls.price_only()(model, 1, season)
    assert model.by_id(1).xp[1] == model.by_id(1).cost / 20.0
    assert model.by_id(1).xp[1] != before

    controls.scrambled(seed=3)(model, 1, season)
    assert 0.0 <= model.by_id(1).xp[1] <= 6.0


# ---------------------------------------------------------------- rangering


def make_curve():
    from fplbot.backtest.rank import RankCurve

    # Sortert fra flest poeng til færrest, slik build_curves lager dem.
    return RankCurve(
        season="2025/26",
        points=[2500, 2400, 2300, 2200, 2000, 1500],
        ranks=[1_000, 10_000, 100_000, 500_000, 2_000_000, 9_000_000],
    )


def test_rank_curve_is_monotone():
    """Flere poeng skal aldri gi dårligere plassering."""
    curve = make_curve()
    from itertools import pairwise

    ranks = [curve.rank_for(p) for p in range(1500, 2501, 50)]
    assert all(a >= b for a, b in pairwise(ranks))


def test_rank_curve_interpolates_between_points():
    curve = make_curve()
    between = curve.rank_for(2350)
    assert 10_000 < between < 100_000


def test_rank_curve_clamps_outside_the_samples():
    curve = make_curve()
    assert curve.rank_for(9999) == 1_000  # bedre enn alt vi har sett
    assert curve.rank_for(0) == 9_000_000  # svakere enn alt vi har sett


def test_rank_curve_hits_the_sampled_points():
    curve = make_curve()
    for points, rank in zip(curve.points, curve.ranks, strict=True):
        assert curve.rank_for(points) == pytest.approx(rank, rel=0.02)


def test_percentile_follows_rank():
    curve = make_curve()
    assert curve.percentile_for(2500) > curve.percentile_for(2000)
    assert 0 <= curve.percentile_for(1500) <= 100


def test_empty_curve_answers_nothing():
    from fplbot.backtest.rank import RankCurve

    empty = RankCurve(season="2025/26")
    assert empty.rank_for(2300) is None
    assert empty.percentile_for(2300) is None


def test_season_key_matches_fpl_format():
    from fplbot.backtest.rank import season_key

    assert season_key("2025-26") == "2025/26"


# ----------------------------------------------------------------------- chips


def chip_squad(model, event=5):
    return list(model.players.values())


def test_second_wildcard_is_locked_to_the_second_half():
    """FPL gir ikke wildcard nummer to før første halvsesong er over."""
    from fplbot.backtest import chips

    state = chips.ChipState(wildcards=1, bench_boost=0, triple_captain=0, free_hit=0)
    early = chips.choose_chip(state, [], event=10, squad_gap=999)
    late = chips.choose_chip(state, [], event=25, squad_gap=999)
    assert early is None
    assert late == chips.WILDCARD


def test_first_wildcard_waits_for_some_data():
    from fplbot.backtest import chips

    state = chips.ChipState(bench_boost=0, triple_captain=0, free_hit=0)
    assert chips.choose_chip(state, [], event=2, squad_gap=999) is None
    assert chips.choose_chip(state, [], event=6, squad_gap=999) == chips.WILDCARD


def test_wildcard_needs_a_real_gap():
    from fplbot.backtest import chips

    state = chips.ChipState(bench_boost=0, triple_captain=0, free_hit=0)
    assert chips.choose_chip(state, [], event=8, squad_gap=5.0) is None
    assert chips.choose_chip(state, [], event=8, squad_gap=40.0) == chips.WILDCARD


def test_unused_chips_are_forced_out_before_the_season_ends():
    from fplbot.backtest import chips

    state = chips.ChipState(wildcards=0, bench_boost=0, triple_captain=0)
    assert chips.choose_chip(state, [], event=36, squad_gap=0) == chips.FREE_HIT


def test_spending_a_chip_records_it():
    from fplbot.backtest import chips

    state = chips.ChipState()
    state.spend(chips.TRIPLE_CAPTAIN, 12)
    assert state.played[12] == chips.TRIPLE_CAPTAIN
    assert not state.available(chips.TRIPLE_CAPTAIN)
    # Bare ett kort per runde.
    assert chips.choose_chip(state, [], event=12, squad_gap=999) is None
