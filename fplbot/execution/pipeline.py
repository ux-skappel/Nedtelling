"""Den planlagte kjøringen, ende til ende.

    hent data -> hent laget -> oppdater projeksjoner -> doctor -> vurder bytter
    -> vurder chips -> sett oppstilling -> valider -> utfør -> verifiser -> logg

Kjøres ofte. Det meste av tiden gjør den ingenting annet enn å se på klokka og
oppdatere en foreløpig oppstilling. Jo nærmere fristen, jo mer alvor.

Tidsplanen er lagdelt fordi handlingene er ulikt farlige:

    over 30 timer igjen   se, ikke rør
    under 30 timer        oppstilling kan settes og settes om, den er reversibel
    under 1,5 timer       bytter kan utføres, informasjonen er så fersk den blir
    under 2 timer         chips kan aktiveres, med en strengere port

Å vente er en gyldig beslutning, ikke en unnlatelse. Et bytte gjort 30 timer før
fristen kaster bort informasjonen fra pressekonferansen som kommer om ti.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import auth, chips, deadline
from ..api import FplApi, FplError
from ..doctor import has_failures, run_checks
from ..model import ProjectionModel
from ..optimizer import pick_lineup
from ..strength import fit_team_strength
from ..transfers import suggest_transfers
from .actions import Action, lineup_action, transfer_action
from .config import Settings
from .executor import ExecutionOutcome, Executor
from .log import ActionLog
from .state import TeamState, fetch_team_state

WAIT = "WAIT"
ACT = "ACT"
IDLE = "IDLE"


@dataclass
class RunResult:
    status: str = "SUCCESS"
    phase: str = IDLE
    event: int | None = None
    hours_to_deadline: float = float("inf")
    mode: str = ""
    doctor_ok: bool = False
    doctor_lines: list[str] = field(default_factory=list)
    outcomes: list[ExecutionOutcome] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    execute_after: float | None = None
    transfer_summary: str = "Ingen bytter."
    captain: str = "-"
    vice: str = "-"
    bench: list[str] = field(default_factory=list)
    chip: str | None = None

    def degrade(self, note: str) -> None:
        self.notes.append(note)
        if self.status == "SUCCESS":
            self.status = "DEGRADED"

    def fail(self, note: str) -> None:
        self.notes.append(note)
        self.status = "FAIL"


def run(settings: Settings, entry_id: int | None = None, now=None) -> RunResult:
    """Én planlagt kjøring."""
    result = RunResult(mode=settings.describe())
    log = ActionLog(settings.action_log)

    entry_id = entry_id or auth.get_entry_id()
    if not entry_id:
        result.fail("Mangler lag-ID. Sett FPL_ENTRY_ID eller kjør 'fplbot config --entry-id'.")
        return result
    cookie = auth.get_cookie()
    if not cookie:
        result.fail("Mangler sesjonscookie. Uten den kan boten verken lese eller skrive laget.")
        return result

    # Doctor først. Er datakjeden brutt, skal ingenting irreversibelt skje.
    checks = run_checks(within_hours=settings.execution_window_hours)
    result.doctor_ok = not has_failures(checks)
    result.doctor_lines = [c.line() for c in checks]
    if not result.doctor_ok:
        result.degrade("Doctor feiler. Ingen irreversible handlinger utføres.")

    # Ferske data. Aldri mellomlager rett før en frist.
    api = FplApi(cookie=cookie, use_cache=False)
    try:
        bootstrap = api.bootstrap()
        fixtures = api.fixtures()
    except FplError as exc:
        result.fail(f"Klarte ikke hente data fra FPL: {exc}")
        return result

    finished = [e["id"] for e in bootstrap["events"] if e.get("finished")]
    strength = fit_team_strength(
        fixtures, [t["id"] for t in bootstrap["teams"]], max(finished) if finished else 0
    )
    model = ProjectionModel(bootstrap, fixtures, strength=strength)
    event = model.next_event()
    hours = deadline.hours_until(model.deadline(event), now)
    result.event = event
    result.hours_to_deadline = hours
    horizon = model.horizon(settings.horizon, start=event)

    # ---------------------------------------------------------------- fase
    #
    # Faseporten kommer før vi henter laget. Er det for tidlig, er det ingen
    # grunn til å bruke det innloggede endepunktet i det hele tatt - og en
    # feil der skal ikke gjøre en kjøring som uansett skulle vente om til FAIL.

    if hours < 0:
        result.phase = IDLE
        result.notes.append("Fristen er passert. Venter på neste runde.")
        return result
    if hours > settings.lineup_window_hours:
        result.phase = WAIT
        result.execute_after = hours - settings.lineup_window_hours
        result.notes.append(
            f"{hours:.1f} timer til fristen. For tidlig til å røre laget - "
            f"informasjonen som avgjør kommer nærmere."
        )
        return result

    try:
        state = fetch_team_state(api, entry_id, event)
    except FplError as exc:
        result.fail(f"Klarte ikke hente laget ditt: {exc}")
        return result

    unknown = [p for p in state.element_ids if p not in model.players]
    if unknown:
        result.degrade(f"Spillere i troppen som modellen ikke kjenner: {unknown}")
    squad = [model.players[e] for e in state.element_ids if e in model.players]
    if len(squad) != 15:
        result.fail("Klarte ikke bygge en komplett tropp fra FPL-dataene.")
        return result

    names = {p.id: p.name for p in model.players.values()}
    executor = Executor(api, settings, log, model.players, result.doctor_ok)

    context = {
        "event": event,
        "hours_to_deadline": round(hours, 2),
        "mode": settings.describe(),
        "doctor": "PASS" if result.doctor_ok else "FAIL",
        "model": "baseline",
        "bank": state.bank,
        "free_transfers": state.free_transfers,
    }

    # ------------------------------------------------------------- bytter

    plan = None
    try:
        plan = suggest_transfers(
            model,
            squad,
            horizon,
            selling_prices=state.selling_prices,
            bank=state.bank,
            free_transfers=state.free_transfers,
            max_transfers=settings.max_transfers,
            min_availability=settings.min_availability,
        )
    except RuntimeError as exc:
        result.degrade(f"Bytteoptimereren feilet: {exc}")

    squad_after = squad
    transfer_window = hours <= settings.execution_window_hours

    if plan is not None and plan.incoming:
        injured = deadline.unavailable_players(squad)
        replacing = [p for p in plan.out if p in injured]
        worth_it = plan.net_gain >= settings.min_transfer_gain or bool(replacing)
        if not worth_it:
            result.transfer_summary = (
                f"Ingen bytter - beste plan gir bare {plan.net_gain:+.1f} poeng."
            )
        elif not transfer_window:
            result.phase = WAIT
            result.execute_after = hours - settings.execution_window_hours
            moves = ", ".join(
                f"{o.name} -> {i.name}"
                for o, i in zip(plan.out, plan.incoming, strict=True)
            )
            result.transfer_summary = (
                f"Bytte klart ({moves}, {plan.net_gain:+.1f} poeng), "
                "men venter til nærmere fristen."
            )
            result.notes.append(
                "Bytter er irreversible. De utføres i det siste vinduet, når "
                "laguttak og skadenyheter er så ferske de blir."
            )
        else:
            action = transfer_action(
                entry_id=entry_id,
                event=event,
                moves=[
                    (out.id, into.id, state.selling_prices[out.id], into.cost)
                    for out, into in zip(plan.out, plan.incoming, strict=True)
                ],
                names=[
                    (out.name, into.name)
                    for out, into in zip(plan.out, plan.incoming, strict=True)
                ],
                predicted_gain=plan.net_gain,
                hit_cost=plan.point_cost,
            )
            outcome = executor.execute(action, state, hours, context)
            result.outcomes.append(outcome)
            result.transfer_summary = _describe(outcome, action.summary)
            if outcome.wrote:
                squad_after = [p for p in squad if p not in plan.out] + plan.incoming
                try:
                    state = fetch_team_state(api, entry_id, event)
                except FplError as exc:
                    result.degrade(f"Klarte ikke oppdatere lagtilstanden etter byttet: {exc}")
            elif outcome.status not in ("DRY_RUN", "SKIPPED"):
                result.degrade(f"Byttet ble ikke utført: {outcome.message}")
    else:
        result.transfer_summary = "Ingen bytter - modellen finner ingen som lønner seg."

    # -------------------------------------------------------------- chips

    chip_to_play = _consider_chip(model, squad_after, horizon, settings, state, hours, result)

    # -------------------------------------------------- oppstilling og kaptein

    lineup = pick_lineup(squad_after, event)
    result.captain = lineup.captain.name
    result.vice = lineup.vice.name
    result.bench = [p.name for p in lineup.bench]
    result.chip = chip_to_play

    action = lineup_action(
        event=event,
        starters=[p.id for p in lineup.starters],
        bench=[p.id for p in lineup.bench],
        captain=lineup.captain.id,
        vice=lineup.vice.id,
        names=names,
        predicted_gain=lineup.expected_points(),
        chip=chip_to_play,
    )
    if _lineup_matches(state, action):
        result.notes.append("Oppstillingen hos FPL stemmer allerede. Ingen ny innsending.")
    else:
        outcome = executor.execute(action, state, hours, context)
        result.outcomes.append(outcome)
        if not outcome.wrote and outcome.status not in ("DRY_RUN", "SKIPPED"):
            result.degrade(f"Oppstillingen ble ikke satt: {outcome.message}")

    if result.phase == IDLE:
        result.phase = ACT if any(o.wrote for o in result.outcomes) else WAIT
    if hours > settings.execution_window_hours and result.execute_after is None:
        result.execute_after = hours - settings.execution_window_hours
    return result


# Rådgiveren snakker menneskespråk; FPL-API-et vil ha sine egne koder.
CHIP_CODES = {
    "Bench Boost": "bboost",
    "Triple Captain": "3xc",
    "Free Hit": "freehit",
    "Wildcard": "wildcard",
}


def _consider_chip(model, squad, horizon, settings: Settings, state, hours, result) -> str | None:
    """Chipvurdering. Aktiveres bare inne i det strengere chipvinduet.

    Rådet må gjelde *denne* runden. En chip som ser bra ut i GW14 skal ikke
    aktiveres i GW9 fordi den tilfeldigvis lå øverst i lista.
    """
    if not settings.allow_chips or state.active_chip:
        return None
    try:
        advice = chips.chip_advice(model, squad, horizon)
    except Exception as exc:  # pragma: no cover - rådgivningen skal aldri velte kjøringen
        result.degrade(f"Chipvurderingen feilet: {exc}")
        return None

    best = None
    for item in advice:
        code = CHIP_CODES.get(item.chip)
        if code is None or code not in state.chips_available:
            continue
        if item.event is not None and item.event != state.event:
            continue
        if item.score < settings.chip_min_advantage:
            continue
        if best is None or item.score > best[1]:
            best = (code, item.score, item.chip)
    if best is None:
        return None

    code, score, label = best
    if hours > settings.chip_window_hours:
        result.notes.append(
            f"{label} ser aktuell ({score:+.1f}), men chips aktiveres først "
            f"under {settings.chip_window_hours:.0f} timer før fristen."
        )
        return None
    if not result.doctor_ok:
        result.notes.append(f"{label} er aktuell, men doctor feiler. Chipen aktiveres ikke.")
        return None
    return code


def _lineup_matches(state: TeamState, action: Action) -> bool:
    return (
        state.starters == action.details["starters"]
        and state.bench == action.details["bench"]
        and state.captain == action.details["captain"]
        and state.vice == action.details["vice"]
    )


def _describe(outcome: ExecutionOutcome, summary: str) -> str:
    if outcome.status == "SUCCESS":
        return f"Utført: {summary}"
    if outcome.status == "DRY_RUN":
        return f"Klart, men ikke sendt (tørrkjøring): {summary}"
    if outcome.status == "SKIPPED":
        return f"Allerede utført: {summary}"
    return f"Blokkert: {summary} - {outcome.message}"
