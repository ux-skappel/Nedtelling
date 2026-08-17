# RESEARCH_BACKLOG

Hypoteser som er registrert, men ikke testet. Hensikten er å ikke miste ideer
uten å la dem snike seg inn i produksjon uten en ren test.

## Statuskoder

| Kode | Betydning |
| --- | --- |
| `CONFIRMATORY` | Forhåndsregistrert før data ble sett. Kan brukes som bevis |
| `EXPLORATORY` | Oppstod etter å ha sett resultater. Kan ikke bekrefte seg selv |
| `FAILED` | Testet og forkastet. Historikken skrives ikke om |

**Regelen:** en `EXPLORATORY`-hypotese kan aldri forfremmes til bevis ved å
kjøres på data som allerede er brukt. Den må vente på en genuint framtidig
sesong, eller aksepteres som eksplorativ for alltid.

---

## H4b — kalibrering betinget på persentil innenfor runden

**Status: `EXPLORATORY` / backlog. Skal ikke bygges nå.**

### Hypotese
Kalibrering betinget på spillerens **persentil innenfor rundens egen
anslagsfordeling** — ikke på rå anslagsverdi — reduserer skjevheten i
optimererens toppsjikt og forbedrer beslutninger ende-til-ende.

### Hvorfor den oppstod
Den er en direkte konsekvens av **hvorfor H4 feilet**, og oppstod etter at
holdout-resultatet var sett. Det gjør den post-hoc.

H4 poolet observasjoner på tvers av runder og betinget på rå anslagsverdi.
Målt: 84 % av topp-15-anslagene ble løftet opp i stedet for krympet, fordi
«topp 15» betyr noe helt ulikt i GW3 og GW20. Tidlig i sesongen er alle anslag
komprimert, så 4,0 er et toppanslag; senere er 4,0 midt på treet. Rå
anslagsverdi er altså ikke invariant gjennom sesongen.

Persentil innenfor runden er invariant på nettopp den måten. Det er en plausibel
mekanisme, men plausibilitet er ikke bevis.

### Foreslått utforming
- Betingingsvariabel: persentil innenfor runden, eller anslag normalisert mot
  rundens egen spredning (z-score).
- Samme isotoniske maskineri som i `fplbot/calibration.py`; algoritmen er
  testet og riktig, det var betingingen som var feil valgt.
- Samme forhåndsregistrerte kriterier som H4: skjevhet i topp 15 under +0,25 og
  sesongpoeng ikke dårligere.

### Hvorfor den ikke bygges nå
1. H4 har fått en legitim test og feilet.
2. Redesignen oppstod etter at holdout-feilen var sett.
3. Det finnes ingen ubrukt framtidig sesong å bekrefte den på. 2025-26 er brukt.
4. Iterative korreksjoner mot fire historiske sesonger er hvordan man tilpasser
   seg støy uten å merke det.
5. V1A tester en uavhengig mekanisme og bør komme først.

### Krav før produksjonsbruk
En **genuint framtidig** sesong. I praksis: registrer hypotesen og kriteriene
nå, kjør boten gjennom 2026-27, og les av resultatet etterpå. Alt annet er
eksplorativt.

Kjøres den mot historiske data i mellomtiden, skal resultatet merkes
`EXPLORATORY` og kan ikke brukes til å rettferdiggjøre å skru den på.

---

## Metoderegel som kom ut av H4

**Aldri vurder prognosekvalitet på modellens egen valgte tropp.**

Den opprinnelige påstanden «bedre MAE, men færre poeng» var målt over hver
kjørings *egen* 15-mannstropp — to forskjellige spillerutvalg. Over en felles
kandidatpool holdt påstanden ikke.

Alle sammenlikninger av prognoser skal bruke enten samme kandidatunivers eller
en eksplisitt paret populasjon. Ellers kan seleksjonseffekter få en dårligere
modell til å se bedre kalibrert ut.

Dette står nå i `scripts/analyse_calibration.py`, som bygger en felles
kandidatpool per runde uavhengig av hvilken tropp som velges.

---

## Åpne poster fra tidligere designnotater

| Post | Status | Blokkering |
| --- | --- | --- |
| Bookmakerodds som prior | Åpen | Nøkkel; historiske odds ligger bak betalt nivå |
| Kohortbasert feltmodell | Utsatt | Ikke data til mer enn to punkter (elite + totalt eierskap) |
| Halefiks på rankkurven | Klar til bygging | Paginering fra toppen av liga 314. Krever at sesongen er i gang |
| Flerukessøk | Åpen hypotese | Testes etter simulering, terskel +25 poeng forhåndsregistrert |
| Nyhetsmotor på A-kilder | Åpen | `team/set-piece-notes` er tom i preseason |
