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
| `fplbot elite` | Hva de best rangerte managerne i verden eier og kapteiner |
| `fplbot backtest` | Spiller gjennom en tidligere sesong og teller poengene |
| `fplbot audit` | Etterprøver at backtesten ikke har sett inn i framtiden |
| `fplbot autopilot` | Handler av seg selv rett før fristen, hvis det trengs |
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

## Hvilke data den henter

Hver kjøring henter ferske tall fra kildene som faktisk er tilgjengelige:

| Kilde | Hva den gir | Status |
| --- | --- | --- |
| FPL-API-et | Priser, eierandel, xG/xA per 90 (Opta), skader, dødballroller | Alltid |
| Resultatene så langt | Angreps- og forsvarsrating per lag, fittet på målene | Fra sesongstart |
| Toppen av verdensrankingen | Eierskap og kaptein blant de beste managerne | `--elite N` |
| Bookmakerodds | Forventede mål per kamp, det skarpeste anslaget som finnes | `--odds` + nøkkel |

**Om YouTube:** en bot kan ikke se video, og transkripsjoner av FPL-kanaler er
både trege og upålitelige. Men signalet du er ute etter derfra — hva de beste
faktisk gjør — ligger direkte i FPL-API-et. `--elite 100` henter uttakene til de
100 best rangerte managerne i verden og viser hvem de eier, hvem de kapteiner,
og hvor de skiller seg fra folket. Det er den samme informasjonen kanalene
diskuterer, bare uten mellomledd og et døgn tidligere.

To kilder ble vurdert og forkastet: Understat leverer ikke lenger data i
sidekilden, og FBref svarer 403 på alt som ikke er en nettleser.

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
3. **Motstander.** Angreps- og forsvarsrating for hvert lag fittes på målene som
   faktisk er scoret, med en Poisson-modell og halv vekt etter ti runder. Ut av
   den kommer forventede mål begge veier i hver kamp, som gir både
   angrepsmultiplikator og clean sheet-sannsynlighet. Tidlig i sesongen krympes
   ratingene mot FPL sin FDR, og før sesongstart er de identiske med den.
   Finnes det odds, går de foran alt annet.
4. **Dødball.** Den som står oppført som straffe-, frispark- eller cornertaker
   får et påslag — men bare i den grad vi ikke har sett rollen i tallene hans
   fra før. En etablert straffetaker har den allerede inne i xG-en sin.
5. **Poeng.** Alt regnes om etter FPL-reglene: oppmøte, mål etter posisjon,
   assists, clean sheet, baklengsmål, redninger, bonus, kort og defensive
   contributions (Poisson-sannsynlighet for å nå terskelen på 10 for forsvar,
   12 for midtbane og spiss).
6. **Anker.** Til slutt trekkes projeksjonen litt mot spillerens faktiske
   poengsnitt, vektet etter hvor mye vi har sett av ham. Er elitedata slått på,
   justeres startsjansen noen prosentpoeng opp eller ned etter hva
   topp-managerne gjør — de vet ofte om en rolleendring før tallene viser den.
   Effekten er med vilje for liten til å snu et anslag.

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

## Backtest mot tidligere sesonger

FPL sitt API serverer bare inneværende sesong, så historikken hentes fra det
åpne arkivet til [vaastav/Fantasy-Premier-League][arkiv], som har en rad per
spiller per runde tilbake til 2016/17.

```bash
fplbot backtest --season 2025-26              # hele sesongen
fplbot backtest --season 2025-26 --to-gw 10   # bare starten
fplbot backtest --min-gain 2.0 --max-transfers 1
```

Testen går forlengs, runde for runde. For hver runde bygges et *snapshot* av
det som var kjent før fristen: totalene summeres til og med forrige runde, og
resultatene fra runden vi står foran maskeres bort. Modellen kan altså ikke se
hvem som scoret. Så settes laget, autobyttene kjøres, og poengene telles slik
FPL ville telt dem — med gratis bytter, minuspoeng, salgspriser og
visekaptein-regelen.

Resultatet for 2025/26, med standardinnstillingene:

```
Sesong 2025-26: 2307 poeng på 38 runder (60.7 per runde)
Bytter: 36, minuspoeng: 0
Treffsikkerhet per spiller: bommer i snitt 3.06 poeng, korrelasjon 0.296
```

Til sammenlikning lå snittmanageren rundt 2000-2100 den sesongen. Tallet er
høyt nok til å være nyttig og lavt nok til å være troverdig — hadde det vist
3000, ville det vært et tegn på at data lakk inn fra framtiden.

### Fire sesonger, seks byttepolicyer

`scripts/run_backtests.py` kjører hele rutenettet parallelt og lagrer resultatet
som JSON, og `scripts/build_dashboard.py` legger dataene inn i et dashboard du
kan bla i:

```bash
python scripts/run_backtests.py --out data/backtests.json
python scripts/build_dashboard.py          # gir dashboard/index.html
```

Poeng per sesong. Arkivet har xG, xA og starter fra og med 2022/23; eldre
sesonger mangler dem, og defensive contributions gjaldt først fra 2025/26.

| Sesong | hold | forsiktig | standard | aktiv | kort sikt | lang sikt |
| --- | --- | --- | --- | --- | --- | --- |
| 2022-23 | 1553 | 1936 | 1963 | 2053 | **2064** | 2026 |
| 2023-24 | 1786 | 2148 | **2277** | 2149 | 2271 | 2223 |
| 2024-25 | 1912 | **2307** | 2184 | 2201 | 2091 | 2184 |
| 2025-26 | 1481 | 2028 | **2307** | 2296 | 2296 | 2290 |
| **Snitt** | 1683 | 2105 | **2183** | 2175 | 2181 | 2181 |

To ting faller ut av dette, og det ene er langt viktigere enn det andre.

**Å bytte i det hele tatt er verdt rundt 500 poeng i sesongen.** «Hold» setter
troppen i runde 1 og rører den aldri igjen, og taper stort hver eneste sesong.
Det er hele avstanden mellom en tropp som vedlikeholdes og en som ikke gjør det.

**Hvilken byttepolicy du velger betyr nesten ingenting.** Standard, aktiv, kort
sikt og lang sikt lander innenfor åtte poeng av hverandre i snitt — mindre enn
svingningen mellom to sesonger med samme policy. Ingen av dem vinner mer enn én
sesong hver. Å plukke fjorårets vinner er å tilpasse seg støy, og derfor er
standardinnstillingen stående.

### Tusen kjøringer, og hvor de havnet i verden

```bash
python scripts/run_simulation.py --runs 1000 --out data/simulation.json
python scripts/build_dashboard.py --data data/simulation.json \
    --template dashboard/simulation.html --out dashboard/simulering.html
```

Backtesten er deterministisk, så tusen like kjøringer ville gitt tusen like
svar. To ting varierer derfor: **innstillingene** (byttegrense, horisont, maks
bytter trekkes tilfeldig, fordi standardverdiene ble valgt med skjønn) og
**anslagene** (xP forstyrres med støy, fordi modellen er omtrent riktig og ikke
nøyaktig riktig). 250 kjøringer per sesong, 49 minutter på fire kjerner.

Plasseringene er ekte: FPL har ingen tabell over hva en poengsum var verdt, så
kurven bygges av noen hundre tilfeldig trukne lag per sesong, hvert med sin egen
poengsum og plassering. Skjevhet i utvalget forkludrer ikke kurven — hvert par
er sant uansett hvilket lag det kom fra.

| Sesong | Median poeng | Spenn (p10–p90) | Median plassering | Beste kjøring | Deltakere |
| --- | --- | --- | --- | --- | --- |
| 2022-23 | 1901 | 1726–2063 | 6 441 119 | 2 092 465 | 11 394 904 |
| 2023-24 | 2186 | 2088–2271 | 2 376 790 | 544 553 | 10 764 159 |
| 2024-25 | 2138 | 2002–2273 | 3 759 451 | 886 220 | 11 305 839 |
| 2025-26 | 2132 | 2033–2239 | **1 774 781** | 52 014 | 12 789 506 |

Det mest slående er hvor lite poengsummen svinger og hvor mye plasseringen
gjør. Boten scorer 2132 i 2025/26 og 2138 i 2024/25 — seks poengs forskjell —
men det er topp 14 % det ene året og topp 33 % det andre. Feltet scorer helt
ulikt fra år til år, og kurven er så bratt at noen få poeng flytter deg
hundretusener av plasser.

Med andre ord: boten lander stabilt i øvre halvdel, men ikke i nærheten av
toppen. Medianen tilsvarer en habil menneskelig manager, ikke en god en.

### Kan modellen ha kikket framover?

Hele backtesten hviler på én antakelse: at modellen aldri fikk se noe fra
runden den skulle spille. `fplbot audit` etterprøver den på to måter.

```bash
fplbot audit --season 2025-26          # revisjon + kontrollforsøk
fplbot audit --season 2024-25 --quick  # bare revisjonen
```

**Revisjonen** regner ut fasiten på nytt, uavhengig av snapshot-koden, og
sammenlikner. For hver runde telles minutter, starter, poeng, bonus og kort opp
rett fra radene, og resultatet må stemme på desimalen. Samtidig sjekkes at ingen
kamp fra runden og utover er merket ferdigspilt eller har resultat. Over de fire
sesongene går 110 072 spiller-snapshots gjennom uten avvik. Revisjonen har egne
tester som planter lekkasje med vilje, så vi vet at den faktisk slår ut.

**Kontrollforsøkene** angriper det fra utsiden: samme rigg, ulike anslag.

| Anslag | Poeng 2025/26 |
| --- | --- |
| Terningkast (ingen informasjon) | 895 |
| Bare pris | 1320 |
| Ekte modell | **2307** |
| Fasit (lekkasje med vilje) | 3671 |

Terningkastet er gulvet: gir riggen bort poeng uansett hvem som velger, ville
det tallet vært høyt. Det er det ikke. Fasit-raden er like viktig — den viser
hvordan et resultat med framtidskunnskap faktisk ser ut, 59 % over den ekte
modellen. Uten det utslaget ville vi ikke visst om vi i det hele tatt er i stand
til å oppdage at noen kikker.

Den ekte modellen ligger med god margin til begge. Det er så nær en garanti man
kommer.

### Én lekkasje som ikke lar seg fikse

Kampoppsettet i arkivet er det endelige. Blir en kamp utsatt i november og lagt
til en annen runde, står den nye datoen der fra første stund — så modellen
«vet» om en blank eller dobbel runde før den ble kunngjort. Revisjonen kan ikke
fange dette, for dataene registrerer ikke *når* oppsettet ble endret.

Effekten ser ut til å være liten: hadde slik kunnskap vært verdt noe, ville
lang horisont slått kort. Den gjør ikke det — åtte runder fram gir 2290 poeng
mot 2296 for to runder fram. Men det er et argument, ikke et bevis.

### Hva backtesten ikke kan si noe om

* **Skader.** Arkivet har ikke spillerstatus per runde, så backtesten vet ikke
  hvem som var tvilsomme. Den ekte boten ser flaggene og styrer unna, så dette
  trekker resultatet ned, ikke opp.
* **Dødballroller** og **elitedata** finnes ikke historisk per runde. Å hente
  dem fra fasiten ville vært juks, så de står avslått.
* **Prisene** i arkivet er påvirket av det som faktisk skjedde. Effekten er
  liten, men den er der.
* Én sesong er én sesong. 2307 poeng er ett utfall, ikke en forventning.

### Et funn: fjorårets tall gjør det verre

FPL nullstiller alle totaler ved sesongstart, så fra runde 2 og noen uker
framover vet modellen nesten ingenting. Den hypotesen lå snublende nær: la
fjorårets rater fylle hullet, så slutter modellen å behandle en etablert
spiller som en tilfeldig spiller til samme pris.

Målt på 2025/26 ble det verre:

| Oppsett | Sesong | GW1-10 | Bom per spiller | Korrelasjon |
| --- | --- | --- | --- | --- |
| Uten fjorårsdata | **2307** | **645** | 3.06 | 0.296 |
| Med fjorårsdata | 2179 | 547 | 3.02 | 0.281 |

Verdt å merke seg: treffsikkerheten per spiller ble marginalt *bedre*, mens
poengene ble klart dårligere. Det henger sammen — optimereren plukker de 15
ytterpunktene av 600 spillere, ikke gjennomsnittet. Å forankre alle mot fjoråret
gjør modellen forsiktig, og da mister den spillerne som tar et byks. Det er de
byksene som vinner sesongen.

Hypotesen er derfor forkastet, ikke skrudd på. Flagget `--priors` finnes fortsatt
så du kan etterprøve den på andre sesonger — det er nettopp det backtesten er til
for.

[arkiv]: https://github.com/vaastav/Fantasy-Premier-League

## Autopilot: bytter rett før fristen

`fplbot autopilot` er laget for å kjøre ofte — for eksempel annenhver time — og
avgjøre selv om det er tid for å handle:

* **Utenfor vinduet** (mer enn `--within-hours` igjen til fristen) gjør den
  ingenting og avslutter.
* **Inne i vinduet** henter den ferske data (aldri fra cache), setter
  oppstillingen, og bytter *hvis det trengs*.

Et bytte regnes som nødvendig når netto gevinst over horisonten er minst
`--min-gain` poeng, eller når noen i troppen er skadet, utestengt eller uten
klubb. Minuspoeng tas aldri med mindre du sier `--allow-hits`. Oppstillingen
settes alltid — den er gratis og kan ikke gjøre skade.

```bash
fplbot autopilot                          # tørrkjøring, viser hva den ville gjort
fplbot autopilot --within-hours 2 --min-gain 1.5
fplbot autopilot --confirm                # gjennomfører på ekte
```

`.github/workflows/fpl-autopilot.yml` kjører dette annenhver time med et
fire timers vindu, så minst én kjøring lander foran hver frist. Den er
**tørrkjøring som standard**: for at den skal sende inn noe må du både legge
inn `FPL_COOKIE` som secret og sette repository variable `FPL_AUTOPILOT` til
`on`. Uten begge deler rapporterer den bare.

Vær klar over at cookien går ut etter noen uker. Da slutter autopiloten å sende
inn, og du må hente en ny — sjekk kjøringene innimellom i sesongen.

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
pressekonferanser eller rotasjonsplaner, og den regner analytisk forventning —
den simulerer ikke utfall, så den sier ingenting om hvor sannsynlig et haul er,
bare hva snittet blir. Verdien av autobytter blir dermed litt undervurdert.

Lagratingene trenger noen runder før de er verdt noe; i august er de i praksis
FDR. Rett før sesongstart er spillertallene fra forrige sesong, så nysignerte og
spillere med ny rolle blir anslått ut fra pris og dødballrolle.

Bruk den som et beslutningsgrunnlag, ikke en fasit.
