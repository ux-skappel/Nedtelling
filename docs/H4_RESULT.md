# H4 — resultat: forkastet på holdout

**Hypotese:** kalibrering betinget på predikert rangering, estimert ut av utvalg,
forbedrer beslutninger ende-til-ende.

**Utfall: forkastet.** Begge forhåndsregistrerte kriterier feiler på holdout.
Kriteriene ble satt i addendum A seksjon 12 før testen ble kjørt, og er ikke
flyttet.

## Oppsett

Isotonisk regresjon (Pool Adjacent Violators, egen implementasjon) tilpasset per
rangeringssjikt. Lært av 2022-23 og 2023-24 (54 371 observasjoner), justert mot
2024-25, med 2025-26 holdt urørt til slutt.

## Resultat

| | Utvikling 2024-25 | HOLDOUT 2025-26 |
| --- | --- | --- |
| Skjevhet topp 15, før | +0,61 | +0,54 |
| Skjevhet topp 15, etter | +0,63 | **+0,72** |
| Sesongpoeng, før | 2184 | 2307 |
| Sesongpoeng, etter | 2215 (**+31**) | **2262 (−45)** |
| Kriterium 1 (skjevhet < +0,25) | Ikke oppfylt | Ikke oppfylt |
| Kriterium 2 (poeng ikke dårligere) | Oppfylt | **Ikke oppfylt** |

Utviklingssesongen ga +31 poeng og så lovende ut. Holdout ga −45. Det er
forskjellen mellom å tilpasse seg en sesong og å lære noe.

## Hvorfor det feilet

Korreksjonen gjør det motsatte av det den aggregerte skjevheten tilsa.

| Anslag i topp 15 | Korreksjon |
| --- | --- |
| 3,5 | **+0,76** |
| 4,0 | **+0,63** |
| 4,5 | **+0,34** |
| 5,0 | +0,12 |
| 6,0 | +0,37 |
| 7,0 | −0,59 |
| 8,0 | −1,55 |

Medianen blant faktiske topp-15-anslag er 4,66. **84 % av dem blir løftet opp,
ikke krympet.** Bare de sjeldne anslagene over 7,0 krympes.

**Rotårsaken er pooling på tvers av runder.** Sjiktet «topp 15» betyr noe helt
ulikt i GW3 og GW20: tidlig i sesongen er alle anslag komprimert fordi modellen
har lite data, og et anslag på 4,0 er da et toppanslag. Senere er 4,0 midt på
treet. Isotonisk regresjon på rått anslag, med alle runder slått sammen, ser
observasjoner med lavt anslag og normal fasit — og konkluderer med at lave
anslag i toppsjiktet skal opp.

Den aggregerte skjevheten på +0,54 er et marginalt tall. Å korrigere den krever
betinging på noe skalafritt — anslaget i forhold til rundens egen fordeling, ikke
råverdien.

## Konsekvenser

**1. Holdout er brukt opp.** Enhver redesign må forhåndsregistreres på nytt og
testes på en sesong som ikke er sett.

*Rettelse.* Jeg skrev opprinnelig at 2022-23 kunne tjene som fersk holdout hvis
korreksjonen ble refittet på 2023-26. **Det er feil.** Å trene på 2023-26 og
teste på 2022-23 bruker framtidig informasjon til å predikere fortiden. Det er
temporal lekkasje selv om observasjonene fra 2022-23 aldri har vært brukt før.

Enhver prediksjon på tidspunkt `t` skal bare kunne bruke informasjon fra før `t`.
Gyldige oppsett er derfor bare framoverrettede:

    tren 2022-23        → test 2023-24
    tren 2022-24        → test 2024-25
    tren 2022-25        → test 2025-26

Og siden 2025-26 nå er brukt til å teste H4, finnes det ingen ubrukt
framtidig sesong igjen. En redesign kan kjøres som **eksplorativ**
walk-forward-forskning, men ikke som ny bekreftelse.

**2. Hypotesen er ikke død, men denne implementasjonen er det.** En redesign bør
betinge på persentil innenfor runden, eller normalisere anslaget mot rundens
egen spredning, før den testes igjen.

**3. Grunnlinjen står.** Simuleringens akseptansekriterier måles fortsatt mot
dagens bot uten kalibrering.

**4. Skjevhet i toppen er fortsatt reell.** +0,54 er målt og bekreftet på fire
sesonger. At denne korreksjonen ikke fanget den, gjør ikke problemet mindre — det
gjør bare at vi ennå ikke har en løsning.

## Hva jeg ikke gjorde

Jeg fikset ikke implementasjonen og kjørte på nytt mot samme holdout. Det ville
gjort tallet meningsløst, og jeg lovet å ikke flytte målstengene etterpå.

Koden beholdes (`fplbot/calibration.py`, ti tester) fordi den er korrekt som
isotonisk regresjon — det er *betingingen* som var feil valgt, ikke algoritmen.
