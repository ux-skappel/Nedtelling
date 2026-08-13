"""Chips i backtesten: når de spilles, og hva de er verdt.

I alle kjøringene så langt har chipsene ligget ubrukt. En ekte manager har fire
kort til rådighet, så tallene undervurderer hva boten kunne fått til.

Beslutningen tas med samme informasjon som alt annet: modellens anslag for
rundene framover. Ingen fasit. Blir en chip liggende for lenge, tvinges den ut
mot slutten av vinduet - som en manager som innser at kortet uansett blir
verdiløst.

Fordelingen som brukes her er den klassiske: to wildcards (ett per halvsesong),
og ett hvert av Bench Boost, Triple Captain og Free Hit. Fra 2025/26 gir FPL to
av hver, så for den sesongen er dette et forsiktig anslag.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..model import Player
from ..optimizer import best_xi

WILDCARD = "wildcard"
BENCH_BOOST = "bboost"
TRIPLE_CAPTAIN = "3xc"
FREE_HIT = "freehit"

# Siste runde i første halvsesong. Wildcard nummer én må brukes innen da.
FIRST_HALF_END = 19
LAST_EVENT = 38

# Terskler for å spille et kort frivillig.
BENCH_BOOST_THRESHOLD = 18.0
TRIPLE_CAPTAIN_THRESHOLD = 8.5
FREE_HIT_BLANKS = 4
# Avstanden til den optimale troppen er alltid stor i august, rett og slett
# fordi vi ennå ikke har sett noe. Terskelen må ligge over det nivået, ellers
# brennes wildcardet på et grunnlag som ikke finnes.
WILDCARD_GAP = 30.0
# Første runde et wildcard i det hele tatt vurderes.
WILDCARD_EARLIEST = 4
# Wildcard nummer to låses opp først i andre halvsesong, slik FPL krever.
SECOND_WILDCARD_FROM = FIRST_HALF_END + 1

# Fra disse rundene tvinges ubrukte kort ut, så de ikke går tapt.
FORCED = {WILDCARD: (FIRST_HALF_END, 36), BENCH_BOOST: 35, TRIPLE_CAPTAIN: 35, FREE_HIT: 34}


@dataclass
class ChipState:
    """Holder styr på hva som er igjen og hva som ble spilt."""

    wildcards: int = 2
    bench_boost: int = 1
    triple_captain: int = 1
    free_hit: int = 1
    played: dict[int, str] = field(default_factory=dict)
    # Troppen som skal tilbake etter en Free Hit.
    revert_to: list[Player] | None = None
    revert_prices: dict[int, int] | None = None
    revert_bank: int = 0

    def available(self, chip: str) -> bool:
        return {
            WILDCARD: self.wildcards,
            BENCH_BOOST: self.bench_boost,
            TRIPLE_CAPTAIN: self.triple_captain,
            FREE_HIT: self.free_hit,
        }[chip] > 0

    def spend(self, chip: str, event: int) -> None:
        if chip == WILDCARD:
            self.wildcards -= 1
        elif chip == BENCH_BOOST:
            self.bench_boost -= 1
        elif chip == TRIPLE_CAPTAIN:
            self.triple_captain -= 1
        elif chip == FREE_HIT:
            self.free_hit -= 1
        self.played[event] = chip


def _bench_projection(squad: list[Player], event: int) -> float:
    def score(player: Player) -> float:
        return player.xp.get(event, 0.0)

    starters = best_xi(squad, score)
    return sum(score(p) for p in squad if p not in starters)


def _captain_projection(squad: list[Player], event: int) -> float:
    def score(player: Player) -> float:
        return player.xp.get(event, 0.0)

    return max((score(p) for p in best_xi(squad, score)), default=0.0)


def _blanks(squad: list[Player], event: int) -> int:
    return sum(1 for p in squad if not p.fixtures.get(event))


def choose_chip(
    state: ChipState,
    squad: list[Player],
    event: int,
    squad_gap: float,
) -> str | None:
    """Velger hvilket kort som skal spilles denne runden, om noe.

    Bare ett kort per runde, slik FPL krever. Rekkefølgen under er prioritert:
    Free Hit redder en runde som ellers er tapt, wildcard bygger om troppen, og
    de to poengkortene spilles når de faktisk gir uttelling.
    """
    if event in state.played:
        return None

    blanks = _blanks(squad, event)
    if state.available(FREE_HIT) and (
        blanks >= FREE_HIT_BLANKS or event >= FORCED[FREE_HIT]
    ):
        return FREE_HIT

    if state.available(WILDCARD):
        first_deadline, second_deadline = FORCED[WILDCARD]
        first_wildcard = state.wildcards == 2
        # Nummer to finnes ikke før andre halvsesong, og nummer én er verdiløs
        # før vi har sett nok kamper til å vite hva vi bygger om til.
        if first_wildcard:
            usable = event >= WILDCARD_EARLIEST
            forced = event >= first_deadline
        else:
            usable = event >= SECOND_WILDCARD_FROM
            forced = event >= second_deadline
        if usable and (squad_gap >= WILDCARD_GAP or forced):
            return WILDCARD

    if state.available(BENCH_BOOST):
        bench = _bench_projection(squad, event)
        if bench >= BENCH_BOOST_THRESHOLD or event >= FORCED[BENCH_BOOST]:
            return BENCH_BOOST

    if state.available(TRIPLE_CAPTAIN):
        captain = _captain_projection(squad, event)
        if captain >= TRIPLE_CAPTAIN_THRESHOLD or event >= FORCED[TRIPLE_CAPTAIN]:
            return TRIPLE_CAPTAIN

    return None
