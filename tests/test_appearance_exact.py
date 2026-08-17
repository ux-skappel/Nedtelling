"""Validering av den eksakte troppsevaluatoren, jf. V1A_PREREG.md seksjon 12A.

Rekkefølgen er bindende: består ikke A, C og D, kjøres ingen historisk
policytest. Testene er viktigere enn backtesten, fordi et negativt resultat fra
en feil evaluator ikke forteller oss noe i det hele tatt.

    A   full oppregning mot optimert analytisk evaluator, til maskinpresisjon
    B   Monte Carlo som uavhengig kryssjekk av selve reglene
    C   sannsynlighetsmasse lik 1
    D   middelbevaring for V1A-0

I tillegg ligger fasittestene 1-6 fra seksjon 12 her, og beviset for at
fordelingen mellom `1-59` og `60+` er beslutningsirrelevant.
"""

from __future__ import annotations

import random

import pytest

from fplbot.appearance import (
    ARM_MEAN_PRESERVING,
    ARM_STRUCTURAL,
    MinuteStates,
    _order_bench,
    _sorted_starters,
    bench_ev,
    best_captaincy,
    build_states,
    optimise_lineup,
    poisson_binomial,
    resolve_autosubs,
    squad_ev,
)
from fplbot.model import P60_GIVEN_START, P60_GIVEN_SUB, Fixture, Player
from fplbot.scoring import DEF, FWD, GKP, MID
from tests.bruteforce import brute_force_ev, monte_carlo_ev

FORMATIONS = [
    {GKP: 1, DEF: 3, MID: 4, FWD: 3},
    {GKP: 1, DEF: 4, MID: 4, FWD: 2},
    {GKP: 1, DEF: 5, MID: 3, FWD: 2},
    {GKP: 1, DEF: 3, MID: 5, FWD: 2},
    {GKP: 1, DEF: 4, MID: 5, FWD: 1},
    {GKP: 1, DEF: 5, MID: 4, FWD: 1},
]


def make_player(player_id: int, position: int, name: str | None = None) -> Player:
    return Player(
        id=player_id,
        name=name or f"P{player_id}",
        full_name=f"Player {player_id}",
        team=1 + player_id % 5,
        team_short="T",
        position=position,
        cost=50,
        status="a",
        news="",
        selected_by=1.0,
        availability=1.0,
        expected_minutes=70.0,
        p_start=0.9,
        p_sub=0.05,
        start_minutes=75.0,
        form=3.0,
        points_per_game=3.0,
        total_points=30,
        minutes=900,
    )


def states_from(p_zero: float, ev: float, split: float = 0.5) -> MinuteStates:
    """Tilstander med gitt blankesannsynlighet og gitt forventning gitt spill.

    `split` styrer hvor mye av massen som ligger i `60+`. Forventningen holdes
    fast uansett split, slik at testene kan variere fordelingen fritt.
    """
    played = 1.0 - p_zero
    p_sixty = played * split
    p_partial = played - p_sixty
    if played <= 0:
        return MinuteStates(1.0, 0.0, 0.0, 0.0, 0.0)
    # Legg all avvikende vekt i 60+, men hold middelet på ev * played.
    if p_sixty <= 0 or p_partial <= 0:
        return MinuteStates(p_zero, p_partial, p_sixty, ev, ev)
    ev_partial = ev * 0.6
    ev_sixty = (ev * played - p_partial * ev_partial) / p_sixty
    return MinuteStates(p_zero, p_partial, p_sixty, ev_partial, ev_sixty)


def build_squad(formation: dict[int, int], bench_positions: list[int]):
    """15 spillere: ellever etter formasjon, pluss en benk med gitte posisjoner."""
    players: list[Player] = []
    starters: list[Player] = []
    player_id = 1
    for position in (GKP, DEF, MID, FWD):
        for _ in range(formation[position]):
            player = make_player(player_id, position)
            starters.append(player)
            players.append(player)
            player_id += 1
    bench: list[Player] = []
    for position in bench_positions:
        player = make_player(player_id, position)
        bench.append(player)
        players.append(player)
        player_id += 1
    return starters, bench, players


def random_states(
    players, rng: random.Random, degenerate: int = 0
) -> dict[int, MinuteStates]:
    """Tilfeldige tilstander. `degenerate` spillere låses til å alltid spille.

    Full oppregning over 15 spillere med tre tilstander hver er 14,3 millioner
    verdener. Ved å låse de fleste blir oppregningen liten nok til å kjøre, uten
    at reglene som testes forenkles.
    """
    states: dict[int, MinuteStates] = {}
    free = list(players)
    rng.shuffle(free)
    locked = set(p.id for p in free[:degenerate])
    for player in players:
        ev = rng.uniform(0.5, 9.0)
        if player.id in locked:
            states[player.id] = MinuteStates(0.0, 0.0, 1.0, 0.0, ev)
            continue
        p_zero = rng.uniform(0.02, 0.55)
        states[player.id] = states_from(p_zero, ev, split=rng.uniform(0.2, 0.9))
    return states


# ------------------------------------------------------------------- test A


@pytest.mark.parametrize("formation", FORMATIONS)
def test_a_brute_force_matches_analytic_across_formations(formation):
    """A: optimert evaluator mot full oppregning, til maskinpresisjon."""
    rng = random.Random(1234 + formation[DEF] * 10 + formation[MID])
    bench_sets = [[GKP, DEF, MID, FWD], [GKP, MID, MID, FWD], [GKP, DEF, DEF, MID]]
    for bench_positions in bench_sets:
        starters, bench, players = build_squad(formation, bench_positions)
        # Åtte frie spillere gir 3^8 = 6561 verdener; resten låses.
        states = random_states(players, rng, degenerate=len(players) - 8)
        starters = _sorted_starters(starters, states)
        captain, vice, _ = best_captaincy(starters, states)

        analytic = squad_ev(starters, bench, captain, vice, states)
        exact, mass = brute_force_ev(starters, bench, captain, vice, states)

        assert abs(mass - 1.0) < 1e-12
        assert abs(analytic - exact) < 1e-9, f"{formation} {bench_positions}: {analytic} {exact}"


def test_a_two_hundred_random_squads():
    """A: 200 tilfeldige tropper, varierte formasjoner og benkeposisjoner.

    Dette er testen som ville avslørt en feilaktig separabilitetsantakelse: den
    aggregerte evaluatoren og den fullstendige oppregningen må gi samme tall,
    ikke bare omtrent samme tall.
    """
    rng = random.Random(20260817)
    worst = 0.0
    total = 0.0
    cases = 0
    for _ in range(200):
        formation = rng.choice(FORMATIONS)
        bench_positions = [GKP] + [rng.choice((DEF, MID, FWD)) for _ in range(3)]
        starters, bench, players = build_squad(formation, bench_positions)
        states = random_states(players, rng, degenerate=len(players) - 7)
        starters = _sorted_starters(starters, states)
        bench = _order_bench(bench, states)
        captain, vice, _ = best_captaincy(starters, states)

        analytic = squad_ev(starters, bench, captain, vice, states)
        exact, mass = brute_force_ev(starters, bench, captain, vice, states)
        assert abs(mass - 1.0) < 1e-12
        difference = abs(analytic - exact)
        worst = max(worst, difference)
        total += difference
        cases += 1

    assert cases == 200
    assert worst < 1e-9, f"største avvik {worst:.3e}"
    print(f"\nTest A: {cases} tilfeller, største avvik {worst:.2e}, snitt {total / cases:.2e}")


def test_a_general_path_without_a_keeper_first_on_the_bench():
    """A: den generelle oppregningen, uten keepersnarveien.

    Evaluatoren har to veier: en rask der reservekeeperen står først på benken
    (som i FPL), og en generell som regner keeperen med i oppregningen. Den
    generelle veien nås aldri av en ekte tropp, så uten denne testen ville den
    stått uprøvd - og en feil der ville ligget stille til dagen noe endret seg.
    """
    rng = random.Random(9090)
    for bench_positions in ([DEF, GKP, MID, FWD], [DEF, MID, FWD, GKP], [DEF, MID, MID, FWD]):
        formation = {GKP: 1, DEF: 4, MID: 4, FWD: 2}
        starters, bench, players = build_squad(formation, bench_positions)
        states = random_states(players, rng, degenerate=len(players) - 7)
        starters = _sorted_starters(starters, states)
        captain, vice, _ = best_captaincy(starters, states)

        analytic = squad_ev(starters, bench, captain, vice, states)
        exact, mass = brute_force_ev(starters, bench, captain, vice, states)
        assert abs(mass - 1.0) < 1e-12
        assert abs(analytic - exact) < 1e-9, f"{bench_positions}: {analytic} mot {exact}"


def test_a_fast_and_general_paths_agree():
    """De to veiene gjennom evaluatoren skal gi nøyaktig samme tall."""
    from fplbot import appearance

    rng = random.Random(4711)
    for _ in range(25):
        formation = rng.choice(FORMATIONS)
        starters, bench, players = build_squad(formation, [GKP, DEF, MID, FWD])
        states = random_states(players, rng)
        starters = _sorted_starters(starters, states)
        fast = appearance.bench_ev(starters, bench, states)

        shape = tuple(sum(1 for p in starters if p.position == pos) for pos in (1, 2, 3, 4))
        general = appearance._general_bench_ev(starters, bench, states, shape)
        assert abs(fast - general) < 1e-12


def test_a_bench_runs_out_of_a_position():
    """A: tilfellet der benken ikke kan dekke posisjonen som blanker."""
    formation = {GKP: 1, DEF: 3, MID: 4, FWD: 3}
    starters, bench, players = build_squad(formation, [GKP, MID, MID, MID])
    states = {}
    for player in players:
        # Alle forsvarere kan blanke; da finnes det ingen lovlig erstatning,
        # for en midtbanespiller ville gitt to forsvarere.
        p_zero = 0.4 if player.position == DEF else 0.05
        states[player.id] = states_from(p_zero, 4.0, split=0.7)
    starters = _sorted_starters(starters, states)
    captain, vice, _ = best_captaincy(starters, states)

    analytic = squad_ev(starters, bench, captain, vice, states)
    exact, _ = brute_force_ev(starters, bench, captain, vice, states)
    assert abs(analytic - exact) < 1e-9


# ------------------------------------------------------------------- test B


def test_b_monte_carlo_cross_check():
    """B: uavhengig Monte Carlo skal treffe analytisk svar innenfor 3 standardfeil.

    Brute force beviser at aggregeringen er riktig gitt reglene. Monte Carlo
    kjører reglene en tredje gang, på en annen måte, og fanger den andre
    feilklassen: at reglene selv er kodet ulikt to steder.
    """
    rng = random.Random(77)
    for trial in range(5):
        formation = FORMATIONS[trial % len(FORMATIONS)]
        starters, bench, players = build_squad(formation, [GKP, DEF, MID, FWD])
        states = random_states(players, rng)  # ingen degenererte: full tropp
        starters = _sorted_starters(starters, states)
        bench = _order_bench(bench, states)
        captain, vice, _ = best_captaincy(starters, states)

        analytic = squad_ev(starters, bench, captain, vice, states)
        sampled, error = monte_carlo_ev(
            starters, bench, captain, vice, states, draws=40_000, seed=1000 + trial
        )
        assert abs(analytic - sampled) < 3 * error + 1e-9, (
            f"analytisk {analytic:.4f} mot MC {sampled:.4f} ± {error:.4f}"
        )


# ------------------------------------------------------------------- test C


def test_c_probability_mass_is_one():
    """C: sannsynlighetsmassen summerer til 1, i hver konvolusjon og hver tilstand."""
    rng = random.Random(5)
    for _ in range(50):
        probabilities = [rng.random() for _ in range(rng.randint(1, 5))]
        distribution = poisson_binomial(probabilities)
        assert abs(sum(distribution) - 1.0) < 1e-12
        assert len(distribution) == len(probabilities) + 1

    _, _, players = build_squad(FORMATIONS[0], [GKP, DEF, MID, FWD])
    states = random_states(players, rng)
    for player in players:
        assert abs(states[player.id].mass() - 1.0) < 1e-12


def test_c_empty_and_certain_convolutions():
    assert poisson_binomial([]) == [1.0]
    assert poisson_binomial([1.0]) == [0.0, 1.0]
    assert poisson_binomial([0.0]) == [1.0, 0.0]


# ------------------------------------------------------------------- test D


def make_projection_player(
    player_id: int,
    position: int,
    p_start: float,
    p_sub: float,
    start_minutes: float,
    xp: float,
    fixtures: int = 1,
) -> Player:
    player = make_player(player_id, position)
    player.p_start = p_start
    player.p_sub = p_sub
    player.start_minutes = start_minutes
    player.expected_minutes = p_start * start_minutes + p_sub * 18.0
    player.xp = {1: xp}
    player.fixtures = {
        1: [
            Fixture(event=1, opponent=2, opponent_short="OPP", is_home=True, difficulty=3)
            for _ in range(fixtures)
        ]
    }
    return player


def test_d_mean_preservation_across_a_wide_grid():
    """D: V1A-0 skal ha nøyaktig samme forventning som skalar xP.

    Hele gitteret, ikke stikkprøver: alle kombinasjoner av startsannsynlighet,
    innbytterandel, minutter, antall kamper og projeksjonsnivå - inkludert
    negative projeksjoner, som finnes for svake forsvarsspillere.
    """
    worst = 0.0
    total = 0.0
    violations = 0
    checked = 0
    for p_start in (0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0):
        for p_sub in (0.0, 0.05, 0.2, 0.5):
            if p_start + p_sub > 1.0:
                continue
            for start_minutes in (20.0, 45.0, 75.0, 90.0):
                for fixtures in (1, 2):
                    for xp in (-0.4, 0.0, 0.15, 1.2, 4.6, 9.0, 14.0):
                        player = make_projection_player(
                            1, MID, p_start, p_sub, start_minutes, xp, fixtures
                        )
                        states = build_states(player, 1, ARM_MEAN_PRESERVING)
                        checked += 1
                        if states.p_played <= 0:
                            # Ingen sjanse for spilletid: forventningen er null.
                            assert states.mean == 0.0
                            continue
                        error = abs(states.mean - xp)
                        worst = max(worst, error)
                        total += error
                        if error >= 1e-9:
                            violations += 1
                        assert abs(states.mass() - 1.0) < 1e-12
                        assert states.ev_sixty >= states.ev_partial - 1e-12

    assert violations == 0
    print(
        f"\nTest D: {checked} spiller-runder, brudd {violations}, "
        f"største avvik {worst:.2e}, snitt {total / max(1, checked):.2e}"
    )


def test_d_structural_arm_is_not_forced_to_preserve():
    """V1A-1 skal ha lov til å flytte forventningen. Det er hele forskjellen."""
    player = make_projection_player(1, MID, 0.95, 0.02, 80.0, 6.0)
    mean_preserving = build_states(player, 1, ARM_MEAN_PRESERVING)
    structural = build_states(player, 1, ARM_STRUCTURAL)
    assert abs(mean_preserving.mean - 6.0) < 1e-9
    assert abs(structural.mean - 6.0) > 1e-6
    # Blankesannsynligheten er den samme; det er bare prisingen som skiller.
    assert abs(structural.p_zero - mean_preserving.p_zero) < 1e-15


def test_states_are_zero_without_a_fixture():
    player = make_projection_player(1, MID, 0.9, 0.05, 80.0, 5.0, fixtures=1)
    player.fixtures = {}
    states = build_states(player, 1, ARM_MEAN_PRESERVING)
    assert states.p_zero == 1.0
    assert states.mean == 0.0


# ------------------------------------ beslutningsirrelevans av 1-59 mot 60+


def test_split_is_decision_irrelevant():
    """Fordelingen mellom `1-59` og `60+` endrer ingen beslutning.

    Reglene bryr seg bare om nøyaktig 0 minutter. To tilstandssett med samme
    `p_zero` og samme forventning må derfor gi nøyaktig samme troppsverdi, uansett
    hvordan verdien er fordelt mellom de to spilte tilstandene.

    Det er grunnen til at hele den inkrementelle effekten av V1A-1 over V1A-0 er
    en omprising av spillere, ikke ny struktur. Funnet er analytisk, ikke
    empirisk, og gjelder uansett hva backtesten viser.
    """
    rng = random.Random(99)
    starters, bench, players = build_squad(FORMATIONS[1], [GKP, DEF, MID, FWD])
    first = {}
    second = {}
    for player in players:
        p_zero = rng.uniform(0.05, 0.5)
        ev = rng.uniform(1.0, 8.0)
        first[player.id] = states_from(p_zero, ev, split=0.25)
        second[player.id] = states_from(p_zero, ev, split=0.85)
        assert abs(first[player.id].mean - second[player.id].mean) < 1e-12

    starters = _sorted_starters(starters, first)
    captain, vice, _ = best_captaincy(starters, first)
    assert abs(
        squad_ev(starters, bench, captain, vice, first)
        - squad_ev(starters, bench, captain, vice, second)
    ) < 1e-12


# ------------------------------------------- fasittester, seksjon 12 (1-6)


def test_1_conditional_replacement_value():
    """Starter med 50 % blankerisiko og 6,0 gitt spill, sikker benk på 4,0.

    Grunnlinjen ser 6,0. Den eksakte evaluatoren skal se 5,0, fordi benken
    forsikrer halvparten av risikoen.
    """
    starters, bench, _ = build_squad({GKP: 1, DEF: 3, MID: 4, FWD: 3}, [GKP, MID, MID, MID])
    states = {}
    risky = starters[-1]  # en spiss
    for player in starters:
        states[player.id] = MinuteStates(0.0, 0.0, 1.0, 0.0, 0.0)
    states[risky.id] = MinuteStates(0.5, 0.0, 0.5, 0.0, 6.0)
    for index, player in enumerate(bench):
        # Bare den første utespilleren på benken er tilgjengelig.
        states[player.id] = (
            MinuteStates(0.0, 0.0, 1.0, 0.0, 4.0)
            if index == 1
            else MinuteStates(1.0, 0.0, 0.0, 0.0, 0.0)
        )
    captain = vice = risky
    # Kapteinsbidraget holdes utenfor ved å la kapteinen være den samme spilleren
    # og trekke det fra; her måles bare troppsleddet.
    value = squad_ev(starters, bench, captain, vice, states) - states[risky.id].mean
    assert abs(value - 5.0) < 1e-9


def test_2_captain_fallback_shrinks_the_margin():
    """Kaptein A: 8,0 med 30 % blankerisiko. Vise B: 5,0 sikker. Alternativ C: 7,0 sikker.

    Forventet kapteinsbidrag for A er 0,7·8,0 + 0,3·5,0 = 7,1 mot C sine 7,0.
    Grunnlinjen ser 8,0 mot 7,0. Marginen skal krympe fra 1,0 til 0,1.
    """
    from fplbot.appearance import captain_bonus

    # A spiller i 70 % av tilfellene og er da verdt 8,0. Ubetinget: 5,6.
    a = MinuteStates(0.30, 0.0, 0.70, 0.0, 8.0)
    b = MinuteStates(0.0, 0.0, 1.0, 0.0, 5.0)
    c = MinuteStates(0.0, 0.0, 1.0, 0.0, 7.0)
    assert abs(a.mean - 5.6) < 1e-9
    assert abs(a.ev_played - 8.0) < 1e-9

    with_a = captain_bonus(a, b, False)
    with_c = captain_bonus(c, b, False)
    assert abs(with_a - (0.7 * 8.0 + 0.3 * 5.0)) < 1e-9
    assert abs(with_c - 7.0) < 1e-9
    assert abs((with_a - with_c) - 0.1) < 1e-9


def test_2b_captain_and_vice_both_blank_means_no_multiplier():
    from fplbot.appearance import captain_bonus

    blank = MinuteStates(1.0, 0.0, 0.0, 0.0, 0.0)
    assert captain_bonus(blank, blank, False) == 0.0
    # Kaptein blanket, vise spilte: vise får doblingen.
    playing = MinuteStates(0.0, 0.0, 1.0, 0.0, 5.0)
    assert abs(captain_bonus(blank, playing, False) - 5.0) < 1e-12
    # En innbytter arver aldri bindet: bare kaptein og vise inngår.
    assert abs(captain_bonus(playing, blank, False) - 5.0) < 1e-12


def test_3_illegal_formation_is_skipped():
    """3-4-3, en forsvarer blanker, første benkespiller er midtbane.

    Byttet ville gitt to forsvarere, som er ulovlig. Evaluatoren skal hoppe over
    ham og gå videre til neste lovlige benkespiller.
    """
    formation = (1, 3, 4, 3)
    bench_positions = (GKP, MID, DEF, FWD)
    played_all = 0b1111
    brought = resolve_autosubs(formation, (0, 1, 0, 0), bench_positions, played_all)
    # Indeks 1 er midtbanespilleren; han kan ikke inn. Indeks 2 er forsvareren.
    assert brought == (2,)

    # Er forsvareren ikke tilgjengelig, kan heller ingen andre komme inn.
    without_defender = 0b1011
    assert resolve_autosubs(formation, (0, 1, 0, 0), bench_positions, without_defender) == ()


def test_3b_extra_defender_allows_a_midfielder_in():
    """Fra 4-4-2 tåler oppstillingen at en forsvarer erstattes av en midtbane."""
    formation = (1, 4, 4, 2)
    bench_positions = (GKP, MID, DEF, FWD)
    assert resolve_autosubs(formation, (0, 1, 0, 0), bench_positions, 0b1111) == (1,)


def test_3c_keeper_only_replaced_by_keeper():
    formation = (1, 4, 4, 2)
    bench_positions = (GKP, MID, DEF, FWD)
    assert resolve_autosubs(formation, (1, 0, 0, 0), bench_positions, 0b1111) == (0,)
    # Uten reservekeeper på banen skjer ingenting.
    assert resolve_autosubs(formation, (1, 0, 0, 0), bench_positions, 0b1110) == ()


def test_4_short_cameo_does_not_trigger_an_autosub():
    """P(1-59) = 0,99 og P(0) = 0,01: autobytte skal utløses i 1 % av tilfellene."""
    starters, bench, _ = build_squad({GKP: 1, DEF: 4, MID: 4, FWD: 2}, [GKP, DEF, MID, FWD])
    states = {}
    for player in starters:
        states[player.id] = MinuteStates(0.0, 0.0, 1.0, 0.0, 3.0)
    cameo = starters[-1]
    states[cameo.id] = MinuteStates(0.01, 0.99, 0.0, 2.0, 0.0)
    for player in bench:
        states[player.id] = MinuteStates(0.0, 0.0, 1.0, 0.0, 5.0)

    # Bare i den ene prosenten kommer noen inn, og da spissen fra benken.
    contribution = bench_ev(starters, bench, states)
    assert abs(contribution - 0.01 * 5.0) < 1e-9


def test_5_degenerate_case_matches_the_baseline_sum():
    """Alle spillere sikre på 60+: evaluatoren skal gi nøyaktig grunnlinjens tall.

    Feiler denne, er det en implementasjonsfeil og ikke en modellforskjell.
    """
    starters, bench, players = build_squad({GKP: 1, DEF: 4, MID: 4, FWD: 2}, [GKP, DEF, MID, FWD])
    rng = random.Random(3)
    states = {}
    expected = {}
    for player in players:
        value = rng.uniform(1.0, 8.0)
        expected[player.id] = value
        states[player.id] = MinuteStates(0.0, 0.0, 1.0, 0.0, value)
    starters = _sorted_starters(starters, states)
    captain, vice, _ = best_captaincy(starters, states)

    baseline = sum(expected[p.id] for p in starters) + expected[captain.id]
    assert abs(squad_ev(starters, bench, captain, vice, states) - baseline) < 1e-12


def test_6_analytic_within_three_standard_errors():
    """Fasittest 6, utdypet som test B over. Beholdt som eget navn i seksjon 12."""
    rng = random.Random(4242)
    starters, bench, players = build_squad(FORMATIONS[2], [GKP, DEF, MID, FWD])
    states = random_states(players, rng)
    starters = _sorted_starters(starters, states)
    bench = _order_bench(bench, states)
    captain, vice, _ = best_captaincy(starters, states)
    analytic = squad_ev(starters, bench, captain, vice, states)
    sampled, error = monte_carlo_ev(
        starters, bench, captain, vice, states, draws=100_000, seed=11
    )
    assert abs(analytic - sampled) < 3 * error + 1e-9


# ------------------------------------------------------------ oppstillingssøk


def test_lineup_search_never_returns_an_illegal_squad():
    rng = random.Random(31337)
    for _ in range(20):
        _, _, players = build_squad(
            FORMATIONS[rng.randrange(len(FORMATIONS))], [GKP, DEF, MID, FWD]
        )
        states = random_states(players, rng)
        lineup = optimise_lineup(players, states, event=1)
        assert len(lineup.starters) == 11
        assert len(lineup.bench) == 4
        counts = {pos: sum(1 for p in lineup.starters if p.position == pos) for pos in (1, 2, 3, 4)}
        assert counts[GKP] == 1 and counts[DEF] >= 3 and counts[MID] >= 2 and counts[FWD] >= 1
        assert lineup.bench[0].position == GKP
        assert lineup.captain in lineup.starters
        assert lineup.vice in lineup.starters
        assert lineup.captain is not lineup.vice


def test_lineup_search_is_deterministic():
    rng = random.Random(8)
    _, _, players = build_squad(FORMATIONS[0], [GKP, DEF, MID, FWD])
    states = random_states(players, rng)
    first = optimise_lineup(players, states, event=1)
    second = optimise_lineup(list(reversed(players)), states, event=1)
    assert [p.id for p in first.starters] == [p.id for p in second.starters]
    assert [p.id for p in first.bench] == [p.id for p in second.bench]
    assert first.captain.id == second.captain.id


def test_lineup_search_beats_the_naive_ordering():
    """Søket skal aldri gi en dårligere oppstilling enn utgangspunktet."""
    rng = random.Random(64)
    for _ in range(15):
        starters, bench, players = build_squad(FORMATIONS[0], [GKP, DEF, MID, FWD])
        states = random_states(players, rng)
        naive_starters = _sorted_starters(starters, states)
        naive_bench = _order_bench(bench, states)
        captain, vice, _ = best_captaincy(naive_starters, states)
        naive = squad_ev(naive_starters, naive_bench, captain, vice, states)
        assert optimise_lineup(players, states, event=1).value >= naive - 1e-12


def test_evaluator_is_never_below_the_baseline_sum():
    """Den eksakte evaluatoren kan aldri se lavere ut enn `Σ xP` for samme lag.

    Grunnlinjen ignorerer både benkeforsikringen og visekapteinen, og begge er
    ikke-negative bidrag. Forskjellen mellom de to er nettopp den mekanismen
    V1A måler.
    """
    rng = random.Random(17)
    for _ in range(30):
        starters, bench, players = build_squad(FORMATIONS[rng.randrange(6)], [GKP, DEF, MID, FWD])
        states = random_states(players, rng)
        starters = _sorted_starters(starters, states)
        bench = _order_bench(bench, states)
        captain, vice, _ = best_captaincy(starters, states)
        baseline = sum(states[p.id].mean for p in starters) + states[captain.id].mean
        assert squad_ev(starters, bench, captain, vice, states) >= baseline - 1e-12


def test_constants_are_the_frozen_ones():
    """Avbildningen er analytisk forhåndsbestemt, ikke tilpasset på data."""
    assert P60_GIVEN_START == 0.85
    assert P60_GIVEN_SUB == 0.03
