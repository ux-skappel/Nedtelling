"""Skrivelaget. Det eneste stedet som kaller FPL sine POST-endepunkter.

Hver skriving går gjennom fire steg, i denne rekkefølgen:

    1. hent tilstanden på nytt
    2. valider handlingen mot den ferske tilstanden
    3. skriv
    4. hent tilstanden på nytt igjen og verifiser at FPL faktisk registrerte den

Steg 4 er ikke overflødig. At et POST-kall svarer 200 betyr at forespørselen ble
tatt imot, ikke at laget ditt ser ut som du tror. Feiler verifikasjonen, stopper
kjeden i stedet for å fortsette blindt med flere irreversible handlinger.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from ..api import FplApi, FplError
from .actions import Action, ActionKind
from .config import Settings
from .log import BLOCKED, DRY_RUN, FAILED, SKIPPED, SUCCESS, ActionLog
from .state import TeamState, fetch_team_state
from .validation import ValidationResult, validate_action


@dataclass
class ExecutionOutcome:
    action: Action
    status: str
    validation: ValidationResult | None = None
    verification: dict | None = None
    message: str = ""
    notes: list[str] = field(default_factory=list)

    @property
    def wrote(self) -> bool:
        return self.status == SUCCESS


class Executor:
    """Utfører handlinger. Stopper seg selv når noe ikke stemmer."""

    def __init__(
        self,
        api: FplApi,
        settings: Settings,
        log: ActionLog,
        players_by_id: dict,
        doctor_ok: bool,
    ) -> None:
        self.api = api
        self.settings = settings
        self.log = log
        self.players_by_id = players_by_id
        self.doctor_ok = doctor_ok
        # Settes når en irreversibel handling feiler verifikasjon. Da skal
        # ingen flere irreversible handlinger forsøkes i samme kjøring.
        self.halted = False
        self.halt_reason = ""

    def execute(
        self,
        action: Action,
        decision_state: TeamState,
        hours_to_deadline: float,
        context: dict,
    ) -> ExecutionOutcome:
        if self.halted and action.irreversible:
            outcome = ExecutionOutcome(
                action, BLOCKED, message=f"stoppet tidligere: {self.halt_reason}"
            )
            self.log.record(action, BLOCKED, context, response=outcome.message)
            return outcome

        if self.log.already_done(action):
            return ExecutionOutcome(action, SKIPPED, message="allerede utført")

        # 1. Fersk tilstand rett før skriving.
        try:
            live = fetch_team_state(self.api, decision_state.entry_id, decision_state.event)
        except FplError as exc:
            outcome = ExecutionOutcome(action, FAILED, message=f"klarte ikke hente laget: {exc}")
            self.log.record(action, FAILED, context, response=str(exc))
            return outcome

        # 2. Valider mot den ferske tilstanden.
        validation = validate_action(
            action,
            settings=self.settings,
            decision_state=decision_state,
            live_state=live,
            doctor_ok=self.doctor_ok,
            hours_to_deadline=hours_to_deadline,
            already_done=False,
            players_by_id=self.players_by_id,
        )
        if not validation.ok:
            outcome = ExecutionOutcome(
                action, BLOCKED, validation, message="; ".join(validation.failures)
            )
            self.log.record(action, BLOCKED, context, response=outcome.message)
            return outcome

        if not self.settings.writes_enabled:
            outcome = ExecutionOutcome(
                action, DRY_RUN, validation, message=self.settings.describe()
            )
            self.log.record(action, DRY_RUN, context, response=outcome.message)
            return outcome

        # 3. Skriv.
        try:
            response = self._write(action, decision_state.entry_id)
        except FplError as exc:
            if action.irreversible:
                self.halted = True
                self.halt_reason = f"{action.kind.value} feilet: {exc}"
            outcome = ExecutionOutcome(action, FAILED, validation, message=str(exc))
            self.log.record(action, FAILED, context, response=str(exc))
            return outcome

        # 4. Verifiser mot FPL sin faktiske tilstand.
        verification = self._verify(action, decision_state)
        status = SUCCESS if verification["ok"] else FAILED
        if not verification["ok"] and action.irreversible:
            self.halted = True
            self.halt_reason = f"verifikasjon feilet for {action.kind.value}"
        self.log.record(action, status, context, verification, str(response)[:500])
        return ExecutionOutcome(
            action,
            status,
            validation,
            verification,
            message="" if verification["ok"] else "; ".join(verification["problems"]),
        )

    # ------------------------------------------------------------------ skriving

    def _write(self, action: Action, entry_id: int):
        if action.kind is ActionKind.TRANSFER:
            return self.api.submit_transfers(action.payload)
        if action.kind is ActionKind.LINEUP:
            return self.api.submit_lineup(entry_id, action.payload)
        raise FplError(f"Ukjent handlingstype: {action.kind}")

    # -------------------------------------------------------------- verifikasjon

    def _verify(self, action: Action, decision_state: TeamState, attempts: int = 3) -> dict:
        """Henter laget på nytt og sjekker at handlingen faktisk står der.

        FPL bruker et lite øyeblikk på å oppdatere, så vi prøver noen ganger før
        vi konkluderer med at skrivingen ikke tok.
        """
        problems: list[str] = []
        for attempt in range(attempts):
            if attempt:
                time.sleep(2.0 * attempt)
            try:
                after = fetch_team_state(
                    self.api, decision_state.entry_id, decision_state.event
                )
            except FplError as exc:
                problems = [f"klarte ikke hente laget for verifisering: {exc}"]
                continue
            problems = self._compare(action, after)
            if not problems:
                return {"ok": True, "problems": [], "attempts": attempt + 1}
        return {"ok": False, "problems": problems, "attempts": attempts}

    def _compare(self, action: Action, after: TeamState) -> list[str]:
        problems: list[str] = []
        if action.kind is ActionKind.TRANSFER:
            for element in action.details["out"]:
                if element in after.element_ids:
                    problems.append(f"spiller {element} står fortsatt i troppen")
            for element in action.details["in"]:
                if element not in after.element_ids:
                    problems.append(f"spiller {element} kom ikke inn i troppen")
            expected_bank = action.details.get("bank_after")
            if expected_bank is not None and after.bank != expected_bank:
                problems.append(f"banken er {after.bank}, ventet {expected_bank}")
        elif action.kind is ActionKind.LINEUP:
            if after.starters != action.details["starters"]:
                problems.append("startellevern hos FPL stemmer ikke med det vi sendte")
            if after.bench != action.details["bench"]:
                problems.append("benkerekkefølgen hos FPL stemmer ikke")
            if after.captain != action.details["captain"]:
                problems.append(f"kapteinen er {after.captain}, ventet {action.details['captain']}")
            if after.vice != action.details["vice"]:
                problems.append(f"visekapteinen er {after.vice}, ventet {action.details['vice']}")
        if action.chip and after.active_chip != action.chip:
            problems.append(f"chipen {action.chip} er ikke aktiv hos FPL")
        return problems
