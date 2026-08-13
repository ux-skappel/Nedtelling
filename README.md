# fplbot

En bot som spiller Fantasy Premier League for deg: den henter data fra FPL sitt
eget API, regner ut forventede poeng (xP) for hver spiller i hver runde, og
bruker heltallsprogrammering til å sette den beste troppen, foreslå bytter,
velge kaptein og si når chipsene bør brukes. Den kan også sende inn
oppstilling og bytter automatisk hvis du gir den en sesjonscookie.

## Kom i gang

```bash
pip install -r requirements.txt
pip install -e .            # gir deg kommandoen "fplbot"

fplbot config --entry-id 1234567   # ID-en fra fantasy.premierleague.com/entry/<ID>/...
```

Uten installasjon virker `python -m fplbot.cli ...` like godt.

## Kommandoer

| Kommando | Hva den gjør |
| --- | --- |
| `fplbot squad` | Setter den beste troppen fra bunnen — til sesongstart eller wildcard |
| `fplbot team` | Viser troppen din med xP, oppstilling og skadeflagg |
| `fplbot lineup` | Beste ellever, kaptein, visekaptein og benkerekkefølge |
| `fplbot transfers` | Foreslår bytter, og regner ut om et minuspoeng lønner seg |
| `fplbot players` | Rangerer spillere etter forventede poeng |
| `fplbot player haaland` | Forklarer projeksjonen for én spiller |
| `fplbot chips` | Sier når Bench Boost, Triple Captain, Free Hit og Wildcard bør brukes |
| `fplbot report` | Alt sammen i én rapport før fristen |
| `fplbot submit-lineup` | Sender inn oppstillingen (krever cookie og `--confirm`) |
| `fplbot submit-transfers` | Gjennomfører byttene (krever cookie og `--confirm`) |

Fellesflagg virker både før og etter kommandoen:

```bash
fplbot squad --horizon 8 --budget 100 --lock haaland --ban isak
fplbot players --position MID --max-price 8.0 --max-owned 10 --top 20
fplbot transfers --free 2 --max-transfers 3 --horizon 6
fplbot report --out rapport.txt
```

* `--horizon N` — hvor mange runder fram modellen skal se (standard 5)
* `--blend` — hvor mye spillerens faktiske poengsnitt skal veie mot modellen
* `--min-availability` — filtrerer bort skadde og tvilsomme spillere
* `--no-cache` — henter ferske data i stedet for mellomlagrede

## Slik regner modellen

For hver spiller og hver kommende kamp:

1. **Rolle.** Startandelen anslås fra `starts` delt på antall spilte runder, og
   innhopp fra minuttene som ikke kan forklares av starter. En spiller som
   starter halvparten av kampene er verdt omtrent halvparten. For nysignerte
   uten historikk brukes prisen som holdepunkt.
2. **Rater per 90.** xG, xA, defensive contributions, redninger, bonus og kort
   hentes fra FPL sine egne tall. Har spilleren lite spilletid bak seg, krympes
   ratene mot medianen for posisjonen — to gode kamper skal ikke gjøre en
   innbytter til stjerne.
3. **Motstander.** FDR-en for kampen justerer angrepsratene opp eller ned, og
   bestemmer sannsynligheten for clean sheet og forventede baklengsmål.
   Hjemmekamp gir et lite påslag.
4. **Poeng.** Alt regnes om etter FPL-reglene: oppmøte, mål etter posisjon,
   assists, clean sheet, baklengsmål, redninger, bonus, kort og defensive
   contributions (Poisson-sannsynlighet for å nå terskelen på 10 for forsvar,
   12 for midtbane og spiss).
5. **Anker.** Til slutt trekkes projeksjonen litt mot spillerens faktiske
   poengsnitt, vektet etter hvor mye vi har sett av ham.

Blanke runder gir null, dobbeltrunder summeres. `fplbot player <navn>` viser
regnestykket per runde.

Troppen settes deretter som et heltallsproblem med alle FPL-reglene som
bibetingelser: 15 spillere, 100m, 2/5/5/3 per posisjon, maks 3 fra samme klubb,
og en lovlig ellever. Bytter løses på samme måte, med de fire minuspoengene lagt
inn i målfunksjonen — boten tar bare et hit når gevinsten over horisonten er
større enn kostnaden.

## Innlogging

FPL sitt innloggingsskjema ligger bak Cloudflare, så boten logger ikke inn med
brukernavn og passord. I stedet gjenbruker du sesjonscookien fra nettleseren:

1. Logg inn på fantasy.premierleague.com.
2. Åpne utviklerverktøy → Network, oppdater siden, klikk et kall til `/api/`,
   og kopier hele `Cookie`-headeren.
3. `fplbot cookie --set "<cookie>"` — eller sett miljøvariabelen `FPL_COOKIE`.

Cookien lagres i `~/.config/fplbot/config.json` med rettigheter 600. Den gir
full tilgang til laget ditt, så del den ikke og sjekk den ikke inn i git.
Cookien varer typisk noen uker; da må du hente en ny.

Uten cookie virker alt unntatt innsending — boten leser da uttaket ditt fra det
offentlige endepunktet, men kjenner ikke salgsprisene dine og bruker nåpris som
anslag.

### Innsending

Begge innsendingskommandoene er tørrkjøringer som standard og gjør ingenting før
du legger til `--confirm`:

```bash
fplbot submit-lineup                      # viser hva den ville gjort
fplbot submit-lineup --confirm            # sender inn
fplbot submit-transfers --confirm --allow-hits
```

`submit-transfers` nekter å ta minuspoeng med mindre du sier `--allow-hits`.

## Automatisk kjøring

`.github/workflows/fpl-rapport.yml` kjører rapporten hver fredag og legger den i
sammendraget for kjøringen. Sett `FPL_ENTRY_ID` som repository variable, og
eventuelt `FPL_COOKIE` som secret hvis du vil at den skal lese det innloggede
laget ditt.

Vil du kjøre den lokalt i stedet, holder en cron-linje:

```
0 9 * * 5 cd ~/Nedtelling && fplbot report --out ~/fpl-rapport.txt
```

## Utvikling

```bash
pip install -e ".[dev]"
pytest          # 20 tester, ingen nettverk
ruff check .
```

Testene bruker syntetiske data, så de kjører uten å røre FPL sine servere.

## Forbehold

Modellen bygger på offentlige data og enkle antakelser. Den kjenner ikke
pressekonferanser, rotasjonsplaner eller hvem som tar straffene neste uke, og
den ser bare FDR — ikke den faktiske formen til motstanderen. Rett før
sesongstart er tallene fra forrige sesong, så nysignerte og spillere med ny
rolle blir anslått ut fra prisen. Bruk den som et beslutningsgrunnlag, ikke en
fasit.
