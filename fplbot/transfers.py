"""Forslag til bytter for en eksisterende tropp.

Vi løser hele byttebeslutningen som ett heltallsproblem: hvilke spillere skal
beholdes, hvem skal inn, og lønner det seg å ta minuspoeng? Straffen på fire
poeng per bytte utover de gratis ligger inne i målfunksjonen, så modellen tar
et hit bare når gevinsten over horisonten er større.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import Player, ProjectionModel
from .optimizer import (
    BENCH_WEIGHT,
    HAS_PULP,
    SQUAD_QUOTA,
    SQUAD_SIZE,
    TEAM_LIMIT,
    XI_MAX,
    XI_MIN,
    xi_value,
)
from .scoring import DEF, FWD, GKP, MID, TRANSFER_HIT_COST

if HAS_PULP:  # pragma: no branch
    import pulp


@dataclass
class TransferPlan:
    out: list[Player]
    incoming: list[Player]
    hits: int
    bank_after: int
    value_before: float
    value_after: float

    @property
    def count(self) -> int:
        return len(self.incoming)

    @property
    def net_gain(self) -> float:
        return self.value_after - self.value_before - self.hits * TRANSFER_HIT_COST

    @property
    def point_cost(self) -> int:
        return self.hits * TRANSFER_HIT_COST


def suggest_transfers(
    model: ProjectionModel,
    squad: list[Player],
    horizon: list[int],
    selling_prices: dict[int, int] | None = None,
    bank: int = 0,
    free_transfers: int = 1,
    max_transfers: int = 3,
    min_availability: float = 0.75,
    decay: float = 0.86,
    banned: set[int] | None = None,
) -> TransferPlan:
    """Finner byttet (eller byttene) med best netto gevinst over horisonten."""
    if not HAS_PULP:
        raise RuntimeError("Bytteoptimering krever PuLP: pip install pulp")

    banned = banned or set()
    selling_prices = selling_prices or {p.id: p.cost for p in squad}
    value = {p.id: p.weighted_xp(horizon, decay) for p in model.players.values()}

    squad_ids = {p.id for p in squad}
    candidates = [
        p
        for p in model.players.values()
        if p.id not in squad_ids
        and p.id not in banned
        and p.availability >= min_availability
        and p.expected_minutes > 5
    ]
    universe = squad + candidates

    problem = pulp.LpProblem("fpl_transfers", pulp.LpMaximize)
    in_squad = {p.id: pulp.LpVariable(f"sq_{p.id}", cat="Binary") for p in universe}
    start = {p.id: pulp.LpVariable(f"st_{p.id}", cat="Binary") for p in universe}
    captain = {p.id: pulp.LpVariable(f"cp_{p.id}", cat="Binary") for p in universe}
    hits = pulp.LpVariable("hits", lowBound=0, cat="Integer")

    problem += (
        pulp.lpSum(
            value[p.id] * (start[p.id] + BENCH_WEIGHT * (in_squad[p.id] - start[p.id]))
            + value[p.id] * captain[p.id]
            for p in universe
        )
        - TRANSFER_HIT_COST * hits
    )

    problem += pulp.lpSum(in_squad.values()) == SQUAD_SIZE
    for position, quota in SQUAD_QUOTA.items():
        problem += pulp.lpSum(in_squad[p.id] for p in universe if p.position == position) == quota
    for team in {p.team for p in universe}:
        problem += pulp.lpSum(in_squad[p.id] for p in universe if p.team == team) <= TEAM_LIMIT

    problem += pulp.lpSum(start.values()) == 11
    for position in (GKP, DEF, MID, FWD):
        in_position = [start[p.id] for p in universe if p.position == position]
        problem += pulp.lpSum(in_position) >= XI_MIN[position]
        problem += pulp.lpSum(in_position) <= XI_MAX[position]
    for p in universe:
        problem += start[p.id] <= in_squad[p.id]
        problem += captain[p.id] <= start[p.id]
    problem += pulp.lpSum(captain.values()) == 1

    # Penger: det vi selger for, pluss banken, må dekke det vi kjøper.
    sold_value = pulp.lpSum(selling_prices[p.id] * (1 - in_squad[p.id]) for p in squad)
    bought_value = pulp.lpSum(p.cost * in_squad[p.id] for p in candidates)
    problem += bought_value <= sold_value + bank

    transfers = pulp.lpSum(in_squad[p.id] for p in candidates)
    problem += transfers <= max_transfers
    problem += hits >= transfers - free_transfers

    problem.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[problem.status] != "Optimal":
        raise RuntimeError(f"Fant ingen gyldig løsning (status: {pulp.LpStatus[problem.status]})")

    kept = [p for p in squad if in_squad[p.id].value() > 0.5]
    # Sorter begge veier likt, slik at ut og inn parvis blir samme posisjon.
    def order(player: Player) -> tuple:
        return (player.position, -player.cost, player.id)

    out = sorted((p for p in squad if in_squad[p.id].value() <= 0.5), key=order)
    incoming = sorted((p for p in candidates if in_squad[p.id].value() > 0.5), key=order)

    spent = sum(p.cost for p in incoming)
    raised = sum(selling_prices[p.id] for p in out)
    used_hits = max(0, len(incoming) - free_transfers)

    def score(player: Player) -> float:
        return value[player.id]

    return TransferPlan(
        out=out,
        incoming=incoming,
        hits=used_hits,
        bank_after=bank + raised - spent,
        value_before=xi_value(squad, score),
        value_after=xi_value(kept + incoming, score),
    )


def rank_transfer_options(
    model: ProjectionModel,
    squad: list[Player],
    horizon: list[int],
    selling_prices: dict[int, int] | None = None,
    bank: int = 0,
    limit: int = 8,
    min_availability: float = 0.75,
    decay: float = 0.86,
) -> list[tuple[Player, Player, float]]:
    """Rangerer enkeltbytter (ut, inn, gevinst) uten hensyn til minuspoeng."""
    selling_prices = selling_prices or {p.id: p.cost for p in squad}
    value = {p.id: p.weighted_xp(horizon, decay) for p in model.players.values()}
    squad_ids = {p.id for p in squad}
    team_counts: dict[int, int] = {}
    for player in squad:
        team_counts[player.team] = team_counts.get(player.team, 0) + 1

    options: list[tuple[Player, Player, float]] = []
    for out_player in squad:
        budget = bank + selling_prices[out_player.id]
        for candidate in model.players.values():
            if candidate.id in squad_ids or candidate.position != out_player.position:
                continue
            if candidate.cost > budget or candidate.availability < min_availability:
                continue
            others = team_counts.get(candidate.team, 0) - (
                1 if candidate.team == out_player.team else 0
            )
            if others >= TEAM_LIMIT:
                continue
            gain = value[candidate.id] - value[out_player.id]
            if gain > 0:
                options.append((out_player, candidate, gain))

    options.sort(key=lambda item: item[2], reverse=True)
    seen: set[int] = set()
    best: list[tuple[Player, Player, float]] = []
    for out_player, candidate, gain in options:
        if out_player.id in seen:
            continue
        seen.add(out_player.id)
        best.append((out_player, candidate, gain))
        if len(best) >= limit:
            break
    return best
