"""Execution-laget: det eneste stedet i koden som skriver til FPL.

Beslutningsmotoren regner ut hva som bør gjøres. Den skriver aldri selv. Alt
som er irreversibelt går gjennom denne kjeden:

    DATA -> FORECAST -> DECISION -> VALIDATION -> EXECUTION -> VERIFICATION

Skillet er poenget. En feil i modellen skal kunne gi et dårlig bytte; den skal
ikke kunne gi et bytte som bryter reglene, gjøres to ganger, eller utføres på
en tropp som har endret seg siden beslutningen ble tatt.
"""

from .actions import Action, ActionKind
from .config import Settings, load_settings
from .log import ActionLog

__all__ = ["Action", "ActionKind", "ActionLog", "Settings", "load_settings"]
