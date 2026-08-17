# Autonom drift

Målet er at du ikke administrerer laget. Boten gjør det.

I normal drift skal du ikke gjøre bytter, sette ellever, ordne benken, velge
kaptein, aktivere chips, følge med på fristen, oppdatere data eller starte noe
manuelt. Du skal få en kort status der jobben allerede er gjort.

## Arkitektur

```
DATA -> FORECAST -> DECISION -> VALIDATION -> EXECUTION -> VERIFICATION
```

Beslutningsmotoren skriver **aldri** til FPL. Alt som er irreversibelt går
gjennom `fplbot/execution/`, som er det eneste stedet i koden som kaller FPL
sine POST-endepunkter.

| Modul | Ansvar |
| --- | --- |
| `execution/config.py` | De to bryterne og alle terskler |
| `execution/state.py` | Øyeblikksbilde av laget, og hva som har endret seg |
| `execution/actions.py` | Handlinger med innholdsbasert ID |
| `execution/validation.py` | Porten før skriving |
| `execution/executor.py` | Skriving og verifisering |
| `execution/pipeline.py` | Den planlagte kjøringen, ende til ende |
| `execution/status.py` | Statusmeldingen du leser |

## De to bryterne

```bash
FPL_AUTONOMY_MODE=true    # har boten lov til å handle selv?
FPL_DRY_RUN=false         # skal den faktisk skrive?
```

**Begge** må stå riktig før noe skrives. Standard er `autonomy=false` og
`dry_run=true`, altså helt trygt. Det skal være et aktivt valg å gi boten
skrivetilgang, ikke noe som skjer fordi en variabel ikke ble satt.

| Autonomi | Tørrkjøring | Oppførsel |
| --- | --- | --- |
| av | — | Bare anbefalinger |
| på | på | Hele kjeden kjøres, payload bygges og valideres, ingenting sendes |
| på | av | Boten styrer laget |

## Rekkefølgen du slår det på

```bash
fplbot doctor                       # er kjeden i orden?
FPL_AUTONOMY_MODE=true fplbot run --verbose   # tørrkjøring, se valideringen
```

Se over noen kjøringer i handlingsloggen. Når payloadene ser riktige ut:

```bash
FPL_AUTONOMY_MODE=true FPL_DRY_RUN=false fplbot run
```

## Tidsplan

Handlingene er ulikt farlige, så vinduene er lagdelt.

| Tid til frist | Hva som kan skje |
| --- | --- |
| over 30 timer | Se, ikke rør. Laget hentes ikke engang |
| under 30 timer | Oppstilling, kaptein og benk settes, og settes om ved ny informasjon |
| under 2 timer | Chips kan aktiveres, med en strengere port |
| under 1,5 timer | Bytter utføres |

Å vente er en beslutning, ikke en unnlatelse. Et bytte gjort 30 timer før
fristen kaster bort informasjonen fra pressekonferansen som kommer om ti. Derfor
kan kjeden svare `WAIT` med et anslag på når den kommer tilbake.

Planleggeren (`.github/workflows/fpl-autopilot.yml`) kjører hver time, og hvert
kvarter i tidsrommet der frister pleier å ligge. De fleste kjøringene ser på
klokka og gjør ingenting.

## Validering før skriving

Automatisk, ikke brukerbekreftelse. Alle må passere:

- doctor er grønn
- lagdata er ferskere enn 15 minutter
- fristen er ikke passert
- handlingen finnes ikke alt i loggen
- tilstanden er uendret siden beslutningen ble tatt
- spillerne som selges er i troppen, de som kjøpes er ikke
- banken går ikke i minus
- 15 spillere, riktige posisjonskvoter, høyst tre fra samme klubb
- lovlig formasjon, keeper først på benken, kaptein og vise starter og er ulike
- minuspoengene stemmer med FPL sin egen telling av gratis bytter
- minuspoengene er under `FPL_MAX_AUTONOMOUS_HIT`
- et hit er forsvart av modellen med margin
- chipen er tilgjengelig, ubrukt, i vinduet og gir vesentlig gevinst

Feiler én av dem: **ikke skriv.** Status blir `DEGRADED` eller `FAIL`.

## Sikringer

**Idempotens.** Hver handling får en ID utledet av innholdet, ikke av klokka:
`GW02-TRANSFER-9f2c1a4b7e05`. To kjøringer på samme beslutning gir samme ID, og
den andre ser i loggen at jobben er gjort. I tillegg sjekkes FPL sin faktiske
tilstand, som fanger tilfellet der loggen har forsvunnet.

**Tilstandsdrift.** Rett før skriving hentes laget på nytt og sammenliknes med
det beslutningen ble laget fra. Har du gjort et bytte selv fra mobilen, eller
har en pris endret seg, forkastes den gamle planen i stedet for å tvinges
gjennom.

**Verifisering etter skriving.** At FPL svarer 200 betyr ikke at laget ditt ser
ut som du tror. Etter hver skriving hentes laget på nytt og sjekkes: er
spilleren ute, er den nye inne, stemmer banken, stemmer ellevern, kapteinen,
visekapteinen, benkerekkefølgen, er chipen aktiv. Feiler det, stopper kjeden i
stedet for å fortsette blindt med flere irreversible handlinger.

**Katastrofesikring på hits.** `FPL_MAX_AUTONOMOUS_HIT` (standard 4) er ikke
strategi. Boten skal kunne ta minuspoeng når modellen forsvarer det, men en feil
i optimereren skal ikke kunne koste 20 poeng.

**Fail-safe.** Er doctor rød, gjøres ingenting irreversibelt. Å ikke gjøre noe
er bedre enn å ødelegge laget fordi datakjeden er brutt. Dette gjelder tekniske
feil og dataintegritet — vanlig fotballusikkerhet håndterer beslutningsmotoren.

## Handlingslogg

Én linje JSON per hendelse, aldri overskrevet.

```bash
fplbot actions --count 20
```

Hver linje har tidsstempel, handlings-ID, doctor-status, modus, hva modellen
trodde den ville tjene, hva FPL svarte, og resultatet av verifiseringen. Det
skal i ettertid være mulig å rekonstruere nøyaktig hvorfor boten gjorde noe.

I GitHub Actions skrives loggen til `logs/actions.jsonl` og committes tilbake,
siden containeren forsvinner etterpå.

## Legitimasjon

Cookie og lag-ID leses fra miljøet eller `~/.config/fplbot/config.json` (modus
600). Aldri fra repoet, aldri i logger, aldri i kode.

I GitHub: `FPL_COOKIE` som **secret**, `FPL_ENTRY_ID` som variable. Cookien kan
byttes når som helst uten at noe annet må endres.

## Modell

Produksjonsmotoren er den validerte grunnlinjen. `H4`, `V1A`, `V1A-2` og annen
uvalidert forskning er **av** og skal ikke slås på. Execution-laget er bygget
mot et stabilt grensesnitt, så en bedre modell kan plugges inn senere uten at
noe av dette må skrives om.
