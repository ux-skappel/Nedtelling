"""Tekstformatering av det boten kommer fram til."""

from __future__ import annotations

from .chips import ChipAdvice
from .deadline import AutopilotDecision
from .model import Player, ProjectionModel
from .optimizer import Lineup, Squad
from .transfers import TransferPlan


def players_table(players: list[Player], events: list[int], show_fixtures: bool = True) -> str:
    show_elite = any(p.elite_ownership is not None for p in players)
    header = f"{'Spiller':<16}{'Lag':<5}{'Pos':<5}{'Pris':>6}{'xMin':>6}{'xP':>7}{'SP':>4}"
    if show_elite:
        header += f"{'Eie%':>6}{'Elite':>7}"
    if show_fixtures:
        header += "  Kamper"
    lines = [header, "-" * (len(header) + 8)]
    for player in players:
        line = (
            f"{player.name[:15]:<16}{player.team_short:<5}{player.position_name:<5}"
            f"{player.price:>6.1f}{player.expected_minutes:>6.0f}"
            f"{player.xp_over(events):>7.1f}{player.set_pieces:>4}"
        )
        if show_elite:
            elite = player.elite_ownership or 0.0
            line += f"{player.selected_by:>6.1f}{elite:>7.1f}"
        if show_fixtures:
            line += f"  {player.fixture_string(events)}"
        if player.news:
            line += f"  [{player.news[:40]}]"
        lines.append(line)
    return "\n".join(lines)


def squad_table(squad: Squad, events: list[int]) -> str:
    order = sorted(squad.players, key=lambda p: (p.position, -p.xp_over(events)))
    body = players_table(order, events)
    total = sum(p.xp_over(events) for p in squad.players)
    footer = (
        f"\nKostnad: {squad.cost / 10:.1f}m   "
        f"Sum xP (GW{events[0]}-{events[-1]}): {total:.1f}"
    )
    return body + footer


def lineup_block(lineup: Lineup) -> str:
    lines = [f"Oppstilling GW{lineup.event} ({lineup.formation}):"]
    for player in lineup.starters:
        marker = ""
        if player is lineup.captain:
            marker = " (C)"
        elif player is lineup.vice:
            marker = " (V)"
        lines.append(
            f"  {player.position_name:<4}{player.name[:16]:<17}{player.team_short:<5}"
            f"{player.xp.get(lineup.event, 0.0):>5.1f} xP{marker}"
        )
    lines.append("Benk:")
    for index, player in enumerate(lineup.bench, start=1):
        lines.append(
            f"  {index}. {player.position_name:<4}{player.name[:16]:<17}{player.team_short:<5}"
            f"{player.xp.get(lineup.event, 0.0):>5.1f} xP"
        )
    lines.append(f"Forventet totalt (med kaptein doblet): {lineup.expected_points():.1f} poeng")
    return "\n".join(lines)


def transfer_block(plan: TransferPlan, events: list[int]) -> str:
    if not plan.incoming:
        return (
            "Anbefaling: ikke bytt denne uka. Ingen bytte gir nok igjen over "
            f"GW{events[0]}-{events[-1]} til å forsvare seg."
        )
    lines = [f"Anbefalte bytter ({plan.count} stk, {plan.point_cost} minuspoeng):"]
    for out_player, in_player in zip(plan.out, plan.incoming, strict=True):
        lines.append(
            f"  UT  {out_player.name[:16]:<17}{out_player.team_short:<5}{out_player.price:>6.1f}m"
            f"  ->  INN {in_player.name[:16]:<17}{in_player.team_short:<5}{in_player.price:>6.1f}m"
        )
    lines.append(f"Bank etterpå: {plan.bank_after / 10:.1f}m")
    lines.append(
        f"Verdi over horisonten: {plan.value_before:.1f} -> {plan.value_after:.1f} "
        f"(netto {plan.net_gain:+.1f} poeng etter hits)"
    )
    return "\n".join(lines)


def single_transfer_block(options: list[tuple[Player, Player, float]]) -> str:
    if not options:
        return "Ingen enkeltbytter gir gevinst."
    lines = ["Beste enkeltbytter:"]
    for out_player, in_player, gain in options:
        lines.append(
            f"  {out_player.name[:15]:<16} -> {in_player.name[:15]:<16}"
            f"{in_player.team_short:<5}{in_player.price:>6.1f}m  {gain:+.1f} xP"
        )
    return "\n".join(lines)


def chips_block(advice: list[ChipAdvice]) -> str:
    if not advice:
        return "Ingen chips peker seg ut i denne horisonten."
    lines = ["Chips:"]
    for item in advice[:6]:
        event = f"GW{item.event}" if item.event else "-"
        lines.append(f"  {item.chip:<15}{event:<7}{item.reason}")
    return "\n".join(lines)


def elite_block(model: ProjectionModel, events: list[int], limit: int = 20) -> str:
    """Hva topp-managerne eier, og hvor de skiller seg fra folket."""
    view = model.elite
    if view is None:
        return "Ingen elitedata tilgjengelig."

    lines = [
        (
            f"{'Spiller':<16}{'Lag':<5}{'Pos':<5}{'Pris':>6}"
            f"{'Elite%':>8}{'Alle%':>7}{'Diff':>7}{'xP':>7}"
        )
    ]
    lines.append("-" * len(lines[0]))
    for player_id, share in view.top(limit):
        player = model.players.get(player_id)
        if player is None:
            continue
        lines.append(
            f"{player.name[:15]:<16}{player.team_short:<5}{player.position_name:<5}"
            f"{player.price:>6.1f}{share:>8.1f}{player.selected_by:>7.1f}"
            f"{share - player.selected_by:>+7.1f}{player.xp_over(events):>7.1f}"
        )

    captains = sorted(view.captaincy.items(), key=lambda item: -item[1])[:5]
    if captains:
        lines.append("\nKapteinsvalg blant eliten:")
        for player_id, share in captains:
            player = model.players.get(player_id)
            if player:
                lines.append(f"  {player.name[:18]:<19}{share:>5.1f}%")

    movers = sorted(
        (p for p in model.players.values() if p.elite_edge is not None),
        key=lambda p: p.elite_edge or 0.0,
    )
    dropped = [p for p in movers if (p.elite_edge or 0) < -5 and p.selected_by > 5][:5]
    if dropped:
        lines.append("\nEliten er lettere inne enn folket her (verdt å sjekke hvorfor):")
        for player in dropped:
            lines.append(
                f"  {player.name[:18]:<19}alle {player.selected_by:>5.1f}%  "
                f"elite {player.elite_ownership:>5.1f}%"
            )
    return "\n".join(lines)


def autopilot_block(decision: AutopilotDecision, events: list[int]) -> str:
    lines = [decision.summary]
    for reason in decision.reasons:
        lines.append(f"  + {reason}")
    for blocker in decision.blocked:
        lines.append(f"  - {blocker}")
    if decision.in_window and decision.plan is not None:
        lines.append("")
        lines.append(transfer_block(decision.plan, events))
    return "\n".join(lines)


def header(model: ProjectionModel, events: list[int], entry: dict | None = None) -> str:
    event = events[0]
    deadline = model.deadline(event)
    lines = [
        "=" * 72,
        f"FPL-rapport  |  neste frist: GW{event} {deadline}",
        f"Horisont: GW{events[0]}-GW{events[-1]}",
    ]
    if entry:
        lines.append(
            f"Lag: {entry.get('name', '?')} ({entry.get('player_first_name', '')} "
            f"{entry.get('player_last_name', '')})  "
            f"totalt {entry.get('summary_overall_points', 0)} poeng, "
            f"rank {entry.get('summary_overall_rank') or '-'}"
        )
    lines.append("=" * 72)
    return "\n".join(lines)
