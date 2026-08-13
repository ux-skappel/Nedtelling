"""Autopilot: gjør jobben rett før fristen, og bare når det trengs.

Tanken er at boten kan kjøre ofte - for eksempel hver time - og selv avgjøre om
det er tid for å handle. Utenfor vinduet før fristen gjør den ingenting. Inne i
vinduet henter den ferske data, setter oppstillingen, og bytter hvis byttet
faktisk er verdt det.

Å sette oppstillingen er gratis og gjøres alltid. Bytter er irreversible, så de
krever at gevinsten er stor nok - eller at noen i troppen er ute av spill.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .model import Player, ProjectionModel
from .transfers import TransferPlan

# Under denne grensen regnes en spiller som ute av spill for neste runde.
UNAVAILABLE_THRESHOLD = 0.5


@dataclass
class AutopilotDecision:
    event: int
    hours_to_deadline: float
    in_window: bool
    should_transfer: bool
    plan: TransferPlan | None = None
    reasons: list[str] = field(default_factory=list)
    blocked: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        when = f"GW{self.event} om {self.hours_to_deadline:.1f} timer"
        if not self.in_window:
            return f"Utenfor vinduet - fristen for {when}. Gjør ingenting."
        if self.should_transfer:
            return f"Handler nå: fristen for {when}."
        return f"Inne i vinduet ({when}), men ingen bytter er nødvendige."


def hours_until(deadline: str, now: datetime | None = None) -> float:
    """Timer fram til en ISO-frist fra FPL, som alltid er i UTC."""
    if not deadline:
        return float("inf")
    parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
    now = now or datetime.now(timezone.utc)
    return (parsed - now).total_seconds() / 3600.0


def unavailable_players(squad: list[Player]) -> list[Player]:
    """Spillere som er skadet, utestengt eller uten klubb."""
    return [p for p in squad if p.availability < UNAVAILABLE_THRESHOLD]


def decide(
    model: ProjectionModel,
    squad: list[Player],
    plan: TransferPlan | None,
    within_hours: float = 3.0,
    min_gain: float = 1.0,
    allow_hits: bool = False,
    now: datetime | None = None,
) -> AutopilotDecision:
    """Avgjør om boten skal bytte nå."""
    event = model.next_event()
    remaining = hours_until(model.deadline(event), now)
    decision = AutopilotDecision(
        event=event,
        hours_to_deadline=remaining,
        in_window=0 <= remaining <= within_hours,
        should_transfer=False,
        plan=plan,
    )
    if not decision.in_window:
        return decision

    if plan is None or not plan.incoming:
        decision.reasons.append("Modellen finner ingen bytter som lønner seg.")
        return decision

    injured = unavailable_players(squad)
    replacing_injured = [p for p in plan.out if p in injured]
    if replacing_injured:
        names = ", ".join(p.name for p in replacing_injured)
        decision.reasons.append(f"Bytter ut spillere som ikke kan spille: {names}.")

    if plan.net_gain >= min_gain:
        decision.reasons.append(
            f"Netto gevinst {plan.net_gain:+.1f} poeng over horisonten, "
            f"over grensen på {min_gain:.1f}."
        )
    elif not replacing_injured:
        decision.blocked.append(
            f"Gevinsten er bare {plan.net_gain:+.1f} poeng, under grensen på {min_gain:.1f}."
        )

    if plan.hits and not allow_hits:
        decision.blocked.append(
            f"Planen koster {plan.point_cost} minuspoeng, og hits er ikke tillatt."
        )

    decision.should_transfer = bool(decision.reasons) and not decision.blocked
    return decision
