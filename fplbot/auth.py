"""Innlogging og innsending til FPL.

FPL sitt innloggingsskjema ligger bak Cloudflare, så vi logger ikke inn med
brukernavn og passord. I stedet gjenbruker vi en sesjonscookie du henter fra
nettleseren din. Slik gjør du det:

  1. Logg inn på fantasy.premierleague.com i nettleseren.
  2. Åpne utviklerverktøy -> Network, oppdater siden, klikk et kall til
     /api/ og kopier hele "Cookie"-headeren.
  3. Lagre den: fplbot cookie --set "<cookie>"  (eller sett FPL_COOKIE).

Cookien er personlig og gir full tilgang til laget ditt. Den lagres lokalt med
filrettigheter 600 og skal ikke sjekkes inn i git.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("FPLBOT_CONFIG_DIR", Path.home() / ".config" / "fplbot"))
CONFIG_FILE = CONFIG_DIR / "config.json"


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def save_config(config: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    CONFIG_FILE.chmod(0o600)


def get_cookie() -> str | None:
    return os.environ.get("FPL_COOKIE") or load_config().get("cookie")


def set_cookie(cookie: str) -> None:
    config = load_config()
    config["cookie"] = cookie.strip()
    save_config(config)


def get_entry_id() -> int | None:
    value = os.environ.get("FPL_ENTRY_ID") or load_config().get("entry_id")
    return int(value) if value else None


def set_entry_id(entry_id: int) -> None:
    config = load_config()
    config["entry_id"] = int(entry_id)
    save_config(config)


def build_transfer_payload(
    entry_id: int,
    event: int,
    moves: list[tuple[int, int, int, int]],
    chip: str | None = None,
) -> dict:
    """Bygger payload for POST /api/transfers/.

    moves er (element_out, element_in, selling_price, purchase_price) med
    priser i tideler av millioner.
    """
    return {
        "chip": chip,
        "entry": entry_id,
        "event": event,
        "transfers": [
            {
                "element_in": element_in,
                "element_out": element_out,
                "purchase_price": purchase_price,
                "selling_price": selling_price,
            }
            for element_out, element_in, selling_price, purchase_price in moves
        ],
    }


def build_lineup_payload(
    starters: list[int],
    bench: list[int],
    captain: int,
    vice_captain: int,
    chip: str | None = None,
) -> dict:
    """Bygger payload for POST /api/my-team/{entry_id}/.

    Plass 1-11 er de som starter, 12-15 er benken i rekkefølge.
    """
    picks = []
    for index, element in enumerate(list(starters) + list(bench), start=1):
        picks.append(
            {
                "element": element,
                "position": index,
                "is_captain": element == captain,
                "is_vice_captain": element == vice_captain,
            }
        )
    payload: dict = {"picks": picks}
    if chip:
        payload["chip"] = chip
    return payload
