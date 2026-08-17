"""V1A-armene koblet på backtesten.

Modulen bytter ut **hvordan en tropp evalueres**, og ingenting annet. Samme
projeksjoner, samme kandidatsett, samme ILP-søk, samme kostnader, samme
rundedata. Konkret er det to steder evalueringen slår inn:

1. **Oppstillingen.** Grunnlinjen setter ellever, kaptein, vise og benk grådig
   etter `xP`. V1A maksimerer eksakt `E[realiserte poeng]` med autobytter og
   kapteinsfallback, over det samme rommet.
2. **Byttebeslutningen.** Grunnlinjen aksepterer ILP-planen når `net_gain`
   overstiger terskelen, der `net_gain` bruker `xi_value` med en fast benkevekt
   på 0,15. V1A vurderer nøyaktig de samme to kandidatene - behold troppen eller
   utfør planen - men priser dem med den eksakte evaluatoren over horisonten.

Troppsoptimereren (ILP) er urørt. Målfunksjonen der er lineær i `xP` og kan
ikke bære en ikke-lineær evaluator; å bytte den ut ville endret *søket*, ikke
bare evalueringen, og da måler vi to ting samtidig.

Kandidatsettet for bytter er også urørt, med vilje. Det ville vært lett å la
V1A vurdere flere alternativer og dermed «vinne», men da ville forskjellen vært
et bredere søk og ikke en bedre evaluator.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..appearance import MinuteStates, build_state_table, optimise_lineup, squad_ev
from ..model import Player, ProjectionModel
from ..optimizer import pick_lineup

# Samme forfall som `weighted_xp` og `suggest_transfers` bruker.
DECAY = 0.86


@dataclass
class Decision:
    """Én paret beslutning, med begge sider målt av samme evaluator.

    `realized_*` er utfylt for oppstillingsbeslutninger, der grunnlinjens valg og
    V1A sitt valg kan scores mot samme runde med samme tropp. For bytter er de
    tomme: der divergerer troppene, og den realiserte effekten kan bare leses av
    på sesongnivå. Å oppgi et parvis realisert tall for bytter ville vært å
    sammenlikne to ulike spillerutvalg - nettopp feilen metoderegelen fra H4
    forbyr.
    """

    season: str
    event: int
    kind: str  # "lineup" eller "transfer"
    baseline_action: str
    v1a_action: str
    predicted_baseline_ev: float
    predicted_v1a_ev: float
    realized_baseline_points: int | None = None
    realized_v1a_points: int | None = None
    reason: str = "ingen forskjell"

    @property
    def predicted_delta(self) -> float:
        return self.predicted_v1a_ev - self.predicted_baseline_ev

    @property
    def realized_delta(self) -> int | None:
        if self.realized_baseline_points is None or self.realized_v1a_points is None:
            return None
        return self.realized_v1a_points - self.realized_baseline_points

    def to_dict(self) -> dict:
        return {
            "season": self.season,
            "event": self.event,
            "kind": self.kind,
            "baseline_action": self.baseline_action,
            "v1a_action": self.v1a_action,
            "predicted_baseline_EV": round(self.predicted_baseline_ev, 4),
            "predicted_v1a_EV": round(self.predicted_v1a_ev, 4),
            "predicted_delta": round(self.predicted_delta, 4),
            "realized_baseline_points": self.realized_baseline_points,
            "realized_v1a_points": self.realized_v1a_points,
            "realized_delta": self.realized_delta,
            "reason": self.reason,
        }


@dataclass
class ArmContext:
    """Tilstandstabeller for én runde, delt mellom oppstilling og byttegate."""

    arm: str
    events: list[int]
    states: dict[int, dict[int, MinuteStates]] = field(default_factory=dict)

    @classmethod
    def build(cls, model: ProjectionModel, events: list[int], arm: str) -> ArmContext:
        players = list(model.players.values())
        return cls(
            arm=arm,
            events=events,
            states={event: build_state_table(players, event, arm) for event in events},
        )

    def lineup(self, squad: list[Player], event: int):
        return optimise_lineup(squad, self.states[event], event)

    def horizon_value(self, squad: list[Player]) -> float:
        """Eksakt forventet poengsum over horisonten, med samme forfall som ellers."""
        total = 0.0
        for index, event in enumerate(self.events):
            total += (DECAY**index) * self.lineup(squad, event).value
        return total

    def baseline_lineup_value(self, squad: list[Player], event: int) -> float:
        """Grunnlinjens oppstilling, priset med V1A-evaluatoren.

        Begge sider av paret må måles med samme instrument, ellers sammenlikner
        vi to målestokker i stedet for to valg.
        """
        lineup = pick_lineup(squad, event)
        return squad_ev(
            lineup.starters, lineup.bench, lineup.captain, lineup.vice, self.states[event]
        )


def lineup_reason(baseline, chosen) -> str:
    """Hva skiller V1A sin oppstilling fra grunnlinjens?"""
    reasons = []
    if {p.id for p in baseline.starters} != {p.id for p in chosen.starters}:
        reasons.append("starter mot benk")
    if baseline.captain.id != chosen.captain.id:
        reasons.append("kaptein")
    if baseline.vice.id != chosen.vice.id:
        reasons.append("visekaptein")
    if [p.id for p in baseline.bench] != [p.id for p in chosen.bench]:
        reasons.append("benkerekkefølge")
    return "+".join(reasons) if reasons else "ingen forskjell"
