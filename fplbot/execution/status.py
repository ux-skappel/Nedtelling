"""Statusmeldingen du faktisk leser.

Poenget med hele systemet er at jobben allerede er gjort når meldingen kommer.
Den skal derfor kunne leses på ti sekunder og svare på ett spørsmål: er laget i
orden, eller må jeg gjøre noe?

Alt som krever handling fra deg står øverst. Alt annet er bekreftelse.
"""

from __future__ import annotations

from .pipeline import IDLE, WAIT, RunResult

VERIFIED = "Alle handlinger er verifisert mot FPL."


def render(result: RunResult) -> str:
    lines = [f"FPL AUTOPILOT — GW{result.event}" if result.event else "FPL AUTOPILOT"]
    lines.append("")
    lines.append(f"STATUS: {result.status}")

    if result.status != "SUCCESS":
        lines.append("")
        for note in result.notes:
            lines.append(f"  ! {note}")

    if result.phase == IDLE and result.event is None:
        return "\n".join(lines)

    lines.append("")
    lines.append("TRANSFER")
    lines.append(f"  {result.transfer_summary}")

    if result.phase == WAIT and result.execute_after:
        lines.append(f"  Neste vurdering om ca. {result.execute_after:.1f} timer.")

    if result.captain != "-":
        lines.append("")
        lines.append("LINEUP")
        written = [o for o in result.outcomes if o.action.kind.value == "LINEUP"]
        if any(o.wrote for o in written):
            lines.append("  Oppdatert automatisk.")
        elif written and written[0].status == "DRY_RUN":
            lines.append("  Klar, men ikke sendt (tørrkjøring).")
        else:
            lines.append("  Uendret.")
        lines.append("")
        lines.append("CAPTAIN")
        lines.append(f"  {result.captain}")
        lines.append("")
        lines.append("VICE")
        lines.append(f"  {result.vice}")
        if result.bench:
            lines.append("")
            lines.append("BENCH")
            for index, name in enumerate(result.bench, start=1):
                lines.append(f"  {index}. {name}")

    lines.append("")
    lines.append("CHIP")
    lines.append(f"  {result.chip or 'Ingen'}")

    lines.append("")
    lines.append("NEXT DEADLINE")
    if result.hours_to_deadline == float("inf"):
        lines.append("  Ukjent")
    else:
        lines.append(f"  Om {result.hours_to_deadline:.1f} timer")

    lines.append("")
    lines.append(f"MODUS: {result.mode}")
    lines.append(f"DOCTOR: {'PASS' if result.doctor_ok else 'FAIL'}")

    written = [o for o in result.outcomes if o.wrote]
    blocked = [o for o in result.outcomes if o.status in ("FAILED", "BLOCKED")]
    lines.append("")
    if blocked:
        lines.append("EXECUTION VERIFICATION FAILED" if any(
            o.status == "FAILED" for o in blocked
        ) else "HANDLINGER BLOKKERT AV VALIDERINGEN")
        for outcome in blocked:
            lines.append(f"  {outcome.action.kind.value}: {outcome.message}")
    elif written:
        lines.append(VERIFIED)
    else:
        lines.append("Ingen handlinger var nødvendige.")

    if result.status == "SUCCESS" and result.notes:
        lines.append("")
        for note in result.notes:
            lines.append(f"  - {note}")
    return "\n".join(lines)


def render_detail(result: RunResult) -> str:
    """Full utskrift for loggen: doctor, validering og verifikasjon per handling."""
    lines = ["", "=" * 60, "DETALJER", "=" * 60, "", "Doctor:"]
    lines.extend(f"  {line}" for line in result.doctor_lines)
    for outcome in result.outcomes:
        lines.append("")
        lines.append(f"{outcome.action.kind.value}  {outcome.action.action_id}")
        lines.append(f"  status      {outcome.status}")
        lines.append(f"  handling    {outcome.action.summary}")
        lines.append(f"  predikert   {outcome.action.predicted_gain:+.2f} over horisonten")
        if outcome.action.hit_cost:
            lines.append(f"  minuspoeng  {outcome.action.hit_cost}")
        if outcome.validation is not None:
            lines.append("  validering:")
            lines.append(outcome.validation.report())
        if outcome.verification is not None:
            mark = "PASS" if outcome.verification["ok"] else "FAIL"
            lines.append(f"  verifikasjon {mark} ({outcome.verification['attempts']} forsøk)")
            for problem in outcome.verification["problems"]:
                lines.append(f"    - {problem}")
    return "\n".join(lines)


def exit_code(result: RunResult) -> int:
    """0 ved suksess, 1 ved degradert, 2 ved feil.

    Planleggeren kan da varsle på ekte problemer uten å bråke på de rundene der
    boten helt korrekt gjorde ingenting.
    """
    return {"SUCCESS": 0, "DEGRADED": 1, "FAIL": 2}.get(result.status, 2)
