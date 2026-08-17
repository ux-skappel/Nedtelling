"""Uavhengig referanseimplementasjon: full oppregning av alle verdener.

Skrevet fra reglene i `V1A_PREREG.md` seksjon 6 og 7, ikke fra `appearance.py`.
Poenget er at den skal kunne feile *annerledes*: deler den kode med den optimerte
evaluatoren, beviser den ingenting.

Den er hjelpeløst treg med vilje. Alle 3^15 verdener er utenfor rekkevidde, så
testene bruker tropper der de fleste spillerne har en degenerert tilstand.
Oppregningen hopper da over umulige verdener og faller til noen tusen.
"""

from __future__ import annotations

import itertools

from fplbot.scoring import GKP

XI_MINIMUM = {1: 1, 2: 3, 3: 2, 4: 1}

ZERO, PARTIAL, SIXTY = 0, 1, 2


def _legal(squad) -> bool:
    counts: dict[int, int] = {}
    for player in squad:
        counts[player.position] = counts.get(player.position, 0) + 1
    if counts.get(1, 0) != 1:
        return False
    return all(counts.get(position, 0) >= minimum for position, minimum in XI_MINIMUM.items())


def autosubs(starters, bench, played: dict[int, bool]):
    """FPL sine autobytter, skrevet rett fra regelteksten.

    Startere gås gjennom i den rekkefølgen de står. For hver som ikke kom på
    banen prøves benken ovenfra og ned. Første benkespiller som spilte og som
    holder oppstillingen lovlig kommer inn. Keeper bare mot keeper. En blankende
    starter som ikke kan erstattes blir stående.
    """
    final = list(starters)
    available = list(bench)
    for index, starter in enumerate(final):
        if played[starter.id]:
            continue
        for candidate in list(available):
            if not played[candidate.id]:
                continue
            if (starter.position == GKP) != (candidate.position == GKP):
                continue
            trial = list(final)
            trial[index] = candidate
            if _legal(trial):
                final = trial
                available.remove(candidate)
                break
    return final


def enumerate_worlds(players, states):
    """Alle mulige tilstandskombinasjoner med sannsynlighet over null."""
    options = []
    for player in players:
        state = states[player.id]
        choices = []
        if state.p_zero > 0.0:
            choices.append((ZERO, state.p_zero, 0.0))
        if state.p_partial > 0.0:
            choices.append((PARTIAL, state.p_partial, state.ev_partial))
        if state.p_sixty > 0.0:
            choices.append((SIXTY, state.p_sixty, state.ev_sixty))
        options.append(choices)
    return itertools.product(*options)


def brute_force_ev(starters, bench, captain, vice, states) -> tuple[float, float]:
    """Forventet poengsum ved full oppregning.

    Returnerer `(forventning, samlet sannsynlighetsmasse)`. Massen skal være 1;
    den returneres slik at testen kan sjekke at oppregningen er komplett.
    """
    squad = list(starters) + list(bench)
    total = 0.0
    mass = 0.0

    for world in enumerate_worlds(squad, states):
        probability = 1.0
        points: dict[int, float] = {}
        played: dict[int, bool] = {}
        for player, (state, chance, value) in zip(squad, world, strict=True):
            probability *= chance
            points[player.id] = value
            played[player.id] = state != ZERO
        mass += probability

        final = autosubs(starters, bench, played)
        realized = sum(points[p.id] for p in final)

        leader = captain if played[captain.id] else vice
        if played[leader.id] and any(p.id == leader.id for p in final):
            realized += points[leader.id]

        total += probability * realized
    return total, mass


def monte_carlo_ev(starters, bench, captain, vice, states, draws: int, seed: int):
    """Uavhengig Monte Carlo-anslag, med standardfeil.

    Ikke en del av produksjonsveien. Den finnes for å fange at *reglene* er
    implementert likt to steder - brute force fanger at aggregeringen er riktig
    gitt reglene, som er en annen feilklasse.
    """
    import random
    import statistics

    rng = random.Random(seed)
    squad = list(starters) + list(bench)
    samples = []
    for _ in range(draws):
        points: dict[int, float] = {}
        played: dict[int, bool] = {}
        for player in squad:
            state = states[player.id]
            roll = rng.random()
            if roll < state.p_zero:
                points[player.id], played[player.id] = 0.0, False
            elif roll < state.p_zero + state.p_partial:
                points[player.id], played[player.id] = state.ev_partial, True
            else:
                points[player.id], played[player.id] = state.ev_sixty, True

        final = autosubs(starters, bench, played)
        realized = sum(points[p.id] for p in final)
        leader = captain if played[captain.id] else vice
        if played[leader.id] and any(p.id == leader.id for p in final):
            realized += points[leader.id]
        samples.append(realized)

    mean = statistics.fmean(samples)
    error = statistics.stdev(samples) / (draws**0.5) if draws > 1 else 0.0
    return mean, error
