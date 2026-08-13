"""Forventede mål utledet fra bookmakerodds.

Odds er det skarpeste anslaget som finnes på hvordan en kamp kommer til å gå -
markedet priser inn skader, rotasjon og form lenge før statistikken gjør det.
Modulen er valgfri: uten API-nøkkel er den bare avslått, og boten går videre på
ratingene den fitter selv.

Nøkkel hentes gratis på the-odds-api.com og settes med FPL_ODDS_API_KEY.

Merk: denne modulen er skrevet mot v4-formatet til the-odds-api, men er ikke
kjørt mot et ekte svar - jeg hadde ingen nøkkel å teste med. Sjekk resultatet
med 'fplbot odds' før du stoler på det.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import requests

API_BASE = "https://api.the-odds-api.com/v4"
SPORT = "soccer_epl"
# Navnene bookmakerne bruker stemmer ikke alltid med FPL sine.
NAME_ALIASES = {
    "brighton and hove albion": "brighton",
    "tottenham hotspur": "spurs",
    "wolverhampton wanderers": "wolves",
    "nottingham forest": "nott'm forest",
    "manchester city": "man city",
    "manchester united": "man utd",
    "newcastle united": "newcastle",
    "west ham united": "west ham",
    "leeds united": "leeds",
    "afc bournemouth": "bournemouth",
}


@dataclass
class MatchOdds:
    home: str
    away: str
    home_goals: float
    away_goals: float


def api_key() -> str | None:
    return os.environ.get("FPL_ODDS_API_KEY")


def normalise(name: str) -> str:
    name = name.strip().lower()
    return NAME_ALIASES.get(name, name)


def implied_probabilities(prices: dict[str, float]) -> dict[str, float]:
    """Fjerner bookmakerens margin fra desimalodds."""
    raw = {outcome: 1.0 / price for outcome, price in prices.items() if price > 0}
    total = sum(raw.values())
    if total <= 0:
        return {}
    return {outcome: value / total for outcome, value in raw.items()}


def split_goals(total_goals: float, home_win: float, away_win: float) -> tuple[float, float]:
    """Fordeler forventede totalmål mellom lagene ut fra hvem som er favoritt.

    Overvekten til favoritten skaleres av hvor stor forskjellen i vinnersjanse
    er; en jevn kamp deler målene likt.
    """
    edge = max(-0.9, min(0.9, home_win - away_win))
    home_share = 0.5 + 0.35 * edge
    return total_goals * home_share, total_goals * (1 - home_share)


def fetch_odds(regions: str = "uk", timeout: int = 20) -> list[MatchOdds]:
    """Henter h2h- og totals-markedene og gjør dem om til forventede mål."""
    key = api_key()
    if not key:
        return []

    response = requests.get(
        f"{API_BASE}/sports/{SPORT}/odds",
        params={
            "apiKey": key,
            "regions": regions,
            "markets": "h2h,totals",
            "oddsFormat": "decimal",
        },
        timeout=timeout,
    )
    response.raise_for_status()

    matches: list[MatchOdds] = []
    for event in response.json():
        home_name = event.get("home_team", "")
        away_name = event.get("away_team", "")
        h2h: dict[str, float] = {}
        totals: list[tuple[float, float, float]] = []

        for bookmaker in event.get("bookmakers", []):
            for market in bookmaker.get("markets", []):
                outcomes = market.get("outcomes", [])
                if market.get("key") == "h2h":
                    for outcome in outcomes:
                        name = outcome.get("name", "")
                        price = outcome.get("price", 0.0)
                        h2h.setdefault(name, price)
                elif market.get("key") == "totals":
                    over = next((o for o in outcomes if o.get("name") == "Over"), None)
                    under = next((o for o in outcomes if o.get("name") == "Under"), None)
                    if over and under and over.get("point") is not None:
                        totals.append((over["point"], over.get("price", 0), under.get("price", 0)))

        if not h2h or not totals:
            continue

        probabilities = implied_probabilities(h2h)
        home_win = probabilities.get(home_name, 0.33)
        away_win = probabilities.get(away_name, 0.33)
        total_goals = _expected_total(totals)
        home_goals, away_goals = split_goals(total_goals, home_win, away_win)
        matches.append(
            MatchOdds(
                home=normalise(home_name),
                away=normalise(away_name),
                home_goals=home_goals,
                away_goals=away_goals,
            )
        )
    return matches


def _expected_total(totals: list[tuple[float, float, float]]) -> float:
    """Anslår forventede totalmål fra over/under-linjene.

    Linja der over og under er nærmest like priset ligger nærmest medianen, og
    justeres litt etter hvilken vei markedet heller.
    """
    best_line, best_gap, tilt = 2.5, 99.0, 0.0
    for point, over_price, under_price in totals:
        probabilities = implied_probabilities({"over": over_price, "under": under_price})
        if not probabilities:
            continue
        gap = abs(probabilities["over"] - 0.5)
        if gap < best_gap:
            best_gap, best_line = gap, point
            tilt = probabilities["over"] - 0.5
    return best_line + 1.5 * tilt


def strength_overrides(
    matches: list[MatchOdds], team_names: dict[int, str]
) -> dict[tuple[int, int], tuple[float, float]]:
    """Kobler oddsene til FPL sine lag-ID-er: (hjemme, borte) -> (mål, mål)."""
    by_name = {normalise(name): team_id for team_id, name in team_names.items()}
    overrides: dict[tuple[int, int], tuple[float, float]] = {}
    for match in matches:
        home = by_name.get(match.home)
        away = by_name.get(match.away)
        if home and away:
            overrides[(home, away)] = (match.home_goals, match.away_goals)
    return overrides
