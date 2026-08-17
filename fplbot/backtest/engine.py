"""Kjører modellen gjennom en hel sesong, runde for runde.

Simuleringen går forlengs: for hver runde bygges et snapshot av det som var
kjent før fristen, modellen får bare se det, og så scores uttaket mot det som
faktisk skjedde. Bytter, gratis bytter, minuspoeng, salgspriser og autobytter
følger FPL-reglene.

Modellen kan altså ikke jukse ved å vite hvem som scoret - men den kan heller
ikke vite hvem som var skadet, for arkivet mangler skadestatus per runde. Det
trekker resultatet ned, ikke opp: den ekte boten ser flaggene og styrer unna.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import correlation, mean

from ..model import Player, ProjectionModel
from ..optimizer import XI_MIN, optimize_squad, pick_lineup
from ..scoring import GKP, TRANSFER_HIT_COST
from ..strength import fit_team_strength
from ..transfers import suggest_transfers
from . import chips, v1a
from .history import Season, prior_profile

MAX_SAVED_TRANSFERS = 5
STARTING_BUDGET = 1000


@dataclass
class GameweekResult:
    event: int
    points: int
    hits: int
    transfers: int
    captain: str
    captain_points: int
    bench_points: int
    autosubs: int
    projected: float
    squad_value: int
    bank: int
    starters: list[dict] = field(default_factory=list)
    bench: list[dict] = field(default_factory=list)
    moves: list[dict] = field(default_factory=list)
    chip: str | None = None

    @property
    def net_points(self) -> int:
        return self.points - self.hits * TRANSFER_HIT_COST

    def to_dict(self) -> dict:
        return {
            "event": self.event,
            "points": self.points,
            "net_points": self.net_points,
            "hits": self.hits,
            "transfers": self.transfers,
            "captain": self.captain,
            "captain_points": self.captain_points,
            "bench_points": self.bench_points,
            "autosubs": self.autosubs,
            "projected": round(self.projected, 2),
            "squad_value": self.squad_value,
            "bank": self.bank,
            "starters": self.starters,
            "bench": self.bench,
            "moves": self.moves,
            "chip": self.chip,
        }


@dataclass
class BacktestResult:
    season: str
    label: str = "standard"
    settings: dict = field(default_factory=dict)
    gameweeks: list[GameweekResult] = field(default_factory=list)
    projection_pairs: list[tuple[float, int]] = field(default_factory=list)

    @property
    def total_points(self) -> int:
        return sum(gw.net_points for gw in self.gameweeks)

    @property
    def total_hits(self) -> int:
        return sum(gw.hits for gw in self.gameweeks)

    @property
    def total_transfers(self) -> int:
        return sum(gw.transfers for gw in self.gameweeks)

    @property
    def points_per_gameweek(self) -> float:
        return self.total_points / len(self.gameweeks) if self.gameweeks else 0.0

    def to_dict(self) -> dict:
        bias, error, match = self.projection_error()
        return {
            "season": self.season,
            "label": self.label,
            "settings": self.settings,
            "total_points": self.total_points,
            "points_per_gameweek": round(self.points_per_gameweek, 2),
            "total_transfers": self.total_transfers,
            "total_hits": self.total_hits,
            "hit_cost": self.total_hits * TRANSFER_HIT_COST,
            "bench_points": sum(gw.bench_points for gw in self.gameweeks),
            "projection": {
                "bias": round(bias, 3),
                "mean_error": round(error, 3),
                "correlation": round(match, 3),
            },
            "gameweeks": [gw.to_dict() for gw in self.gameweeks],
        }

    def projection_error(self) -> tuple[float, float, float]:
        """Returnerer (snittavvik, snittbom, korrelasjon) for xP mot faktiske poeng."""
        if len(self.projection_pairs) < 3:
            return 0.0, 0.0, 0.0
        projected = [p for p, _ in self.projection_pairs]
        actual = [float(a) for _, a in self.projection_pairs]
        bias = mean(p - a for p, a in zip(projected, actual, strict=True))
        error = mean(abs(p - a) for p, a in zip(projected, actual, strict=True))
        try:
            match = correlation(projected, actual)
        except (ValueError, ZeroDivisionError):
            match = 0.0
        return bias, error, match


def selling_price(purchase: int, current: int) -> int:
    """FPL selger til kjøpspris pluss halve stigningen, rundet ned."""
    if current <= purchase:
        return current
    return purchase + (current - purchase) // 2


def apply_autosubs(
    starters: list[Player],
    bench: list[Player],
    season: Season,
    event: int,
) -> tuple[list[Player], int]:
    """Bytter inn benkespillere for startere som ikke kom på banen.

    FPL går gjennom benken ovenfra og ned og bruker den første som holder
    oppstillingen lovlig. Keeper kan bare erstattes av keeper.
    """
    final = list(starters)
    available = list(bench)
    swaps = 0

    def played(player: Player) -> bool:
        return season.actual_minutes(player.id, event) > 0

    def legal(squad: list[Player]) -> bool:
        counts: dict[int, int] = {}
        for player in squad:
            counts[player.position] = counts.get(player.position, 0) + 1
        if counts.get(GKP, 0) != 1:
            return False
        return all(counts.get(position, 0) >= minimum for position, minimum in XI_MIN.items())

    for index, starter in enumerate(final):
        if played(starter):
            continue
        for candidate in list(available):
            if not played(candidate):
                continue
            if (starter.position == GKP) != (candidate.position == GKP):
                continue
            trial = list(final)
            trial[index] = candidate
            if legal(trial):
                final = trial
                available.remove(candidate)
                swaps += 1
                break
    return final, swaps


def _describe_plan(plan) -> str:
    return ", ".join(
        f"{out.name}->{into.name}"
        for out, into in zip(plan.out, plan.incoming, strict=True)
    )


def _describe_lineup(lineup) -> str:
    return (
        f"XI[{'/'.join(p.name for p in lineup.starters)}] "
        f"C={lineup.captain.name} V={lineup.vice.name} "
        f"B[{'/'.join(p.name for p in lineup.bench)}]"
    )


@dataclass
class GameweekScore:
    points: int
    captain: str
    captain_points: int
    bench_points: int
    autosubs: int
    projected: float
    starters: list[dict]
    bench: list[dict]


def _player_card(player: Player, season: Season, event: int, captain: bool = False) -> dict:
    return {
        "name": player.name,
        "team": player.team_short,
        "position": player.position_name,
        "price": round(player.price, 1),
        "points": season.actual_points(player.id, event),
        "projected": round(player.xp.get(event, 0.0), 2),
        "captain": captain,
    }


def score_gameweek(
    squad: list[Player], season: Season, event: int, chip: str | None = None, lineup=None
) -> GameweekScore:
    """Setter laget, kjører autobytter og teller poengene som faktisk kom.

    `lineup` lar en annen evaluator bestemme oppstillingen. Står den tom, settes
    laget som før - grunnlinjens vei gjennom koden er uendret.
    """
    lineup = lineup if lineup is not None else pick_lineup(squad, event)
    if chip == chips.BENCH_BOOST:
        # Med Bench Boost teller alle femten, så autobytter er uten betydning.
        final_xi, swaps = list(squad), 0
    else:
        final_xi, swaps = apply_autosubs(lineup.starters, lineup.bench, season, event)

    captain = lineup.captain
    # Visekapteinen overtar hvis kapteinen ikke spilte.
    if season.actual_minutes(captain.id, event) == 0:
        captain = lineup.vice

    points = sum(season.actual_points(p.id, event) for p in final_xi)
    # Triple Captain gir kapteinen to ekstra ganger i stedet for én.
    multiplier = 2 if chip == chips.TRIPLE_CAPTAIN else 1
    captain_points = season.actual_points(captain.id, event) if captain in final_xi else 0
    points += captain_points * multiplier

    bench = [p for p in squad if p not in final_xi]
    return GameweekScore(
        points=points,
        captain=captain.name,
        captain_points=captain_points,
        bench_points=sum(season.actual_points(p.id, event) for p in bench),
        autosubs=swaps,
        projected=(
            sum(p.xp.get(event, 0.0) for p in lineup.starters) + captain.xp.get(event, 0.0)
        ),
        starters=[_player_card(p, season, event, p is captain) for p in final_xi],
        bench=[_player_card(p, season, event) for p in bench],
    )


def run_backtest(
    season: Season,
    prior: Season | None = None,
    start_event: int = 1,
    end_event: int | None = None,
    horizon: int = 5,
    min_gain: float = 1.0,
    max_transfers: int = 2,
    allow_hits: bool = False,
    blend_ppg: float = 0.25,
    # Målt til å skade: se README. Står av med vilje, men kan slås på for
    # å etterprøve hypotesen på andre sesonger.
    use_prior_stats: bool = False,
    # Chips lå ubrukt i de første kjøringene. Med dette på spilles de etter
    # modellens egne anslag, uten fasit.
    use_chips: bool = False,
    label: str = "standard",
    # Kontrollknapp for lekkasjetesting: får bytte ut modellens anslag før
    # troppen settes. Se backtest/controls.py.
    projection_override=None,
    # Gjenbruk av ferdigbygde modeller på tvers av kjøringer. Modellen for en
    # runde avhenger bare av sesongen og innstillingene, ikke av troppen, så
    # ved simulering av mange kjøringer er det halvparten av arbeidet spart.
    model_cache: dict | None = None,
    on_gameweek=None,
    # V1A: bytter ut hvordan en tropp evalueres, og ingenting annet. `None` gir
    # nøyaktig samme kodevei som før, slik at grunnlinjen kan regresjonstestes
    # bit for bit. Se fplbot/backtest/v1a.py og V1A_PREREG.md.
    arm: str | None = None,
    decisions: list | None = None,
) -> BacktestResult:
    """Spiller gjennom sesongen med modellen ved rattet."""
    result = BacktestResult(
        season=season.season,
        label=label,
        settings={
            "horizon": horizon,
            "min_gain": min_gain,
            "max_transfers": max_transfers,
            "allow_hits": allow_hits,
            "blend_ppg": blend_ppg,
            "prior_stats": use_prior_stats,
        },
    )
    end_event = end_event or max(season.events)
    priors = prior_profile(prior, season) if (prior and use_prior_stats) else {}

    squad: list[Player] | None = None
    purchase_prices: dict[int, int] = {}
    bank = STARTING_BUDGET
    free_transfers = 1
    chip_state = chips.ChipState() if use_chips else None

    for event in range(start_event, end_event + 1):
        cached = model_cache.get(event) if model_cache is not None else None
        if cached is not None:
            # Forrige kjøring kan ha skrevet over anslagene, så de settes tilbake.
            model, pristine = cached
            for player_id, projection in pristine.items():
                model.players[player_id].xp = dict(projection)
        else:
            bootstrap, fixtures = season.snapshot(event, prior=prior)
            finished = [e["id"] for e in bootstrap["events"] if e["finished"]]
            strength = fit_team_strength(
                fixtures, [t["id"] for t in bootstrap["teams"]], max(finished) if finished else 0
            )
            # I runde 1 er snapshotet allerede fjorårets tall, så da ville
            # historikken blitt talt to ganger.
            model = ProjectionModel(
                bootstrap,
                fixtures,
                blend_ppg=blend_ppg,
                strength=strength,
                prior_stats=priors if event > 1 else None,
            )
            if model_cache is not None:
                model_cache[event] = (
                    model,
                    {pid: dict(p.xp) for pid, p in model.players.items()},
                )

        if projection_override is not None:
            projection_override(model, event, season)
        events = model.horizon(horizon, start=event)
        context = v1a.ArmContext.build(model, events, arm) if arm else None

        transfers_made = 0
        hits = 0
        moves: list[dict] = []
        chip: str | None = None

        if squad is None:
            initial = optimize_squad(model, events, budget=bank, min_availability=0.0)
            squad = initial.players
            purchase_prices = {p.id: p.cost for p in squad}
            bank -= initial.cost
        else:
            # Ta med prisene inn i den nye modellen, og hopp over spillere som
            # har forsvunnet ut av spillet siden forrige runde.
            # Free Hit varer én runde; etterpå er den gamle troppen tilbake.
            if chip_state is not None and chip_state.revert_to is not None:
                squad = chip_state.revert_to
                purchase_prices = chip_state.revert_prices or purchase_prices
                bank = chip_state.revert_bank
                chip_state.revert_to = None
                chip_state.revert_prices = None

            squad = [model.players[p.id] for p in squad if p.id in model.players]
            if len(squad) < 15:
                # En spiller er fjernet fra spillet; da kan vi ikke regne videre.
                break
            prices = {p.id: selling_price(purchase_prices[p.id], p.cost) for p in squad}

            if chip_state is not None:
                # Wildcard vurderes mot hvor langt troppen er fra den optimale.
                optimal = optimize_squad(model, events, budget=1000, min_availability=0.0)
                gap = sum(p.weighted_xp(events) for p in optimal.players) - sum(
                    p.weighted_xp(events) for p in squad
                )
                chip = chips.choose_chip(chip_state, squad, event, gap)

            if chip in (chips.WILDCARD, chips.FREE_HIT):
                # Begge gir fritt leide til å bygge om troppen denne runden.
                if chip == chips.FREE_HIT:
                    chip_state.revert_to = list(squad)
                    chip_state.revert_prices = dict(purchase_prices)
                    chip_state.revert_bank = bank
                free_this_week, cap = 15, 15
            else:
                free_this_week, cap = free_transfers, max_transfers

            plan = suggest_transfers(
                model,
                squad,
                events,
                selling_prices=prices,
                bank=bank,
                free_transfers=free_this_week,
                max_transfers=cap,
                min_availability=0.0,
            )
            unlimited = chip in (chips.WILDCARD, chips.FREE_HIT)
            baseline_worth_it = plan.incoming and (unlimited or plan.net_gain >= min_gain)
            if baseline_worth_it and plan.hits and not allow_hits and not unlimited:
                baseline_worth_it = False
            worth_it = baseline_worth_it

            if context is not None and plan.incoming:
                # Samme to kandidater som grunnlinjen vurderer - behold troppen,
                # eller utfør planen - men priset med den eksakte evaluatoren.
                after_squad = [p for p in squad if p not in plan.out] + plan.incoming
                keep_value = context.horizon_value(squad)
                move_value = context.horizon_value(after_squad)
                exact_gain = move_value - keep_value - plan.hits * TRANSFER_HIT_COST
                worth_it = unlimited or exact_gain >= min_gain
                if worth_it and plan.hits and not allow_hits and not unlimited:
                    worth_it = False
                if decisions is not None and worth_it != bool(baseline_worth_it):
                    decisions.append(
                        v1a.Decision(
                            season=season.season,
                            event=event,
                            kind="transfer",
                            baseline_action=(
                                _describe_plan(plan) if baseline_worth_it else "ingen bytter"
                            ),
                            v1a_action=_describe_plan(plan) if worth_it else "ingen bytter",
                            predicted_baseline_ev=(
                                move_value if baseline_worth_it else keep_value
                            ),
                            predicted_v1a_ev=move_value if worth_it else keep_value,
                            reason="bytte",
                        )
                    )
            if chip and chip_state is not None:
                chip_state.spend(chip, event)
            if worth_it:
                for out_player, in_player in zip(plan.out, plan.incoming, strict=True):
                    moves.append(
                        {
                            "out": out_player.name,
                            "out_team": out_player.team_short,
                            "in": in_player.name,
                            "in_team": in_player.team_short,
                            "position": in_player.position_name,
                        }
                    )
                for out_player in plan.out:
                    bank += prices[out_player.id]
                    purchase_prices.pop(out_player.id, None)
                for in_player in plan.incoming:
                    bank -= in_player.cost
                    purchase_prices[in_player.id] = in_player.cost
                squad = [p for p in squad if p not in plan.out] + plan.incoming
                transfers_made = plan.count
                hits = plan.hits

        # Wildcard og Free Hit koster ingen av de opptjente byttene.
        if chip in (chips.WILDCARD, chips.FREE_HIT):
            free_transfers = min(MAX_SAVED_TRANSFERS, free_transfers + 1)
        else:
            free_transfers = max(1, min(MAX_SAVED_TRANSFERS, free_transfers - transfers_made + 1))

        lineup = None
        if context is not None:
            lineup = context.lineup(squad, event)
            if decisions is not None:
                baseline_lineup = pick_lineup(squad, event)
                reason = v1a.lineup_reason(baseline_lineup, lineup)
                if reason != "ingen forskjell":
                    baseline_score = score_gameweek(
                        squad, season, event, chip=chip, lineup=baseline_lineup
                    )
                    v1a_score = score_gameweek(squad, season, event, chip=chip, lineup=lineup)
                    decisions.append(
                        v1a.Decision(
                            season=season.season,
                            event=event,
                            kind="lineup",
                            baseline_action=_describe_lineup(baseline_lineup),
                            v1a_action=_describe_lineup(lineup),
                            predicted_baseline_ev=context.baseline_lineup_value(squad, event),
                            predicted_v1a_ev=lineup.value,
                            realized_baseline_points=baseline_score.points,
                            realized_v1a_points=v1a_score.points,
                            reason=reason,
                        )
                    )

        score = score_gameweek(squad, season, event, chip=chip, lineup=lineup)
        for player in squad:
            result.projection_pairs.append(
                (player.xp.get(event, 0.0), season.actual_points(player.id, event))
            )

        gameweek = GameweekResult(
            event=event,
            points=score.points,
            hits=hits,
            transfers=transfers_made,
            captain=score.captain,
            captain_points=score.captain_points,
            bench_points=score.bench_points,
            autosubs=score.autosubs,
            projected=score.projected,
            squad_value=sum(p.cost for p in squad),
            bank=bank,
            starters=score.starters,
            bench=score.bench,
            moves=moves,
            chip=chip,
        )
        result.gameweeks.append(gameweek)
        if on_gameweek:
            on_gameweek(gameweek)

    return result
