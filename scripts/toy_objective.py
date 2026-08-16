"""Toy-eksperiment: hva velger hver målfunksjon, i hvilken sesongtilstand?

Formålet er å se om matematikken gjør det vi tror før den kobles til ekte data.
To strategier settes opp med ulik forventning, varians og korrelasjon mot
feltet, og fem målfunksjoner får velge mellom dem i fem sesongtilstander.

Rangeringen kommer fra de ekte poeng-til-rank-kurvene, ikke fra en antatt
fordeling.

Den avgjørende modelleringen: bare den delen av variansen min som IKKE deles
med feltet, flytter meg gjennom feltet. En kaptein hele verden eier gir høy
poengvarians og null rankvarians.

    python scripts/toy_objective.py
"""

from __future__ import annotations

import math
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fplbot.backtest.rank import build_curves

SEASON = "2025/26"
DRAWS = 40_000
# Kurven fra tilfeldig sampling dekker ikke topp 10k - et utvalg på 600 lag
# inneholder 0,47 forventede topp-10k-lag. Målet settes derfor der kurven
# faktisk har data. Se addendum A, seksjon 3.
TARGET_RANK = 100_000


@dataclass
class Strategy:
    name: str
    mean_per_gw: float
    sd_per_gw: float
    field_correlation: float  # hvor mye av variansen feltet deler med meg


@dataclass
class State:
    label: str
    points_so_far: int
    gws_left: int


def simulate(strategy: Strategy, state: State, rng: random.Random) -> list[float]:
    """Trekker sluttpoeng, og skiller felles fra egen varians."""
    total_sd = strategy.sd_per_gw * math.sqrt(state.gws_left)
    # Bare den idiosynkratiske delen flytter meg i forhold til feltet.
    idio_sd = total_sd * math.sqrt(max(0.0, 1.0 - strategy.field_correlation))
    centre = state.points_so_far + strategy.mean_per_gw * state.gws_left
    return [centre + rng.gauss(0.0, idio_sd) for _ in range(DRAWS)]


def objectives(scores: list[float], curve) -> dict[str, float]:
    """Fem målfunksjoner over samme trekninger. Høyere er bedre for alle."""
    ranks = [max(1, curve.rank_for(s)) for s in scores]
    logs = [math.log(r) for r in ranks]

    def sigmoid_utility(tau: float) -> float:
        target = math.log(TARGET_RANK)
        return statistics.mean(1.0 / (1.0 + math.exp(-(target - lr) / tau)) for lr in logs)

    return {
        "E[poeng]": statistics.mean(scores),
        "-E[log rank]": -statistics.mean(logs),
        "sigmoid t=1": sigmoid_utility(1.0),
        "sigmoid t=5": sigmoid_utility(5.0),
        "P(topp 100k)": sum(1 for r in ranks if r <= TARGET_RANK) / len(ranks),
    }


def main() -> int:
    curve = build_curves(samples=600).get(SEASON)
    if curve is None:
        print(f"Mangler rankkurve for {SEASON}")
        return 1

    # A eier malen: litt bedre snitt, men feltet deler det meste av svingningene.
    # B er differensial: svakere snitt, mer varians, og svingningene er dine egne.
    mal = Strategy("A mal", mean_per_gw=56.0, sd_per_gw=17.0, field_correlation=0.70)
    diff = Strategy("B differensial", mean_per_gw=55.0, sd_per_gw=22.0, field_correlation=0.20)

    # Tilstandene spenner både antall runder igjen OG hvor du står i forhold
    # til målet. Det siste er det som avgjør om utility er konveks (jag) eller
    # konkav (beskytt) der du befinner deg.
    states = [
        State("GW2  bak", 100, 36),
        State("GW2  foran", 190, 36),
        State("GW20 bak", 1000, 18),
        State("GW20 foran", 1180, 18),
        State("GW34 bak", 1900, 4),
        State("GW34 på mål", 2120, 4),
        State("GW34 foran", 2200, 4),
        State("GW37 på mål", 2290, 1),
    ]

    names = ["E[poeng]", "-E[log rank]", "sigmoid t=1", "sigmoid t=5", "P(topp 100k)"]
    print(f"Toy-modell, kurve fra {SEASON}. {DRAWS:,} trekninger per celle.".replace(",", " "))
    print(f"A mal:          {mal.mean_per_gw}/runde, sd {mal.sd_per_gw}, "
          f"feltkorrelasjon {mal.field_correlation}")
    print(f"B differensial: {diff.mean_per_gw}/runde, sd {diff.sd_per_gw}, "
          f"feltkorrelasjon {diff.field_correlation}")
    print("\nHvem vinner under hver målfunksjon?\n")
    threshold = next(
        (g for g in range(1200, 2700) if curve.rank_for(g) <= TARGET_RANK), None
    )
    if threshold is None:
        print(f"Kurven dekker ikke topp {TARGET_RANK}. Kan ikke kjøre.")
        return 1
    print(f"Topp {TARGET_RANK:,} krever ca. {threshold} poeng denne sesongen.\n".replace(",", " "))
    print(f"{'Tilstand':<14}{'Snitt slutt':>12}{'mot mål':>9}" + "".join(f"{n:>14}" for n in names))
    print("-" * (35 + 14 * len(names)))

    for state in states:
        rng_a = random.Random(12345)
        rng_b = random.Random(12345)  # felles tilfeldige tall
        values_a = objectives(simulate(mal, state, rng_a), curve)
        values_b = objectives(simulate(diff, state, rng_b), curve)
        cells = []
        for name in names:
            winner = "A" if values_a[name] >= values_b[name] else "B"
            gap = abs(values_a[name] - values_b[name])
            scale = max(abs(values_a[name]), abs(values_b[name]), 1e-9)
            cells.append(f"{winner} {gap / scale:>5.1%}")
        centre = state.points_so_far + mal.mean_per_gw * state.gws_left
        delta = centre - threshold
        print(
            f"{state.label:<14}{centre:>12.0f}{delta:>+9.0f}"
            + "".join(f"{c:>14}" for c in cells)
        )

    print("\nA har høyest forventning etter konstruksjon, så A i en kolonne betyr")
    print("at målfunksjonen følger forventningen. B betyr at den kjøper varians.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
