"""Automatisk validering før skriving. Ikke brukerbekreftelse.

Full autonomi betyr at ingen mennesker ser på handlingen før den utføres. Da må
maskinen selv nekte når noe ikke stemmer. Reglene her er ikke strategi - de
sier ingenting om hvorvidt byttet er *lurt*. De sier om det er *gyldig*: om
troppen fortsatt er den vi regnet på, om reglene holder, om pengene finnes, og
om handlingen allerede er gjort.

Skillet er viktig. Vanlig fotballusikkerhet skal beslutningsmotoren håndtere.
Teknisk tvil og dataintegritetsfeil skal blokkere skriving.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..optimizer import SQUAD_QUOTA, SQUAD_SIZE, TEAM_LIMIT, XI_MAX, XI_MIN
from ..scoring import GKP, TRANSFER_HIT_COST
from .actions import Action, ActionKind
from .config import Settings
from .state import TeamState

PASS, DEGRADED, FAIL = "PASS", "DEGRADED", "FAIL"


@dataclass
class ValidationResult:
    ok: bool
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checks: list[tuple[str, bool, str]] = field(default_factory=list)

    def check(self, name: str, condition: bool, message: str = "") -> None:
        self.checks.append((name, bool(condition), message))
        if not condition:
            self.ok = False
            self.failures.append(f"{name}: {message}" if message else name)

    def report(self) -> str:
        lines = []
        for name, ok, message in self.checks:
            mark = "OK  " if ok else "FEIL"
            lines.append(f"  {mark} {name}" + (f" - {message}" if message and not ok else ""))
        return "\n".join(lines)


def validate_action(
    action: Action,
    *,
    settings: Settings,
    decision_state: TeamState,
    live_state: TeamState,
    doctor_ok: bool,
    hours_to_deadline: float,
    already_done: bool,
    players_by_id: dict,
) -> ValidationResult:
    """Kjører hele porten for én handling.

    `decision_state` er tilstanden beslutningen ble laget fra. `live_state` er
    hentet på nytt rett før skriving. Er de ulike på noe som betyr noe, skal den
    gamle beslutningen forkastes - ikke tvinges gjennom.
    """
    result = ValidationResult(ok=True)

    result.check("doctor er grønn", doctor_ok, "helsesjekken feiler")
    result.check(
        "laget er ferskt",
        live_state.age_seconds() <= settings.max_data_age_seconds,
        f"lagdata er {live_state.age_seconds():.0f} s gamle",
    )
    result.check(
        "fristen er ikke passert",
        hours_to_deadline > 0,
        f"fristen gikk for {-hours_to_deadline:.1f} timer siden",
    )
    result.check("handlingen er ikke utført før", not already_done, "finnes alt i handlingsloggen")

    drift = decision_state.differences(live_state)
    result.check(
        "tilstanden er uendret siden beslutningen",
        not drift,
        "; ".join(drift),
    )

    if action.kind is ActionKind.TRANSFER:
        _validate_transfer(result, action, settings, live_state, players_by_id)
    elif action.kind is ActionKind.LINEUP:
        _validate_lineup(result, action, live_state, players_by_id)

    if action.chip:
        _validate_chip(result, action, settings, live_state, hours_to_deadline)

    return result


def _validate_transfer(
    result: ValidationResult,
    action: Action,
    settings: Settings,
    state: TeamState,
    players_by_id: dict,
) -> None:
    out_ids = action.details["out"]
    in_ids = action.details["in"]

    result.check(
        "spillerne som selges er i troppen",
        all(element in state.element_ids for element in out_ids),
        "en spiller som skal ut står ikke i laget lenger",
    )
    result.check(
        "spillerne som kjøpes er ikke i troppen",
        all(element not in state.element_ids for element in in_ids),
        "en spiller som skal inn er allerede i laget",
    )
    result.check("like mange ut som inn", len(out_ids) == len(in_ids))
    result.check(
        "antall bytter er innenfor grensen",
        len(in_ids) <= settings.max_transfers or action.chip in ("wildcard", "freehit"),
        f"{len(in_ids)} bytter mot grensen {settings.max_transfers}",
    )

    # Penger. Salgsprisen er den FPL selv oppgir, ikke dagens markedspris.
    raised = sum(state.selling_prices.get(element, 0) for element in out_ids)
    spent = 0
    for element in in_ids:
        player = players_by_id.get(element)
        spent += player.cost if player is not None else 10**6
    bank_after = state.bank + raised - spent
    result.check(
        "banken går ikke i minus",
        bank_after >= 0,
        f"banken ville blitt {bank_after / 10:.1f}m",
    )
    action.details["bank_after"] = bank_after

    # Hits. Antall gratis bytter er FPL sin egen telling.
    expected_hits = 0 if action.chip in ("wildcard", "freehit") else max(
        0, len(in_ids) - state.free_transfers
    )
    expected_cost = expected_hits * TRANSFER_HIT_COST
    result.check(
        "minuspoengene stemmer med FPL sin telling",
        action.hit_cost == expected_cost,
        f"planen sier {action.hit_cost}, FPL-tilstanden tilsier {expected_cost}",
    )
    result.check(
        "minuspoengene er innenfor katastrofesikringen",
        expected_cost <= settings.max_autonomous_hit,
        f"{expected_cost} poeng mot taket på {settings.max_autonomous_hit}",
    )
    if expected_cost > 0:
        result.check(
            "modellen forsvarer minuspoengene",
            action.predicted_gain >= expected_cost + settings.hit_safety_margin,
            f"gevinst {action.predicted_gain:+.1f} mot krav "
            f"{expected_cost + settings.hit_safety_margin:.1f}",
        )

    # Troppen etter byttet skal fortsatt være lovlig.
    after = (state.element_ids - set(out_ids)) | set(in_ids)
    _validate_squad_shape(result, after, players_by_id)


def _validate_squad_shape(result: ValidationResult, elements: set[int], players_by_id) -> None:
    result.check("troppen har 15 spillere", len(elements) == SQUAD_SIZE, f"{len(elements)}")
    known = [players_by_id[e] for e in elements if e in players_by_id]
    if len(known) != len(elements):
        result.check("alle spillere er kjent i modellen", False, "ukjent spiller-ID i troppen")
        return
    for position, quota in SQUAD_QUOTA.items():
        count = sum(1 for p in known if p.position == position)
        result.check(
            f"posisjonskvote {position}", count == quota, f"{count} av {quota}"
        )
    per_team: dict[int, int] = {}
    for player in known:
        per_team[player.team] = per_team.get(player.team, 0) + 1
    worst = max(per_team.values()) if per_team else 0
    result.check(
        "høyst tre fra samme klubb", worst <= TEAM_LIMIT, f"{worst} fra ett lag"
    )


def _validate_lineup(
    result: ValidationResult, action: Action, state: TeamState, players_by_id: dict
) -> None:
    starters = action.details["starters"]
    bench = action.details["bench"]
    picked = starters + bench

    result.check("oppstillingen har 15 plasser", len(picked) == SQUAD_SIZE, f"{len(picked)}")
    result.check("ingen spiller står to steder", len(set(picked)) == len(picked))
    result.check(
        "oppstillingen bruker bare spillere i troppen",
        set(picked) == state.element_ids,
        "oppstillingen inneholder spillere som ikke er i laget",
    )
    result.check("ellevern har elleve", len(starters) == 11, f"{len(starters)}")

    known = [players_by_id[e] for e in starters if e in players_by_id]
    if len(known) == len(starters):
        for position in (GKP, 2, 3, 4):
            count = sum(1 for p in known if p.position == position)
            result.check(
                f"formasjonsgrense {position}",
                XI_MIN[position] <= count <= XI_MAX[position],
                f"{count} på posisjon {position}",
            )
    if bench:
        first = players_by_id.get(bench[0])
        result.check(
            "reservekeeper står først på benken",
            first is not None and first.position == GKP,
            "FPL krever keeperen på første benkeplass",
        )
    result.check(
        "kaptein og visekaptein er ulike",
        action.details["captain"] != action.details["vice"],
    )
    result.check(
        "kapteinen starter",
        action.details["captain"] in starters,
    )
    result.check(
        "visekapteinen starter",
        action.details["vice"] in starters,
    )


def _validate_chip(
    result: ValidationResult,
    action: Action,
    settings: Settings,
    state: TeamState,
    hours_to_deadline: float,
) -> None:
    """Strengere port for chips. Fortsatt automatikk, ikke brukerbekreftelse."""
    result.check("chips er tillatt i konfigurasjonen", settings.allow_chips)
    result.check(
        "chipen er tilgjengelig hos FPL",
        action.chip in state.chips_available,
        f"{action.chip} står ikke som tilgjengelig",
    )
    result.check(
        "ingen annen chip er aktiv",
        state.active_chip is None or state.active_chip == action.chip,
        f"{state.active_chip} er allerede aktiv",
    )
    result.check(
        "chipen er ikke brukt før",
        action.chip not in state.chips_played,
        f"{action.chip} er allerede spilt",
    )
    result.check(
        "chipen aktiveres nær fristen",
        hours_to_deadline <= settings.chip_window_hours,
        f"{hours_to_deadline:.1f} timer igjen, krever under {settings.chip_window_hours}",
    )
    result.check(
        "chipen gir vesentlig gevinst",
        action.predicted_gain >= settings.chip_min_advantage,
        f"gevinst {action.predicted_gain:+.1f} mot kravet {settings.chip_min_advantage:.1f}",
    )
