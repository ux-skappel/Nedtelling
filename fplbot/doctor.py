"""Sjekker at boten faktisk er i stand til å styre laget ditt.

Den farligste feilen i et oppsett som skal gå av seg selv, er ikke at det
krasjer. Det er at det slutter å virke stille. Cookien varer noen uker, og når
den går ut, gjør autopiloten nøyaktig ingenting - uten å si fra. For noen som
allerede glemmer å bytte selv, er det verre enn å ikke ha boten.

Derfor går denne modulen gjennom hele kjeden og avslutter med feilkode hvis noe
er brutt. Kjøres den fra CI, sender GitHub deg en e-post når jobben feiler, og
da vet du det.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import auth, deadline
from .api import FplApi, FplError

OK, WARN, FAIL = "ok", "advarsel", "feil"
MARK = {OK: "OK  ", WARN: "!   ", FAIL: "FEIL"}


@dataclass
class Check:
    name: str
    status: str
    message: str
    fix: str = ""

    def line(self) -> str:
        text = f"  [{MARK[self.status]}] {self.name}: {self.message}"
        if self.fix and self.status != OK:
            text += f"\n         → {self.fix}"
        return text


def run_checks(within_hours: float = 4.0) -> list[Check]:
    """Går gjennom alt som må stemme for at autopiloten skal virke."""
    checks: list[Check] = []

    entry_id = auth.get_entry_id()
    checks.append(
        Check("Lag-ID", OK, str(entry_id))
        if entry_id
        else Check(
            "Lag-ID",
            FAIL,
            "ikke satt",
            "fplbot config --entry-id <ID> (står i URL-en din på fantasy.premierleague.com)",
        )
    )

    cookie = auth.get_cookie()
    if not cookie:
        checks.append(
            Check(
                "Cookie",
                FAIL,
                "ikke satt",
                "fplbot cookie --set \"<Cookie-headeren fra nettleseren>\"",
            )
        )
    else:
        api_probe = FplApi(cookie=cookie, use_cache=False)
        if api_probe.cookie_value("csrftoken"):
            checks.append(Check("Cookie", OK, "satt, med csrftoken"))
        else:
            checks.append(
                Check(
                    "Cookie",
                    FAIL,
                    "mangler csrftoken, og FPL avviser innsending uten den",
                    "Kopier hele Cookie-headeren på nytt, ikke bare deler av den",
                )
            )

    api = FplApi(cookie=cookie, use_cache=False)
    try:
        bootstrap = api.bootstrap()
        checks.append(
            Check("FPL-API", OK, f"svarer, {len(bootstrap['elements'])} spillere")
        )
    except FplError as exc:
        checks.append(Check("FPL-API", FAIL, str(exc)[:80], "Sjekk nettverk eller prøv igjen"))
        return checks

    # Selve prøven på om cookien fortsatt gjelder.
    if cookie and entry_id:
        try:
            team = api.my_team(entry_id)
            picks = team.get("picks", [])
            transfers = team.get("transfers", {})
            if len(picks) == 15:
                checks.append(
                    Check(
                        "Innlogget tilgang",
                        OK,
                        f"leser troppen din ({transfers.get('limit', '?')} gratis bytter, "
                        f"{transfers.get('bank', 0) / 10:.1f}m i banken)",
                    )
                )
            else:
                checks.append(
                    Check("Innlogget tilgang", WARN, f"fikk {len(picks)} spillere, ventet 15")
                )
        except FplError as exc:
            checks.append(
                Check(
                    "Innlogget tilgang",
                    FAIL,
                    f"kommer ikke inn ({str(exc)[:60]})",
                    "Cookien har trolig gått ut. Hent en ny fra nettleseren.",
                )
            )

    next_event = next(
        (e for e in bootstrap["events"] if e.get("is_next")),
        bootstrap["events"][-1],
    )
    hours = deadline.hours_until(next_event.get("deadline_time", ""))
    if hours < 0:
        checks.append(Check("Neste frist", WARN, f"GW{next_event['id']} har passert"))
    else:
        inside = hours <= within_hours
        checks.append(
            Check(
                "Neste frist",
                OK,
                f"GW{next_event['id']} om {hours:.1f} timer"
                + (" - autopiloten ville handlet nå" if inside else " - utenfor vinduet"),
            )
        )

    return checks


def report(checks: list[Check]) -> str:
    lines = ["Sjekker at boten kan styre laget ditt:", ""]
    lines.extend(check.line() for check in checks)
    failures = [c for c in checks if c.status == FAIL]
    lines.append("")
    if failures:
        lines.append(
            f"{len(failures)} ting er brutt. Autopiloten vil ikke røre laget ditt "
            "før de er rettet."
        )
    else:
        warnings = [c for c in checks if c.status == WARN]
        tail = f" {len(warnings)} advarsel(er) verdt et blikk." if warnings else ""
        lines.append("Alt henger sammen." + tail)
    return "\n".join(lines)


def has_failures(checks: list[Check]) -> bool:
    return any(check.status == FAIL for check in checks)
