# V1A — PREREGISTRERING

Fryser testen før kode skrives. Ingenting i dette dokumentet endres etter at
resultatet er sett. Endres noe likevel, merkes kjøringen `EXPLORATORY`.

**Status: `CONFIRMATORY`.** Baseline og historiske utdata er urørt mens dette
skrives.

---

## 1. Hypotese

### Primær
> Eksplisitt modellering av oppmøte- og minuttusikkerhet, kombinert med FPL sine
> faktiske regler for autobytter og kapteinsfallback, gir bedre realiserte
> lagpoeng enn å evaluere de samme beslutningene med skalar xP alene.

### Sekundær
> V1A endrer benke-, kapteins- eller byttebeslutninger spesifikt i situasjoner
> med reell oppmøterisiko, og lar beslutninger uten slik risiko stå uendret.

### Den matematiske kilden til edge

Baseline evaluerer en tropp som `Σ xP` over ellevern. Det er `realisert(E[utfall])`.
Det riktige er `E[realisert(utfall)]`, og de er ikke like fordi reglene er
ikke-lineære:

1. **Betinget erstatningsverdi.** Spiller A med 4,5 xP og 25 % risiko for 0
   minutter er ikke verdt 4,5 i en tropp — for i de 25 % kommer en benkespiller
   inn. A er delvis forsikret. Baseline ser ikke forsikringen.
2. **Kapteinsfallback.** Spiller 0 minutter, går bindet til visekapteinen. Det er
   en diskontinuitet ved nøyaktig 0 minutter.
3. **60-minuttersgrensen.** Oppmøtepoeng er 1 under 60 og 2 fra 60. `E[oppmøte]`
   er derfor ikke lineær i forventede minutter. En spiller med forventet 60
   minutter er ikke det samme som en som alltid spiller 60.
4. **Formasjonsgrenser.** Et autobytte som ville gitt ulovlig oppstilling faller
   bort. Benkens verdi avhenger av posisjonssammensetningen, ikke bare av xP.

Punkt 1 og 2 er hovedkanalene. Punkt 3 gjelder alle spillere hele tiden og kan
være den største i volum.

---

## 2. Hva V1A ikke tester

Eksplisitt utenfor: spillerkorrelasjoner, rank-utility, EO, feltsimulering,
flerukessøk, chips, bookmakerdata, prismodell, fulle utfallsfordelinger for mål
og assists.

Alt dette holdes **identisk** mellom baseline og V1A.

---

## 3. Baseline — fryst

| Komponent | Nøyaktig innhold |
| --- | --- |
| Projeksjoner | `fplbot.model.ProjectionModel`, `blend_ppg=0.25`, lagstyrke fra `fit_team_strength` |
| Kandidatsett | `expected_minutes > 5`, `min_availability=0.0` i backtest |
| Troppsvalg | `optimize_squad`, ILP, budsjett 1000 |
| Bytter | `suggest_transfers`, ILP med hits i målfunksjonen, `min_gain=1.0`, `max_transfers=2` |
| Kaptein | Høyeste `xp[event]` i ellevern; vice er nummer to |
| Benk | `pick_lineup`, alle lovlige formasjoner prøvd, reservekeeper først |
| Horisont | 5 runder, `decay=0.86` |
| Sesonger | 2022-23, 2023-24, 2024-25, 2025-26 |
| Chips | Av |
| Fjorårsdata | Av (`use_prior_stats=False`) |

**Referansetall (målt, uendret):** 1963 / 2277 / 2184 / 2307 poeng.

V1A bruker **samme** projeksjoner, samme kandidatsett, samme byttesøk, samme
kostnader, samme rundedata. Den eneste forskjellen er **hvordan en tropp
evalueres**.

---

## 4. Minuttrepresentasjon

### Decision
Tre tilstander. Ingen ny modell.

```
P(0)      = 1 − p_start − p_sub
P(1–59)   = p_start·(1 − P60|start) + p_sub·(1 − P60|sub)
P(60+)    = p_start·P60|start       + p_sub·P60|sub
```

Alle fire størrelsene finnes allerede i `fplbot/model.py`: `p_start`, `p_sub`,
og konstantene `P60_GIVEN_START = 0.85`, `P60_GIVEN_SUB = 0.03`.

### Why
Dette er en **deterministisk omskriving av eksisterende parametre**, ikke en ny
modell. Ingen tuning, ingen nye data, ingen nye frihetsgrader. Da tester V1A
regelevalueringen alene, ikke minuttmodellens kvalitet.

Bygde vi en ny minuttmodell samtidig, ville et positivt resultat vært umulig å
tilskrive.

### Alternative
Seks bøtter (`0`, `1–29`, `30–59`, `60–74`, `75–89`, `90+`). Forkastet for V1A:
FPL sin poengregel har bare én knekk, ved 60 minutter. Flere bøtter gir ingen
ekstra oppløsning i poengfunksjonen, bare flere parametre å ta feil av.

### Non-appearance-poeng
Alt annet enn oppmøtepoeng (mål, assists, clean sheet, bonus, defcon, kort)
holdes som i dag: eksisterende betinget forventning, skalert med
`minutter/90` for tilstanden. Ingen hendelsesmodell. Da blandes ikke H1 med H2.

```
poeng | tilstand = oppmøtepoeng(tilstand) + eksisterende betinget xP · (minutter(tilstand)/90)
```

Representative minutter per tilstand: `0`, `start_minutes/2` for delvis, og
`start_minutes` for 60+. Dette er en tilnærming og noteres som antakelse 3.

---

## 5. Analytisk eller Monte Carlo?

### Decision
**Analytisk. Eksakt. Ingen Monte Carlo i V1A.**

### Regnestykket som avgjorde det

Naivt ser tilstandsrommet umulig ut: 3 tilstander × 15 spillere = 14,3 millioner
kombinasjoner. Men strukturen faller fra hverandre:

**Starterne er separable.** En starter som blanker bidrar 0 og blir erstattet.
En som spiller bidrar sitt eget. Ingen kobling:

```
E[starterbidrag] = Σ_i  Σ_tilstand  P(tilstand_i) · poeng_i(tilstand)
```

**Bare benken krever oppregning.** En benkespiller bidrar hvis han kommer inn.
Det avhenger av:
- hvor mange startere som blanket, og i hvilke **posisjoner** (ikke hvilke
  spillere — formasjonslovlighet avhenger bare av antall per posisjon)
- hvilke benkespillere som spilte (4 spillere → 16 mønstre)
- benkerekkefølgen

Fordelingen av antall blankende startere per posisjon er en **Poisson-binomial**
per posisjon, som regnes eksakt ved konvolusjon. For en 1-4-4-2 gir det
`2×5×5×3 = 150` posisjonsmønstre, ganger 16 benkmønstre = **2 400 tilstander**.

**Kapteinen er separabel.** Fallback avhenger bare av kapteinens og
visekapteinens tilstand: 3 × 3 = 9 kombinasjoner.

Totalt under 3 000 eksakte evalueringer per tropp per runde. Det er raskere enn
4 000 Monte Carlo-trekninger, og har null støy.

### Why
- Ingen simuleringsstøy å skille fra effekten vi måler.
- Deterministisk, altså testbart mot håndregnede fasitcase.
- Raskere backtest.
- CRN blir irrelevant fordi det ikke finnes tilfeldighet å dele.

Monte Carlo skal ikke brukes fordi prosjektet heter simulering.

### Alternative
MC + CRN med 4 000 trekninger. Beholdes som **kryssjekk**: analytisk og MC skal
gi samme svar innenfor MC-ens standardfeil på tilfeldige tropper. Avvik er en
implementasjonsfeil i én av dem.

### Når analytisk må vike
Introduseres korrelasjon (H2), er starterne ikke lenger separable og
Poisson-binomialen faller. Da kreves MC. Det er en av grunnene til at H2 er en
egen hypotese.

---

## 6. Autobytter — reglene, ikke en tilnærming

Per tilstandskombinasjon:

1. Finn startere med 0 minutter.
2. Gå benken ovenfra og ned.
3. Første benkespiller som **spilte** og som gir **lovlig formasjon** kommer inn.
4. Gjenta for hver blankende starter, med benken som allerede er brukt utelukket.
5. Keeper kan bare erstattes av keeper.

`fplbot/backtest/engine.py::apply_autosubs` implementerer allerede dette og er
verifisert. Gjenbrukes uendret.

---

## 7. Kapteinsfallback

- Kaptein 0 minutter → visekapteinen får multiplikatoren.
- Kaptein 1 minutt → **ingen** fallback. Diskontinuiteten er ved nøyaktig 0.
- Både kaptein og vice 0 minutter → ingen dobling.

---

## 8. Akseptansekriterier — fryst

### A. Praktisk signifikans

| Nivå | Snitt sesongpoeng | Beslutning |
| --- | --- | --- |
| Forkast | < +5 | Ikke verdt noen kompleksitet |
| Grensetilfelle | +5 til +10 | Behold bare hvis kjøretid og kode er uendret i praksis |
| **Aksepter** | **≥ +10** | Skru på permanent |
| Sterkt | > +25 | Prioriter videre arbeid på H1-mekanismer |

**Begrunnelse for +10, ikke +40:**

Mekanismen slår inn målbart ofte: over 152 backtestede runder er det **1,02
autobytter per runde**, og minst ett autobytte i **105 av 152 runder**. Men
baseline *får* allerede disse poengene når de skjer — spørsmålet er om det å
*vite om dem på forhånd* endrer valg.

Endringene er derfor sjeldne og små: bedre benkerekkefølge, en risikabel starter
verdsatt riktigere, en kaptein valgt med fallback i mente. Å kreve +40 av den
kanalen ville vært å kreve mer enn mekanismen kan levere. Implementasjonen er
samtidig billig og deterministisk, så terskelen for å beholde den er lav.

+5 som forkastelsesgrense er satt fordi noe under det ikke kan skilles fra
tilfeldig variasjon i byttesekvensene.

### B. Konsistens
Positiv ende-til-ende-delta i **minst 3 av 4 sesonger**.

### C. Usikkerhet
Ingen enkelt konfidensintervall avgjør. Rapporteres samlet:

- gjennomsnittlig paret rundedelta
- median paret rundedelta
- bootstrap-KI (se seksjon 9)
- andel runder med positiv delta
- sesongvise utfall, alle fire
- antall runder der en beslutning faktisk ble endret

Alle seks tallene vises. Ingen av dem alene avgjør.

---

## 9. Resamplingenhet

### Decision
**Blokkbootstrap på rundenivå**, med runden som udelelig enhet. 10 000
gjentrekninger, blokker på 4 sammenhengende runder innenfor sesong.

### Why
Beslutninger innenfor samme runde deler kamper, spillerutfall, lagform, skader og
modelltilstand. Å trekke enkeltspillere som uavhengige ville gitt et
konfidensintervall som er altfor smalt.

Runden er den minste enheten der utfallet er tilnærmet uavhengig. Blokker på 4
fanger at troppen bæres videre mellom runder — et dårlig bytte i GW12 forurenser
GW13-15 også.

### Alternative
- Enkeltruntebootstrap uten blokker. Forkastet: ignorerer at troppen er en
  tilstand som bæres videre.
- Sesongbootstrap med `n = 4`. Forkastet: for få enheter.

### How we validate
Sammenlikn KI-bredde med blokkstørrelse 1, 4 og 8. Vokser bredden monotont og
flater ut, er 4 et rimelig valg. Vokser den fortsatt ved 8, er
seriekorrelasjonen sterkere enn antatt og blokken må økes.

---

## 10. Primærmetrikk

**Realiserte FPL-poeng for policyen, paret mot baseline.**

Ikke simuleringssannsynlighet, ikke MAE, ikke Brier. De er diagnostiske.

Predikerer V1A minutter bedre uten å gi bedre beslutninger, er hypotesen
forkastet. Det er beslutningskvalitet som testes.

---

## 11. Diagnostikk — hvor kommer eventuell edge fra

Per beslutningspunkt logges:

```
sesong, runde, baseline-handling, V1A-handling, årsak, predikert delta, realisert delta
```

Årsak klassifiseres som: `kaptein`, `visekaptein`, `benkerekkefølge`,
`starter mot benk`, `bytte`, `ingen forskjell`.

Aggregeres til:
- Hvor mange av 152 runder endret V1A faktisk en beslutning?
- Hvordan fordeler poengdifferansen seg på de fem kategoriene?
- Hva er realisert delta betinget på hver kategori?

**Dette avgjør tolkningen.** Endres 5 av 152 runder og gir +12 poeng, er
mekanismen skarp og sjelden. Endres 100 beslutninger for +2 totalt, er det støy
som tilfeldigvis falt riktig vei. De to sier helt ulike ting om hva vi bør bygge
videre.

---

## 12. Fasittester før historisk backtest

Deterministiske, håndregnede. Disse er viktigere enn backtesten.

**Test 1 — betinget erstatningsverdi.**
Starter: `P(0) = 0,50`, xP gitt spill 6,0. Benk: sikker 4,0.
Baseline ser 6,0. V1A skal se `0,5·6,0 + 0,5·4,0 = 5,0`.

**Test 2 — kapteinsfallback.**
Kaptein A: xP 8,0 gitt spill, `P(0) = 0,30`. Vice B: xP 5,0, sikker start.
Mot kaptein C: xP 7,0, sikker start.
Forventet kapteinsbidrag A: `0,7·8,0 + 0,3·5,0 = 7,1`. C gir 7,0.
V1A skal foretrekke A knapt; baseline foretrekker A klart. Fortegnet er likt her,
men marginen skal krympe fra 1,0 til 0,1.

**Test 3 — ulovlig formasjon.**
Oppstilling 3-4-3, én forsvarer blanker, første benkespiller er midtbane.
Byttet ville gitt to forsvarere. V1A skal hoppe over ham og gå til neste lovlige.

**Test 4 — kort innhopp trigger ikke autobytte.**
Spiller med `P(1–59) = 0,99` og `P(0) = 0,01`. Forventede minutter er lave, men
autobytte skal utløses i 1 % av tilfellene, ikke ofte.

**Test 5 — degenerert tilfelle.**
Alle spillere `P(60+) = 1`. V1A skal gi **nøyaktig** samme tall som baseline.
Feiler denne, er det en implementasjonsfeil, ikke en modellforskjell.

**Test 6 — analytisk mot Monte Carlo.**
Tilfeldig tropp, tilfeldige sannsynligheter. Analytisk svar skal ligge innenfor
3 standardfeil av 100 000 MC-trekninger.

---

## 13. Antakelser

1. Minuttilstander er uavhengige mellom spillere. Feil i virkeligheten — det er
   H2 — men holdes fast så V1A tester én ting.
2. `P60|start = 0,85` og `P60|sub = 0,03` er faste konstanter, ikke tilpasset.
3. Representative minutter per tilstand er en tilnærming; ekte fordelinger
   innenfor tilstand ignoreres.
4. Non-appearance-xP skalerer lineært med minutter innenfor tilstand.
5. Autosub-implementasjonen i backtesten er korrekt. Den er verifisert med
   tester, men mot min egen lesning av reglene.

---

## 14. Feilmoduser

| Feilmodus | Symptom | Vern |
| --- | --- | --- |
| Dobbelttelling av oppmøtepoeng | V1A høyere overalt | Fasittest 5 |
| Feil i Poisson-binomialen | Sannsynligheter summerer ikke til 1 | Enhetstest på hver konvolusjon |
| Benkeverdi overvurdert | Benken tas med for ofte | Fasittest 1 og 3 |
| Skjult tuning | Kriterier «justeres» etterpå | Dette dokumentet |
| Baseline endret | Referansetallene flytter seg | Referansetallene står i seksjon 3 |

---

## 15. Nøyaktig hva som bygges

1. `fplbot/appearance.py` — minuttilstander fra eksisterende parametre,
   Poisson-binomial per posisjon, eksakt forventet troppsverdi med autobytter og
   kapteinsfallback.
2. Tester for fasittestene 1–6.
3. `scripts/run_v1a_test.py` — paret backtest, blokkbootstrap, diagnostikklogg.
4. `docs/V1A_RESULT.md` — resultatet, uansett fortegn.

Baseline og historiske utdata røres ikke.

---

## Forpliktelse

Kriteriene over er fryst. Resultatet rapporteres uansett fortegn, med samme
grundighet som H4 fikk. Feiler V1A, skrives det opp som `FAILED` og vi går
videre — vi redder den ikke.
