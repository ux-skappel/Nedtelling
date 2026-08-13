"""FPL-poengregler og fikstur-justeringer.

Reglene under følger sesongen 2025/26 og framover, inkludert "defensive
contributions" som ble innført i 2025/26.
"""

from __future__ import annotations

import math

GKP, DEF, MID, FWD = 1, 2, 3, 4

POSITION_NAME = {GKP: "GKP", DEF: "DEF", MID: "MID", FWD: "FWD"}

# Poeng for mål etter posisjon.
GOAL_POINTS = {GKP: 6, DEF: 6, MID: 5, FWD: 4}
ASSIST_POINTS = 3
# Clean sheet (krever minst 60 spilte minutter).
CLEAN_SHEET_POINTS = {GKP: 4, DEF: 4, MID: 1, FWD: 0}
# -1 poeng per 2 baklengsmål for keeper og forsvar.
GOALS_CONCEDED_PER_POINT = 2
SAVES_PER_POINT = 3
# Defensive contributions: 2 poeng ved terskelen, én gang per kamp.
DEFCON_THRESHOLD = {GKP: 99, DEF: 10, MID: 12, FWD: 12}
DEFCON_POINTS = 2

# Multiplikator på forventet mål/assist ut fra motstanderens FDR (1 = enklest).
ATTACK_BY_FDR = {1: 1.35, 2: 1.18, 3: 1.00, 4: 0.84, 5: 0.68}
# Basissannsynlighet for clean sheet ut fra FDR.
CLEAN_SHEET_BY_FDR = {1: 0.52, 2: 0.42, 3: 0.30, 4: 0.20, 5: 0.12}
# Forventede baklengsmål ut fra FDR.
CONCEDED_BY_FDR = {1: 0.85, 2: 1.05, 3: 1.35, 4: 1.70, 5: 2.05}

HOME_ATTACK_BOOST = 1.08
AWAY_ATTACK_BOOST = 0.93
HOME_CLEAN_SHEET_BOOST = 1.12
AWAY_CLEAN_SHEET_BOOST = 0.88

TRANSFER_HIT_COST = 4


def fdr_lookup(table: dict[int, float], difficulty: int) -> float:
    """Slår opp i en FDR-tabell og tåler verdier utenfor 1-5."""
    return table[max(1, min(5, int(difficulty)))]


def poisson_at_least(lam: float, k: int) -> float:
    """P(X >= k) for en Poisson-fordelt X med forventning lam."""
    if lam <= 0:
        return 0.0
    if k <= 0:
        return 1.0
    # Summerer halen nedenfra: 1 - P(X <= k-1).
    cumulative = 0.0
    term = math.exp(-lam)
    for i in range(k):
        if i > 0:
            term *= lam / i
        cumulative += term
    return max(0.0, min(1.0, 1.0 - cumulative))


def appearance_points(p_sixty: float) -> float:
    """Oppmøtepoeng gitt at spilleren kommer på banen.

    1 poeng for å spille i det hele tatt, 1 til fra 60 minutter.
    """
    return 1.0 + max(0.0, min(1.0, p_sixty))
