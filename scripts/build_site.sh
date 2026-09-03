#!/usr/bin/env bash
#
# Bygger den statiske sida Vercel publiserer, til public/.
#
#     bash scripts/build_site.sh
#
# Sidene bygges på nytt fra JSON-en i data/ ved hver deploy, slik at en
# oppdatering av dataene er nok — de ferdige HTML-filene trenger ingen egen
# runde. Uten python3 faller vi tilbake på de innsjekkede sidene i dashboard/,
# så en deploy aldri står og faller på hva byggemiljøet har installert.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="public"
rm -rf "$OUT"
mkdir -p "$OUT"

if command -v python3 >/dev/null 2>&1; then
    python3 scripts/build_dashboard.py \
        --data data/backtests.json \
        --template dashboard/template.html \
        --out "$OUT/index.html"
    python3 scripts/build_dashboard.py \
        --data data/simulation.json \
        --template dashboard/simulation.html \
        --out "$OUT/simulering.html"
else
    echo "Fant ikke python3 — kopierer de innsjekkede sidene i stedet."
    cp dashboard/index.html "$OUT/index.html"
    cp dashboard/simulering.html "$OUT/simulering.html"
fi

ls -l "$OUT"
