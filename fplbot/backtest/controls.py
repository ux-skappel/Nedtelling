"""Kontrollforsøk som viser om resultatet kommer fra modellen eller fra riggen.

Revisjonen i audit.py kontrollerer at tallene i hvert snapshot er summen av de
rundene som var spilt. Men den kan bare fange lekkasje den vet hvordan den skal
lete etter. Disse kontrollene angriper spørsmålet fra utsiden i stedet, ved å
bytte ut modellens anslag og se hva som skjer med poengene:

* **Terningkast** gir tilfeldige anslag. Scorer riggen like høyt med dem, kommer
  poengene fra riggen og ikke fra modellen.
* **Fasit** lar modellen se rundens faktiske poeng. Den skal score voldsomt.
  Uten dette utslaget vet vi ikke om vi i det hele tatt er i stand til å oppdage
  at noen kikker framover.

Ekte modell mellom de to, med god margin til begge, er det vi vil se.
"""

from __future__ import annotations

import random

from ..model import ProjectionModel
from .history import Season

# Grovt spennet en spillers rundepoeng ligger i, brukt til terningkastet.
RANDOM_RANGE = (0.0, 6.0)


def scrambled(seed: int = 0):
    """Erstatter alle anslag med tilfeldige tall.

    Troppen blir da satt uten informasjon i det hele tatt. Det er gulvet: alt
    over dette må modellen ha fortjent.
    """
    rng = random.Random(seed)

    def override(model: ProjectionModel, event: int, season: Season) -> None:
        for player in model.players.values():
            for gameweek in player.xp:
                player.xp[gameweek] = rng.uniform(*RANDOM_RANGE)

    return override


def oracle():
    """Gir modellen rundens faktiske poeng som anslag.

    Dette *er* lekkasje, med vilje. Utslaget viser hvordan et resultat med
    framtidskunnskap ser ut, så vi vet hva vi leter etter.
    """

    def override(model: ProjectionModel, event: int, season: Season) -> None:
        for player in model.players.values():
            for gameweek in list(player.xp):
                player.xp[gameweek] = float(season.actual_points(player.id, gameweek))

    return override


def price_only():
    """Anslag som bare følger prisen.

    Et mellomledd: pris er kjent på forhånd og bærer ekte informasjon, men
    ingenting om form eller kampprogram.
    """

    def override(model: ProjectionModel, event: int, season: Season) -> None:
        for player in model.players.values():
            for gameweek in player.xp:
                player.xp[gameweek] = player.cost / 20.0

    return override


CONTROLS = {
    "terningkast": scrambled,
    "pris": price_only,
    "fasit": oracle,
}
