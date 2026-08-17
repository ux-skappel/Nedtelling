"""Permanent handlingslogg.

Én linje JSON per hendelse, aldri overskrevet. Loggen har to jobber:

1. **Revisjon.** Det skal i ettertid være mulig å rekonstruere nøyaktig hvorfor
   boten gjorde noe: hvilken modell, hvilke data, hvilken doctor-status, hva den
   trodde den ville tjene, og hva FPL svarte.
2. **Idempotens, sekundært.** Har handlingen alt en linje med `SUCCESS`, gjøres
   den ikke om igjen.

Loggen er den sekundære garantien, ikke den primære. Kjører boten i en
midlertidig container kan filen forsvinne, og da er det kontrollen mot FPL sin
faktiske tilstand som redder oss. Begge finnes fordi de svikter på hver sin måte.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .actions import Action

SUCCESS = "SUCCESS"
FAILED = "FAILED"
SKIPPED = "SKIPPED"
DRY_RUN = "DRY_RUN"
BLOCKED = "BLOCKED"


class ActionLog:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def _entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        rows = []
        for line in self.path.read_text(encoding="utf8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                # En halvskrevet linje skal ikke gjøre hele loggen ubrukelig.
                continue
        return rows

    def already_done(self, action: Action) -> bool:
        return any(
            row.get("action_id") == action.action_id and row.get("status") == SUCCESS
            for row in self._entries()
        )

    def transfers_this_event(self, event: int) -> list[dict]:
        return [
            row
            for row in self._entries()
            if row.get("event") == event
            and row.get("kind") == "TRANSFER"
            and row.get("status") == SUCCESS
        ]

    def chip_played(self, event: int, chip: str) -> bool:
        return any(
            row.get("event") == event
            and row.get("chip") == chip
            and row.get("status") == SUCCESS
            for row in self._entries()
        )

    def record(
        self,
        action: Action,
        status: str,
        context: dict | None = None,
        verification: dict | None = None,
        response: str | None = None,
    ) -> dict:
        entry = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": status,
            **action.to_dict(),
            "context": context or {},
            "verification": verification,
            "response": (response or "")[:500],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        return entry

    def tail(self, count: int = 10) -> list[dict]:
        return self._entries()[-count:]
