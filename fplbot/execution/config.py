"""Konfigurasjon for autonom drift.

To brytere styrer alt, og de er bevisst adskilte:

    AUTONOMY_MODE   Har boten lov til å handle på egen hånd i det hele tatt?
    DRY_RUN         Kjør hele kjeden, men ikke skriv til FPL.

`DRY_RUN` står på som standard. Det skal være et aktivt valg å la boten skrive
til laget, ikke noe som skjer fordi en variabel ikke ble satt.

Ingen legitimasjon leses herfra. Cookie og lag-ID hentes av `fplbot.auth` fra
miljøvariabler eller den lokale konfigfila, aldri fra repoet.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

STATE_DIR = Path(
    os.environ.get("FPLBOT_STATE_DIR", Path.home() / ".local" / "state" / "fplbot")
)


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "on", "yes", "ja"}


def _number(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass
class Settings:
    # Hovedbryterne.
    autonomy: bool = False
    dry_run: bool = True

    # Hvor nær fristen boten regner seg som "i vinduet" og kan skrive.
    execution_window_hours: float = 1.5
    # Oppstillingen er reversibel og kan settes tidligere og oftere.
    lineup_window_hours: float = 30.0

    # Katastrofesikring, ikke strategi. Et hit større enn dette utføres aldri
    # autonomt, uansett hva optimereren mener. Standard tilsvarer ett bytte
    # utover de gratis.
    max_autonomous_hit: int = 4
    # Et hit krever eksplisitt modellstøtte utover selve kostnaden.
    hit_safety_margin: float = 2.0
    # Minste netto gevinst over horisonten før et bytte i det hele tatt gjøres.
    min_transfer_gain: float = 1.0

    # Chips er sjeldne og svært irreversible, så de har en strengere port.
    allow_chips: bool = True
    chip_min_advantage: float = 6.0
    # Chips aktiveres bare helt inntil fristen, når informasjonen er ferskest.
    chip_window_hours: float = 2.0

    # Data eldre enn dette regnes som foreldet rett før en skriving.
    max_data_age_seconds: int = 900

    horizon: int = 6
    max_transfers: int = 2
    min_availability: float = 0.75

    action_log: Path = field(default_factory=lambda: STATE_DIR / "actions.jsonl")

    @property
    def writes_enabled(self) -> bool:
        """Skal denne kjøringen faktisk sende noe til FPL?"""
        return self.autonomy and not self.dry_run

    def describe(self) -> str:
        if not self.autonomy:
            return "RÅDGIVENDE (autonomi av)"
        if self.dry_run:
            return "TØRRKJØRING (autonomi på, skriving av)"
        return "AUTONOM (skriver til FPL)"


def load_settings() -> Settings:
    """Leser konfigurasjonen fra miljøet.

    `FPL_AUTONOMY_MODE=true` og `FPL_DRY_RUN=false` er kombinasjonen som gir
    ekte autonom drift. Alt annet er trygt.
    """
    settings = Settings(
        autonomy=_flag("FPL_AUTONOMY_MODE", False),
        dry_run=_flag("FPL_DRY_RUN", True),
        execution_window_hours=_number("FPL_EXECUTION_WINDOW_HOURS", 1.5),
        lineup_window_hours=_number("FPL_LINEUP_WINDOW_HOURS", 30.0),
        max_autonomous_hit=int(_number("FPL_MAX_AUTONOMOUS_HIT", 4)),
        hit_safety_margin=_number("FPL_HIT_SAFETY_MARGIN", 2.0),
        min_transfer_gain=_number("FPL_MIN_TRANSFER_GAIN", 1.0),
        allow_chips=_flag("FPL_ALLOW_CHIPS", True),
        chip_min_advantage=_number("FPL_CHIP_MIN_ADVANTAGE", 6.0),
        chip_window_hours=_number("FPL_CHIP_WINDOW_HOURS", 2.0),
        max_data_age_seconds=int(_number("FPL_MAX_DATA_AGE_SECONDS", 900)),
        horizon=int(_number("FPL_HORIZON", 6)),
        max_transfers=int(_number("FPL_MAX_TRANSFERS", 2)),
        min_availability=_number("FPL_MIN_AVAILABILITY", 0.75),
    )
    log_path = os.environ.get("FPLBOT_ACTION_LOG")
    if log_path:
        settings.action_log = Path(log_path)
    return settings
