"""Kommandolinjegrensesnitt for fplbot."""

from __future__ import annotations

import argparse
import sys

from . import auth, deadline, report
from .api import FplApi, FplError
from .chips import chip_advice
from .model import Player, ProjectionModel
from .optimizer import optimize_squad, pick_lineup, xi_value
from .scoring import DEF, FWD, GKP, MID
from .sources import elite as elite_source
from .sources import odds as odds_source
from .strength import fit_team_strength
from .transfers import rank_transfer_options, suggest_transfers

POSITION_BY_NAME = {"GKP": GKP, "GK": GKP, "DEF": DEF, "MID": MID, "FWD": FWD}


def build_model(args) -> tuple[FplApi, ProjectionModel]:
    """Setter sammen modellen av alle kildene som er tilgjengelige."""
    api = FplApi(cookie=auth.get_cookie(), use_cache=not args.no_cache)
    bootstrap = api.bootstrap()
    fixtures = api.fixtures()

    # Lagstyrke fittet på resultatene så langt; faller tilbake på FDR i august.
    finished = [e["id"] for e in bootstrap["events"] if e.get("finished")]
    current = max(finished) if finished else 0
    strength = fit_team_strength(fixtures, [t["id"] for t in bootstrap["teams"]], current)

    elite = None
    if getattr(args, "elite", 0):
        elite = elite_source.fetch_elite_view(
            api, current, managers=args.elite, use_cache=not args.no_cache
        )
        if elite is None and current > 0:
            print("Advarsel: fikk ikke tak i uttakene til topp-managerne.\n")

    odds_overrides = None
    if getattr(args, "odds", False):
        odds_overrides = _load_odds(bootstrap)

    model = ProjectionModel(
        bootstrap,
        fixtures,
        blend_ppg=args.blend,
        strength=strength,
        elite=elite,
        odds_overrides=odds_overrides,
    )
    return api, model


def _load_odds(bootstrap: dict) -> dict | None:
    if not odds_source.api_key():
        print("Advarsel: --odds krever FPL_ODDS_API_KEY. Hopper over odds.\n")
        return None
    try:
        matches = odds_source.fetch_odds()
    except Exception as exc:  # nettverk, kvote eller formatendring hos leverandøren
        print(f"Advarsel: klarte ikke hente odds ({exc}). Går videre uten.\n")
        return None
    names = {t["id"]: t["name"] for t in bootstrap["teams"]}
    overrides = odds_source.strength_overrides(matches, names)
    print(f"Odds hentet for {len(overrides)} kamper.\n")
    return overrides


def resolve_events(model: ProjectionModel, args) -> list[int]:
    return model.horizon(args.horizon, start=args.event)


def find_player(model: ProjectionModel, needle: str) -> Player:
    needle = needle.lower()
    matches = [
        p
        for p in model.players.values()
        if needle in p.name.lower() or needle in p.full_name.lower()
    ]
    if not matches:
        raise SystemExit(f"Fant ingen spiller som matcher '{needle}'")
    matches.sort(key=lambda p: -p.total_points)
    return matches[0]


# --------------------------------------------------------------------- lag inn

def load_squad(api: FplApi, model: ProjectionModel, args) -> dict:
    """Henter troppen din, helst med salgspriser via innlogget endepunkt."""
    entry_id = args.entry or auth.get_entry_id()
    if not entry_id:
        raise SystemExit(
            "Mangler lag-ID. Kjør 'fplbot config --entry-id <ID>' "
            "(ID-en står i URL-en din på fantasy.premierleague.com/entry/<ID>/...)"
        )

    if auth.get_cookie():
        try:
            data = api.my_team(entry_id)
            picks = data["picks"]
            transfers = data.get("transfers", {})
            return {
                "entry_id": entry_id,
                "players": [model.by_id(p["element"]) for p in picks],
                "selling_prices": {p["element"]: p["selling_price"] for p in picks},
                "bank": transfers.get("bank", 0),
                "free_transfers": transfers.get("limit") or 1,
                "chips_used": [
                    c["name"]
                    for c in data.get("chips", [])
                    if c.get("status_for_entry") == "played"
                ],
                "source": "my-team (innlogget)",
            }
        except FplError as exc:
            print(f"Advarsel: klarte ikke hente innlogget lag ({exc}). Bruker offentlige data.\n")

    current = model.current_event()
    last_played = current or (model.next_event() - 1)
    if last_played < 1:
        raise SystemExit(
            "Sesongen har ikke startet, så du har ikke noe uttak ennå. "
            "Kjør 'fplbot squad' for å sette en tropp fra bunnen."
        )
    picks = api.entry_picks(entry_id, last_played)["picks"]
    entry = api.entry(entry_id)
    players = [model.by_id(p["element"]) for p in picks]
    return {
        "entry_id": entry_id,
        "players": players,
        # Uten innlogging kjenner vi ikke salgsprisene; nåpris er beste anslag.
        "selling_prices": {p.id: p.cost for p in players},
        "bank": entry.get("last_deadline_bank") or 0,
        "free_transfers": args.free,
        "chips_used": [],
        "source": f"offentlig uttak fra GW{last_played} (salgspriser er anslag)",
    }


# ------------------------------------------------------------------ kommandoer

def cmd_squad(args) -> None:
    _, model = build_model(args)
    events = resolve_events(model, args)
    locked = {find_player(model, name).id for name in args.lock}
    banned = {find_player(model, name).id for name in args.ban}
    squad = optimize_squad(
        model,
        events,
        budget=round(args.budget * 10),
        locked=locked,
        banned=banned,
        min_availability=args.min_availability,
    )
    print(report.header(model, events))
    print(report.squad_table(squad, events))
    print()
    print(report.lineup_block(pick_lineup(squad.players, events[0])))


def cmd_team(args) -> None:
    api, model = build_model(args)
    events = resolve_events(model, args)
    data = load_squad(api, model, args)
    entry = api.entry(data["entry_id"])
    print(report.header(model, events, entry))
    print(f"Kilde: {data['source']}")
    print(f"Bank: {data['bank'] / 10:.1f}m   Gratis bytter: {data['free_transfers']}\n")
    order = sorted(data["players"], key=lambda p: (p.position, -p.xp_over(events)))
    print(report.players_table(order, events))
    print()
    print(report.lineup_block(pick_lineup(data["players"], events[0])))
    flagged = [p for p in data["players"] if p.availability < 1.0]
    if flagged:
        print("\nSpillere med tvil:")
        for player in flagged:
            print(f"  {player.name:<18}{player.availability:>5.0%}  {player.news or player.status}")


def cmd_lineup(args) -> None:
    api, model = build_model(args)
    events = resolve_events(model, args)
    data = load_squad(api, model, args)
    print(report.header(model, events))
    print(report.lineup_block(pick_lineup(data["players"], events[0])))


def cmd_transfers(args) -> None:
    api, model = build_model(args)
    events = resolve_events(model, args)
    data = load_squad(api, model, args)
    free = args.free if args.free is not None else data["free_transfers"]
    bank = round(args.bank * 10) if args.bank is not None else data["bank"]

    print(report.header(model, events, api.entry(data["entry_id"])))
    print(f"Bank: {bank / 10:.1f}m   Gratis bytter: {free}\n")
    plan = suggest_transfers(
        model,
        data["players"],
        events,
        selling_prices=data["selling_prices"],
        bank=bank,
        free_transfers=free,
        max_transfers=args.max_transfers,
        min_availability=args.min_availability,
    )
    print(report.transfer_block(plan, events))
    print()
    options = rank_transfer_options(
        model,
        data["players"],
        events,
        selling_prices=data["selling_prices"],
        bank=bank,
        min_availability=args.min_availability,
    )
    print(report.single_transfer_block(options))


def cmd_players(args) -> None:
    _, model = build_model(args)
    events = resolve_events(model, args)
    position = POSITION_BY_NAME.get((args.position or "").upper())
    pool = model.ranked(events, position)
    pool = [
        p
        for p in pool
        if p.price <= args.max_price
        and p.price >= args.min_price
        and p.availability >= args.min_availability
        and p.selected_by <= args.max_owned
    ]
    print(report.header(model, events))
    print(report.players_table(pool[: args.top], events))


def cmd_player(args) -> None:
    _, model = build_model(args)
    events = resolve_events(model, args)
    player = find_player(model, args.name)
    print(model.explain(player, events))
    print(f"  sum over horisonten: {player.xp_over(events):.2f} xP")


def cmd_chips(args) -> None:
    api, model = build_model(args)
    events = model.horizon(max(args.horizon, 8), start=args.event)
    data = load_squad(api, model, args)
    optimal = optimize_squad(model, events, min_availability=args.min_availability)

    def value(player: Player) -> float:
        return player.weighted_xp(events)

    advice = chip_advice(
        model,
        data["players"],
        events,
        optimal_value=xi_value(optimal.players, value),
        squad_value=xi_value(data["players"], value),
    )
    print(report.header(model, events))
    print(report.chips_block(advice))


def cmd_report(args) -> None:
    api, model = build_model(args)
    events = resolve_events(model, args)
    data = load_squad(api, model, args)
    entry = api.entry(data["entry_id"])
    free = args.free if args.free is not None else data["free_transfers"]
    bank = round(args.bank * 10) if args.bank is not None else data["bank"]

    chunks = [report.header(model, events, entry)]
    plan = suggest_transfers(
        model,
        data["players"],
        events,
        selling_prices=data["selling_prices"],
        bank=bank,
        free_transfers=free,
        max_transfers=args.max_transfers,
        min_availability=args.min_availability,
    )
    chunks.append(report.transfer_block(plan, events))

    after = [p for p in data["players"] if p not in plan.out] + plan.incoming
    chunks.append(report.lineup_block(pick_lineup(after, events[0])))

    long_horizon = model.horizon(max(args.horizon, 8), start=args.event)

    def value(player: Player) -> float:
        return player.weighted_xp(long_horizon)

    optimal = optimize_squad(model, long_horizon, min_availability=args.min_availability)
    chunks.append(
        report.chips_block(
            chip_advice(
                model,
                data["players"],
                long_horizon,
                optimal_value=xi_value(optimal.players, value),
                squad_value=xi_value(data["players"], value),
            )
        )
    )
    text = "\n\n".join(chunks)
    print(text)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(text + "\n")
        print(f"\nSkrevet til {args.out}")


def cmd_elite(args) -> None:
    _, model = build_model(args)
    events = resolve_events(model, args)
    if model.elite is None:
        raise SystemExit(
            "Ingen elitedata ennå. Rankingen fylles opp først etter at GW1 er spilt. "
            "Bruk --elite <antall> for å hente flere managere."
        )
    print(report.header(model, events))
    print(f"Basert på uttakene til {model.elite.managers} av de best rangerte managerne.\n")
    print(report.elite_block(model, events, limit=args.top))


def cmd_autopilot(args) -> None:
    # Nær fristen skal vi aldri gå på mellomlagrede data.
    args.no_cache = True
    api, model = build_model(args)
    events = resolve_events(model, args)
    data = load_squad(api, model, args)
    free = args.free if args.free is not None else data["free_transfers"]
    bank = round(args.bank * 10) if args.bank is not None else data["bank"]

    plan = suggest_transfers(
        model,
        data["players"],
        events,
        selling_prices=data["selling_prices"],
        bank=bank,
        free_transfers=free,
        max_transfers=args.max_transfers,
        min_availability=args.min_availability,
    )
    decision = deadline.decide(
        model,
        data["players"],
        plan,
        within_hours=args.within_hours,
        min_gain=args.min_gain,
        allow_hits=args.allow_hits,
    )

    print(report.header(model, events))
    print(report.autopilot_block(decision, events))

    if not decision.in_window:
        return

    squad_after = data["players"]
    if decision.should_transfer:
        if not args.confirm:
            print("\nTørrkjøring. Legg til --confirm for å gjennomføre byttene.")
        else:
            moves = [
                (out.id, into.id, data["selling_prices"][out.id], into.cost)
                for out, into in zip(plan.out, plan.incoming, strict=True)
            ]
            api.submit_transfers(auth.build_transfer_payload(data["entry_id"], events[0], moves))
            print("\nByttene er gjennomført.")
            squad_after = [p for p in data["players"] if p not in plan.out] + plan.incoming

    lineup = pick_lineup(squad_after, events[0])
    print()
    print(report.lineup_block(lineup))
    if args.confirm:
        api.submit_lineup(
            data["entry_id"],
            auth.build_lineup_payload(
                [p.id for p in lineup.starters],
                [p.id for p in lineup.bench],
                lineup.captain.id,
                lineup.vice.id,
            ),
        )
        print("\nOppstillingen er sendt inn.")
    else:
        print("\nTørrkjøring. Legg til --confirm for å sende inn oppstillingen.")


def cmd_config(args) -> None:
    if args.entry_id:
        auth.set_entry_id(args.entry_id)
        print(f"Lagret lag-ID {args.entry_id}")
    config = auth.load_config()
    print(f"Lag-ID: {config.get('entry_id') or '-'}")
    print(f"Cookie: {'satt' if auth.get_cookie() else 'ikke satt'}")
    print(f"Konfigfil: {auth.CONFIG_FILE}")


def cmd_cookie(args) -> None:
    if args.set:
        auth.set_cookie(args.set)
        print("Cookie lagret.")
    else:
        print("Cookie er " + ("satt." if auth.get_cookie() else "ikke satt."))
        print(auth.__doc__)


def cmd_submit_lineup(args) -> None:
    api, model = build_model(args)
    events = resolve_events(model, args)
    if not auth.get_cookie():
        raise SystemExit("Innsending krever cookie. Se 'fplbot cookie'.")
    data = load_squad(api, model, args)
    lineup = pick_lineup(data["players"], events[0])
    payload = auth.build_lineup_payload(
        [p.id for p in lineup.starters],
        [p.id for p in lineup.bench],
        lineup.captain.id,
        lineup.vice.id,
    )
    print(report.lineup_block(lineup))
    if not args.confirm:
        print("\nTørrkjøring. Legg til --confirm for å sende inn dette til FPL.")
        return
    api.submit_lineup(data["entry_id"], payload)
    print("\nOppstillingen er sendt inn.")


def cmd_submit_transfers(args) -> None:
    api, model = build_model(args)
    events = resolve_events(model, args)
    if not auth.get_cookie():
        raise SystemExit("Innsending krever cookie. Se 'fplbot cookie'.")
    data = load_squad(api, model, args)
    free = args.free if args.free is not None else data["free_transfers"]
    bank = round(args.bank * 10) if args.bank is not None else data["bank"]
    plan = suggest_transfers(
        model,
        data["players"],
        events,
        selling_prices=data["selling_prices"],
        bank=bank,
        free_transfers=free,
        max_transfers=args.max_transfers,
        min_availability=args.min_availability,
    )
    print(report.transfer_block(plan, events))
    if not plan.incoming:
        return
    if plan.hits and not args.allow_hits:
        raise SystemExit(
            f"Planen koster {plan.point_cost} minuspoeng. Legg til --allow-hits om det er greit."
        )
    moves = [
        (out.id, into.id, data["selling_prices"][out.id], into.cost)
        for out, into in zip(plan.out, plan.incoming, strict=True)
    ]
    payload = auth.build_transfer_payload(data["entry_id"], events[0], moves)
    if not args.confirm:
        print("\nTørrkjøring. Legg til --confirm for å gjennomføre byttene.")
        return
    api.submit_transfers(payload)
    print("\nByttene er gjennomført.")


# ------------------------------------------------------------------- argparsing

COMMON_ARGS = [
    ("--horizon", {"type": int, "default": 5, "help": "antall gameweeks fram (5)"}),
    ("--event", {"type": int, "default": None, "help": "start-gameweek (neste frist)"}),
    ("--blend", {"type": float, "default": 0.25, "help": "vekt på poengsnitt-ankeret"}),
    (
        "--min-availability",
        {"type": float, "default": 0.75, "help": "minste spilleklarhet (0.75)"},
    ),
    ("--no-cache", {"action": "store_true", "help": "ikke bruk mellomlagrede data"}),
    ("--entry", {"type": int, "default": None, "help": "lag-ID"}),
    (
        "--elite",
        {
            "type": int,
            "default": 0,
            "help": "hent uttakene til N topp-managere (0 = av)",
        },
    ),
    ("--odds", {"action": "store_true", "help": "bruk bookmakerodds (krever FPL_ODDS_API_KEY)"}),
]


def add_common_args(parser: argparse.ArgumentParser, suppress: bool) -> None:
    """Legger til fellesflaggene.

    Subkommandoene får dem med SUPPRESS som standard, slik at de bare
    overstyrer når du faktisk skriver flagget. Da virker både
    'fplbot --horizon 8 squad' og 'fplbot squad --horizon 8'.
    """
    for flag, options in COMMON_ARGS:
        options = dict(options)
        if suppress:
            options["default"] = argparse.SUPPRESS
        parser.add_argument(flag, **options)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fplbot", description="Bot som analyserer og spiller Fantasy Premier League"
    )
    add_common_args(parser, suppress=False)
    common = argparse.ArgumentParser(add_help=False)
    add_common_args(common, suppress=True)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_parser(name: str, help: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, help=help, parents=[common])

    def add_transfer_args(sp):
        sp.add_argument("--free", type=int, default=None, help="antall gratis bytter")
        sp.add_argument("--bank", type=float, default=None, help="penger i banken (millioner)")
        sp.add_argument("--max-transfers", type=int, default=3, help="maks bytter å vurdere (3)")

    squad = add_parser("squad", "sett den beste troppen fra bunnen (wildcard/sesongstart)")
    squad.add_argument("--budget", type=float, default=100.0, help="budsjett i millioner (100.0)")
    squad.add_argument("--lock", action="append", default=[], help="spiller som må være med")
    squad.add_argument("--ban", action="append", default=[], help="spiller som ikke skal med")
    squad.set_defaults(func=cmd_squad)

    team = add_parser("team", "vis og analyser laget ditt")
    team.add_argument("--free", type=int, default=1, help="antall gratis bytter")
    team.set_defaults(func=cmd_team)

    lineup = add_parser("lineup", "beste oppstilling og kaptein")
    lineup.add_argument("--free", type=int, default=1)
    lineup.set_defaults(func=cmd_lineup)

    transfers = add_parser("transfers", "forslag til bytter")
    add_transfer_args(transfers)
    transfers.set_defaults(func=cmd_transfers)

    players = add_parser("players", "rangerte spillere etter forventede poeng")
    players.add_argument("--position", help="GKP, DEF, MID eller FWD")
    players.add_argument("--max-price", type=float, default=20.0)
    players.add_argument("--min-price", type=float, default=0.0)
    players.add_argument("--max-owned", type=float, default=100.0, help="maks eierandel i prosent")
    players.add_argument("--top", type=int, default=25)
    players.set_defaults(func=cmd_players)

    player = add_parser("player", "forklar projeksjonen for én spiller")
    player.add_argument("name")
    player.set_defaults(func=cmd_player)

    chips = add_parser("chips", "råd om bruk av chips")
    chips.add_argument("--free", type=int, default=1)
    chips.set_defaults(func=cmd_chips)

    full = add_parser("report", "full rapport før fristen")
    add_transfer_args(full)
    full.add_argument("--out", help="skriv rapporten til fil")
    full.set_defaults(func=cmd_report)

    elite = add_parser("elite", "vis hva de best rangerte managerne eier")
    elite.add_argument("--free", type=int, default=1)
    elite.add_argument("--top", type=int, default=20)
    elite.set_defaults(func=cmd_elite)

    autopilot = add_parser("autopilot", "handle automatisk rett før fristen")
    add_transfer_args(autopilot)
    autopilot.add_argument(
        "--within-hours", type=float, default=3.0, help="hvor nær fristen den skal handle (3)"
    )
    autopilot.add_argument(
        "--min-gain", type=float, default=1.0, help="minste netto gevinst for å bytte (1.0)"
    )
    autopilot.add_argument("--allow-hits", action="store_true", help="godta minuspoeng")
    autopilot.add_argument("--confirm", action="store_true", help="gjennomfør på ekte")
    autopilot.set_defaults(func=cmd_autopilot)

    config = add_parser("config", "lagre lag-ID")
    config.add_argument("--entry-id", type=int)
    config.set_defaults(func=cmd_config)

    cookie = add_parser("cookie", "lagre sesjonscookie for innlogget bruk")
    cookie.add_argument("--set", help="cookie-strengen fra nettleseren")
    cookie.set_defaults(func=cmd_cookie)

    submit_lineup = add_parser("submit-lineup", "send inn oppstillingen til FPL")
    submit_lineup.add_argument("--free", type=int, default=1)
    submit_lineup.add_argument("--confirm", action="store_true", help="gjennomfør på ekte")
    submit_lineup.set_defaults(func=cmd_submit_lineup)

    submit_transfers = add_parser("submit-transfers", "gjennomfør byttene på FPL")
    add_transfer_args(submit_transfers)
    submit_transfers.add_argument("--confirm", action="store_true", help="gjennomfør på ekte")
    submit_transfers.add_argument("--allow-hits", action="store_true", help="godta minuspoeng")
    submit_transfers.set_defaults(func=cmd_submit_transfers)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except FplError as exc:
        print(f"Feil mot FPL-API-et: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"Feil: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
