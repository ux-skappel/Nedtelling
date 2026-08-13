"""Bygger dashboardet ved å legge backtest-dataene rett inn i HTML-en.

Artefakter kjører uten nettverk, så dataene må ligge i selve sida.

    python scripts/build_dashboard.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDER = "/*__DATA__*/ null"


def main() -> int:
    parser = argparse.ArgumentParser(description="Bygg dashboardet")
    parser.add_argument("--data", default=ROOT / "data" / "backtests.json")
    parser.add_argument("--template", default=ROOT / "dashboard" / "template.html")
    parser.add_argument("--out", default=ROOT / "dashboard" / "index.html")
    args = parser.parse_args()

    template = Path(args.template).read_text(encoding="utf8")
    if PLACEHOLDER not in template:
        raise SystemExit(f"Fant ikke plassholderen '{PLACEHOLDER}' i malen")

    data = json.loads(Path(args.data).read_text(encoding="utf8"))
    # separators uten mellomrom holder sida så liten som mulig.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(template.replace(PLACEHOLDER, payload), encoding="utf8")

    runs = len(data["runs"])
    print(f"Skrev {output} ({output.stat().st_size // 1024} kB, {runs} kjøringer)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
