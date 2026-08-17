"""Tester for execution-laget.

Dette er koden som får skrive til laget uten at noen ser på. Testene her handler
derfor ikke om hvor gode beslutningene er, men om at ugyldige handlinger stoppes,
at ingenting utføres to ganger, og at en skriving som ikke tok blir oppdaget.
"""

from __future__ import annotations

import json

import pytest

from fplbot.execution.actions import ActionKind, lineup_action, transfer_action
from fplbot.execution.config import Settings, load_settings
from fplbot.execution.executor import Executor
from fplbot.execution.log import BLOCKED, DRY_RUN, FAILED, SUCCESS, ActionLog
from fplbot.execution.state import Pick, TeamState
from fplbot.execution.validation import validate_action
from fplbot.scoring import DEF, FWD, GKP, MID
from tests.test_appearance_exact import make_player

QUOTA = [(GKP, 2), (DEF, 5), (MID, 5), (FWD, 3)]


def build_players(count: int = 20) -> dict:
    """Nok spillere til en lovlig tropp, pluss noen å bytte inn.

    Klubbene fordeles etter at troppen er plukket, slik at grunntroppen har
    nøyaktig tre fra hver klubb. Da er utgangspunktet lovlig, og en test som
    bryter klubbgrensen gjør det fordi den vil, ikke ved uhell.
    """
    players = {}
    element = 1
    for position, quota in QUOTA:
        for index in range(quota + 4):
            player = make_player(element, position)
            player.cost = 50 + index
            players[element] = player
            element += 1

    inside = squad_ids(players)
    for index, key in enumerate(inside):
        players[key].team = 1 + index // 3
    for key in players:
        if key not in inside:
            # Reservene ligger på egne klubber, så innbytte aldri sprenger grensen.
            players[key].team = 20 + key % 5
    return players


def squad_ids(players: dict) -> list[int]:
    picked: list[int] = []
    for position, quota in QUOTA:
        matching = [e for e, p in players.items() if p.position == position]
        picked.extend(matching[:quota])
    return picked


def make_state(players: dict, event: int = 5, bank: int = 10, free: int = 1) -> TeamState:
    ids = squad_ids(players)
    # Lovlig 1-4-4-2, så benken: reservekeeper, så én per posisjon.
    by_position = {
        position: [e for e in ids if players[e].position == position]
        for position, _ in QUOTA
    }
    ordered = (
        by_position[GKP][:1]
        + by_position[DEF][:4]
        + by_position[MID][:4]
        + by_position[FWD][:2]
        + by_position[GKP][1:]
        + by_position[DEF][4:]
        + by_position[MID][4:]
        + by_position[FWD][2:]
    )
    picks = [
        Pick(
            element=element,
            position=index,
            is_captain=index == 1,
            is_vice_captain=index == 2,
            selling_price=players[element].cost,
            purchase_price=players[element].cost,
        )
        for index, element in enumerate(ordered, start=1)
    ]
    return TeamState(
        entry_id=99,
        event=event,
        picks=picks,
        bank=bank,
        free_transfers=free,
        chips_played=[],
        chips_available=["wildcard", "bboost", "3xc", "freehit"],
        active_chip=None,
    )


def make_transfer(players, state, out_element, in_element, gain=5.0, hit=0):
    return transfer_action(
        entry_id=state.entry_id,
        event=state.event,
        moves=[(out_element, in_element, state.selling_prices[out_element],
                players[in_element].cost)],
        names=[(players[out_element].name, players[in_element].name)],
        predicted_gain=gain,
        hit_cost=hit,
    )


def spare(players, state, position):
    return next(
        e for e, p in players.items()
        if p.position == position and e not in state.element_ids
    )


def validate(action, state, players, live=None, doctor_ok=True, hours=1.0, done=False,
             settings=None):
    return validate_action(
        action,
        settings=settings or Settings(autonomy=True, dry_run=False),
        decision_state=state,
        live_state=live or state,
        doctor_ok=doctor_ok,
        hours_to_deadline=hours,
        already_done=done,
        players_by_id=players,
    )


# ------------------------------------------------------------------ identitet


def test_action_id_is_stable_across_runs():
    """To kjøringer på samme beslutning må gi samme ID, ellers er idempotens umulig."""
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    first = make_transfer(players, state, out, into)
    second = make_transfer(players, state, out, into)
    assert first.action_id == second.action_id
    assert first.action_id.startswith("GW05-TRANSFER-")


def test_action_id_changes_with_content():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    position = players[out].position
    candidates = [
        e for e, p in players.items()
        if p.position == position and e not in state.element_ids
    ]
    first = make_transfer(players, state, out, candidates[0])
    second = make_transfer(players, state, out, candidates[1])
    assert first.action_id != second.action_id


def test_lineup_is_reversible_and_transfers_are_not():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    assert make_transfer(players, state, out, into).irreversible
    assert not lineup_action(
        5, state.starters, state.bench, state.starters[0], state.starters[1], {}
    ).irreversible


# ------------------------------------------------------------------ validering


def test_valid_transfer_passes():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    result = validate(make_transfer(players, state, out, into), state, players)
    assert result.ok, result.failures


def test_transfer_blocked_when_doctor_fails():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    result = validate(make_transfer(players, state, out, into), state, players, doctor_ok=False)
    assert not result.ok
    assert any("doctor" in f for f in result.failures)


def test_transfer_blocked_after_deadline():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    result = validate(make_transfer(players, state, out, into), state, players, hours=-0.5)
    assert not result.ok
    assert any("fristen" in f for f in result.failures)


def test_transfer_blocked_when_squad_changed_since_decision():
    """Har du gjort et bytte selv fra mobilen, skal den gamle planen forkastes."""
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    action = make_transfer(players, state, out, into)

    live = make_state(players)
    other = spare(players, live, players[live.starters[6]].position)
    live.picks = [
        p if p.element != live.starters[6] else Pick(other, p.position, False, False, 50, 50)
        for p in live.picks
    ]
    result = validate(action, state, players, live=live)
    assert not result.ok
    assert any("troppen er endret" in f for f in result.failures)


def test_transfer_blocked_when_bank_would_go_negative():
    players = build_players()
    state = make_state(players, bank=0)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    players[into].cost = players[out].cost + 50  # 5,0m dyrere enn vi har råd til
    result = validate(make_transfer(players, state, out, into), state, players)
    assert not result.ok
    assert any("banken" in f for f in result.failures)


def test_hit_above_failsafe_is_blocked():
    """Katastrofesikringen, ikke strategi: et stort hit skal aldri kunne skje autonomt."""
    players = build_players()
    state = make_state(players, free=1)
    outs = state.starters[3:6]
    ins = []
    for element in outs:
        candidate = next(
            e for e, p in players.items()
            if p.position == players[element].position
            and e not in state.element_ids
            and e not in ins
        )
        ins.append(candidate)
    action = transfer_action(
        entry_id=state.entry_id,
        event=state.event,
        moves=[(o, i, state.selling_prices[o], players[i].cost)
               for o, i in zip(outs, ins, strict=True)],
        names=[(players[o].name, players[i].name) for o, i in zip(outs, ins, strict=True)],
        predicted_gain=99.0,
        hit_cost=8,
    )
    settings = Settings(autonomy=True, dry_run=False, max_autonomous_hit=4, max_transfers=3)
    result = validate(action, state, players, settings=settings)
    assert not result.ok
    assert any("katastrofesikringen" in f for f in result.failures)


def test_hit_requires_model_support():
    players = build_players()
    state = make_state(players, free=0)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    weak = make_transfer(players, state, out, into, gain=4.5, hit=4)
    result = validate(weak, state, players)
    assert not result.ok
    assert any("forsvarer minuspoengene" in f for f in result.failures)

    strong = make_transfer(players, state, out, into, gain=6.5, hit=4)
    assert validate(strong, state, players).ok


def test_hit_cost_must_match_fpl_own_count():
    """Optimereren kan tro den har et gratis bytte FPL ikke gir den."""
    players = build_players()
    state = make_state(players, free=0)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    action = make_transfer(players, state, out, into, gain=9.0, hit=0)
    result = validate(action, state, players)
    assert not result.ok
    assert any("minuspoengene stemmer" in f for f in result.failures)


def test_already_executed_action_is_blocked():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    result = validate(make_transfer(players, state, out, into), state, players, done=True)
    assert not result.ok


def test_transfer_breaking_team_limit_is_blocked():
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    # Gjør slik at fire spillere i den nye troppen kommer fra samme klubb.
    target = 3
    for element in list(state.element_ids)[:3]:
        players[element].team = target
    players[into].team = target
    result = validate(make_transfer(players, state, out, into), state, players)
    assert not result.ok
    assert any("samme klubb" in f for f in result.failures)


# ------------------------------------------------------------ oppstillingsvern


def lineup_from(state, players, captain=None, vice=None, bench=None):
    starters = state.starters
    return lineup_action(
        state.event,
        starters,
        bench or state.bench,
        captain or starters[1],
        vice or starters[2],
        {e: players[e].name for e in players},
    )


def test_valid_lineup_passes():
    players = build_players()
    state = make_state(players)
    assert validate(lineup_from(state, players), state, players).ok


def test_lineup_with_captain_on_the_bench_is_blocked():
    players = build_players()
    state = make_state(players)
    action = lineup_from(state, players, captain=state.bench[1])
    result = validate(action, state, players)
    assert not result.ok
    assert any("kapteinen starter" in f for f in result.failures)


def test_lineup_with_same_captain_and_vice_is_blocked():
    players = build_players()
    state = make_state(players)
    action = lineup_from(state, players, captain=state.starters[1], vice=state.starters[1])
    result = validate(action, state, players)
    assert not result.ok


def test_lineup_without_keeper_first_on_bench_is_blocked():
    players = build_players()
    state = make_state(players)
    bench = list(state.bench)
    bench[0], bench[1] = bench[1], bench[0]
    result = validate(lineup_from(state, players, bench=bench), state, players)
    assert not result.ok
    assert any("Reservekeeper" in f or "reservekeeper" in f for f in result.failures)


def test_lineup_with_foreign_player_is_blocked():
    players = build_players()
    state = make_state(players)
    outsider = spare(players, state, MID)
    starters = list(state.starters)
    starters[5] = outsider
    action = lineup_action(
        state.event, starters, state.bench, starters[1], starters[2],
        {e: players[e].name for e in players},
    )
    result = validate(action, state, players)
    assert not result.ok


# --------------------------------------------------------------------- chips


def test_chip_blocked_outside_the_chip_window():
    players = build_players()
    state = make_state(players)
    action = lineup_from(state, players)
    action.chip = "bboost"
    action.predicted_gain = 20.0
    result = validate(action, state, players, hours=8.0)
    assert not result.ok
    assert any("nær fristen" in f for f in result.failures)


def test_chip_blocked_when_already_played():
    players = build_players()
    state = make_state(players)
    state.chips_played = ["bboost"]
    state.chips_available = ["wildcard"]
    action = lineup_from(state, players)
    action.chip = "bboost"
    action.predicted_gain = 20.0
    result = validate(action, state, players, hours=1.0)
    assert not result.ok


def test_chip_blocked_without_material_advantage():
    players = build_players()
    state = make_state(players)
    action = lineup_from(state, players)
    action.chip = "bboost"
    action.predicted_gain = 2.0
    result = validate(action, state, players, hours=1.0)
    assert not result.ok
    assert any("vesentlig gevinst" in f for f in result.failures)


# --------------------------------------------------------------------- logg


def test_log_makes_repeat_execution_a_no_op(tmp_path):
    players = build_players()
    state = make_state(players)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    action = make_transfer(players, state, out, into)

    log = ActionLog(tmp_path / "actions.jsonl")
    assert not log.already_done(action)
    log.record(action, SUCCESS, {"doctor": "PASS"})
    assert log.already_done(action)
    # En feilet handling skal ikke blokkere et nytt forsøk.
    other = make_transfer(players, state, state.starters[6],
                          spare(players, state, players[state.starters[6]].position))
    log.record(other, FAILED, {})
    assert not log.already_done(other)


def test_log_is_append_only_and_parsable(tmp_path):
    players = build_players()
    state = make_state(players)
    log = ActionLog(tmp_path / "actions.jsonl")
    for index in range(3):
        log.record(lineup_from(state, players), SUCCESS, {"run": index})
    rows = [json.loads(line) for line in log.path.read_text().splitlines()]
    assert len(rows) == 3
    assert [r["context"]["run"] for r in rows] == [0, 1, 2]
    assert all(r["timestamp"] for r in rows)


def test_log_survives_a_corrupt_line(tmp_path):
    path = tmp_path / "actions.jsonl"
    path.write_text('{"action_id": "a", "status": "SUCCESS"}\nikke json\n')
    assert len(ActionLog(path)._entries()) == 1


# ----------------------------------------------------------------- executor


class FakeApi:
    """Nok av FPL-API-et til å kjøre skrivelaget uten nett."""

    def __init__(self, state: TeamState, apply=True, fail=False):
        self.state = state
        self.apply = apply
        self.fail = fail
        self.writes: list[tuple[str, dict]] = []

    def my_team(self, entry_id):
        picks = [
            {
                "element": p.element,
                "position": p.position,
                "is_captain": p.is_captain,
                "is_vice_captain": p.is_vice_captain,
                "selling_price": p.selling_price,
                "purchase_price": p.purchase_price,
            }
            for p in self.state.picks
        ]
        return {
            "picks": picks,
            "transfers": {"bank": self.state.bank, "limit": self.state.free_transfers},
            "chips": [{"name": c, "status_for_entry": "available"}
                      for c in self.state.chips_available],
        }

    def submit_transfers(self, payload):
        from fplbot.api import FplError

        if self.fail:
            raise FplError("400 fra POST transfers/")
        self.writes.append(("transfers", payload))
        if self.apply:
            moves = payload["transfers"]
            outs = {m["element_out"] for m in moves}
            raised = sum(
                p.selling_price for p in self.state.picks if p.element in outs
            )
            keep = [p for p in self.state.picks if p.element not in outs]
            for index, move in enumerate(moves):
                keep.append(Pick(move["element_in"], 15 - index, False, False,
                                 move["purchase_price"], move["purchase_price"]))
            self.state.picks = keep
            self.state.bank += raised - sum(m["purchase_price"] for m in moves)
        return {"ok": True}

    def submit_lineup(self, entry_id, payload):
        self.writes.append(("lineup", payload))
        if self.apply:
            self.state.picks = [
                Pick(p["element"], p["position"], p["is_captain"], p["is_vice_captain"], 50, 50)
                for p in payload["picks"]
            ]
        return {"ok": True}


def make_executor(api, players, settings=None, tmp_path=None, doctor_ok=True):
    settings = settings or Settings(autonomy=True, dry_run=False)
    if tmp_path is not None:
        settings.action_log = tmp_path / "actions.jsonl"
    return Executor(api, settings, ActionLog(settings.action_log), players, doctor_ok)


def test_dry_run_never_writes(tmp_path):
    players = build_players()
    state = make_state(players)
    api = FakeApi(state)
    settings = Settings(autonomy=True, dry_run=True, action_log=tmp_path / "a.jsonl")
    executor = make_executor(api, players, settings)
    action = lineup_from(state, players)
    outcome = executor.execute(action, state, 1.0, {})
    assert outcome.status == DRY_RUN
    assert api.writes == []


def test_advisory_mode_never_writes(tmp_path):
    players = build_players()
    state = make_state(players)
    api = FakeApi(state)
    settings = Settings(autonomy=False, dry_run=False, action_log=tmp_path / "a.jsonl")
    executor = make_executor(api, players, settings)
    outcome = executor.execute(lineup_from(state, players), state, 1.0, {})
    assert outcome.status == DRY_RUN
    assert api.writes == []


def test_successful_lineup_write_is_verified(tmp_path):
    players = build_players()
    state = make_state(players)
    api = FakeApi(state)
    executor = make_executor(api, players, tmp_path=tmp_path)
    action = lineup_from(state, players, captain=state.starters[3], vice=state.starters[4])
    outcome = executor.execute(action, state, 1.0, {})
    assert outcome.status == SUCCESS, outcome.message
    assert outcome.verification["ok"]
    assert api.writes[0][0] == "lineup"


def test_write_that_does_not_take_is_caught(tmp_path):
    """FPL svarer 200, men laget endrer seg ikke. Det skal oppdages."""
    players = build_players()
    state = make_state(players)
    api = FakeApi(state, apply=False)
    executor = make_executor(api, players, tmp_path=tmp_path)
    action = lineup_from(state, players, captain=state.starters[3], vice=state.starters[4])
    outcome = executor.execute(action, state, 1.0, {})
    assert outcome.status == FAILED
    assert not outcome.verification["ok"]
    assert executor.halted is False  # oppstilling er reversibel, den stopper ikke kjeden


def test_failed_transfer_halts_further_irreversible_actions(tmp_path):
    players = build_players()
    state = make_state(players)
    api = FakeApi(state, apply=False)
    executor = make_executor(api, players, tmp_path=tmp_path)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    outcome = executor.execute(make_transfer(players, state, out, into), state, 1.0, {})
    assert outcome.status == FAILED
    assert executor.halted

    second_out = state.starters[6]
    second_in = spare(players, state, players[second_out].position)
    blocked = executor.execute(
        make_transfer(players, state, second_out, second_in), state, 1.0, {}
    )
    assert blocked.status == BLOCKED
    assert "stoppet tidligere" in blocked.message


def test_api_error_on_transfer_halts_and_logs(tmp_path):
    players = build_players()
    state = make_state(players)
    api = FakeApi(state, fail=True)
    executor = make_executor(api, players, tmp_path=tmp_path)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    outcome = executor.execute(make_transfer(players, state, out, into), state, 1.0, {})
    assert outcome.status == FAILED
    assert executor.halted
    assert ActionLog(executor.settings.action_log).tail(1)[0]["status"] == FAILED


def test_repeat_run_does_not_transfer_twice(tmp_path):
    """Planleggeren kan kjøre to ganger. Det skal ikke gi to bytter."""
    players = build_players()
    state = make_state(players)
    api = FakeApi(state)
    executor = make_executor(api, players, tmp_path=tmp_path)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    action = make_transfer(players, state, out, into)

    first = executor.execute(action, state, 1.0, {})
    assert first.status == SUCCESS
    assert len(api.writes) == 1

    second = executor.execute(action, state, 1.0, {})
    assert second.status == "SKIPPED"
    assert len(api.writes) == 1


def test_state_drift_between_decision_and_write_blocks(tmp_path):
    """Beslutningen ble tatt på en tropp som ikke lenger finnes."""
    players = build_players()
    state = make_state(players)
    live = make_state(players, bank=999)
    api = FakeApi(live)
    executor = make_executor(api, players, tmp_path=tmp_path)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    outcome = executor.execute(make_transfer(players, state, out, into), state, 1.0, {})
    assert outcome.status == BLOCKED
    assert "banken endret" in outcome.message
    assert api.writes == []


def test_doctor_failure_blocks_the_write(tmp_path):
    players = build_players()
    state = make_state(players)
    api = FakeApi(state)
    executor = make_executor(api, players, tmp_path=tmp_path, doctor_ok=False)
    out = state.starters[5]
    into = spare(players, state, players[out].position)
    outcome = executor.execute(make_transfer(players, state, out, into), state, 1.0, {})
    assert outcome.status == BLOCKED
    assert api.writes == []


# ------------------------------------------------------------ konfigurasjon


def test_defaults_are_safe(monkeypatch):
    for name in list(dict(**{k: v for k, v in __import__("os").environ.items()})):
        if name.startswith("FPL_"):
            monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.autonomy is False
    assert settings.dry_run is True
    assert settings.writes_enabled is False


def test_autonomy_requires_both_switches(monkeypatch):
    monkeypatch.setenv("FPL_AUTONOMY_MODE", "true")
    monkeypatch.setenv("FPL_DRY_RUN", "false")
    assert load_settings().writes_enabled is True
    monkeypatch.setenv("FPL_DRY_RUN", "true")
    assert load_settings().writes_enabled is False
    monkeypatch.setenv("FPL_AUTONOMY_MODE", "false")
    monkeypatch.setenv("FPL_DRY_RUN", "false")
    assert load_settings().writes_enabled is False


@pytest.mark.parametrize("value,expected", [("on", True), ("ja", True), ("0", False), ("", False)])
def test_flag_parsing(monkeypatch, value, expected):
    monkeypatch.setenv("FPL_AUTONOMY_MODE", value)
    assert load_settings().autonomy is expected


def test_action_kind_covers_the_write_surface():
    assert {k.value for k in ActionKind} == {"TRANSFER", "LINEUP", "CHIP"}


# ------------------------------------------------------------------ pipeline


def test_pipeline_waits_when_the_deadline_is_far_away(monkeypatch, tmp_path):
    """Ingen skriving når fristen er langt unna. Å vente er en beslutning."""
    from fplbot import auth
    from fplbot.execution import pipeline

    monkeypatch.setenv("FPL_ENTRY_ID", "42")
    monkeypatch.setenv("FPL_COOKIE", "csrftoken=abc; pl_profile=xyz")
    monkeypatch.setattr(auth, "get_entry_id", lambda: 42)
    monkeypatch.setattr(auth, "get_cookie", lambda: "csrftoken=abc")
    monkeypatch.setattr(pipeline, "run_checks", lambda within_hours=0: [])
    monkeypatch.setattr(pipeline, "has_failures", lambda checks: False)

    calls: list[str] = []

    class Api:
        def __init__(self, *a, **k):
            pass

        def bootstrap(self):
            calls.append("bootstrap")
            return {
                "events": [{"id": 9, "deadline_time": "2099-01-01T00:00:00Z", "is_next": True}],
                "teams": [{"id": 1, "short_name": "AAA", "name": "A"}],
                "elements": [],
                "element_types": [],
            }

        def fixtures(self):
            return []

        def my_team(self, entry_id):
            raise AssertionError("skal ikke hente laget når det er for tidlig")

        def submit_transfers(self, payload):
            raise AssertionError("skrev til FPL utenfor vinduet")

        def submit_lineup(self, entry_id, payload):
            raise AssertionError("skrev til FPL utenfor vinduet")

    monkeypatch.setattr(pipeline, "FplApi", Api)
    settings = Settings(autonomy=True, dry_run=False, action_log=tmp_path / "a.jsonl")
    result = pipeline.run(settings)

    assert result.phase == "WAIT"
    assert result.status == "SUCCESS"
    assert not result.outcomes
    assert "bootstrap" in calls


def test_pipeline_fails_safely_without_credentials(monkeypatch, tmp_path):
    from fplbot import auth
    from fplbot.execution import pipeline, status

    monkeypatch.setattr(auth, "get_entry_id", lambda: None)
    monkeypatch.setattr(auth, "get_cookie", lambda: None)
    result = pipeline.run(Settings(action_log=tmp_path / "a.jsonl"))
    assert result.status == "FAIL"
    assert status.exit_code(result) == 2
    assert not result.outcomes
