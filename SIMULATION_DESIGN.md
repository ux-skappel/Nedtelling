# SIMULATION_DESIGN

Spesifikasjon for simuleringslaget i fplbot. Konkret nok til å implementeres
direkte. Alle tall som oppgis som målt, er målt i dette repoet mot ferdigspilte
sesonger — ikke hentet fra litteraturen.

**Premisset er en hypotese, ikke en beslutning.** Vi bygger simulering for å
teste om utfallsfordelinger med realistiske korrelasjoner gir *materielt bedre
beslutninger* enn skalar xP. Akseptansekriteriene i seksjon 25 er skrevet før
testen kjøres og skal ikke flyttes etterpå. Hvis en enklere modell tar de samme
beslutningene, bruker vi den enklere modellen.

---

## 0. Tre korreksjoner til forrige designnotat

Før spesifikasjonen: tre ting jeg tok for hardt i, som er rettet her.

**Flerukesoptimering er ikke avkreftet.** Jeg konkluderte at åtte poengs
spredning over seks policyer viste at flerukessøk er verdiløst. Testen viser
ikke det. Den seks policyene delte samme projeksjoner, samme grådige
byttestruktur, ingen chips og ingen minutteusikkerhet — de var varianter av én
strategi, ikke ulike strategier. Hypotesen holdes åpen, og seksjon 13 spesifiserer
en test som faktisk kan avgjøre den.

**«Valider på sluttpoeng, ikke MAE» var for grovt.** Sluttpoeng har enorm
varians, og å optimere direkte mot det inviterer overtilpasning. Seksjon 17
bruker den lagdelte valideringen du foreslo.

**Min MAE-sammenlikning var feil målt.** Påstanden «bedre MAE, færre poeng» kom
fra en måling over hver kjørings *egen* tropp — to forskjellige spillerutvalg.
Over en felles kandidatpool er varianten dårligere på begge mål. Det ekte funnet
er skarpere, og står i seksjon 17.

---

## 1. Målfunksjon

### Decision
Én målfunksjon, ikke tre moduser:

```
maximize  E[ U(R) ]        U(r) = σ( (log R* − log r) / τ )
```

der `R` er sluttplassering, `R*` er ambisjonsnivået, `τ` er mykhet, og `σ` er
logistisk. `EV MODE`, `RANK MODE` og `TARGET MODE` er punkter i denne familien:

| Modus | Parametre | Oppførsel |
| --- | --- | --- |
| TARGET | `τ → 0` | Hard terskel på `R*`. Patologisk, se under |
| RANK | `τ ≈ 1–2` | Myk ambisjon rundt `R*` |
| EV | `τ → ∞` | `U` blir lokalt lineær i log-rank ≈ maksimer poeng |

### Why
En hard terskel er patologisk fordi den er flat overalt bortsett fra ved `R*`:
en plan som gir 30 % sjanse for topp 10k og 70 % sjanse for 8 millioner
rangeres likt med en som gir 30 % og 70 % sjanse for 200k. Den bryr seg ikke om
hvor ille det går når det går galt. Den logistiske myker dette opp uten å miste
ambisjonen.

Log-rank er riktig skala fordi FPL-rank er tilnærmet log-uniform fordelt: å gå
fra 1M til 500k og fra 100k til 50k er omtrent like vanskelig. Målt på våre egne
rangeringskurver holder dette godt over midtfeltet.

### Alternative
- `U(r) = −log r` (ren skalafri). Enklere, men har ingen ambisjonsparameter og
  vekter halen for lite.
- Lineær i persentil. Feil: behandler 55 %→50 % som like verdifullt som 1 %→0,5 %.
- Ren `P(top X)`. Det er `τ → 0` og forkastes over.

### How we validate
Kjør backtest med `τ ∈ {0.5, 1, 2, 5, ∞}` og `R*` = 10k. Plott
sluttrankfordelingen per innstilling. Aksept: `τ → ∞` skal reprodusere dagens
EV-oppførsel innenfor ±15 poeng, og lav `τ` skal øke både halene. Ser vi ikke
det, er implementasjonen gal — ikke teorien.

---

## 2. Hvordan målet endrer seg gjennom sesongen

### Decision
**Ingen modusbytte. Ingen regel av typen «GW30 → jag rank».** Vekten mellom
poeng og rank kommer ut av matematikken av seg selv.

### Why
Dette er det eleganteste svaret på spørsmålet ditt, og det følger direkte av å
alltid maksimere `E[U(R)]`.

I august er fordelingen over sluttrank enormt bred. Over et så bredt intervall
er `U` tilnærmet lineær, og en lineær utility av rank er — via kurven fra poeng
til rank — tilnærmet monotont i forventede poeng. **Så tidlig i sesongen
maksimerer `E[U]` nesten nøyaktig forventede poeng, uten at vi ber om det.**

I april er fordelingen smal og sentrert et sted på kurven. Da biter krumningen i
`U`. Ligger du like over `R*`, blir `U` konkav lokalt og boten blir
risikoavers — den beskytter plasseringen. Ligger du under `R*`, blir `U` konveks
lokalt og boten søker varians — men bare så mye som faktisk trengs for å nå
`R*`, ikke mer.

Det er dette som skiller reell rank-optimering fra «ta mer risiko». Varians er
aldri et mål i seg selv; den er en pris `U` noen ganger er villig til å betale.

### Alternative
Eksplisitt `season_state → mode`-tabell. Forkastet: vilkårlig, og gir hopp i
oppførsel ved rundeskiller.

### How we validate
Mål den implisitte vekten empirisk: kjør boten fra ulike (rank, GW-igjen)-
tilstander på historiske data og regn ut korrelasjonen mellom valgt plan og
ren-EV-planen. Forventet mønster: korrelasjon nær 1 tidlig, fallende utover
sesongen, og fallende raskere jo lenger fra `R*` du er.

---

## 3. Generativ modell for spillerutfall

### Decision
Hierarkisk, i denne rekkefølgen per kamp:

1. **Kamptilstand:** lagmål `(G_h, G_a)` trekkes.
2. **Minutter:** hver spillers tilstand og minutter, betinget på lag.
3. **Målfordeling:** lagets mål fordeles på spillere som faktisk var på banen.
4. **Assists:** betinget på hvert mål.
5. **Øvrige hendelser:** redninger, kort, dødballer, defcon.
6. **Bonus:** fra simulert BPS.
7. **Poeng:** FPL-reglene anvendes på hendelsene.

Ingen fordeling legges rundt xP. xP blir et *resultat* av simuleringen, ikke en
input til den.

### Why
Korrelasjonene vi trenger oppstår gratis: to Chelsea-forsvarere holder nullen i
nøyaktig de trekningene der `G_a = 0`. En Chelsea-spiss har flere returns i
trekninger der Chelsea scorer tre. Det er den strukturen du beskrev, og den er
riktig av konstruksjon i stedet for påklistret i etterkant.

### Alternative
Normalfordeling rundt xP med en korrelasjonsmatrise. Forkastet: krever at vi
estimerer korrelasjoner vi ikke har data til, gir negative poeng med positiv
sannsynlighet, og bommer på formen (FPL-poeng er svært høyreskjeve og har atomer
på 0, 1, 2).

### How we validate
Simuler hver ferdigspilte runde i arkivet og sammenlikn simulert fordeling mot
faktisk. Ikke bare snitt: sjekk `P(0)`, `P(≥10)`, `P(≥15)` per posisjon, og
kalibreringsplott (predikert sannsynlighet mot observert frekvens i desiler).

---

## 4. Kampmodell

### Decision
Uavhengig Poisson per lag med **Dixon-Coles-korreksjon** for lave scorer.
`λ` kommer fra dagens lagstyrkemodell (angreps- og forsvarsrating fittet på
faktiske mål).

### Why
Vi har allerede en fittet lagstyrkemodell som produserer forventede mål begge
veier. DC-korreksjonen retter det ene stedet uavhengig Poisson beviselig bommer:
0–0, 1–0, 0–1 og 1–1 er vanligere enn uavhengighet tilsier, og nettopp de
scorene avgjør clean sheets. Korreksjonen er én parameter (`ρ`), estimerbar fra
våre egne 4×380 kamper.

### Alternative
- **Bivariat Poisson.** Kan bare modellere positiv korrelasjon mellom lagmål;
  fotball har svakt negativ. Mer maskineri, ikke bedre passform.
- **Negativ binomial.** Løser overdispersjon vi ikke har vist at finnes. Test det
  når residualene sier at vi trenger det.

### How we validate
Sammenlikn simulert scorefordeling mot observert i arkivet: χ² over
scorematrisen, og spesifikt clean sheet-rate per lagstyrkedesil. Aksept:
simulert CS-rate innenfor ±3 prosentpoeng av observert i hvert desil.

---

## 5. Minuttmodell

### Decision
Tre tilstander, deretter minutter betinget på tilstand:

```
P(start), P(innhopp), P(ubrukt)      Σ = 1
minutter | start   ~ empirisk fordeling, atom på 90
minutter | innhopp ~ empirisk fordeling, tyngdepunkt 10–25
```

De seks bøttene du ba om (`P(0)`, `P(1–29)`, …) er **output**, ikke modellen.

### Why
Tilstandene er det som faktisk genererer dataene, og de er direkte observerbare
i arkivet (`starts` og `minutes` per runde). En modell direkte på bøttene ville
kastet bort den strukturen og gjort betinging på nyheter vanskeligere — en
skademelding flytter `P(start)`, ikke bøtte 4.

Dette er også der dagens modell allerede har lært en dyr lekse: en tidligere
versjon brukte snittminutter og ga en reservekeeper 21,3 xP fordi 25
snittminutter ble lest som «møter opp hver kamp». Enhver modell på snittminutter
gjør den feilen.

### Alternative
Ordinal regresjon direkte på bøttene. Enklere å fitte, men mister
tolkbarheten og gjør nyhetsinnputt vanskelig.

### How we validate
Level 1: Brier-score på `P(start)` og `P(60+)`, mot to baselines — forrige rundes
start, og rullende startandel over fem runder. Aksept: bedre enn begge på
walk-forward.

---

## 6. Korrelasjonsmodell

### Decision
Ingen eksplisitt korrelasjonsmatrise. All korrelasjon oppstår fra delt
kamptilstand i hierarkiet.

Én tilleggskanal må inn eksplisitt: **DGW-avhengighet**. Minutter i kamp 2
betinges på minutter i kamp 1 (spilte 90 → lavere `P(start)` i kamp 2, skalert
med hviledager).

### Why
Du har rett i at påklistrede pairwise-korrelasjoner er svakere enn generativ
struktur. Det eneste stedet strukturen ikke fanger avhengigheten, er over tid
innenfor samme runde.

### How we validate
Mål korrelasjonen mellom lagkameraters faktiske rundepoeng i arkivet, og
sammenlikn mot simulert. Særlig: to forsvarere på samme lag (forventet sterkt
positiv), spiss og keeper på samme lag (forventet svakt positiv), og
motstanderes forsvarere (forventet negativ).

---

## 7. Autobytter

### Decision
Simuler hele 15-mannstroppen gjennom de faktiske reglene i hver trekning:
oppstilling → hvem spilte → autobytter i benkerekkefølge med
formasjonsvalidering → kaptein til vice hvis kapteinen har 0 minutter.

Motoren har allerede en verifisert implementasjon av dette i backtesten
(`apply_autosubs`), som gjenbrukes.

### Why
Autobytter er en ikke-lineær gevinst: benken teller *bare* når en starter
blanker. Forventningsregning kan ikke se den, og undervurderer derfor benken
systematisk. Dette er det klareste enkeltargumentet for simulering i det hele
tatt, og det er direkte målbart.

### How we validate
Sammenlikn simuleringens anslag for benkebidrag mot faktisk realisert
autobyttegevinst i backtesten. Aksept: innenfor ±20 % på sesongtotal.

---

## 8. Kaptein og visekaptein

### Decision
Samme motor. Output per kandidat:
`E[poeng]`, `P(blank ≤2)`, `P(return ≥6)`, `P(≥10)`, `P(≥15)`, `P(≥20)`, og
`E[U]`-bidraget gitt gjeldende målfunksjon.

Valget gjøres på `E[U]`, ikke på `E[poeng]`.

### Why
To spillere med samme forventning kan ha helt ulik halesannsynlighet. Hvilken
som er riktig avhenger av målfunksjonen — og med EO i feltmodellen kan en
høyeid kaptein være riktig selv med lavere forventning, fordi den beskytter
mot nedside i rank.

### How we validate
Level 2: treffrate mot en orakel-kaptein i backtesten, og gjennomsnittlig tapte
poeng mot beste mulige valg. Baseline: høyeste xP. Aksept: ikke dårligere enn
baseline på poeng, og bedre på `E[U]` i rank-modus.

---

## 9. Chips

### Decision
Alle fire simuleres innenfor samme motor: Bench Boost teller alle 15, Triple
Captain tredobler, Wildcard og Free Hit gir ubegrensede bytter den runden med
Free Hit-tilbakestilling etterpå. Beslutningen tas på `E[U]` med og uten kortet,
mot **opsjonsverdien av å spare det**, estimert ved å simulere resten av
sesongen med kortet tilgjengelig.

### Why
Dagens chip-policy er terskelbasert og svak: andre wildcard blir *tvunget* ut i
GW36 uten å bli valgt. Riktig ramme er opsjonsprising — et kort er verdt
`max(bruk nå, forventet verdi av å ha det igjen)`.

Merk at chips allerede er målt til **+105 poeng i snitt** med grov policy, og at
første måling ga bare +24,8 fordi policyen brøt FPL-reglene. Det er mye igjen her.

### How we validate
Backtest med og uten chip-simulering. Aksept: ikke dårligere enn dagens +105, og
den tvungne GW36-wildcarden skal forsvinne.

---

## 10. Dobbeltrunder

### Decision
To separate kamper i hierarkiet, med minuttbetinging mellom dem (seksjon 6).
Ikke `2 ×` samme kamp.

### Why
Rotasjon etter kamp 1 er reell og størst nettopp i DGW, som er når chips spilles
og feilen koster mest.

### How we validate
Sammenlikn simulert mot faktisk poengfordeling i historiske DGW-er spesifikt.
Få observasjoner, så dette er en svak test — det noteres som en kjent begrensning.

---

## 11. Feltmodell

### Decision — to trinn, ærlig om usikkerheten

**V1: analytisk felt via EO.** Ikke simuler managere. Feltets snittpoeng i en
trekning er

```
field_score ≈ Σ_p  EO_p × points_p  +  baseline
```

der `EO_p` er effektivt eierskap (eierskap + kapteinandel). Din relative
posisjon i trekningen er `my_score − field_score`. Dette bruker de samme
trekningene, koster nesten ingenting, og fanger den viktigste effekten: **eier du
malen, er dine gode uker også alles gode uker.**

**V2 (utsatt): kohorter.** Casual / aktiv / topp-100k-lik / elite, med hver sin
EO-vektor og chip-atferd.

### Why
Kohortmodellering er spekulativt uten data om hva hver kohort faktisk eier. Vi
har elite-eierskap (målt, fra toppen av verdensrankingen) og totalt eierskap fra
FPL. Det gir to punkter, ikke fem kohorter. Å finne på de tre andre ville vært
å pynte en gjetning som en modell.

### Fra «spilleren min scoret 12» til rank

Dette er kjeden, konkret:

1. Spilleren scoret 12 med effektivt eierskap 40 %. Ditt bidrag *relativt til
   feltet* er `12 × (1 − 0,40) = 7,2` poeng.
2. Summert over troppen gir det ditt forsprang på feltsnittet denne runden.
3. Akkumulert over sesongen gir det din sluttscore relativt til feltet.
4. Kurven fra poeng til rank — **allerede bygget, fra ekte lags
   sesonghistorikker** — oversetter sluttscoren til plassering.
5. Fordelingen over trekninger gir fordelingen over rank, og dermed `E[U(R)]`.

Steg 4 er ikke teori: kurvene finnes i `fplbot/backtest/rank.py`, bygget av
noen hundre tilfeldig trukne lag per sesong.

### Alternative
Ren empirisk CDF uten EO. Enklere, men mister korrelasjonen mellom din score og
feltets — som er hele poenget med rank-optimering.

### How we validate
Backtest: sammenlikn simulert sluttrankfordeling mot faktisk oppnådd rank for
kjente poengsummer. Aksept: faktisk rank innenfor det simulerte 80 %-intervallet
i minst 3 av 4 sesonger.

---

## 12. Rank-simulering

Dekket av seksjon 11. Ingen egen manager-simulering i V1.

---

## 13. Grensesnitt mot flerukesoptimering

### Decision
Simuleringen eksponerer:

```python
evaluate_plan(plan, state, draws) -> {"E_points": float, "E_utility": float, "rank_dist": ...}
```

En `plan` er en sekvens av rundevise handlinger. Optimereren er *utenfor*
simuleringen og kan byttes ut uavhengig.

### Testen som avgjør flerukeshypotesen
Med denne strukturen kan vi endelig gjøre den rettferdige sammenlikningen du ber
om — **samme projeksjoner, samme simulering, kun søket varierer**:

| Arm | Beskrivelse |
| --- | --- |
| A | Grådig, 1 runde |
| B | 3 runders rullende horisont |
| C | 5 runders rullende horisont |
| D | Beam search over byttesekvenser, bredde 20 |

Alle fire med chips, minutteusikkerhet, prisbegrensninger og samme
trekningsstrøm. Måles ende-til-ende over fire sesonger, walk-forward.

**Forhåndsregistrert:** flerukessøk beholdes bare hvis beste arm slår A med
**≥ 25 poeng i snitt** og med riktig fortegn i **≥ 3 av 4 sesonger**. Ellers
dropper vi kompleksiteten. Terskelen er satt over den målte
policy-spredningen (±8) med god margin.

---

## 14. Konvergenskrav for Monte Carlo

### Decision
- **Felles tilfeldige tall (CRN)** mellom alle alternativer som sammenliknes.
- V1: **4 000 trekninger** per beslutning.
- Konvergens rapporteres som standardfeil på *differansen* mellom alternativer,
  ikke på nivået.

### Why
CRN er den viktigste enkeltbeslutningen her. Sammenlikner vi to bytter med
uavhengige trekninger, drukner differansen på ~0,3 poeng i støy med SD ~4, og vi
trenger titusener av trekninger. Med samme trekningsstrøm forsvinner det aller
meste av felles varians, og differansens standardfeil faller med en
størrelsesorden. Dette gjør forskjellen på om simulering er praktisk i det hele
tatt.

### How we validate
Kjør samme beslutning med 1k, 4k, 16k og 64k trekninger. Aksept: rangeringen av
topp 5 alternativer stabil fra 4k og oppover i ≥ 95 % av tilfellene.

---

## 15. Nødvendige inndata

| Data | Kilde | Status |
| --- | --- | --- |
| Priser, posisjon, lag, eierskap | FPL `bootstrap-static` | Finnes |
| xG/xA/xGI per 90, defcon, redninger | FPL `bootstrap-static` | Finnes |
| Starter og minutter per runde | FPL + arkiv | Finnes |
| Skadeflagg, `chance_of_playing` | FPL `bootstrap-static` | Finnes |
| Dødballrekkefølge | FPL `bootstrap-static` | Finnes |
| Dødballnotater (redaksjonelle) | FPL `team/set-piece-notes` | Finnes, ubrukt |
| Kampresultater | FPL `fixtures` | Finnes |
| Elite-eierskap | FPL liga 314 | Finnes |
| Poeng→rank-kurver | Samplede lags historikk | Finnes |
| Historikk per runde | vaastav-arkivet | Finnes, verifisert |
| BPS per runde | Arkivet | Finnes |
| Bookmakerodds | the-odds-api | **Mangler nøkkel** |

---

## 16. Håndtering av manglende data

### Decision
Aldri fyll inn oppdiktede tall. Hver avledet størrelse bærer en `confidence`, og
manglende input propagerer til **bredere fordeling**, ikke til et gjettet punkt.

Konkrete fallbacks:

| Mangler | Fallback |
| --- | --- |
| Fjorårets rater (nysignert) | Posisjonsmedian, bred fordeling, `confidence = low` |
| Lagstyrke (august) | Krymp mot FDR, som i dag |
| EO (før GW1) | Bruk totalt eierskap; markér feltmodell som `degraded` |
| Odds | Egen lagstyrkemodell |
| Dødballnotater | Kun `penalties_order` fra bootstrap |

### Why
En bred fordeling er en ærlig representasjon av «vi vet ikke». Et gjettet
punktestimat ser like selvsikkert ut som et godt et, og optimereren kan ikke se
forskjell.

---

## 17. Valideringsmetodikk

### Decision — tre lag, som du foreslo

**Level 1 — komponentnøyaktighet.** Brier på `P(start)`/`P(60+)`; kalibrering av
mål-, assist- og CS-sannsynligheter; rangeringsevne (Spearman) på tvers av
spillere per runde.

**Level 2 — beslutningsnøyaktighet.** Kapteinstreff, byttedelta mot orakel,
benkerekkefølge, chip-timing.

**Level 3 — ende-til-ende.** Sesongpoeng, `E[U]`, målsannsynligheter.

### Den nye hovedmetrikken: kalibrering betinget på utvalg

Global MAE over 600 spillere er nesten irrelevant når boten kjøper 15. Målt for
2025/26, skjevhet per rangeringssjikt (anslag minus fasit):

| Sjikt | Uten fjorårsdata | Med fjorårsdata |
| --- | --- | --- |
| **Topp 1–15** | **+0,54** | **+0,94** |
| Topp 16–30 | +0,07 | +0,29 |
| Topp 31–60 | −0,02 | +0,11 |
| Topp 61–150 | −0,16 | +0,07 |
| Global MAE | 1,30 | 1,32 |

Varianten som tapte 128 poeng overvurderer sine egne toppvalg med nesten det
dobbelte. Det er optimizer's curse i ren form: optimereren velger nettopp de
spillerne der modellens feil peker oppover.

Merk også at **alle** konfigurasjoner overvurderer topp 15. Det er en
systematisk skjevhet som simuleringen må håndtere, ikke en kuriositet.

**Konsekvens for designet:** skjevhet i topp 15–30 blir en Level 1-hovedmetrikk,
rapportert ved hver modellendring. En endring som forbedrer global MAE men øker
toppskjevheten, avvises.

### Walk-forward
Ingen tuning og rapportering på samme sesonger. Fit på 2022–23 og 2023–24, valider
på 2024–25, hold 2025–26 urørt til slutt. Prediksjoner persisteres med tidsstempel
før utfall er kjent.

---

## 18. Baselines

Hver arm måles mot alle disse:

1. **Skalar xP** — dagens bot. Hovedmotstanderen.
2. **Bytt aldri** — måler verdien av vedlikehold (målt: −500 poeng).
3. **Terningkast** — gulv (målt: 895 poeng).
4. **Bare pris** — naiv, men reell informasjon (målt: 1320 poeng).
5. **Fasit** — tak og lekkasjedetektor (målt: 3671 poeng).
6. **Malen** — eie de høyest eide spillerne. Direkte relevant for rank-påstander.

---

## 19. Metrikker

| Nivå | Metrikk | Baseline å slå |
| --- | --- | --- |
| 1 | Brier på `P(start)` | Rullende startandel |
| 1 | **Skjevhet topp 1–15** | Dagens +0,54 |
| 1 | CS-kalibrering per styrkedesil | ±3 pp |
| 1 | Spearman på tvers av spillere | Dagens 0,296 |
| 2 | Kapteinstreff mot orakel | Høyeste xP |
| 2 | Benkerekkefølge: realisert autobyttegevinst | Dagens |
| 3 | Sesongpoeng | 2307 (2025/26) |
| 3 | `E[U]` og `P(topp 100k)` | Skalar xP |
| 3 | Dekning av rankintervall | 80 % nominelt |

---

## 20. Beregningskostnad

Dagens full sesongbacktest: **~10 s**. Budsjett for simuleringsversjonen:
**≤ 90 s** per sesong.

Regnestykket: 38 runder × 4 000 trekninger × ~600 spillere = 91 millioner
spillertrekninger per sesong. Ren Python klarer ikke det. **Vektorisering med
numpy er et krav, ikke en optimalisering** — trekk hele `(draws × players)`-
matriser om gangen. Med det er 90 s realistisk.

Ved brudd på budsjettet: reduser trekninger før du reduserer realisme, og bruk
CRN hardere.

---

## 21. Forenklinger i V1

| Forenkling | Begrunnelse |
| --- | --- |
| Ingen kohorter i feltmodellen | Ikke data. Analytisk EO i stedet |
| Ingen odds | Mangler nøkkel |
| Ingen nyhetsmotor | Egen leveranse, ikke i veien for hypotesen |
| Bonus fra BPS-fordeling, ikke full BPS-simulering | Full BPS krever hendelsesdata vi ikke har per runde |
| Grådig 1-runde optimerer | Flerukestesten kommer etter at simuleringen virker |
| Ingen prisendringsmodell | Behandles som fast innenfor horisonten |

---

## 22. Eksplisitt utsatt

Kohortbasert feltmodell. Bookmakerodds som prior. MCTS. Nyhetsmotor med
tillitsnivåer. Opsjonsverdi av lagverdi. Internasjonale pauser og
europacupbelastning som eksplisitte variabler.

Utsatt betyr utsatt, ikke forkastet. Alle står i seksjon 13-rammen og kan testes
når fundamentet virker.

---

## 23. Antakelser som bærer designet

1. **Lagmål er tilnærmet Poisson med DC-korreksjon.** Vil bli testet direkte.
2. **Målfordeling innad i laget er tilnærmet multinomisk på xG-andeler.** Ignorerer
   at spillere bytter rolle midt i kamp.
3. **Feltet påvirkes ikke av våre valg.** Trygt for én manager blant 12 millioner.
4. **EO er en tilstrekkelig statistikk for feltet.** Den svakeste antakelsen. Den
   ignorerer at feltets varians ikke bare avhenger av snittet.
5. **Kurven fra poeng til rank er stabil innenfor en sesong.** Den bygges på
   sluttrank, og brukes på delsummer underveis.
6. **Minutter er betinget uavhengige gitt kamptilstand.** Ignorerer at en manager
   tar av flere spillere samtidig ved 3–0.

---

## 24. Feilmoduser

| Feilmodus | Symptom | Vern |
| --- | --- | --- |
| Halene for smale | Faktisk rank utenfor simulert intervall | Dekningstest, seksjon 11 |
| Optimizer's curse forsterket | Toppskjevhet øker | Level 1-metrikk, seksjon 17 |
| Tilfeldig contrarian play | `E[U]` opp, poeng kraftig ned | Krev at EV-modus reproduserer dagens resultat |
| For få trekninger | Beslutninger flakker mellom kjøringer | Stabilitetstest, seksjon 14 |
| CRN feil implementert | Differanser støyete tross høy N | Enhetstest: identiske alternativer skal gi differanse nøyaktig 0 |
| Stille datasvikt | Fordelinger uendret tross ny runde | `fplbot doctor`, utvidet |
| Overtilpasning til fire sesonger | Sterk backtest, svak i praksis | Walk-forward, urørt 2025/26 |

---

## 25. Akseptansekriterier — forhåndsregistrert

Hypotesen:

> Utfallsfordelinger med realistiske korrelasjoner og faktiske FPL-regler gir
> materielt bedre beslutninger enn skalar xP.

**«Materielt bedre» defineres nå, før testen kjøres:**

**Primærkriterium.** I EV-modus, over fire sesonger, walk-forward:
sesongpoeng **≥ +40 i snitt** mot skalar xP, med riktig fortegn i **≥ 3 av 4**
sesonger.

*Begrunnelse for 40:* over den målte policy-støyen (±8) med fem gangers margin,
og omtrent 1 poeng per runde — samme størrelsesorden som en tredel av
chip-gevinsten. Under dette er kompleksiteten ikke verdt det.

**Sekundærkriterier** (alle må holde):
- Benkerekkefølge: realisert autobyttegevinst **≥ +15 poeng** per sesong.
- Skjevhet topp 1–15 **ikke verre** enn dagens +0,54.
- Dekning av 80 %-rankintervall i **≥ 3 av 4** sesonger.
- Kjøretid **≤ 90 s** per sesongbacktest.

**Kill-kriterium.** Klarer ikke simuleringen primærkriteriet, men en enkel
variansheuristikk på skalar xP (for eksempel å straffe spillere med lav
`P(start)`) kommer innenfor 15 poeng av den — **skipper vi heuristikken og
skroter simuleringen.**

---

## V1: minste versjon som avgjør hypotesen

Nøyaktig dette, ikke mer:

1. **Kampmodell:** Poisson + DC, `λ` fra dagens lagstyrke.
2. **Minutter:** tre tilstander, empiriske fordelinger fra arkivet.
3. **Spillerutfall:** mål multinomisk på xG-andel, assists betinget på mål,
   CS fra `G_mot = 0`, defcon Poisson, bonus fra BPS-fordeling.
4. **Full tropp gjennom reglene:** autobytter, kaptein, vice.
5. **4 000 trekninger med CRN.**
6. **Feltmodell:** analytisk EO + eksisterende rankkurver.
7. **Målfunksjon:** `E[U]` med `τ` som parameter; standard `τ → ∞` (EV-modus).
8. **Optimerer:** uendret grådig 1-runde.

Punkt 8 er med vilje. **V1 endrer bare hvordan alternativer *evalueres*, ikke
hvordan de *søkes*.** Da måler primærkriteriet én ting: er fordelinger bedre enn
skalarer? Endrer vi søket samtidig, vet vi ikke hva som virket.

Flerukessøk testes i steg to, med simuleringen holdt fast.
