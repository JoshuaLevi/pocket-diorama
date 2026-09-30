# De visuele revisie van 11 september

Joshua, na de playtest van 11 september: *"in een huis ziet het eruit alsof de kasten
mini huisjes zijn"* en *"er zit visueel ook veel werk in"*. Dit document zegt wat er
gemeten is, wat er veranderd is, en wat er open staat.

De beelden staan naast elkaar op <https://claude.ai/code/artifact/d09f1370-ebef-4f22-96a9-ac7168c19ad9>:
elke plaats zoals de cartridge hem tekent naast zoals de lens hem tekent, met een
voor-en-na-knop.

## De ene fout onder bijna alles

`tileCategories()` in `Assets/Scripts/rom/BundleFromExtraction.ts` geeft elke tegel een
categorie, en die categorie bepaalt zowel de KLEUR (via `VoxelPalette`) als de VORM (via
`UPRIGHT_CATEGORIES` in `Structures.ts`). De tabellen die hij las — de kaptabomen en de
richels — zijn OVERWORLD-tegel-ids, dus elke andere sheet viel door naar één `else`:

```ts
out.push(outdoor ? "STRUCTURE" : cave ? "ROCK" : "WALL");
```

Gemeten gevolg over de hele bundle: van de 2.160 gecategoriseerde tegels waren er 1.606
`WALL` en 227 `STRUCTURE`, terwijl `TREE` er 12 had, `LEDGE` 5 en `WATER` 1. Eén
categorie deed zeven banen.

- **Binnen** waren een boekenkast, een bed, een tv, een plantenbak, een winkelschap, een
  trap en een echte muur allemaal `WALL`: dezelfde blauwgrijze kleurenramp en dezelfde
  extrusie.
- **Buiten** had het FOREST-tileset geen enkele `TREE`-tegel, dus 84 van zijn 96 tegels
  stonden in gebouwen-crème. 54% van Viridian Forest was de kleur van een Pokecenter, en
  de opname ervan leest als magazijnstellingen.

## Wat er veranderd is

Vier commits, elk met zijn eigen meting en zijn eigen test.

### `27c6ad1` Binnen is de tekening een plattegrond

Buiten tekent Gen 1 een gebouw in **opstand**: een huis is zes rijen muur en dak van
opzij gezien, dus die rijen rechtop vouwen levert het gebouw op. Dat is waar
`Structures.ts` voor gebouwd is. Binnen tekent hetzelfde tileset meubels in
**plattegrond**: de vier rijen van Red's eettafel zijn haar voetafdruk, niet haar hoogte.
De detector kende het verschil niet en gaf die tafel een volume van vier rijen met een
puntdak en een dakgoot rondom: 15 voxels, tegen een speler van 8,8.

Een puntdak en een overstek zijn precies wat een silhouet tot huis maakt, dus binnen is
er nu geen van beide. `StructureField` draagt een `roofed`-vlag uit `isOutdoors(map)`,
die de eigen `grassTile` van de cartridge leest en dus niet kan afdrijven van de
vormbibliotheek, die dezelfde vraag stelt.

Gemeten over 222 maps: 19.130 getopte binnentegels over 152 van de 180 binnenmaps, nu 0.
Buiten onveranderd.

### `f7645a5` Een bos is bomen, en waar je op kunt staan is grond

`BLOCKED_BY_TILESET` geeft FOREST de categorie `TREE` en PLATEAU `ROCK`. Dat is geen gok:
de cartridge levert FOREST voor Viridian Forest en de vier Safari-maps, en PLATEAU voor
Indigo Plateau en Route 23. Het verzet ook de VORM, wat de grotere helft is: `TREE` staat
niet in `UPRIGHT_CATEGORIES`, dus een kruin wordt niet langer tot volume gevouwen maar
krijgt de getrapte hull die de vormbibliotheek al had. Viridian Forest, de zwaarste map
van het spel, zakt van 257.806 naar 206.284 getekende quads.

En een tweede fout in dezelfde tabel: tegel 60 staat zowel in de kaptabomen als in
`walkable`. Het is een brugplank die een id deelt met een boom die de bijl kan vellen, en
hij werd boomgroen geverfd op alle 672 cellen die hij bedekt — 398 op Route 12, waar 396
van de beloopbare cellen de kleur van een kruin droegen. Dat is de exacte omkering van de
regel waar `Legibility.ts` voor bestaat, dus loopbaarheid gaat nu vóór de richel- en
boomtabellen.

`Legibility` kreeg `TREE` 28 → 33 en `ROCK` 26 → 31 aan de donkere kant, omdat beide nu
een heel tileset dragen in plaats van een dozijn tegels. Elke gemeten map werd leesbaarder,
en het aantal maps waar de grond helderder is dan wat je tegenhoudt blijft 0 van 222.

### `99e4ec5` Een runlengte is binnen geen hoogte

Het dak was **aftrekkend**: het weghalen tilde elk binnenvolume naar zijn platte cap, dus
Red's boekenkast ging van 8..15 voxels naar een vlakke 16. De eerste commit repareerde het
silhouet en maakte de hoogte erger.

Binnen mag de runlengte dus helemaal niet als hoogte gebruikt worden, en de kamer zegt het
zelf: een Gen 1-interieur tekent zijn kale muur als precies twee tegelrijen, dus de muur is
het plafond van de schaal. De flood fill scheidt de twee al — een gebied dat de buitenring
van de map raakt is de SCHIL en staat op twee rijen; een gebied dat dat niet doet is
MEUBILAIR en staat op één.

Het histogram van 181 binnenmaps was `{2: 13678, 3: 35, 4: 2331, 5: 21, 6: 4283}` tegels,
met 6.635 op 300 tot 450 cm in kamers waarvan de muren 150 zijn. Het is nu
`{1: 8402, 2: 71921}`. Red's tafel staat op 4 voxels tegen een speler van 8,8.

### `331369e` De weg is aarde, geen violet

`#6e46b4` was eerlijk bemonsterd: het is werkelijk de kleur waarmee de referentievideo
zijn paden tekent. Maar die legt lange, aaneengesloten wegen, terwijl tegel 57 in Kanto
de open grond bínnen een stad is, cel voor cel afgewisseld met de grastegel. Een lange
violette weg leest als een weg; hetzelfde violet gedithered door een gazon leest als
schade, en het was het opvallendste dat er nog stond.

Bewust niet de ramp van `SAND`, al zit hij er dichtbij: een strand en een dorpsplein
horen niet dezelfde kleur te hebben, dus deze is koeler en een stap donkerder. `SAND`
blijft in de tabel staan en wordt nog steeds door geen enkel tileset uitgegeven — een
gereserveerde plek, geen kleur in gebruik.

`Legibility` merkt er niets van: `PATH` zit hoe dan ook in de grond-waardeband, dus de
regrade verplaatst dezelfde luminantie en alleen de tint veranderde.

### `2d3e343` Een klif is geen gebouw

PLATEAU `ROCK` maken repareerde de kleur en legde bloot wat eronder zat: `ROCK` staat wél
in `UPRIGHT_CATEGORIES`, dus Route 23 en Indigo Plateau werden nog steeds tot volumes
gevouwen én getopt. De plateau ging van crème schuren naar grijze schuren.

Een gebied weet nu of het GEBOUWD is of LANDSCHAP, via de modale categorie van zijn eigen
tegels, net zoals het al zijn modale hoogte kent. Een dak hoort bij een gebouw, dus
landschap wordt niet getopt: Route 23 van 3.012 naar 0, Indigo Plateau van 744 naar 0,
terwijl Pallet Town al zijn 192 houdt.

En een gevel is een tekening — dat is waar `pushFacade` voor is, één quad per voxel hoogte
zodat een raam een raam is. Een klif heeft geen opstand, dus landschap krijgt de
samengevoegde `pushWall`, één quad voor de hele val. Dat moest wel: zonder dak werden het
volle platte massa's en ging Indigo Plateau door het quad-plafond heen (15.762 van 15.000
op ZOOM 20). Die plafonds beschermen een bril die al eens heeft afgeknepen, dus ze zijn
niet verzet.

## Wat open staat, met de meting erbij

Op volgorde van hoeveel het aan het beeld doet.

| Wat | Gemeten | Waarom het er nog staat |
|---|---|---|
| Bomen zijn te laag | kruin piekt op 8 voxels tegen een speler van 8,8 | Raakt het geometriebudget, wil een meting op de bril |
| Rots als heg | 3.206 cellen grijze rotswand worden groene koepels | `isHedgeCell` accepteert elke buiten-massa van twee rijen |
| Toonbanken | 757 cellen, `counterTiles` zit al in de bundle en `MapRuntime.isCounter()` bestaat | Geen enkele vormcode vraagt het |
| Trappen | 257 cellen, nu geverfde vloer | Geen eigen vorm |
| Geen contactschaduw onder NPC's | `GroundShadow` bestaat, hangt alleen aan de speler en de twee vechters | +15 draw calls op de drukste map, betaalbaar |
| Oak, en elke NPC die je aankijkt | Speler op `depthTest = false` met `renderOrder = 98`, NPC's op `depthTest = true` met `renderOrder = 0`; gemeten in de lens, Oak staat exact één tegel (7,0 units) noordelijk op dezelfde hoogte | Joshua's keuze op 11 september: eerst zelf op de bril kijken hoe erg het is. De drie opties staan hieronder |
| `twoSided = true` op het terrein | `test/terrainwinding.test.mjs` meet nul naar binnen gerichte driehoeken over drie maps | Het materiaal kleedt ook de billboards en de panelen, dus het terrein heeft een eigen pad nodig |
| Interieurpalet klopt niet | het veld `palette` wijkt op 122 van de 222 maps af van de cartridgeregel | Interieurs erven het palet van de kaart waar je vandaan kwam; een BFS over de warps lost 220 van de 222 statisch op |

### De drie manieren om Oak terug te krijgen

Geen ervan is gebouwd; de keuze wacht op een bril-test.

1. **De speler vervaagt tijdens dialoog.** Er is precedent: tijdens een gevecht wordt
   zijn billboard al uitgezet. Klein en omkeerbaar, en het onderwerp van dat moment is
   toch de NPC. Nadeel: het is een zichtbare ingreep in wat de speler ziet.
2. **De cast sorteren op camera-afstand.** Speler en NPC's krijgen dezelfde behandeling
   en worden per frame geordend. Van elke kant correct. Nadeel: NPC's tekenen dan ook
   over bomen en hekken heen, zoals de speler nu doet — dat is precies de eigenschap die
   de code bewust vermeed.
3. **Alleen de NPC die je aankijkt wint.** Kleinste ingreep. Nadeel: vanuit het zuiden
   lijkt die NPC dan vóór Red te staan in plaats van erachter.

Wat geen van drieën oplost: twee billboards van gelijke hoogte, één tegel uit elkaar,
recht in de kijkrichting, dekken elkaar geometrisch af. Alleen ordening verandert wie
wint, niet dát er één verliest.

## De ruimte die er is

Uit de geometrie-survey, en het is de belangrijkste zin voor wie hierna verder gaat:
**geef het uit aan het palet en aan geometrie wegnemen, niet aan geometrie toevoegen.**

Het palet is 43 bij 43 pixels, 7.396 bytes: **0,7% van één toegestane 512-textuur.** Er
passen 585 dieptetreden in dat budget. Per-vertex ambient occlusion, een randband op de
bovenkant van elke muur, een afstandsband en een variatieband kunnen er alle vier
tegelijk in, en kosten nul quads, nul vertices, nul draw calls en nul werk per frame.

Draw calls zijn wél krap: 28 van 30 op de standaardtrede en 62 van 64 op ZOOM 28, en dat
is het terrein alleen. Eén disc per NPC kan erbij; één materiaal per NPC niet.

En een open vraag die alleen de bril kan beantwoorden: de framerate van 10 september
correleert **niet** met het quad-aantal (Route 22 tekent er meer dan Viridian City en liep
bijna twee keer zo snel), wat erop wijst dat deze renderer fill-rate-gebonden is en niet
vertex-gebonden. Eén Lens Power-meting op twee treden beslist dat, en niets op een laptop
kan het vervangen.

## De poorten

`test/indoorvolumes.test.mjs` is er bijgekomen en staat in `tools/verify.sh`. Hij meet
over alle 222 maps dat er binnen geen enkel puntdak staat, dat buiten alles wat er stond
er nog staat, dat er binnen precies twee hoogtes bestaan en dat niets de muur overstijgt
waar het tegenaan staat. Zijn selftest bewijst dat de dakcode buiten nog bereikbaar is en
loopt Red's eigen kolommen af om te tonen dat de tekening echt runs van vier rijen draagt,
zodat bewezen is dat de regel ze afkapt en niet dat er niets af te kappen viel.

De vastgezette getallen in `test/voxeldepth.test.mjs` zijn omlaag bijgesteld met de reden
erbij; `test/tileshapes.test.mjs` verwacht nu dat de `PROP_MAP_SHARE`-veto voor het bos
inert is, omdat die veto het symptoom behandelde dat hier bij de wortel is weggenomen.
`test/legibility.test.mjs` noemt bij een fout welke map het is in plaats van ze te tellen.
