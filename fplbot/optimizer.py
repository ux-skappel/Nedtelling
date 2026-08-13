"""Optimering av tropp og lagoppstilling.

Troppen settes med heltallsprogrammering (PuLP) slik at alle FPL-reglene
holdes: 15 spillere, 100m budsjett, 2/5/5/3 per posisjon og maks 3 fra samme
klubb. Finnes ikke PuLP, faller vi tilbake på et grådig søk.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import Player, ProjectionModel
from .scoring import DEF, FWD, GKP, MID

SQUAD_SIZE = 15
SQUAD_QUOTA = {GKP: 2, DEF: 5, MID: 5, FWD: 3}
XI_MIN = {GKP: 1, DEF: 3, MID: 2, FWD: 1}
XI_MAX = {GKP: 1, DEF: 5, MID: 5, FWD: 3}
TEAM_LIMIT = 3
DEFAULT_BUDGET = 1000  # 100.0m i tideler
BENCH_WEIGHT = 0.15


try:  # pragma: no cover - avhenger av miljøet
    import pulp

    HAS_PULP = True
except ImportError:  # pragma: no cover
    pulp = None
    HAS_PULP = False


@dataclass
class Lineup:
    starters: list[Player]
    bench: list[Player]
    captain: Player
    vice: Player
    event: int

    @property
    def formation(self) -> str:
        counts = {pos: 0 for pos in (DEF, MID, FWD)}
        for player in self.starters:
            if player.position in counts:
                counts[player.position] += 1
        return f"{counts[DEF]}-{counts[MID]}-{counts[FWD]}"

    def expected_points(self) -> float:
        base = sum(p.xp.get(self.event, 0.0) for p in self.starters)
        return base + self.captain.xp.get(self.event, 0.0)


@dataclass
class Squad:
    players: list[Player]
    event: int
    horizon: list[int]

    @property
    def cost(self) -> int:
        return sum(p.cost for p in self.players)

    def by_position(self, position: int) -> list[Player]:
        return [p for p in self.players if p.position == position]

    def ids(self) -> set[int]:
        return {p.id for p in self.players}


def valid_formations() -> list[dict[int, int]]:
    """Alle lovlige oppstillinger som ellever."""
    formations = []
    for defenders in range(XI_MIN[DEF], XI_MAX[DEF] + 1):
        for midfielders in range(XI_MIN[MID], XI_MAX[MID] + 1):
            forwards = 10 - defenders - midfielders
            if XI_MIN[FWD] <= forwards <= XI_MAX[FWD]:
                formations.append({GKP: 1, DEF: defenders, MID: midfielders, FWD: forwards})
    return formations


def best_xi(players: list[Player], score) -> list[Player]:
    """Beste ellever gitt en poengfunksjon, ved å prøve alle oppstillinger."""
    by_position: dict[int, list[Player]] = {GKP: [], DEF: [], MID: [], FWD: []}
    for player in players:
        by_position[player.position].append(player)
    for pool in by_position.values():
        pool.sort(key=score, reverse=True)

    best: list[Player] = []
    best_value = float("-inf")
    for formation in valid_formations():
        if any(len(by_position[pos]) < count for pos, count in formation.items()):
            continue
        picked = [p for pos, count in formation.items() for p in by_position[pos][:count]]
        value = sum(score(p) for p in picked)
        if value > best_value:
            best_value, best = value, picked
    if not best:
        raise RuntimeError("Klarte ikke sette en lovlig ellever av troppen")
    return best


def xi_value(players: list[Player], score, bench_weight: float = BENCH_WEIGHT) -> float:
    """Verdien av en tropp: ellever pluss kapteinsdobling og litt for benken."""
    starters = best_xi(players, score)
    bench = [p for p in players if p not in starters]
    captain = max((score(p) for p in starters), default=0.0)
    return sum(score(p) for p in starters) + captain + bench_weight * sum(score(p) for p in bench)


def pick_lineup(players: list[Player], event: int) -> Lineup:
    """Velger beste ellever, kaptein, visekaptein og benkerekkefølge."""

    def score(player: Player) -> float:
        return player.xp.get(event, 0.0)

    ranked = sorted(players, key=score, reverse=True)
    starters = best_xi(players, score)
    starters.sort(key=lambda p: (p.position, -p.xp.get(event, 0.0)))
    bench = [p for p in ranked if p not in starters]
    # Reservekeeper står alltid først på benken i FPL.
    bench.sort(key=lambda p: (p.position != GKP, -p.xp.get(event, 0.0)))
    bench_gk = [p for p in bench if p.position == GKP]
    bench_out = [p for p in bench if p.position != GKP]
    bench = bench_gk + bench_out

    captain_pool = sorted(starters, key=lambda p: p.xp.get(event, 0.0), reverse=True)
    captain = captain_pool[0]
    vice = captain_pool[1] if len(captain_pool) > 1 else captain
    return Lineup(starters=starters, bench=bench, captain=captain, vice=vice, event=event)


def optimize_squad(
    model: ProjectionModel,
    horizon: list[int],
    budget: int = DEFAULT_BUDGET,
    locked: set[int] | None = None,
    banned: set[int] | None = None,
    min_availability: float = 0.75,
    decay: float = 0.86,
) -> Squad:
    """Setter den beste troppen innenfor budsjettet."""
    locked = locked or set()
    banned = banned or set()
    pool = [
        p
        for p in model.players.values()
        if p.id not in banned
        and (p.id in locked or (p.availability >= min_availability and p.expected_minutes > 5))
    ]
    value = {p.id: p.weighted_xp(horizon, decay) for p in pool}

    if HAS_PULP:
        chosen = _solve_squad_ilp(pool, value, budget, locked)
    else:  # pragma: no cover - kun uten PuLP
        chosen = _greedy_squad(pool, value, budget, locked)
    return Squad(players=chosen, event=horizon[0], horizon=horizon)


def _solve_squad_ilp(
    pool: list[Player], value: dict[int, float], budget: int, locked: set[int]
) -> list[Player]:
    problem = pulp.LpProblem("fpl_squad", pulp.LpMaximize)
    squad = {p.id: pulp.LpVariable(f"squad_{p.id}", cat="Binary") for p in pool}
    start = {p.id: pulp.LpVariable(f"start_{p.id}", cat="Binary") for p in pool}
    captain = {p.id: pulp.LpVariable(f"capt_{p.id}", cat="Binary") for p in pool}

    problem += pulp.lpSum(
        value[p.id] * (start[p.id] + BENCH_WEIGHT * (squad[p.id] - start[p.id]))
        + value[p.id] * captain[p.id]
        for p in pool
    )

    problem += pulp.lpSum(squad.values()) == SQUAD_SIZE
    problem += pulp.lpSum(p.cost * squad[p.id] for p in pool) <= budget
    for position, quota in SQUAD_QUOTA.items():
        problem += pulp.lpSum(squad[p.id] for p in pool if p.position == position) == quota
    teams = {p.team for p in pool}
    for team in teams:
        problem += pulp.lpSum(squad[p.id] for p in pool if p.team == team) <= TEAM_LIMIT

    problem += pulp.lpSum(start.values()) == 11
    for position in (GKP, DEF, MID, FWD):
        in_position = [start[p.id] for p in pool if p.position == position]
        problem += pulp.lpSum(in_position) >= XI_MIN[position]
        problem += pulp.lpSum(in_position) <= XI_MAX[position]
    for p in pool:
        problem += start[p.id] <= squad[p.id]
        problem += captain[p.id] <= start[p.id]
    problem += pulp.lpSum(captain.values()) == 1

    for player_id in locked:
        if player_id in squad:
            problem += squad[player_id] == 1

    problem.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[problem.status] != "Optimal":
        raise RuntimeError(f"Fant ingen gyldig tropp (status: {pulp.LpStatus[problem.status]})")
    return [p for p in pool if squad[p.id].value() > 0.5]


def _greedy_squad(  # pragma: no cover - reserveløsning uten PuLP
    pool: list[Player], value: dict[int, float], budget: int, locked: set[int]
) -> list[Player]:
    chosen = [p for p in pool if p.id in locked][:SQUAD_SIZE]
    counts = {pos: sum(1 for p in chosen if p.position == pos) for pos in SQUAD_QUOTA}
    per_team: dict[int, int] = {}
    for p in chosen:
        per_team[p.team] = per_team.get(p.team, 0) + 1
    spent = sum(p.cost for p in chosen)

    candidates = sorted(pool, key=lambda p: value[p.id] / max(1, p.cost), reverse=True)
    while len(chosen) < SQUAD_SIZE:
        slots_left = SQUAD_SIZE - len(chosen)
        for player in candidates:
            if player in chosen:
                continue
            if counts[player.position] >= SQUAD_QUOTA[player.position]:
                continue
            if per_team.get(player.team, 0) >= TEAM_LIMIT:
                continue
            # Sett av minstepris for plassene som gjenstår.
            reserve = 40 * (slots_left - 1)
            if spent + player.cost + reserve > budget:
                continue
            chosen.append(player)
            counts[player.position] += 1
            per_team[player.team] = per_team.get(player.team, 0) + 1
            spent += player.cost
            break
        else:
            raise RuntimeError("Grådig søk fant ingen gyldig tropp - installer PuLP")
    return chosen
