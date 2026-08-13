"""Revisjon av snapshotene: leter etter data som har lekket bakover i tid.

Hele backtesten hviler på én antakelse: at modellen aldri fikk se noe fra
runden den skulle spille. En enkelt enhetstest er tynt belegg for noe så
avgjørende, så denne modulen gjør det motsatte av å stole på koden - den
regner ut fasiten på nytt, uavhengig av `Season._aggregate`, og sammenlikner.

Går revisjonen gjennom for alle 38 runder, er alle tall i hvert snapshot
etterprøvd mot en separat opptelling av nøyaktig de rundene som var spilt.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .history import Season

# Felt i snapshotet som skal kunne gjenskapes ved å telle opp tidligere runder.
SUMMED_FIELDS = {
    "minutes": lambda row: row.minutes,
    "starts": lambda row: row.starts,
    "total_points": lambda row: row.points,
    "bonus": lambda row: row.bonus,
    "yellow_cards": lambda row: row.yellow_cards,
}


@dataclass
class AuditReport:
    season: str
    events_checked: int = 0
    elements_checked: int = 0
    findings: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not self.findings

    def summary(self) -> str:
        head = (
            f"{self.season}: {self.events_checked} runder, "
            f"{self.elements_checked} spiller-snapshots kontrollert"
        )
        if self.clean:
            return f"{head}\n  Ingen lekkasje funnet."
        lines = [head, f"  {len(self.findings)} funn:"]
        lines.extend(f"    - {finding}" for finding in self.findings[:20])
        if len(self.findings) > 20:
            lines.append(f"    ... og {len(self.findings) - 20} til")
        return "\n".join(lines)


def audit_event(season: Season, event: int, report: AuditReport) -> None:
    """Kontrollerer ett snapshot mot en uavhengig opptelling."""
    bootstrap, fixtures = season.snapshot(event)

    # 1. Regn ut fasiten på nytt, rett fra radene, uten å gå via snapshot-koden.
    expected: dict[int, dict[str, float]] = {}
    for row in season.rows:
        if row.event >= event:
            continue
        entry = expected.setdefault(row.element, dict.fromkeys(SUMMED_FIELDS, 0.0))
        for name, extract in SUMMED_FIELDS.items():
            entry[name] += extract(row)

    for element in bootstrap["elements"]:
        report.elements_checked += 1
        truth = expected.get(element["id"])
        if truth is None:
            report.findings.append(
                f"GW{event}: spiller {element['id']} er med i snapshotet, "
                "men har ikke spilt en eneste tidligere runde"
            )
            continue
        for name in SUMMED_FIELDS:
            if abs(float(element[name]) - truth[name]) > 1e-6:
                report.findings.append(
                    f"GW{event}: {element['web_name']} har {name}={element[name]}, "
                    f"men summen av rundene før er {truth[name]:g}"
                )

    # 2. Ingen kamp fra denne runden eller senere får ha et resultat.
    for fixture in fixtures:
        if fixture.get("event") is not None and fixture["event"] < event:
            continue
        if fixture.get("finished"):
            report.findings.append(f"GW{event}: kamp {fixture['id']} er merket ferdigspilt")
        if fixture.get("team_h_score") is not None or fixture.get("team_a_score") is not None:
            report.findings.append(f"GW{event}: kamp {fixture['id']} har resultat")

    # 3. Rundetabellen må ikke påstå at noe fra nå av er spilt.
    for entry in bootstrap["events"]:
        if entry["id"] >= event and entry.get("finished"):
            report.findings.append(f"GW{event}: runde {entry['id']} er merket ferdigspilt")

    report.events_checked += 1


def audit_season(season: Season, start_event: int = 2) -> AuditReport:
    """Går gjennom alle rundene i en sesong.

    Runde 1 hoppes over: der er snapshotet enten tomt eller bygget av forrige
    sesong, og har ingen inneværende runder å telle opp.
    """
    report = AuditReport(season=season.season)
    for event in range(start_event, max(season.events) + 1):
        audit_event(season, event, report)
    return report
