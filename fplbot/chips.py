"""Råd om når chipsene bør brukes.

Dette er heuristikker, ikke fasit: de peker på gameweeks der troppen din har
dobbeltrunder, blanke runder eller en benk som faktisk er verdt å starte.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import Player, ProjectionModel
from .optimizer import best_xi

BENCH_BOOST_THRESHOLD = 18.0
TRIPLE_CAPTAIN_THRESHOLD = 8.5
FREE_HIT_BLANK_THRESHOLD = 4
WILDCARD_GAP_THRESHOLD = 12.0


@dataclass
class ChipAdvice:
    chip: str
    event: int | None
    score: float
    reason: str


def fixture_counts(
    model: ProjectionModel, squad: list[Player], events: list[int]
) -> dict[int, dict]:
    """Teller hvor mange av spillerne dine som har 0, 1 eller 2 kamper per runde."""
    summary = {}
    for event in events:
        blanks = doubles = 0
        for player in squad:
            count = len(player.fixtures.get(event, []))
            if count == 0:
                blanks += 1
            elif count > 1:
                doubles += 1
        summary[event] = {"blanks": blanks, "doubles": doubles}
    return summary


def chip_advice(
    model: ProjectionModel,
    squad: list[Player],
    events: list[int],
    optimal_value: float | None = None,
    squad_value: float | None = None,
) -> list[ChipAdvice]:
    advice: list[ChipAdvice] = []
    counts = fixture_counts(model, squad, events)

    for event in events:
        def score(player: Player, ev: int = event) -> float:
            return player.xp.get(ev, 0.0)

        starters = best_xi(squad, score)
        bench = [p for p in squad if p not in starters]
        bench_points = sum(score(p) for p in bench)
        if bench_points >= BENCH_BOOST_THRESHOLD:
            advice.append(
                ChipAdvice(
                    chip="Bench Boost",
                    event=event,
                    score=bench_points,
                    reason=(
                        f"Benken din er ventet å gi {bench_points:.1f} poeng i GW{event}"
                        + (
                            f" ({counts[event]['doubles']} spillere har dobbeltrunde)"
                            if counts[event]["doubles"]
                            else ""
                        )
                    ),
                )
            )

        best_captain = max((score(p) for p in starters), default=0.0)
        if best_captain >= TRIPLE_CAPTAIN_THRESHOLD:
            captain = max(starters, key=score)
            advice.append(
                ChipAdvice(
                    chip="Triple Captain",
                    event=event,
                    score=best_captain,
                    reason=(
                        f"{captain.name} er ventet å gi {best_captain:.1f} poeng i GW{event}"
                        f" ({len(captain.fixtures.get(event, []))} kamper)"
                    ),
                )
            )

        if counts[event]["blanks"] >= FREE_HIT_BLANK_THRESHOLD:
            advice.append(
                ChipAdvice(
                    chip="Free Hit",
                    event=event,
                    score=float(counts[event]["blanks"]),
                    reason=f"{counts[event]['blanks']} av spillerne dine er uten kamp i GW{event}",
                )
            )

    if optimal_value is not None and squad_value is not None:
        gap = optimal_value - squad_value
        if gap >= WILDCARD_GAP_THRESHOLD:
            advice.append(
                ChipAdvice(
                    chip="Wildcard",
                    event=events[0],
                    score=gap,
                    reason=(
                        f"Den optimale troppen er {gap:.1f} poeng bedre enn din over horisonten "
                        "- for stort gap til å byttes bort ett bytte om gangen"
                    ),
                )
            )

    advice.sort(key=lambda a: a.score, reverse=True)
    return advice
