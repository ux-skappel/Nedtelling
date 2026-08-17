"""Et øyeblikksbilde av laget slik FPL har det akkurat nå.

Beslutningen tas på ett tidspunkt og skrives på et annet. Mellom dem kan alt ha
endret seg: prisen på en spiller, banken, antall gratis bytter, eller hva laget
består av (du kan ha gjort et bytte selv fra mobilen). Derfor hentes tilstanden
på nytt rett før skriving og sammenliknes mot den beslutningen ble laget fra.

Avviker de på noe som betyr noe, forkastes beslutningen i stedet for å tvinges
gjennom.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from ..api import FplApi


@dataclass(frozen=True)
class Pick:
    element: int
    position: int
    is_captain: bool
    is_vice_captain: bool
    selling_price: int
    purchase_price: int


@dataclass
class TeamState:
    entry_id: int
    event: int
    picks: list[Pick]
    bank: int
    free_transfers: int
    chips_played: list[str]
    chips_available: list[str]
    active_chip: str | None
    fetched_at: float = field(default_factory=time.time)

    @property
    def element_ids(self) -> set[int]:
        return {p.element for p in self.picks}

    @property
    def selling_prices(self) -> dict[int, int]:
        return {p.element: p.selling_price for p in self.picks}

    @property
    def captain(self) -> int | None:
        return next((p.element for p in self.picks if p.is_captain), None)

    @property
    def vice(self) -> int | None:
        return next((p.element for p in self.picks if p.is_vice_captain), None)

    @property
    def starters(self) -> list[int]:
        return [p.element for p in sorted(self.picks, key=lambda x: x.position)[:11]]

    @property
    def bench(self) -> list[int]:
        return [p.element for p in sorted(self.picks, key=lambda x: x.position)[11:]]

    def age_seconds(self) -> float:
        return time.time() - self.fetched_at

    def differences(self, other: TeamState) -> list[str]:
        """Hva har endret seg som gjør en gammel beslutning ugyldig?

        Rekkefølgen på benken teller ikke - den er hele poenget med å skrive en
        ny oppstilling. Troppen, pengene og byttene teller.
        """
        problems = []
        if self.event != other.event:
            problems.append(f"runde endret: GW{self.event} -> GW{other.event}")
        if self.element_ids != other.element_ids:
            gone = self.element_ids - other.element_ids
            new = other.element_ids - self.element_ids
            problems.append(f"troppen er endret (ut: {sorted(gone)}, inn: {sorted(new)})")
        if self.bank != other.bank:
            problems.append(f"banken endret: {self.bank} -> {other.bank}")
        if self.free_transfers != other.free_transfers:
            problems.append(
                f"gratis bytter endret: {self.free_transfers} -> {other.free_transfers}"
            )
        if set(self.chips_played) != set(other.chips_played):
            problems.append("chipstatus er endret")
        changed_prices = [
            p.element
            for p in self.picks
            for q in other.picks
            if p.element == q.element and p.selling_price != q.selling_price
        ]
        if changed_prices:
            problems.append(f"salgsprisen er endret for {sorted(changed_prices)}")
        return problems


def fetch_team_state(api: FplApi, entry_id: int, event: int) -> TeamState:
    """Henter laget fra det innloggede endepunktet. Aldri fra mellomlager."""
    data = api.my_team(entry_id)
    transfers = data.get("transfers", {})
    chips = data.get("chips", [])
    picks = [
        Pick(
            element=p["element"],
            position=p["position"],
            is_captain=bool(p.get("is_captain")),
            is_vice_captain=bool(p.get("is_vice_captain")),
            selling_price=p.get("selling_price", 0),
            purchase_price=p.get("purchase_price", 0),
        )
        for p in data["picks"]
    ]
    return TeamState(
        entry_id=entry_id,
        event=event,
        picks=picks,
        bank=transfers.get("bank", 0),
        free_transfers=transfers.get("limit") or 1,
        chips_played=[c["name"] for c in chips if c.get("status_for_entry") == "played"],
        chips_available=[c["name"] for c in chips if c.get("status_for_entry") == "available"],
        active_chip=next(
            (c["name"] for c in chips if c.get("status_for_entry") == "active"), None
        ),
    )
