# SIMULATION_DESIGN — ADDENDUM A

Svar på tolv innvendinger mot hoveddokumentet. Tre av dem viser seg å være
riktige mot meg, og én av dem fant et hull som ville gitt falsk presisjon i alt
rank-arbeid. Alle tall her er målt i denne sesjonen; skriptene ligger i repoet.

**Sammendrag av hva som endres:**

| Punkt | Utfall |
| --- | --- |
| τ → ∞ = EV-modus | **Feil.** Erstattet med eksplisitt blanding |
| Overgang oppstår automatisk | **Feil.** Refutert av toy-modell |
| EO er nok for rankfordeling | **Feil.** Begrenset til forventet relativ gevinst |
| Rankkurven tåler P(topp 10k) | **Feil.** Dekker ikke halen i det hele tatt |
| +40 poeng som terskel | Revidert, med paret evaluering |
| CRN | Beholdes, presisert |

---

## 1. Målfunksjonen — du har rett

### Regnestykket

`U(r) = σ((log R* − log r)/τ)`. Når `τ → ∞` går argumentet mot 0 og
`σ(x) ≈ ½ + x/4`, altså

```
E[U] ≈ ½ + (log R* − E[log R]) / (4τ)
```

`argmax E[U]` blir da `argmin E[log R]` — **forventet log-rank, ikke forventede
poeng.** Å kalle det EV-modus var feil.

### Er forventet log-rank likevel omtrent forventede poeng?

Det ville krevd at `log R` er lineær i sluttpoeng `S`. Målt på de ekte kurvene:

| Sesong | R² (hele spennet) | R² (over 2000 p) | Lokal helning 1400–1900 → 2200–2600 |
| --- | --- | --- | --- |
| 2022/23 | 0,52 | 0,86 | −0,0009 → −0,0109 (**×12,4**) |
| 2023/24 | 0,49 | 0,91 | −0,0011 → −0,0119 (**×10,8**) |
| 2024/25 | 0,62 | 0,90 | −0,0011 → −0,0105 (**×10,0**) |
| 2025/26 | 0,62 | 0,92 | −0,0015 → −0,0198 (**×13,6**) |

Ett poeng flytter deg 10–13 ganger mer i log-rank øverst enn nederst. `log R` er
altså klart konkav i `S`, så `−log R` er **konveks** — en objektiv som iboende
belønner varians. Den er ikke en nøytral erstatning for forventede poeng.

### Decision
Bruk din opsjon B, med `E[S]` som et ekte spesialtilfelle:

```
J_λ(plan) = (1 − λ) · E[S] / S_scale  +  λ · E[U(R(S))]
```

- `λ = 0` → **eksakt** maksimering av forventede poeng.
- `λ = 1` → ren rank-utility, med `τ` som ambisjonsknapp.
- `S_scale` er standardavviket til sluttpoeng, så begge ledd er dimensjonsløse.

### Why
Familien inneholder nå målet vi faktisk vil ha som et matematisk punkt, ikke som
en grense den aldri når. Ingen eleganse går tapt som var ekte.

### Alternative
Beholde én utility og hevde at den dekker alt. Forkastet av regnestykket over.

### How we validate
`λ = 0` skal reprodusere dagens bot bit for bit. Er det ikke tilfellet, er
implementasjonen gal.

---

## 2. Overgangen oppstår ikke automatisk — refutert

Jeg påsto: bred rankfordeling tidlig → `U` lokalt lineær → `E[U] ≈ E[poeng]`.
Toy-modellen (`scripts/toy_objective.py`, 40 000 trekninger per celle, ekte
2025/26-kurve) sier noe annet.

To strategier: **A** har høyest forventning (56,0/runde, sd 17, feltkorrelasjon
0,70). **B** har lavere forventning men mer egen varians (55,0/runde, sd 22,
feltkorrelasjon 0,20). A vinner på forventede poeng i alle tilstander etter
konstruksjon.

| Tilstand | Snitt slutt | Mot mål | E[poeng] | −E[log rank] | sigmoid τ=1 | sigmoid τ=5 | P(topp 100k) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GW2 bak | 2116 | −211 | A | A | **B** | A | **B** |
| GW2 foran | 2206 | −121 | A | A | **B** | A | **B** |
| GW20 bak | 2008 | −319 | A | A | **B** | A | **B** |
| GW20 foran | 2188 | −139 | A | A | **B** | A | **B** |
| GW34 bak | 2124 | −203 | A | A | **B** | A | A |
| GW34 på mål | 2344 | +17 | A | A | A | A | A |
| GW34 foran | 2424 | +97 | A | A | A | A | A |
| GW37 på mål | 2346 | +19 | A | A | A | A | A |

**Tre avlesninger:**

1. **Min påstand er feil.** Sigmoid τ=1 velger differensialen allerede i GW2 når
   du ligger bak. Den blir ikke EV-lignende tidlig. Bred fordeling gir ikke
   lokal linearitet — den sprer deg over et område der helningen varierer 10×.

2. **Det som faktisk styrer risikoprofilen er avstand til målet, ikke
   rundenummer.** Kolonnene for sigmoid τ=1 og P(topp 100k) snur fra B til A
   nøyaktig når snittet krysser terskelen. Det er riktig oppførsel — jag når du
   er bak, beskytt når du er foran — men den kommer fra posisjon, ikke fra tid.

3. **τ virker som ambisjonsknapp.** τ=5 følger forventningen overalt; τ=1 jager.
   Familien gjør altså jobben sin, den bare limiterer et annet sted enn jeg sa.

### Konsekvens for designet
`λ` er en **preferanse**, ikke noe som kan utledes. Det ærlige er å si det.
Det som *kan* utledes fra tilstand er risikoprofilen gitt `λ` — og den kommer
fra hvor du står på kurven, som toy-modellen viser.

Standard blir `λ = 0` til feltmodellen er til å stole på.

---

## 3. Hva EO kan og ikke kan brukes til

### Du har rett, og hullet er større enn du antydet

EO er et førstemoment. To spillere med EO 40 % kan ha helt ulik
rankvarianseffekt, og eierskap er korrelert på tvers av spillere. Alt det
stemmer.

Men da jeg forsøkte å kjøre toy-modellen mot `P(topp 10k)`, fant jeg noe verre:

**Rankkurven har ingen data i halen.**

| Sesong | Beste rank i utvalget | Deltakere | Andel av feltet dekket |
| --- | --- | --- | --- |
| 2022/23 | 2 375 | 11 394 904 | 0,02 % |
| 2023/24 | 16 542 | 10 764 159 | 0,15 % |
| 2024/25 | 37 750 | 11 305 839 | 0,33 % |
| 2025/26 | 15 082 | 12 789 506 | 0,12 % |

Et tilfeldig utvalg på 600 lag inneholder **0,47 forventede topp-10k-lag**. Alt
jeg måtte rapportere om topp 10k ville vært ekstrapolasjon forbi siste
datapunkt.

### Decision
1. EO brukes **kun** til forventet relativ gevinst:
   `Δ_relativ ≈ poeng × (1 − EO)`. Det er et førstemoment og presenteres som det.
2. **Ingen `P(topp X)` publiseres for X under kurvens dekning.** V1 sier
   eksplisitt: *vi kan anslå forventet relativ gevinst, men ikke hevde en korrekt
   P(topp 10k).*
3. **Fiks som er buildbar:** liga 314 sine standingssider gir de *faktiske* topp-
   managerne med poengsum. Kombiner tilfeldig sampling (midten) med paginering
   fra toppen (halen). Kun i sesong, siden 314 er tom i preseason.

### How we validate
Etter fiksen: sjekk at kurven har minst 30 datapunkter under rank 10 000 før noe
`P(topp 10k)` rapporteres. Ellers degraderes utdata.

---

## 4. Hypotesen splittes

**H1 — regler og ikke-lineariteter.** Minuttfordelinger, autobytter,
kapteinsfallback, benkerekkefølge. Dette kan endre *forventede realiserte
lagpoeng* fordi FPL-reglene er ikke-lineære i utfall.

**H2 — korrelasjon.** Realistiske avhengigheter mellom spillere.

**H3 — ikke-lineær rank-utility.** Hele fordelingen plus feltmodell mot
poengmaksimering.

### Punkt 6 er den viktigste innvendingen i hele brevet ditt

Du skriver: er målet lineært i forventede poeng, kan ikke fordelingen slå sitt
eget korrekte gjennomsnitt. **Det er riktig, og det har direkte konsekvenser:**

- **H2 har null effekt på forventede poeng.** Forventningen til en sum er summen
  av forventningene, uansett korrelasjon. Korrelasjon påvirker EV *bare* gjennom
  ikke-lineariteter — altså gjennom H1. Å teste H2 mot et EV-mål er å teste noe
  som må gi null.
- **H1 er den eneste som kan gi EV-gevinst.** Og kilden er presist:
  `E[realisert(utfall)] ≠ realisert(E[utfall])` fordi autobytter, kapteinsfallback
  og formasjonsregler er ikke-lineære.
- **H3 krever et ikke-lineært mål**, altså `λ > 0`, og dermed en feltmodell vi
  akkurat viste at ikke er klar.

Hoveddokumentets primærkriterium ba altså simuleringen om +40 poeng under et
EV-mål, der bare H1 kan bidra. Det var å sette opp en test simulatoren nesten
måtte stryke på. Rettet i seksjon 6 under.

---

## 5. Ablasjonsstige

Samme kandidatsett, samme optimerer, samme historiske informasjon, samme frø.

| Arm | Innhold | Kan bidra på EV? |
| --- | --- | --- |
| BASE | Skalar xP, dagens bot | — |
| V1A | + eksplisitte minuttfordelinger, autobytter, kapteinsfallback gjennom reglene | **Ja (H1)** |
| V1B | + uavhengige utfallsfordelinger per spiller | Nei, ~0 |
| V1C | + kampkorrelerte fordelinger | Nei, ~0 (H2) |
| V1D | + feltrelativt mål (EO) | Bare på relativ metrikk |
| V1E | + rank-utility (`λ > 0`) | Bare på `E[U]` (H3) |

**V1B og V1C forventes å gi ≈ 0 på sesongpoeng.** Det er ikke en svakhet ved
testen — det er prediksjonen. Gir de en stor positiv effekt, er noe galt:
enten var BASE sitt gjennomsnitt feil, eller så lekker det informasjon.

Det gjør V1B/V1C til en **konsistenssjekk på implementasjonen**, ikke til en
verdihypotese. Verdien deres materialiserer seg først i V1E.

---

## 6. Reviderte akseptansekriterier

### A. Praktisk signifikans (produktbeslutning)

| Nivå | Sesongpoeng | Vurdering |
| --- | --- | --- |
| Uinteressant | < +10 | Innenfor det vi ikke kan måle pålitelig |
| Marginal | +10 til +25 | Behold bare hvis kompleksiteten er lav |
| Interessant | +25 til +50 | Verdt kompleksiteten |
| Stor | > +50 | Prioriter |

**V1A (H1) må nå «marginal», altså ≥ +10 poeng.** Ikke +40. Begrunnelsen er
seksjon 4: bare ikke-lineariteter kan bidra, og realisert autobyttegevinst i
dagens backtest ligger i størrelsesorden 20–40 poeng per sesong. Å kreve +40 av
den ene mekanismen var urimelig.

### B. Statistisk usikkerhet

Fire sesongtotaler er fire korrelerte observasjoner. Konfidens skal ikke komme
fra `n = 4`. Evalueringsenheter:

1. **Parede rundedeltaer** — samme runde, samme tilstand, to armer. `n ≈ 150`
   over fire sesonger. Hovedgrunnlaget for konfidensintervall.
2. **Bootstrap over beslutningspunkter**, blokkvis per sesong for å bevare
   avhengighet innad i sesong.
3. **Rullende blokker** på 6 runder.
4. **Sesongtotal** rapporteres som hovedtall, men uten konfidenspåstand.
5. **Flere starttilstander** — start backtesten i GW1, 5, 10, 15 for å bryte
   avhengigheten av ett enkelt utgangspunkt.

Kriterium: **paret rundedelta med 95 % bootstrap-KI som utelukker 0**, og
sesongsnitt over praktisk terskel.

### C. Om «5 × policy-støy»

Jeg må dokumentere hvordan det tallet ble til, siden jeg brukte det til å
begrunne +40: det var **spennet i sesongtotaler mellom seks byttepolicyer,
snittet over fire sesonger**. Det er en beskrivende spredning mellom *systematisk
ulike* strategier — ikke et støyestimat, og ikke en standardfeil. Å bygge en
terskel på det var feil metode. Erstattet av bootstrap over parede deltaer.

---

## 7. Forecast quality mot decision quality

Per runde persisteres, før utfall er kjent:

**Alle spillere:** predikert snitt, predikert varians, predikerte minutter,
realiserte poeng, realiserte minutter.

**Kandidatsett:** skjevhet, MAE, rangkorrelasjon, kalibrering.

**Optimererens topp-K:** skjevhet i topp 5 / 15 / 30, realisert minus predikert.

**Faktisk valgte:** predikert delta mot realisert delta.

**Hovedmetrikk:** `E[realisert | predikert persentil]`. Faller topp-persentilen
systematisk under diagonalen, har vi et direkte mål på optimizer's curse.

Grunnlaget finnes allerede: `scripts/analyse_calibration.py` måler skjevhet per
rangeringssjikt, og fant +0,54 i topp 1–15 mot −0,02 i topp 31–60 for dagens
modell.

---

## 8. Hvor fordelingen faktisk kan endre beslutningen

Presist, ikke «simulering er bedre»:

| Mekanisme | Endrer EV? | Hvorfor |
| --- | --- | --- |
| Autobytter | **Ja** | Benken teller bare når en starter blanker — ikke-lineært i felles minuttutfall |
| Kaptein → vice | **Ja** | Betinget bytte ved 0 minutter |
| Formasjonsgrenser ved autobytte | **Ja** | Byttet kan være ulovlig og faller bort |
| Bench Boost / Triple Captain | Nei | Lineære multiplikatorer |
| Kapteinsvalg under EV | Nei | Lineært i forventning |
| Kapteinsvalg under rank-utility | **Ja** | Halen betyr noe når målet er ikke-lineært |
| Korrelasjon per se | Nei | Forventningen til en sum er additiv |
| Korrelasjon × autobytte | **Ja** | Felles minutter endrer sannsynligheten for at benken teller |

Kilden til edge er altså **ikke «fordeling»**. Det er at troppens realiserte
poeng er en ikke-lineær funksjon av spillerutfall, og at vi i dag anvender den
funksjonen på gjennomsnitt i stedet for å ta gjennomsnitt av funksjonen.

---

## 9. Kandidathale-kalibrering som egen hypotese

**H4:** *Kalibrering betinget på predikert rangering, estimert ut av utvalg,
forbedrer beslutninger ende-til-ende.*

Dette kan være en større edge enn simulering, og er langt billigere. Alle
konfigurasjoner vi har målt overvurderer topp 15 — den svakeste med +0,94, den
beste med +0,54.

Metoder å teste: isotonisk regresjon ut av fold, empirisk Bayes-krymping,
hierarkisk krymping mot posisjonsmiddel, eksplisitt winner's curse-korreksjon
betinget på predikert persentil.

**Ufravikelig:** korreksjonen estimeres aldri på de observasjonene den evalueres
på. Walk-forward, fit på 2022–24, valider på 2024–25, hold 2025–26 urørt.

**Og ikke krymp toppen fordi det føles riktig.** Hypotesen kan være feil — de
ekstreme prediksjonene kan være ekte signal som tilfeldigvis bommet. Testen
avgjør.

**Rekkefølge: H4 før V1.** Den er billigere, uavhengig, og hvis den virker
endrer den grunnlaget simuleringen skal måles mot.

---

## 10. Bookmakerdata — vurderingen

**Testet:** `api.the-odds-api.com/v4/sports` → **401**. Nøkkel kreves.

**Vurdering av verdi:** sannsynligvis vårt sterkeste manglende signal. Markedet
priser inn skader, rotasjon og formasjonsendringer før statistikken ser dem, og
gir direkte kampmål og clean sheet-sannsynligheter — nøyaktig det lagstyrke-
modellen vår estimerer selv med langt mindre data.

**Blokkeringer, i rekkefølge:**

1. **Nøkkel.** Gratisnivået hos the-odds-api er lavt (i størrelsesorden noen
   hundre kall i måneden). Nok til én ukentlig henting, ikke til daglig.
2. **Historiske odds er det harde problemet.** Backtesting krever odds slik de
   var før hver historisk frist. Det ligger på betalte nivåer hos alle
   leverandører jeg kjenner, og jeg har ikke kunnet verifisere formatet uten
   nøkkel.
3. **Uten historiske odds kan vi ikke backteste dem** — bare bruke dem framover.
   Det bryter med prinsippet om at alt skal valideres før det får telle.

**Konklusjon:** koden finnes (`fplbot/sources/odds.py`), er avslått uten nøkkel,
og er **ikke** kjørt mot et ekte svar. Skaffes en nøkkel med historisk tilgang,
flytter dette opp til topp tre. Uten historisk tilgang bør det brukes som
sanity-sjekk mot vår egen modell, ikke som erstatning.

Dette skal ikke forsvinne igjen: det står nå som eksplisitt åpen post.

---

## 11. Nøyaktig hvordan CRN brukes

**Regel:** hvert alternativ som sammenliknes evalueres mot **samme simulerte
verden**. Konkret deles:

- kampresultater `(G_h, G_a)` per kamp
- minuttrekninger per spiller
- måltilordning innad i lag
- bonus- og korttrekninger

**Implementasjon:** trekk en `world` først — alle stokastiske hendelser for alle
spillere i runden — og evaluer deretter hver kandidattropp mot den samme verdenen.
Frøet bestemmes av `(sesong, runde, trekningsnummer)`, aldri av alternativet.

**Konvergens logges på beslutningsdeltaet**, ikke på nivået:

```
SE(Δ) = sd(A_i − B_i) / √N        i = 1..N over samme verdener
```

**Enhetstest:** to identiske alternativer skal gi `Δ = 0` eksakt, ikke bare
statistisk. Feiler den, deles ikke verdenen slik vi tror.

---

## 12. Revidert V1-omfang

**Rekkefølge endret. H4 kommer først.**

### Steg 0 — H4: kandidathale-kalibrering
Ingen simulering. Isotonisk kalibrering ut av fold betinget på predikert
persentil, walk-forward. Måles på skjevhet i topp 15 og på sesongpoeng.
**Kriterium:** topp 15-skjevhet under +0,25 og sesongpoeng ikke dårligere.
Billig, uavhengig, og kan flytte grunnlinjen simuleringen måles mot.

### Steg 1 — V1A: reglene, ikke fordelingene
Minuttfordelinger i tre tilstander, full tropp gjennom autobytter, kaptein og
vice, formasjonsvalidering. Skalar forventning ellers.
**Kriterium:** ≥ +10 sesongpoeng, paret rundedelta med 95 % KI som utelukker 0.
Dette er den eneste armen som kan gi EV-gevinst, og den testes alene.

### Steg 2 — V1B/V1C: konsistenssjekk
Fordelinger og korrelasjon inn. **Forventet effekt ≈ 0 på poeng.** Avvik større
enn ±10 poeng er et varsel om implementasjonsfeil, ikke et funn.

### Steg 3 — feltmodellen, med halefiks
Utvid rankkurven med paginering fra toppen av liga 314 før noe `P(topp X)`
rapporteres. Uten det: kun forventet relativ gevinst.

### Steg 4 — V1E: `λ > 0`
Først når steg 3 er på plass. Kriterium på `E[U]` og på rankfordelingens
dekning, ikke på poeng.

### Flerukessøk
Uendret fra hoveddokumentet: testes etter at simuleringen står, med
forhåndsregistrert terskel på +25 poeng og riktig fortegn i ≥ 3 av 4 sesonger.
Hypotesen er fortsatt åpen.

---

## Hva jeg tok feil om

Samlet, siden det er poenget med et addendum:

1. **τ → ∞ er ikke EV-modus.** Det er forventet log-rank. Målt: log-rank er
   10–13× brattere øverst, så de to er ikke utskiftbare.
2. **Overgangen oppstår ikke automatisk.** Toy-modellen viser at sigmoid τ=1
   jager varians allerede i GW2 når du ligger bak. Risikoprofilen kommer fra
   avstand til mål, ikke fra tid.
3. **Rankkurven tåler ikke haleutsagn.** 0,47 forventede topp-10k-lag i et
   utvalg på 600. Jeg var på vei til å publisere `P(topp 10k)` fra data som
   stopper ved 15 082.
4. **+40 som primærterskel var feil satt**, både i nivå og i metode. Bare H1 kan
   bidra på EV, og «5 × policy-støy» var en spredning mellom strategier, ikke en
   støyestimator.

Punkt 3 er den jeg er mest glad for at ble fanget her og ikke i mars.
