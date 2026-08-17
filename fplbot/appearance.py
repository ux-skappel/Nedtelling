"""Eksakt forventet troppspoeng under FPL sine egne regler.

Grunnlinjen verdsetter en tropp som `Σ xP` over ellevern. Det er
`realisert(E[utfall])`. Det riktige er `E[realisert(utfall)]`, og de er ikke
like, fordi reglene er ikke-lineære: en starter som ikke kommer på banen blir
erstattet av benken, og et kapteinsbind faller til visekapteinen.

Modulen implementerer `E[realisert(utfall)]` eksakt - ikke ved simulering, men
ved å aggregere over det tilstandsrommet reglene faktisk avhenger av. Se
`V1A_PREREG.md` seksjon 5 for hvorfor det er mulig, og seksjon 12A for hvordan
det bevises.

To armer, forhåndsregistrert i seksjon 3A:

    V1A-0   middelbevarende. Tilstandsdekomposisjonen har nøyaktig samme
            forventning som dagens skalare xP, så det eneste som endrer seg er
            at troppen evalueres med reglene i stedet for med en sum.
    V1A-1   strukturell. Oppmøtepoeng 1 under 60 minutter og 2 fra 60, med
            representative minutter fra seksjon 4. Forventningen får flytte seg.

En strukturell merknad som er verdt å lese før tallene tolkes: reglene
avhenger bare av *om* en spiller kom på banen, aldri av om han spilte 30 eller
80 minutter. Autobytter utløses ved nøyaktig 0 minutter, kapteinsfallback ved
nøyaktig 0 minutter, og formasjonslovlighet av hvem som står igjen. Fordelingen
av verdi mellom tilstandene `1-59` og `60+` er derfor **beslutningsirrelevant**
så lenge forventningen er den samme. Det er bevist i
`tests/test_appearance_exact.py::test_split_is_decision_irrelevant`, og det
betyr at hele den inkrementelle effekten av V1A-1 over V1A-0 er en
*omprising* av spillere - ikke ny struktur. Det er en konsekvens av modellen,
ikke et valg, og det rapporteres som funn.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

from .model import P60_GIVEN_START, P60_GIVEN_SUB, SUB_MINUTES, Player
from .scoring import DEF, FWD, GKP, MID

# Representative minutter for en innbytter som likevel når 60 minutter. Seksjon 4
# fastsetter `0`, `start_minutes/2` og `start_minutes` for startbanen; innbytter-
# banen er ikke navngitt der, fordi P60|sub = 0,03 gjør den nesten tom. Verdien
# settes her, før noen historisk kjøring, og er ikke tilpasset.
SUB_SIXTY_MINUTES = 65.0

POSITIONS = (GKP, DEF, MID, FWD)
XI_MINIMUM = {GKP: 1, DEF: 3, MID: 2, FWD: 1}
XI_MAXIMUM = {GKP: 1, DEF: 5, MID: 5, FWD: 3}

ARM_MEAN_PRESERVING = "v1a-0"
ARM_STRUCTURAL = "v1a-1"

# Toleranse for middelbevaring (test D) og for sannsynlighetsmasse (test C).
MEAN_TOLERANCE = 1e-9
MASS_TOLERANCE = 1e-12


@dataclass(frozen=True)
class MinuteStates:
    """Tre minuttilstander for én spiller i én runde.

    `p_zero` er sannsynligheten for null minutter - den eneste terskelen FPL
    sine troppsregler bryr seg om. `ev_partial` og `ev_sixty` er forventede
    poeng *betinget* på at tilstanden inntreffer.
    """

    p_zero: float
    p_partial: float
    p_sixty: float
    ev_partial: float
    ev_sixty: float

    @property
    def p_played(self) -> float:
        return self.p_partial + self.p_sixty

    @property
    def mean(self) -> float:
        """Ubetinget forventning. Skal være lik skalar xP i V1A-0."""
        return self.p_partial * self.ev_partial + self.p_sixty * self.ev_sixty

    @property
    def ev_played(self) -> float:
        """Forventede poeng betinget på å ha kommet på banen."""
        played = self.p_played
        return self.mean / played if played > 0 else 0.0

    def mass(self) -> float:
        return self.p_zero + self.p_partial + self.p_sixty


BLANK_STATES = MinuteStates(1.0, 0.0, 0.0, 0.0, 0.0)


# --------------------------------------------------------------- tilstandsbygg


def build_states(player: Player, event: int, arm: str) -> MinuteStates:
    """Bygger minuttilstandene for en spiller i en runde.

    Ingen ny modell: `p_start`, `p_sub` og `start_minutes` kommer uendret fra
    `ProjectionModel`, og `P60|start`, `P60|sub` er konstantene som allerede
    står der. Avbildningen er analytisk forhåndsbestemt og bruker bare
    informasjon fra før fristen (preregistrering seksjon 4).
    """
    fixtures = len(player.fixtures.get(event, []))
    if fixtures == 0:
        return BLANK_STATES

    p_start = max(0.0, player.p_start)
    p_sub = max(0.0, player.p_sub)
    played = p_start + p_sub
    if played > 1.0:
        # Kan skje etter elite-justeringen; skaler ned uten å endre forholdet.
        p_start, p_sub = p_start / played, p_sub / played
        played = 1.0
    if played <= 1e-12:
        return BLANK_STATES

    p_sixty = p_start * P60_GIVEN_START + p_sub * P60_GIVEN_SUB
    p_partial = played - p_sixty
    # Numerisk sikring: masse skal summere til nøyaktig 1 (test C).
    p_zero = 1.0 - played

    scalar_xp = player.xp.get(event, 0.0)
    start_minutes = player.start_minutes

    # Representative minutter per bane, aggregert til tilstand. På startbanen
    # gir dette nøyaktig tallene i seksjon 4: start_minutes/2 og start_minutes.
    w_start_partial = p_start * (1.0 - P60_GIVEN_START)
    w_sub_partial = p_sub * (1.0 - P60_GIVEN_SUB)
    w_start_sixty = p_start * P60_GIVEN_START
    w_sub_sixty = p_sub * P60_GIVEN_SUB

    if p_partial > 1e-12:
        minutes_partial = (
            w_start_partial * (start_minutes / 2.0) + w_sub_partial * SUB_MINUTES
        ) / p_partial
    else:
        minutes_partial = start_minutes / 2.0
    if p_sixty > 1e-12:
        minutes_sixty = (
            w_start_sixty * start_minutes + w_sub_sixty * SUB_SIXTY_MINUTES
        ) / p_sixty
    else:
        minutes_sixty = start_minutes

    # Del den skalare projeksjonen i oppmøte og alt annet. Oppmøtedelen kan
    # regnes eksakt fra de samme parametrene modellen selv brukte.
    appearance_expected = fixtures * (
        p_start * (1.0 + P60_GIVEN_START) + p_sub * (1.0 + P60_GIVEN_SUB)
    )
    minutes_expected = fixtures * (p_start * start_minutes + p_sub * SUB_MINUTES)
    rest = scalar_xp - appearance_expected
    rest_per_90 = rest * 90.0 / minutes_expected if minutes_expected > 1e-12 else 0.0

    structural_partial = fixtures * 1.0 + rest_per_90 * (fixtures * minutes_partial) / 90.0
    structural_sixty = fixtures * 2.0 + rest_per_90 * (fixtures * minutes_sixty) / 90.0

    if arm == ARM_STRUCTURAL:
        return _monotone(p_zero, p_partial, p_sixty, structural_partial, structural_sixty)

    if arm != ARM_MEAN_PRESERVING:
        raise ValueError(f"Ukjent arm: {arm!r}")

    # V1A-0: én skalar per spiller, slik at forventningen blir nøyaktig xP.
    structural_mean = p_partial * structural_partial + p_sixty * structural_sixty
    if abs(structural_mean) < 1e-12 or (scalar_xp / structural_mean) <= 0.0:
        # Degenerert eller fortegnsskifte: flat fordeling, som også bevarer middel.
        flat = scalar_xp / played
        return MinuteStates(p_zero, p_partial, p_sixty, flat, flat)
    scale = scalar_xp / structural_mean
    return _monotone(
        p_zero, p_partial, p_sixty, scale * structural_partial, scale * structural_sixty
    )


def _monotone(
    p_zero: float, p_partial: float, p_sixty: float, ev_partial: float, ev_sixty: float
) -> MinuteStates:
    """Håndhever at 60+ aldri er verdt mindre enn 1-59, uten å flytte middelet.

    Preregistreringen krever at et slikt brudd ikke får passere. Det kan oppstå
    legitimt for spillere med negativ ikke-oppmøtedel (baklengsmål, kort), så i
    stedet for å stoppe kjøringen flates fordelingen ut. Forventningen er den
    samme, og siden fordelingen mellom de to spilte tilstandene er
    beslutningsirrelevant, endrer utflatingen ingen beslutning.
    """
    if ev_sixty >= ev_partial:
        return MinuteStates(p_zero, p_partial, p_sixty, ev_partial, ev_sixty)
    played = p_partial + p_sixty
    flat = (p_partial * ev_partial + p_sixty * ev_sixty) / played if played > 0 else 0.0
    return MinuteStates(p_zero, p_partial, p_sixty, flat, flat)


def build_state_table(players, event: int, arm: str) -> dict[int, MinuteStates]:
    return {p.id: build_states(p, event, arm) for p in players}


# ------------------------------------------------------------ autobytteoppslag

_RESOLUTION_CACHE: dict[tuple, tuple[int, ...]] = {}


def _legal(counts: tuple[int, int, int, int]) -> bool:
    """Samme regel som `backtest.engine.apply_autosubs.legal`."""
    if counts[0] != XI_MINIMUM[GKP]:
        return False
    return (
        counts[1] >= XI_MINIMUM[DEF]
        and counts[2] >= XI_MINIMUM[MID]
        and counts[3] >= XI_MINIMUM[FWD]
    )


def resolve_autosubs(
    formation: tuple[int, int, int, int],
    blanks: tuple[int, int, int, int],
    bench_positions: tuple[int, ...],
    played_mask: int,
) -> tuple[int, ...]:
    """Hvilke benkespillere kommer inn, gitt hvor mange som blanket per posisjon.

    Speiler `apply_autosubs` linje for linje: startere gås gjennom i
    posisjonsrekkefølge, benken ovenfra og ned, keeper bare mot keeper, og
    byttet gjennomføres bare hvis oppstillingen forblir lovlig. Blankende
    startere som ikke blir erstattet står igjen i oppstillingen og teller
    fortsatt i formasjonen - akkurat som i FPL.

    Utfallet avhenger bare av *antall* blanke per posisjon, ikke av hvilke
    spillere det var. Det er nettopp derfor evalueringen kan aggregeres.
    """
    key = (formation, blanks, bench_positions, played_mask)
    cached = _RESOLUTION_CACHE.get(key)
    if cached is not None:
        return cached

    counts = list(formation)
    available = [i for i in range(len(bench_positions)) if played_mask >> i & 1]
    brought: list[int] = []

    for position in POSITIONS:
        for _ in range(blanks[position - 1]):
            for index in available:
                candidate = bench_positions[index]
                if (position == GKP) != (candidate == GKP):
                    continue
                trial = list(counts)
                trial[position - 1] -= 1
                trial[candidate - 1] += 1
                if _legal((trial[0], trial[1], trial[2], trial[3])):
                    counts = trial
                    available.remove(index)
                    brought.append(index)
                    break

    result = tuple(brought)
    _RESOLUTION_CACHE[key] = result
    return result


def poisson_binomial(probabilities: list[float]) -> list[float]:
    """Fordelingen av antall hendelser blant uavhengige forsøk, ved konvolusjon.

    Returnerer `[P(0), P(1), ...]`. Massen summerer til 1 per konstruksjon; det
    kontrolleres eksplisitt av test C.
    """
    distribution = [1.0]
    for probability in probabilities:
        nxt = [0.0] * (len(distribution) + 1)
        for count, mass in enumerate(distribution):
            if mass == 0.0:
                continue
            nxt[count] += mass * (1.0 - probability)
            nxt[count + 1] += mass * probability
        distribution = nxt
    return distribution


# ------------------------------------------------------------------- evaluator


def captain_bonus(
    captain_states: MinuteStates, vice_states: MinuteStates, same_player: bool
) -> float:
    """Forventet kapteinspåslag, med fallback til visekapteinen.

    Kapteinen dobles hvis han spilte. Blanket han, går bindet til visekapteinen -
    men bare hvis visekapteinen selv spilte, for ellers står han ikke i
    oppstillingen. Blanket begge, faller doblingen helt bort. En innbytter arver
    aldri bindet.
    """
    if same_player:
        return captain_states.mean
    return captain_states.mean + captain_states.p_zero * vice_states.mean


def squad_ev(
    starters: list[Player],
    bench: list[Player],
    captain: Player,
    vice: Player,
    states: dict[int, MinuteStates],
) -> float:
    """Eksakt `E[realiserte lagpoeng]` for en oppstilling.

    Summen har tre ledd, og linearitet i forventning gjør at de kan regnes hver
    for seg selv om de ikke er uavhengige:

        1. Starternes egne poeng. En blankende starter bidrar 0, så leddet er
           separabelt.
        2. Benkens bidrag. Ikke separabelt: det avhenger av hvor mange startere
           som blanket, i hvilke posisjoner, og hvilke benkespillere som spilte.
           Aggregeres eksakt over den kombinerte tilstanden.
        3. Kapteinspåslaget, med fallback.
    """
    total = sum(states[p.id].mean for p in starters)
    total += captain_bonus(states[captain.id], states[vice.id], captain.id == vice.id)
    total += bench_ev(starters, bench, states)
    return total


def bench_ev(
    starters: list[Player], bench: list[Player], states: dict[int, MinuteStates]
) -> float:
    """Forventet bidrag fra autobytter.

    Startere aggregeres til antall blanke per posisjon (Poisson-binomial ved
    konvolusjon). Benken enumereres som spilte/blanket-mønstre. Formasjons-
    lovligheten avgjøres på den kombinerte tilstanden, ikke på de to hver for seg.
    """
    if not bench:
        return 0.0

    formation = tuple(sum(1 for p in starters if p.position == pos) for pos in POSITIONS)

    # Keeperen er beviselig separabel fra resten. En utespiller kan aldri fylle
    # keeperplassen, og reservekeeperen kan aldri fylle en utespillerplass, så
    # keeperbyttet endrer verken formasjonstellingen eller hvilke benkespillere
    # som er igjen til utespillerne. Snarveien er ren fart; test A kjører den mot
    # full oppregning på nøyaktig samme måte som den generelle veien.
    keepers = [index for index, p in enumerate(bench) if p.position == GKP]
    if len(keepers) == 1 and keepers[0] == 0:
        keeper_starters = [p for p in starters if p.position == GKP]
        keeper_blank = keeper_starters[0].id if len(keeper_starters) == 1 else None
        if keeper_blank is not None:
            reserve = states[bench[0].id]
            total = states[keeper_blank].p_zero * reserve.p_played * reserve.ev_played
            return total + _outfield_bench_ev(starters, bench[1:], states, formation)

    return _general_bench_ev(starters, bench, states, formation)


def _general_bench_ev(
    starters: list[Player],
    bench: list[Player],
    states: dict[int, MinuteStates],
    formation: tuple[int, int, int, int],
) -> float:
    """Full oppregning inkludert keeperen, uten snarveier.

    Brukes når benken ikke har nøyaktig én keeper først, eller når ellevern ikke
    har nøyaktig én keeper. En ekte FPL-tropp treffer aldri denne veien, men den
    er referansen de raske veiene måles mot.
    """
    distributions = [
        poisson_binomial([states[p.id].p_zero for p in starters if p.position == position])
        for position in POSITIONS
    ]
    bench_positions = tuple(p.position for p in bench)
    bench_played = [states[p.id].p_played for p in bench]
    bench_value = [states[p.id].ev_played for p in bench]

    # Alle spilte/blanket-mønstre på benken, med sannsynlighet og verdi.
    patterns: list[tuple[int, float]] = []
    for mask in range(1 << len(bench)):
        probability = 1.0
        for index, played in enumerate(bench_played):
            probability *= played if mask >> index & 1 else 1.0 - played
        if probability > 0.0:
            patterns.append((mask, probability))

    total = 0.0
    for gkp_blank, gkp_mass in enumerate(distributions[0]):
        if gkp_mass == 0.0:
            continue
        for def_blank, def_mass in enumerate(distributions[1]):
            if def_mass == 0.0:
                continue
            gkp_def = gkp_mass * def_mass
            for mid_blank, mid_mass in enumerate(distributions[2]):
                if mid_mass == 0.0:
                    continue
                gkp_def_mid = gkp_def * mid_mass
                for fwd_blank, fwd_mass in enumerate(distributions[3]):
                    if fwd_mass == 0.0:
                        continue
                    joint = gkp_def_mid * fwd_mass
                    blanks = (gkp_blank, def_blank, mid_blank, fwd_blank)
                    if blanks == (0, 0, 0, 0):
                        continue  # ingen å erstatte
                    for mask, mask_probability in patterns:
                        brought = resolve_autosubs(formation, blanks, bench_positions, mask)
                        if not brought:
                            continue
                        gain = sum(bench_value[index] for index in brought)
                        total += joint * mask_probability * gain
    return total


def _outfield_bench_ev(
    starters: list[Player],
    bench: list[Player],
    states: dict[int, MinuteStates],
    formation: tuple[int, int, int, int],
) -> float:
    """Autobytteverdien blant utespillerne, med keeperen allerede trukket ut."""
    if not bench:
        return 0.0

    distributions = [
        poisson_binomial([states[p.id].p_zero for p in starters if p.position == position])
        for position in (DEF, MID, FWD)
    ]
    bench_positions = tuple(p.position for p in bench)
    bench_played = [states[p.id].p_played for p in bench]
    bench_value = [states[p.id].ev_played for p in bench]

    patterns: list[tuple[int, float]] = []
    for mask in range(1 << len(bench)):
        probability = 1.0
        for index, played in enumerate(bench_played):
            probability *= played if mask >> index & 1 else 1.0 - played
        if probability > 0.0:
            patterns.append((mask, probability))

    total = 0.0
    for def_blank, def_mass in enumerate(distributions[0]):
        if def_mass == 0.0:
            continue
        for mid_blank, mid_mass in enumerate(distributions[1]):
            if mid_mass == 0.0:
                continue
            partial = def_mass * mid_mass
            for fwd_blank, fwd_mass in enumerate(distributions[2]):
                if fwd_mass == 0.0 or (def_blank == 0 and mid_blank == 0 and fwd_blank == 0):
                    continue
                joint = partial * fwd_mass
                blanks = (0, def_blank, mid_blank, fwd_blank)
                for mask, mask_probability in patterns:
                    brought = resolve_autosubs(formation, blanks, bench_positions, mask)
                    if not brought:
                        continue
                    total += (
                        joint
                        * mask_probability
                        * sum(bench_value[index] for index in brought)
                    )
    return total


# --------------------------------------------------------------- oppstillingen


@dataclass
class V1ALineup:
    starters: list[Player]
    bench: list[Player]
    captain: Player
    vice: Player
    value: float
    event: int

    @property
    def formation(self) -> str:
        counts = {pos: 0 for pos in (DEF, MID, FWD)}
        for player in self.starters:
            if player.position in counts:
                counts[player.position] += 1
        return f"{counts[DEF]}-{counts[MID]}-{counts[FWD]}"


def _sorted_starters(players: list[Player], states: dict[int, MinuteStates]) -> list[Player]:
    """Samme rekkefølge som `pick_lineup` bruker: posisjon, så verdi synkende.

    Rekkefølgen betyr noe, fordi `apply_autosubs` går gjennom startere i den
    rekkefølgen. Evaluatoren og den faktiske poengtellingen må se samme liste.
    """
    return sorted(players, key=lambda p: (p.position, -states[p.id].mean, p.id))


def _order_bench(players: list[Player], states: dict[int, MinuteStates]) -> list[Player]:
    """Reservekeeper først, slik FPL krever, deretter verdi synkende."""
    keepers = [p for p in players if p.position == GKP]
    outfield = sorted(players, key=lambda p: (-states[p.id].mean, p.id))
    return keepers + [p for p in outfield if p.position != GKP]


def best_captaincy(
    starters: list[Player], states: dict[int, MinuteStates]
) -> tuple[Player, Player, float]:
    """Beste kaptein og visekaptein i lukket form.

    Påslaget er `mean_c + P(c blanker) · mean_v`, som bare avhenger av de to
    spillerne. Da trengs ingen søk: for hver kandidat er beste vise den beste
    andre spilleren, så det holder å kjenne de to høyeste.
    """
    ranked = sorted(starters, key=lambda p: (-states[p.id].mean, p.id))
    if len(ranked) == 1:
        only = ranked[0]
        return only, only, states[only.id].mean
    first, second = ranked[0], ranked[1]

    best: tuple[Player, Player, float] | None = None
    for candidate in starters:
        partner = second if candidate.id == first.id else first
        value = captain_bonus(states[candidate.id], states[partner.id], False)
        if best is None or value > best[2] + 1e-12:
            best = (candidate, partner, value)
    assert best is not None
    return best


def _evaluate(
    starters: list[Player], bench: list[Player], states: dict[int, MinuteStates]
) -> tuple[float, Player, Player]:
    captain, vice, bonus = best_captaincy(starters, states)
    total = sum(states[p.id].mean for p in starters) + bonus
    total += bench_ev(starters, bench, states)
    return total, captain, vice


def _formation_legal(starters: list[Player]) -> bool:
    counts = {pos: 0 for pos in POSITIONS}
    for player in starters:
        counts[player.position] += 1
    if len(starters) != 11:
        return False
    return all(XI_MINIMUM[pos] <= counts[pos] <= XI_MAXIMUM[pos] for pos in POSITIONS)


def optimise_lineup(
    squad: list[Player], states: dict[int, MinuteStates], event: int, rounds: int = 4
) -> V1ALineup:
    """Setter oppstillingen som maksimerer eksakt forventet poengsum.

    Deterministisk lokalsøk: start fra troppen sortert på verdi, prøv alle
    enkeltbytter mellom ellever og benk til ingen forbedrer, optimer så
    benkerekkefølgen uttømmende, og gjenta. Kaptein og vise løses i lukket form
    ved hver evaluering. Uavgjort brytes på spiller-ID, så resultatet er
    reproduserbart.

    Søket er lokalt, men nabolaget er fullstendig for ett bytte. Grunnlinjen
    løser det samme problemet grådig, så V1A søker ikke bredere - den bruker en
    annen målfunksjon på samme rom.
    """
    ranked = sorted(squad, key=lambda p: (-states[p.id].mean, p.id))
    starters = _greedy_start(ranked, states)
    bench = _order_bench([p for p in squad if p not in starters], states)
    starters = _sorted_starters(starters, states)
    value, captain, vice = _evaluate(starters, bench, states)

    for _ in range(rounds):
        improved = False

        # Ett bytte mellom ellever og benk, hele nabolaget.
        while True:
            best_swap = None
            for out_index, out_player in enumerate(starters):
                for in_index, in_player in enumerate(bench):
                    trial_start = list(starters)
                    trial_start[out_index] = in_player
                    if not _formation_legal(trial_start):
                        continue
                    trial_bench = list(bench)
                    trial_bench[in_index] = out_player
                    trial_start = _sorted_starters(trial_start, states)
                    trial_bench = _order_bench(trial_bench, states)
                    trial_value, trial_captain, trial_vice = _evaluate(
                        trial_start, trial_bench, states
                    )
                    if trial_value > value + 1e-12 and (
                        best_swap is None or trial_value > best_swap[0]
                    ):
                        best_swap = (
                            trial_value,
                            trial_start,
                            trial_bench,
                            trial_captain,
                            trial_vice,
                        )
            if best_swap is None:
                break
            value, starters, bench, captain, vice = best_swap
            improved = True

        # Benkerekkefølgen, uttømmende. Reservekeeper står alltid først.
        keepers = [p for p in bench if p.position == GKP]
        outfield = [p for p in bench if p.position != GKP]
        for permutation in itertools.permutations(outfield):
            trial_bench = keepers + list(permutation)
            trial_value, trial_captain, trial_vice = _evaluate(starters, trial_bench, states)
            if trial_value > value + 1e-12:
                value, bench, captain, vice = trial_value, trial_bench, trial_captain, trial_vice
                improved = True

        if not improved:
            break

    return V1ALineup(
        starters=starters, bench=bench, captain=captain, vice=vice, value=value, event=event
    )


def _greedy_start(ranked: list[Player], states: dict[int, MinuteStates]) -> list[Player]:
    """Et lovlig utgangspunkt: beste ellever etter forventning alene."""
    by_position: dict[int, list[Player]] = {pos: [] for pos in POSITIONS}
    for player in ranked:
        by_position[player.position].append(player)

    best: list[Player] = []
    best_value = float("-inf")
    for defenders in range(XI_MINIMUM[DEF], XI_MAXIMUM[DEF] + 1):
        for midfielders in range(XI_MINIMUM[MID], XI_MAXIMUM[MID] + 1):
            forwards = 10 - defenders - midfielders
            if not XI_MINIMUM[FWD] <= forwards <= XI_MAXIMUM[FWD]:
                continue
            shape = {GKP: 1, DEF: defenders, MID: midfielders, FWD: forwards}
            if any(len(by_position[pos]) < count for pos, count in shape.items()):
                continue
            picked = [p for pos, count in shape.items() for p in by_position[pos][:count]]
            value = sum(states[p.id].mean for p in picked)
            if value > best_value:
                best_value, best = value, picked
    if not best:
        raise RuntimeError("Klarte ikke sette en lovlig ellever av troppen")
    return best
