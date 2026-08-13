"""Lagstyrke estimert fra faktiske resultater.

FPL sin egen FDR er en grov skala fra 1 til 5 som er satt før sesongen og
sjelden oppdateres. Her fitter vi i stedet angreps- og forsvarsstyrke for hvert
lag direkte på målene som er scoret så langt, med en Poisson-modell:

    forventede mål hjemme = mu * angrep[hjemmelag] * forsvar[bortelag] * hjemmefordel
    forventede mål borte  = mu * angrep[bortelag]  * forsvar[hjemmelag]

Ratingene løses med iterativ skalering. Tidlig i sesongen finnes det knapt
kamper å fitte på, så ratingene krympes mot det FDR-en antyder - og før
sesongstart er de identiske med FDR.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import scoring

# Snitt antall mål et lag scorer i en Premier League-kamp.
LEAGUE_GOALS_PER_TEAM = 1.42
HOME_ADVANTAGE = 1.14
# Hvor mange kamper som skal til før ratingene står på egne ben.
STRENGTH_SHRINK_GAMES = 6.0
# Vekt per gameweek bakover i tid; ca. halv vekt etter 10 runder.
RECENCY_DECAY = 0.93
FIT_ITERATIONS = 60


@dataclass
class TeamStrength:
    """Angreps- og forsvarsrating per lag, der 1.0 er en gjennomsnittsklubb."""

    attack: dict[int, float] = field(default_factory=dict)
    defence: dict[int, float] = field(default_factory=dict)
    games: dict[int, float] = field(default_factory=dict)

    def expected_goals(
        self, team: int, opponent: int, is_home: bool, difficulty: int
    ) -> tuple[float, float]:
        """Forventede mål (scoret, sluppet inn) for laget i denne kampen."""
        attack = self.attack.get(team, 1.0)
        defence = self.defence.get(team, 1.0)
        opponent_attack = self.attack.get(opponent, 1.0)
        opponent_defence = self.defence.get(opponent, 1.0)

        scored = LEAGUE_GOALS_PER_TEAM * attack * opponent_defence
        conceded = LEAGUE_GOALS_PER_TEAM * opponent_attack * defence
        if is_home:
            scored *= HOME_ADVANTAGE
        else:
            conceded *= HOME_ADVANTAGE

        # Krymp mot FDR så lenge vi har sett lite av laget.
        played = min(self.games.get(team, 0.0), self.games.get(opponent, 0.0))
        weight = played / (played + STRENGTH_SHRINK_GAMES)
        fdr_scored, fdr_conceded = fdr_expected_goals(difficulty, is_home)
        scored = weight * scored + (1 - weight) * fdr_scored
        conceded = weight * conceded + (1 - weight) * fdr_conceded
        return max(0.15, scored), max(0.15, conceded)


def fdr_expected_goals(difficulty: int, is_home: bool) -> tuple[float, float]:
    """Oversetter FDR til forventede mål, som holdepunkt før vi har resultater."""
    conceded = scoring.fdr_lookup(scoring.CONCEDED_BY_FDR, difficulty)
    scored = LEAGUE_GOALS_PER_TEAM * scoring.fdr_lookup(scoring.ATTACK_BY_FDR, difficulty)
    if is_home:
        scored *= scoring.HOME_ATTACK_BOOST
        conceded *= 0.92
    else:
        scored *= scoring.AWAY_ATTACK_BOOST
        conceded *= 1.08
    return scored, conceded


def fit_team_strength(fixtures: list[dict], teams: list[int], current_event: int) -> TeamStrength:
    """Fitter ratinger på ferdigspilte kamper med iterativ skalering."""
    played = [
        f
        for f in fixtures
        if f.get("finished") and f.get("team_h_score") is not None and f.get("event")
    ]
    strength = TeamStrength(
        attack=dict.fromkeys(teams, 1.0),
        defence=dict.fromkeys(teams, 1.0),
        games=dict.fromkeys(teams, 0.0),
    )
    if not played:
        return strength

    # Nyere kamper skal veie mer enn kamper fra august.
    weights = []
    for fixture in played:
        age = max(0, current_event - fixture["event"])
        weights.append(RECENCY_DECAY**age)
    for fixture, weight in zip(played, weights, strict=True):
        strength.games[fixture["team_h"]] = strength.games.get(fixture["team_h"], 0.0) + weight
        strength.games[fixture["team_a"]] = strength.games.get(fixture["team_a"], 0.0) + weight

    for _ in range(FIT_ITERATIONS):
        # Angrepsrating: scorede mål delt på hva ratingene forventer.
        scored: dict[int, float] = dict.fromkeys(teams, 0.0)
        expected_scored: dict[int, float] = dict.fromkeys(teams, 0.0)
        conceded: dict[int, float] = dict.fromkeys(teams, 0.0)
        expected_conceded: dict[int, float] = dict.fromkeys(teams, 0.0)

        for fixture, weight in zip(played, weights, strict=True):
            home, away = fixture["team_h"], fixture["team_a"]
            goals_home = fixture["team_h_score"]
            goals_away = fixture["team_a_score"]
            lambda_home = (
                LEAGUE_GOALS_PER_TEAM
                * strength.attack[home]
                * strength.defence[away]
                * HOME_ADVANTAGE
            )
            lambda_away = LEAGUE_GOALS_PER_TEAM * strength.attack[away] * strength.defence[home]

            scored[home] += weight * goals_home
            scored[away] += weight * goals_away
            expected_scored[home] += weight * lambda_home
            expected_scored[away] += weight * lambda_away
            conceded[home] += weight * goals_away
            conceded[away] += weight * goals_home
            expected_conceded[home] += weight * lambda_away
            expected_conceded[away] += weight * lambda_home

        for team in teams:
            if expected_scored[team] > 0:
                ratio = scored[team] / expected_scored[team]
                strength.attack[team] *= ratio**0.5  # halve skritt for å unngå svingninger
            if expected_conceded[team] > 0:
                ratio = conceded[team] / expected_conceded[team]
                strength.defence[team] *= ratio**0.5

        # Hold gjennomsnittet på 1.0 slik at ratingene er sammenliknbare.
        _normalise(strength.attack)
        _normalise(strength.defence)

    return strength


def _normalise(ratings: dict[int, float]) -> None:
    if not ratings:
        return
    mean = sum(ratings.values()) / len(ratings)
    if mean <= 0:
        return
    for team in ratings:
        ratings[team] = max(0.35, min(2.6, ratings[team] / mean))
