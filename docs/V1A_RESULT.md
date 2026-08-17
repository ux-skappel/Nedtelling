# V1A — resultat

Forhåndsregistrert i `V1A_PREREG.md`. Kriteriene under er ikke flyttet etter at
tallene ble sett, og armene ble implementert og frosset før noen historisk
kjøring ble lest.

## Utfall

```
V1A-0 vs baseline:      FAIL
V1A-1 inkrementelt:     FAIL
V1A-1 vs baseline:      FAIL
```

Kriteriene i preregistreringen seksjon 8, anvendt mekanisk: snitt under +5 poeng
per sesong er FAIL. Målt snitt er −0,8, −0,5 og −1,2. Ingen skjønnsmessig
oppgradering.

**Både positive og negative resultater er bevis fra en forhåndsregistrert
retrospektiv test. Ingen av dem er prospektiv bekreftelse.** Et negativt
resultat her betyr ikke uten videre at mekanismen ikke finnes — det kan skyldes
statistisk styrke, implementasjon, kvaliteten på prognosen under, eller
regimeforskjeller. Hvilken av dem det er, er nettopp det diagnostikken lenger
nede prøver å avgjøre, og den peker ganske entydig ett sted.

## Sporbarhet

| | |
| --- | --- |
| Preregistrering | `a564415` |
| Implementasjon (pre-results) | `eb0bb86` |
| Tester i suiten | 117 |
| Kommando | `python scripts/run_v1a_test.py --out data/v1a.json` |
| Grunnlinjens fingeravtrykk | `sha256 2164e900…b85368` |

## 1. Portene før måling

Ingen historisk kjøring ble lest før disse besto.

| Port | Resultat |
| --- | --- |
| **A** full oppregning mot optimert evaluator | 200 tilfeldige tropper + 18 parametriserte + benk uten posisjonsdekning + generell vei uten keepersnarvei. **Største avvik 1,78e−15**, langt under kravet på 1e−9 |
| **B** Monte Carlo som uavhengig kryssjekk | 6 tropper, 40 000–100 000 trekninger, alle innenfor 3 standardfeil |
| **C** sannsynlighetsmasse | Største avvik fra 1: **2,22e−16**. Aktiv assertion, ikke bare test |
| **D** middelbevaring for V1A-0 | **526 580 spiller-runder, 0 brudd.** Maks 3,55e−15, snitt 1,0e−16 |
| Grunnlinjeregresjon | Kjørt på `a564415` og på implementasjonscommiten. Sesongtotaler, bytter, kapteiner, benk og troppsutvikling **bit-identiske**, samme sha256 |

Evaluatoren er altså bevist riktig før den ble brukt. Det er avgjørende for
tolkningen: feilen ligger ikke i regnestykket.

## 2. Policyresultat

| Sesong | baseline | V1A-0 | V1A-1 | Δ0 | Δ1 | Δ(1−0) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-23 | 1963 | 2087 | 2085 | **+124** | +122 | −2 |
| 2023-24 | 2277 | 2252 | 2252 | −25 | −25 | 0 |
| 2024-25 | 2184 | 2164 | 2164 | −20 | −20 | 0 |
| 2025-26 | 2307 | 2225 | 2225 | **−82** | −82 | 0 |
| **Snitt** | | | | **−0,8** | **−1,2** | **−0,5** |

Usikkerheten er stor og gjør sesongtotalene nesten innholdsløse alene:

| Sammenlikning | snitt/sesong | snitt/runde | median | positive runder | blokkbootstrap-KI |
| --- | ---: | ---: | ---: | ---: | --- |
| V1A-0 vs baseline | −0,8 | −0,02 | 0,00 | 35 % | [−54,5, +50,8] |
| V1A-1 inkrementelt | −0,5 | −0,01 | 0,00 | 0 % | [−1,5, +0,0] |
| V1A-1 vs baseline | −1,2 | −0,03 | 0,00 | 35 % | [−55,2, +50,5] |

Med fire sesonger og et konfidensintervall på over hundre poeng kunne testen
ikke ha oppdaget en effekt på +10 selv om den fantes. **Sesongtotalene alene er
underdimensjonert.** Det er en styrkebegrensning som burde vært synlig i
preregistreringen, og den noteres her som en metodefeil ved designet — ikke som
en unnskyldning for utfallet, for den parete målingen under er godt nok
dimensjonert og peker samme vei.

## 3. Beslutningsdivergens

V1A-0 mot grunnlinjen, over 152 runder:

| Mål | |
| --- | ---: |
| Runder med minst én endret beslutning | **122 av 152** |
| Bytter endret | 18 |
| Kaptein endret | 35 |
| Visekaptein endret | 35 |
| Startellever endret | 90 |
| Benkerekkefølge endret | 109 |

V1A-1 er praktisk talt identisk: 123 runder, 18 bytter, 36 kapteiner.

Dette er den motsatte enden av skalaen fra «skarp og sjelden». V1A endrer noe i
fire av fem runder. Hadde resultatet vært +12, ville det vært spredt tynt utover
122 beslutninger — altså støy som falt riktig vei, ikke en mekanisme.

## 4. Realisert verdi av endrede beslutninger

Dette er den viktigste tabellen i dokumentet, fordi den er **paret**: grunnlinjens
oppstilling og V1A sin oppstilling scores mot samme runde med **samme tropp**.
Ingen seleksjonseffekt, ingen divergerende spillerutvalg.

| | V1A-0 |
| --- | ---: |
| Endrede oppstillinger med målbart utfall | 116 |
| Positiv realisert delta | 18 |
| Negativ realisert delta | 34 |
| Null | 64 |
| **Sum realisert** | **−134** |

Fordelt på årsak:

| Årsak | Antall | Predikert | Realisert |
| --- | ---: | ---: | ---: |
| starter mot benk + benkerekkefølge | 64 | +21,8 | **−61** |
| starter mot benk + kaptein + vise + benk | 25 | +22,4 | **−51** |
| kaptein + visekaptein | 7 | +3,5 | **−23** |
| benkerekkefølge | 17 | +0,6 | +6 |
| kaptein + vise + benkerekkefølge | 2 | +0,5 | −5 |
| starter mot benk + vise + benkerekkefølge | 1 | +0,0 | 0 |

Og per sesong, samme parete måling:

| Sesong | Endrede | Predikert | Realisert | Sesongdelta totalt |
| --- | ---: | ---: | ---: | ---: |
| 2022-23 | 35 | +18,6 | **−40** | +124 |
| 2023-24 | 18 | +8,1 | **−26** | −25 |
| 2024-25 | 26 | +8,1 | **−15** | −20 |
| 2025-26 | 37 | +13,9 | **−53** | −82 |

**Den siste kolonnen er en felle, og den er verdt å stoppe ved.** Sesongdeltaen
i 2022-23 er +124, men den parete oppstillingsmålingen for samme sesong er −40.
De +124 kommer ikke fra mekanismen. De kommer av at V1A tok fire andre
byttebeslutninger, troppene divergerte, og den ene troppen tilfeldigvis gikk
bedre resten av sesongen.

Den parete målingen er **negativ i alle fire sesongene**. Konsistenskravet i
preregistreringen, anvendt på den metrikken som faktisk måler mekanismen, feiler
4 av 4 — ikke 3 av 4.

## 5. Predikert mot realisert beslutningsfordel

| Predikert fordel | Antall | Snitt predikert | Snitt realisert |
| --- | ---: | ---: | ---: |
| 0,00–0,10 | 34 | +0,024 | **−0,618** |
| 0,10–0,25 | 22 | +0,167 | **−1,545** |
| 0,25–0,50 | 29 | +0,371 | **−0,448** |
| 0,50–1,00 | 19 | +0,757 | **−2,316** |
| > 1,00 | 12 | +1,583 | **−1,833** |

Predikert fordel er positiv i hver eneste bøtte. Realisert er negativ i hver
eneste bøtte. Det er ikke støy rundt null — det er en systematisk overvurdering
av egen beslutningsfordel, og den blir ikke bedre når modellen er mer sikker.

Dette er optimizer's curse på **beslutningsnivå**, ikke på spillernivå. H4 fant
den samme sykdommen ett hakk lenger ned, i anslagene for enkeltspillere.

**Ingenting er tunet på denne tabellen.** Den er diagnostikk.

## 6. Hvorfor det feilet

Evaluatoren er bevist eksakt til 1,78e−15 mot full oppregning. Regnestykket kan
altså ikke være feilen. Da må feilen ligge i **inputet**, og det er lett å
teste: den eneste størrelsen V1A handler på som grunnlinjen ikke bryr seg om, er
`P(0 minutter)`.

Målt over 108 732 spiller-runder i en **felles kandidatpool** — ikke over
modellens egen tropp, jf. metoderegelen fra H4:

| Predikert P(0) | Antall | Snitt predikert | Faktisk andel | Avvik |
| --- | ---: | ---: | ---: | ---: |
| 0,00–0,05 | 12 158 | 0,004 | **0,158** | −0,154 |
| 0,05–0,15 | 5 777 | 0,100 | 0,162 | −0,062 |
| 0,15–0,30 | 8 955 | 0,226 | 0,224 | +0,002 |
| 0,30–0,50 | 13 073 | 0,402 | 0,359 | +0,043 |
| 0,50–0,80 | 67 844 | 0,651 | **0,802** | −0,151 |
| 0,80–1,01 | 925 | 0,822 | 0,658 | +0,164 |
| **Totalt** | **108 732** | 0,486 | 0,594 | −0,108 |

Den øverste raden er avgjørende. Der modellen sier at spilleren så godt som
sikkert spiller — `P(0) = 0,4 %` — blanker han i virkeligheten **15,8 % av
gangene**. Det er feil med en faktor på nesten førti, og det er nøyaktig det
sjiktet startellevern består av.

Konsekvensen følger direkte: V1A verdsetter benkeforsikringen for lavt, priser
visekapteinen for lavt, og rangerer benken etter en sannsynlighet som ikke
holder. En eksakt evaluator på et feilkalibrert input gir ikke bedre
beslutninger — den **forsterker** feilen, fordi den handler på et tall
grunnlinjen ignorerer. Grunnlinjen er delvis beskyttet nettopp fordi den er
grovere.

Det er den sentrale lærdommen: **det hjelper ikke å regne riktig på feil tall.**

En ærlig innvending mot denne diagnosen: arkivet mangler skadestatus per runde,
så en del av de 15,8 % var ikke mulig å vite ved fristen. Det trekker fra på
hvor stor den unnvikelige delen av feilen er, men ikke på retningen — `0,4 %`
er ikke en forsvarlig basisrate for fravær i seg selv, uansett hva boten kunne
vite om skader.

## 7. Hvorfor V1A-1 ikke tilførte noe

Den inkrementelle armen ga −2 poeng i én sesong og nøyaktig 0 i de tre andre.
Det er ikke tilfeldig, og det ble forutsagt analytisk før kjøringen.

FPL sine troppsregler avhenger bare av **om** en spiller kom på banen. Autobytter
utløses ved nøyaktig 0 minutter, kapteinsfallback ved nøyaktig 0 minutter,
formasjonslovligheten av hvem som står igjen. Ingen regel skiller mellom 30 og
80 minutter. Fordelingen av verdi mellom tilstandene `1–59` og `60+` er derfor
**beslutningsirrelevant** så lenge forventningen er den samme — bevist i
`tests/test_appearance_exact.py::test_split_is_decision_irrelevant`.

Hele den inkrementelle effekten av V1A-1 er dermed en **omprising** av spillere,
ikke ny struktur. Målt drift fra de representative minuttene i seksjon 4:
−2,0 % i snitt, −0,035 poeng per spiller-runde. Den prisingen endret 1–2
beslutninger og kostet 2 poeng.

Det er verdt å si rett ut: **preregistreringen beskrev V1A-1 som «ekte
60-minuttersknekk», og den beskrivelsen var upresis.** Knekken lå allerede inne
i grunnlinjens forventning. Det er en svakhet ved designet, ikke ved
implementasjonen, og den ble oppdaget ved å bygge tingen — ikke ved å se
resultatet.

## 8. Klassifisering og konsekvenser

**1. `FAILED`.** Alle tre armene skrus ikke på. `arm=None` er fortsatt
standard, og grunnlinjen står uendret på 1963 / 2277 / 2184 / 2307.

**2. Ingen rerun.** Etter seksjon 14A i preregistreringen er dette en
modell-/designsvikt, ikke en implementasjonsfeil: evaluatoren gjør nøyaktig det
spesifikasjonen sier, bevist til maskinpresisjon. At `P(0)` burde vært regnet ut
på en annen måte er en veldig god idé — og den blir en **ny eksplorativ
hypotese**, ikke en bugfix av V1A. Datasettet er brukt opp for V1A.

**3. Koden beholdes.** `fplbot/appearance.py` er en korrekt eksakt evaluator med
31 tester bak seg. Den er ikke feil; den fikk feil mat. Blir minuttmodellen
kalibrert en gang, er evaluatoren klar uten endringer.

**4. To metodefunn å ta med videre.**

Det ene: en eksakt evaluator er ikke en forbedring i seg selv. Den flytter
beslutningen nærmere inputet, og gjør systemet **mer** følsomt for feil i
inputet, ikke mindre. Presisjon nedstrøms uten kalibrering oppstrøms er negativ
verdi.

Det andre: sesongtotaler var feil primærmetrikk her. Konfidensintervallet på
[−54, +51] kunne ikke ha skilt +10 fra 0. Den parete
oppstillingsmålingen — samme tropp, samme runde, to valg — ga et entydig svar på
116 observasjoner i stedet. **Preregistrer den parete metrikken som primær neste
gang, ikke sesongsummen.**

## 9. Hva jeg ikke gjorde

Jeg justerte ikke `P(0)` og kjørte på nytt. Det ville gjort tallene meningsløse,
og jeg lovet i seksjon 14A å ikke gjøre nettopp det.

Jeg lot heller ikke `+124` i 2022-23 stå som en delvis oppmuntring. Den parete
målingen for samme sesong er −40, og den er den som måler mekanismen.
