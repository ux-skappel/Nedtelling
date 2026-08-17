# V1A — PREREGISTRERING

Fryser testen før kode skrives. Ingenting i dette dokumentet endres etter at
resultatet er sett. Endres noe likevel, merkes kjøringen `EXPLORATORY`.

**Status: `PREREGISTRERT RETROSPEKTIV TEST`.**

Det er en presis og bevisst svakere merkelapp enn `CONFIRMATORY`. Kriteriene er
fryst før koden skrives og før noe V1A-resultat er sett — det er ekte og verdt
noe. Men de fire sesongene testen kjøres på er **ikke urørte**: de er allerede
brukt til å bygge grunnlinjen, velge chip-policy, forkaste fjorårsblending og
kjøre H4. Jeg vet hvordan de oppfører seg. Den kunnskapen kan lekke inn i
designvalg uten at jeg merker det.

Det gir følgende:

| Merkelapp | Hva den betyr her |
| --- | --- |
| `PREREGISTRERT RETROSPEKTIV` | Denne testen. Kriterier fryst på forhånd, data ikke ferske |
| `CONFIRMATORY` | Krever en sesong som ikke er sett. 2026/27 kan tjene som det |
| `EXPLORATORY` | Alt som endres etter at resultatet er lest |

Et **negativt** resultat er sterkt selv retrospektivt: hadde jeg ubevisst
tilpasset designet til disse sesongene, ville skjevheten pekt mot et positivt
funn. Et **positivt** resultat er svakere, og skal beskrives som «bestått
forhåndsregistrert retrospektiv test», ikke som bekreftet.

Blir V1A skrudd på, registreres samme kriterier for 2026/27 som genuint
prospektiv validering.

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

## 3A. Ablasjon — V1A-0 og V1A-1

Slik seksjon 4 opprinnelig var skrevet, endret V1A **to** ting samtidig:
troppsreglene (autobytter, kapteinsfallback, formasjonslovlighet) *og*
poengfunksjonen (ekte 60-minuttersknekk i stedet for lineær skalering). Et
positivt resultat kunne da ikke tilskrives. Testen splittes derfor i to trinn.

### V1A-0 — bare troppsreglene

Minuttilstandene konstrueres **middelbevarende**: for hver spiller, hver runde,
skal tilstandsdekomposisjonen ha nøyaktig samme forventning som dagens skalare
xP.

```
Σ_tilstand P(tilstand) · E[poeng | tilstand]  ==  eksisterende skalar xP
```

Konkret: tilstandssannsynlighetene settes som i seksjon 4, og de betingede
poengene skaleres med én felles faktor per spiller slik at likheten holder
eksakt. Én skalar per spiller, lukket form, ingen frihetsgrader, ingen tuning.

Da er **eneste** forskjell fra baseline at tropper evalueres med reglene i
seksjon 6 og 7 i stedet for `Σ xP`. Enhver forskjell i poeng kommer fra
regelevalueringen, ikke fra at spillere ble verdsatt annerledes.

Faller en spillers `E[poeng | 60+]` under `E[poeng | 1–59]` etter skaleringen, er
det en implementasjonsfeil og kjøringen stoppes.

### V1A-1 — legger til ekte poengfunksjon

V1A-0 pluss:
- oppmøtepoeng 1 under 60 minutter og 2 fra 60, evaluert per tilstand
- ingen middelbevarende reskalering; forventningen får flytte seg

Her endrer spillerverdier seg. Effekten er ikke lenger ren regelevaluering,
men den er fortsatt fri for nye tilpassede parametre.

### Rapportering

Begge kjøres og rapporteres, mot samme grunnlinje og mot hverandre:

| Sammenlikning | Hva den isolerer |
| --- | --- |
| baseline → V1A-0 | Verdien av å evaluere FPL-reglene eksakt |
| V1A-0 → V1A-1 | Verdien av ekte 60-minuttersknekk oppå det |
| baseline → V1A-1 | Samlet effekt |

Akseptansekriteriene i seksjon 8 gjelder **hver** sammenlikning for seg. Består
V1A-1 samlet mens V1A-0 er flat, er konklusjonen at edgen ligger i
poengfunksjonen, ikke i regelevalueringen — og motsatt. Det er nettopp det som
ikke lot seg lese ut av den udelte testen.

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

### Lekkasjefri minuttavbildning — fryst her

Avbildningen fra spillertilstand til `(p_start, p_sub, P60|start, P60|sub)` er
**analytisk forhåndsbestemt** og fastsatt i dette dokumentet:

- `p_start` og `p_sub` kommer fra `ProjectionModel._role()`, som utelukkende
  leser `starts`, `minutes` og pris fra øyeblikksbildet **før** fristen. Ingen
  ny kilde introduseres.
- `P60|start = 0,85` og `P60|sub = 0,03` er **konstanter**, satt før testen og
  ikke estimert fra noen sesong.

**Regelen:** for hver historiske frist `t` kan sannsynlighetene bare bruke
informasjon tilgjengelig før `t`. Ingen parameter i V1A kalibreres på det
utfallet den senere evalueres mot.

Blir det senere aktuelt å estimere `P60|·` fra data i stedet for å holde dem
faste, er det **ikke** V1A. Det krever egen forhåndsregistrering og
walk-forward-tilpasning der hvert estimat bare bruker tidligere observasjoner —
kun framoverrettede splitter, samme regel som rettelsen i `docs/H4_RESULT.md`.
Å tilpasse en konstant på alle fire sesongene og så måle på de samme fire
sesongene er lekkasje, uansett hvor liten parameteren er.

---

## 5. Analytisk eller Monte Carlo?

### Decision
**Analytisk. Eksakt. Ingen Monte Carlo i V1A.**

### Regnestykket som avgjorde det

Naivt ser tilstandsrommet umulig ut: 3 tilstander × 15 spillere = 14,3 millioner
kombinasjoner. Strukturen kollapser, men **ikke** slik jeg først skrev det.

#### Rettelse av separabilitetspåstanden

Den opprinnelige formuleringen — «starterne er separable» — var upresis på en
måte som kunne skjult en ekte avhengighet bak en rask «eksakt» evaluator. Presist:

**Separabelt:** en starters *eget poengbidrag gitt at han spiller*. Spiller `i`
i tilstand «spilte» bidrar `poeng_i(tilstand)` uavhengig av hva de andre gjorde,
under antakelse 1 (uavhengige minuttilstander).

```
E[starternes egne poeng] = Σ_i  Σ_tilstand≠0  P(tilstand_i) · poeng_i(tilstand)
```

**Ikke separabelt:** *verdien av at en starter får 0 minutter*. Den avhenger av
hvor mange andre startere som også blanket, i hvilke posisjoner, hvilke
benkespillere som er tilgjengelige, og om formasjonen fortsatt er lovlig. To
blankende forsvarere er ikke to ganger én — den andre kan bli stående uerstattet
fordi benken er tom for forsvarere eller fordi 3-4-3 ikke tåler det.

Evaluatoren er derfor eksakt fordi den **aggregerer riktig**, ikke fordi
avhengigheten er antatt bort. Tilstanden som må føres videre er:

```
(antall blanke MV, antall blanke FOR, antall blanke MID, antall blanke SPS,
 hvilke av de fire benkespillerne som spilte,
 kapteinens tilstand, visekapteinens tilstand)
```

Antallet blanke per posisjon er en **Poisson-binomial** per posisjon, eksakt ved
konvolusjon over startere i den posisjonen. Det er tallene som må aggregeres —
identiteten til de blanke starterne spiller ingen rolle for autobytteutfallet,
bare antallet per posisjon.

Benkens tilgjengelighet er **ikke** marginal: den kombineres med
blankeopptellingen, og formasjonslovligheten avgjøres på den **kombinerte**
tilstanden. Nettopp derfor føres begge deler i samme tilstandsvektor i stedet for
å regnes hver for seg.

#### Kaptein og vice er ikke bare «separable»

Identiteten deres betyr noe, så de **skilles ut** av Poisson-binomialen og føres
eksplisitt:

- Kaptein og vice er selv startere. Deres tilstand teller **både** inn i
  blankeopptellingen for sin posisjon **og** i multiplikatorlogikken. Å la dem
  ligge implisitt i posisjonstellingen ville tapt hvem som blanket.
- Kaptein 0 **og** vice 0 → ingen dobling i det hele tatt.
- Kaptein eller vice kan selv bli autobyttet ut. En innbytter arver **aldri**
  kapteinsbindet — FPL flytter bindet bare kaptein → vice, aldri videre.

Rekkefølgen i evaluatoren er derfor: (1) trekk kapteins- og visetilstanden ut,
(2) konvolver de resterende starterne per posisjon, (3) legg kapteins- og
visetilstanden tilbake i posisjonstellingen, (4) kjør autobyttereglene på den
kombinerte tilstanden, (5) påfør multiplikatoren på det som faktisk står igjen.

#### Størrelsen på tilstandsrommet

For en 1-4-4-2 med kaptein og vice trukket ut: `2×5×5×3 = 150` posisjonsmønstre
× 16 benkmønstre = 2 400, ganger 9 kaptein/vice-kombinasjoner. Kaptein og vice
er allerede talt i posisjonsmønstrene, så produktet er en **øvre grense**, ikke
et eksakt antall — den reelle oppregningen er lavere fordi de fleste
kombinasjonene er umulige.

Øvre grense: under 25 000 tilstander per tropp per runde, de aller fleste med
neglisjerbar sannsynlighet. Fortsatt eksakt, fortsatt uten støy, fortsatt
raskere enn Monte Carlo med brukbar presisjon.

**Jeg har justert dette tallet opp fra «under 3 000» fordi den forrige
formuleringen fikk fart ut av å anta bort kaptein/vice-koblingen.** Det er
kjøretid vi kan betale; feil tilstandsrom er det ikke.

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
- Både kaptein og vice 0 minutter → **ingen dobling for noen**. Ikke for en
  innbytter, ikke for tredjevalget. Bindet forsvinner.
- Er kaptein eller vice på benken (kan skje etter autobytte-oppstilling), gjelder
  vanlige FPL-regler: en benket kaptein som kommer inn via autobytte beholder
  bindet, men en **innbytter arver aldri** et bind han ikke hadde.
- Kaptein og vice inngår samtidig i blankeopptellingen for sin posisjon. En
  blankende kaptein utløser altså både fallback **og** et mulig autobytte, og
  begge må evalueres på samme tilstand.

Dette er den eneste koblingen i modellen der spilleridentitet, ikke bare antall
per posisjon, påvirker utfallet. Derfor føres den eksplisitt (seksjon 5).

---

## 8. Akseptansekriterier — fryst

### A. Tre utfall — PASS, INCONCLUSIVE, FAIL

Testen har **tre** mulige utfall, ikke to. Alle er definert her, før kjøring.

| Utfall | Betingelse | Handling |
| --- | --- | --- |
| **PASS** | Snitt ≥ **+10** poeng/sesong **og** konsistenskravet i B **og** ingen brudd på invariantene i seksjon 12 | Skru på permanent. Registrer samme kriterier for 2026/27 som prospektiv validering |
| **INCONCLUSIVE** | Snitt **+5 til +10**, **eller** snitt ≥ +10 men konsistens- eller invariantkrav brutt uten at effekten er klart negativ | Ikke skru på. Ikke forkast hypotesen. Skriv opp som uavklart og la den vente på ferske data |
| **FAIL** | Snitt **< +5**, eller klart negativ | `FAILED`. Hypotesen forkastes, koden skrus ikke på |

Kriteriene gjelder **hver** av de tre sammenlikningene i seksjon 3A hver for seg.

`INCONCLUSIVE` finnes fordi de to alternativene ellers begge er løgner: å kalle
+7 poeng en suksess er å flytte målstengene, og å kalle det en fiasko er å
påstå at mekanismen er motbevist når den bare er umålbar med fire sesonger.

En `INCONCLUSIVE` kjøring **skrur ikke på funksjonen**. Den utløser heller ikke
en redesign fulgt av ny kjøring på de samme sesongene — det er nettopp hvordan
H4 ville blitt reddet hvis vi hadde latt den.

**Sterkt utfall** (> +25) endrer ikke beslutningen, men flagger at videre arbeid
bør prioriteres mot H1-mekanismer.

**Begrunnelse for +10, ikke +40:**

For **kontekst**, ikke som avledning: over 152 backtestede runder er det 1,02
autobytter per runde, og minst ett autobytte i 105 av 152 runder. Det sier at
mekanismen forekommer ofte nok til å kunne bety noe. Det er **ikke** en
utledning av +10 — jeg kan ikke gå fra autobyttefrekvens til forventet
poenggevinst uten å vite hvor ofte bedre informasjon faktisk endrer et valg, og
det er nettopp det testen skal måle.

+10 er valgt som en **beslutningsterskel**: under det er kompleksiteten ikke
verdt det gitt at implementasjonen også må vedlikeholdes; over det er den det.
+5 som gulv er satt fordi noe under det ikke lar seg skille fra tilfeldig
variasjon i byttesekvensene over fire sesonger.

Terskelen er en verdivurdering satt på forhånd, ikke et estimat. Den forsvares
som sådan.

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

### Paret årsakslogg

Per beslutningspunkt logges en rad med **begge sider av paret**, slik at
prediksjon og realisering kan holdes opp mot hverandre:

| Felt | Innhold |
| --- | --- |
| `season`, `event` | Hvilken runde |
| `baseline_action` | Hva grunnlinjen valgte |
| `v1a_action` | Hva V1A valgte |
| `predicted_baseline_EV` | V1A-evaluatorens verdi av grunnlinjens valg |
| `predicted_v1a_EV` | V1A-evaluatorens verdi av sitt eget valg |
| `predicted_delta` | `predicted_v1a_EV − predicted_baseline_EV` |
| `realized_baseline_points` | Faktiske poeng grunnlinjens valg ga |
| `realized_v1a_points` | Faktiske poeng V1As valg ga |
| `realized_delta` | `realized_v1a_points − realized_baseline_points` |
| `reason` | Årsakskategori |

Begge EV-ene måles med **samme** evaluator. Ellers sammenlikner vi to
måleinstrumenter, ikke to valg.

Årsak klassifiseres som: `kaptein`, `visekaptein`, `benkerekkefølge`,
`starter mot benk`, `bytte`, `ingen forskjell`.

Den kritiske avlesningen er `predicted_delta` mot `realized_delta`. Er
prediksjonen systematisk større enn realiseringen, overvurderer V1A sin egen
edge — samme optimizer's curse som H4 avdekket, bare på et annet nivå. Den
sammenhengen rapporteres eksplisitt, ikke bare summene.

### Metoderegel arvet fra H4

**Aldri vurder prognosekvalitet på modellens egen valgte tropp.**

For V1A betyr det:

- Alle **komponentmetrikker** (minuttkalibrering, forventet mot realisert
  troppspoeng, evaluatorskjevhet) måles **paret** — over samme tropp, eller over
  et felles kandidatunivers. Å måle V1A på V1As tropp og baseline på baselines
  tropp sammenlikner to spillerutvalg, ikke to evaluatorer.
- **Ende-til-ende-policypoeng** er unntaket: der *skal* troppene få lov til å
  divergere, for det er hele poenget med å endre policy. Den metrikken er paret
  på runde, ikke på spiller.

Blandes disse to, kan en dårligere evaluator se bedre kalibrert ut fordi den
valgte enklere spillere. Det er akkurat feilen jeg gjorde i H4.

### Aggregater
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
3 standardfeil av 100 000 MC-trekninger. Utdypet som test B under.

---

## 12A. Validering av den eksakte evaluatoren

Seksjon 5 påstår at aggregering per posisjon gir samme svar som full
oppregning. Den påstanden skal **bevises numerisk**, ikke antas. Feiler noen av
disse, er hele V1A ugyldig og kjøringen stoppes — uansett hva backtesten viser.

### Test A — brute force mot optimert analytisk

Konstruer en **liten** tropp der full oppregning er mulig: 15 spillere, 3
tilstander hver, men med de fleste sannsynlighetene degenerert slik at bare 6–7
spillere har mer enn én mulig tilstand. Det gir `3^7 = 2 187` fullstendige
verdener som kan regnes ut én for én, med autobytter og kapteinsfallback
anvendt eksplisitt på hver.

Den optimerte evaluatoren skal gi **nøyaktig samme** forventning:

```
| E_bruteforce − E_analytisk |  <  1e-9
```

Ikke «nær nok». Maskinpresisjon. Begge regner den samme endelige summen; ethvert
avvik er en feil i aggregeringen.

Kjøres over minst 200 tilfeldig genererte slike tropper, med varierte
formasjoner (3-4-3, 4-4-2, 5-3-2, 3-5-2), varierte benkeposisjoner, og tilfeller
der benken går tom for en posisjon.

**Dette er testen som ville avslørt en feilaktig separabilitetsantakelse.** Den
er derfor obligatorisk før noen backtest kjøres.

### Test B — Monte Carlo som uavhengig kryssjekk

Full tropp, ingen degenererte sannsynligheter, 100 000 trekninger med
uavhengig implementert autobyttelogikk. Analytisk svar skal ligge innenfor 3
standardfeil.

Test A beviser at aggregeringen er riktig gitt reglene. Test B fanger at
**reglene selv** er implementert likt to steder. De fanger ulike feil, så begge
kreves.

### Test C — sannsynlighetsmasse, permanent invariant

```
Σ_tilstand P(tilstand) == 1     innenfor 1e-12
```

Sjekkes for hver Poisson-binomial-konvolusjon, hver kombinerte tilstandsvektor
og hver kaptein/vice-fordeling. Ikke bare i tester: **assertion i produksjons-
koden**, aktiv under hele backtesten.

En konvolusjon som mister masse gir systematisk for lave forventninger, og gjør
det stille. Det er den feilmodusen som lettest ville blitt lest som «V1A virker
ikke».

### Test D — middelbevaring for V1A-0

Før noen troppskontekst, per spiller per runde:

```
| Σ_tilstand P(tilstand)·E[poeng|tilstand] − skalar_xP |  <  1e-9
```

Dette er invarianten som gjør V1A-0 til en ren ablasjon. Holder den ikke, har
tilstandsdekomposisjonen endret spillerverdier, og enhver forskjell i poeng kan
ikke lenger tilskrives regelevalueringen alene.

Sjekkes for **hver spiller i hver runde i hele backtesten**, ikke stikkprøver.

Merk at invarianten gjelder **standalone**, altså før autobytter og
kapteinsmultiplikator. I troppskontekst *skal* V1A-0 avvike fra `Σ xP` — det er
hele effekten som måles.

For V1A-1 gjelder den **ikke**, og det er meningen. Avviket fra `Σ xP` per
spiller logges der som en diagnostisk størrelse: det er ekstra
60-minuttersstruktur, ikke en feil.

---

## 13. Antakelser

1. Minuttilstander er uavhengige mellom spillere. Feil i virkeligheten — det er
   H2 — men holdes fast så V1A tester én ting. Merk at dette er den **eneste**
   uavhengighetsantakelsen: autobytteverdien behandles som avhengig (seksjon 5),
   og evaluatoren aggregerer den, den antar den ikke bort.
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
| Feil i Poisson-binomialen | Sannsynligheter summerer ikke til 1 | Test C, aktiv assertion |
| Benkeverdi overvurdert | Benken tas med for ofte | Fasittest 1 og 3 |
| **Antatt bort en ekte avhengighet** | Rask evaluator, subtilt feil svar | **Test A, brute force til 1e-9** |
| Verdiendring forkledd som regeleffekt | V1A-0 ser ut til å virke, men flyttet spillerverdier | Test D, middelbevaring |
| Innbytter arver kapteinsbind | For høy forventet kapteinsverdi | Fasittest 2, utvidet med kaptein+vice begge 0 |
| Skjult tuning | Kriterier «justeres» etterpå | Dette dokumentet, tre definerte utfall |
| Redning av et uavklart resultat | Redesign kjøres på samme fire sesonger | `INCONCLUSIVE` skrur ikke på og utløser ikke ny kjøring |
| Baseline endret | Referansetallene flytter seg | Referansetallene står i seksjon 3 |

---

## 15. Nøyaktig hva som bygges

1. `fplbot/appearance.py` — minuttilstander fra eksisterende parametre,
   middelbevarende skalering for V1A-0, Poisson-binomial per posisjon,
   eksplisitt kaptein/vice-tilstand, eksakt forventet troppsverdi med autobytter
   og kapteinsfallback.
2. Tester for fasittestene 1–6.
3. `tests/test_appearance_exact.py` — validering A, B, C, D fra seksjon 12A.
   **Skrives og består før noen backtest kjøres.**
4. `scripts/run_v1a_test.py` — paret backtest for V1A-0 og V1A-1, blokkbootstrap,
   paret årsakslogg med feltene i seksjon 11.
5. `docs/V1A_RESULT.md` — resultatet, uansett fortegn, med alle tre
   sammenlikningene og eksplisitt PASS / INCONCLUSIVE / FAIL.

Baseline og historiske utdata røres ikke.

Rekkefølgen er bindende: validering før måling. Kjøres backtesten før 12A
består, er tallene ikke til å stole på uansett hva de viser.

---

## Forpliktelse

Kriteriene over er fryst. Resultatet rapporteres uansett fortegn, med samme
grundighet som H4 fikk.

- **FAIL** → skrives opp som `FAILED`, koden skrus ikke på, vi går videre. Vi
  redder den ikke.
- **INCONCLUSIVE** → skrives opp som uavklart. Ikke påskrudd, ikke forkastet,
  ikke kjørt om igjen på de samme sesongene.
- **PASS** → skrus på, og beskrives som «bestått forhåndsregistrert retrospektiv
  test», ikke som bekreftet. Bekreftelse krever 2026/27.

Målet er at et negativt resultat skal være like troverdig som et positivt. Det
er derfor valideringen i 12A er obligatorisk og går først: uten den kan et
negativt resultat like gjerne være en aggregeringsfeil som en død hypotese, og
da har testen ikke fortalt oss noe.
