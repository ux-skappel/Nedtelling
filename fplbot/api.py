"""Klient mot det offentlige Fantasy Premier League-API-et.

Alle GET-kall caches på disk slik at gjentatte kjøringer ikke hamrer på FPL sine
servere. Endepunkter som krever innlogging (my-team, transfers, lineup) tar en
cookie-streng; se auth.py.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import requests

BASE = "https://fantasy.premierleague.com/api"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

DEFAULT_CACHE_DIR = Path(
    os.environ.get("FPLBOT_CACHE_DIR", Path.home() / ".cache" / "fplbot")
)


class FplError(RuntimeError):
    """Feil fra FPL-API-et."""


class FplApi:
    def __init__(
        self,
        cache_dir: Path | str = DEFAULT_CACHE_DIR,
        ttl: int = 3600,
        cookie: str | None = None,
        use_cache: bool = True,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.ttl = ttl
        self.use_cache = use_cache
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
        if cookie:
            self.session.headers["Cookie"] = cookie
        self._memo: dict[str, Any] = {}

    # ------------------------------------------------------------------ intern

    def _cache_path(self, path: str) -> Path:
        name = path.strip("/").replace("/", "_") or "root"
        return self.cache_dir / f"{name}.json"

    def _get(self, path: str, ttl: int | None = None) -> Any:
        if path in self._memo:
            return self._memo[path]

        ttl = self.ttl if ttl is None else ttl
        cache_file = self._cache_path(path)
        fresh = cache_file.exists() and time.time() - cache_file.stat().st_mtime < ttl
        if self.use_cache and ttl > 0 and fresh:
            data = json.loads(cache_file.read_text())
            self._memo[path] = data
            return data

        url = f"{BASE}/{path.lstrip('/')}"
        resp = self.session.get(url, timeout=30)
        if resp.status_code == 403:
            raise FplError(
                f"403 fra {url}. Endepunktet krever innlogging, eller cookien er utløpt."
            )
        if not resp.ok:
            raise FplError(f"{resp.status_code} fra {url}: {resp.text[:200]}")
        data = resp.json()

        if self.use_cache and ttl > 0:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data))
        self._memo[path] = data
        return data

    def _post(self, path: str, payload: dict) -> Any:
        url = f"{BASE}/{path.lstrip('/')}"
        headers = {
            "Content-Type": "application/json",
            "Referer": "https://fantasy.premierleague.com/",
            "Origin": "https://fantasy.premierleague.com",
            "X-Requested-With": "XMLHttpRequest",
        }
        resp = self.session.post(url, json=payload, headers=headers, timeout=30)
        if not resp.ok:
            raise FplError(f"{resp.status_code} fra POST {url}: {resp.text[:500]}")
        return resp.json() if resp.content else {}

    # --------------------------------------------------------------- offentlig

    def bootstrap(self) -> dict:
        """Spillere, lag, gameweeks og regelinnstillinger."""
        return self._get("bootstrap-static/")

    def fixtures(self, event: int | None = None) -> list[dict]:
        path = "fixtures/" if event is None else f"fixtures/?event={event}"
        return self._get(path)

    def element_summary(self, player_id: int) -> dict:
        """Kampfor-kamp-historikk og kommende kamper for én spiller."""
        return self._get(f"element-summary/{player_id}/")

    def entry(self, entry_id: int) -> dict:
        """Offentlig info om et lag (navn, poeng, rank)."""
        return self._get(f"entry/{entry_id}/", ttl=600)

    def entry_history(self, entry_id: int) -> dict:
        return self._get(f"entry/{entry_id}/history/", ttl=600)

    def entry_picks(self, entry_id: int, event: int) -> dict:
        """Uttaket for en ferdigspilt/pågående gameweek. Krever ikke innlogging."""
        return self._get(f"entry/{entry_id}/event/{event}/picks/", ttl=600)

    # ------------------------------------------------------- krever innlogging

    def my_team(self, entry_id: int) -> dict:
        """Nåværende tropp med salgspriser, bank og gratis bytter."""
        return self._get(f"my-team/{entry_id}/", ttl=0)

    def submit_transfers(self, payload: dict) -> Any:
        return self._post("transfers/", payload)

    def submit_lineup(self, entry_id: int, payload: dict) -> Any:
        return self._post(f"my-team/{entry_id}/", payload)
