"""Handlinger som kan skrives til FPL, med stabil identitet.

Hver handling får en ID som er utledet av *innholdet*, ikke av klokka. Det er
med vilje: kjører planleggeren to ganger på samme beslutning, får den samme ID
begge ganger, og den andre kjøringen kan se i loggen at jobben er gjort.

    GW02-TRANSFER-9f2c1a4b7e05

Hadde ID-en inneholdt et tidsstempel, ville to kjøringer fått hver sin ID og
idempotensen vært verdiløs.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum


class ActionKind(str, Enum):
    TRANSFER = "TRANSFER"
    LINEUP = "LINEUP"
    CHIP = "CHIP"


@dataclass
class Action:
    kind: ActionKind
    event: int
    payload: dict
    # Menneskelesbar beskrivelse, for loggen og statusmeldingen.
    summary: str = ""
    # Hva modellen mente handlingen var verdt, over horisonten.
    predicted_gain: float = 0.0
    hit_cost: int = 0
    chip: str | None = None
    details: dict = field(default_factory=dict)

    @property
    def action_id(self) -> str:
        digest = hashlib.sha256(
            json.dumps(self.payload, sort_keys=True, separators=(",", ":")).encode("utf8")
        ).hexdigest()[:12]
        return f"GW{self.event:02d}-{self.kind.value}-{digest}"

    @property
    def irreversible(self) -> bool:
        """Oppstillingen kan settes om igjen fram til fristen. Resten kan ikke."""
        return self.kind is not ActionKind.LINEUP

    def to_dict(self) -> dict:
        return {
            "action_id": self.action_id,
            "kind": self.kind.value,
            "event": self.event,
            "summary": self.summary,
            "predicted_gain": round(self.predicted_gain, 3),
            "hit_cost": self.hit_cost,
            "chip": self.chip,
            "details": self.details,
        }


def transfer_action(
    entry_id: int,
    event: int,
    moves: list[tuple[int, int, int, int]],
    names: list[tuple[str, str]],
    predicted_gain: float,
    hit_cost: int,
    chip: str | None = None,
) -> Action:
    from ..auth import build_transfer_payload

    return Action(
        kind=ActionKind.TRANSFER,
        event=event,
        payload=build_transfer_payload(entry_id, event, moves, chip=chip),
        summary=", ".join(f"{out} -> {into}" for out, into in names),
        predicted_gain=predicted_gain,
        hit_cost=hit_cost,
        chip=chip,
        details={
            "out": [m[0] for m in moves],
            "in": [m[1] for m in moves],
            "names": names,
        },
    )


def lineup_action(
    event: int,
    starters: list[int],
    bench: list[int],
    captain: int,
    vice: int,
    names: dict[int, str],
    predicted_gain: float = 0.0,
    chip: str | None = None,
) -> Action:
    from ..auth import build_lineup_payload

    return Action(
        kind=ActionKind.LINEUP,
        event=event,
        payload=build_lineup_payload(starters, bench, captain, vice, chip=chip),
        summary=f"C {names.get(captain, captain)}, V {names.get(vice, vice)}",
        predicted_gain=predicted_gain,
        chip=chip,
        details={
            "starters": starters,
            "bench": bench,
            "captain": captain,
            "vice": vice,
            "bench_names": [names.get(e, str(e)) for e in bench],
        },
    )
