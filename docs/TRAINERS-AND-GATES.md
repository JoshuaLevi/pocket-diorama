# Trainers die je zien, en wegen die dicht zitten

Nacht van 11 op 12 september 2026, stap 1 van `PLAN-FULL-GAME.md`. Dit
document zegt wat er gebouwd is, welke regel uit de cartridge eronder ligt,
en wat er met opzet niet in zit.

**In één regel:** Kanto was één open veld waar niemand je tegenhield; nu is de
Boulder Badge een sleutel, de Pokédex een sleutel, en vallen 295 trainers je
aan zodra je hun blikveld in loopt.

## Wat er eerst gemeten is

Vóór dit werk, met de echte engine headless gelopen:

| Gemeten | Uitkomst |
|---|---|
| `PEWTER_CITY (30,18)`, 12x naar rechts | `ROUTE_3 (2,10)`, zonder badge en zonder één regel tekst |
| `VIRIDIAN_CITY`, de weg naar het noorden | open zonder Pokédex; de slaper zei niets |
| `header.range` (hoe ver een trainer kijkt) | ingelezen in `TrainerTalk.ts:88`, daarna door niets gelezen |
| Trainers die uit zichzelf aanvallen | 0 van 295 |

De badge opende dus letterlijk niets, want er stond niets dicht.

## De twee poorten

Een poort in Gen 1 is een coördinaat-trigger, en hij hangt aan een **vlag**,
niet aan een lichaam dat in de weg staat. Dat onderscheid is het hele punt:
de cartridge kan de slaper laten liggen en je tóch doorlaten, en hem weghalen
en de weg tóch dichthouden.

| Waar | Cellen | Vlag | Wat er gebeurt |
|---|---|---|---|
| `VIRIDIAN_CITY` | (19,9) | `unless EVENT_GOT_POKEDEX` | "This is private property!" en één stap terug |
| `PEWTER_CITY` | (35,17) (36,17) (37,18) (37,19) | `unless EVENT_BEAT_BROCK` | de youngster loopt je naar de gym |

De Pewter-poort is geen regel tekst maar een scène. `TEXT_PEWTERCITY_YOUNGSTER`
zet `wNPCMovementScriptPointerTableNum = 3`, en dat is het gesimuleerde-joypad
systeem: dezelfde machinerie waarmee Oak je in Pallet Town meeneemt. De
cartridge bewaart **één** spelerspad voor alle vier de cellen
(`RLEList_PewterGymPlayer`, achterstevoren afgespeeld) en laat `PewterGuys` er
een kort positioneringsstukje overheen schrijven; muren vangen het verschil op,
zodat alle vier samenkomen. Dat rekenwerk staat hier één keer uitgeschreven per
cel, en alle vier zetten de speler op **(11,18)** met de youngster op **(12,18)**
— nagerekend tegen de echte map voordat er een regel van geschreven werd.

Zijn voorsprong is geen versiering. Op twee van de vier cellen schrijft
`PewterGuys` acht NO_INPUT-frames — één stap van hem — over de kop van het
spelerspad, omdat de speler anders tegelijk met hem op (35,18) aankomt. Onze
gescripte wandeling geeft het op waar hij staat als er een lichaam in de weg
staat, dus zonder die voorsprong bleef de speler twee cellen verderop staan.
Dat is precies wat de eerste testrun ving.

Hij loopt niet terug: `MovementData_PewterGymGuyExit` neemt hem vijf naar
rechts, (17,18) in, een doodlopende hoek achter het hek op (18,18) — en daarom
teleporteert het origineel hem daarna buiten beeld naar zijn eigen cel.

En de derde vlag: Oak's lab zet `EVENT_GOT_POKEDEX` en verwisselt in dezelfde
adem de twee oude mannen (`HideObject TOGGLE_LYING_OLD_MAN` /
`ShowObject TOGGLE_OLD_MAN`), zonder branch ertussen. Onze port zette de vlag
en liet beide lichamen staan waar ze scheepten. Dat is nu één feit, en
`PlayLoop` herhaalt de gevolgtrekking bij elke load — want een save die de
vlag draagt en de schakelaars niet, kan door niets later nog rechtgezet worden:
het script dat ze schuldig was, heeft al gedraaid.

## Het zichtsysteem

Geen 162 scripts maar één routine: `engine/overworld/trainer_sight.asm`,
`TrainerEngage`, na elke stap tegen elke sprite op de map. De twaalf bytes die
hij leest zaten al in de bundel als `trainerHeaders`.

De regel, in volgorde:

1. de sprite staat op het scherm — kan bij bereik ≤ 5 in een rechte lijn niet
   falen, dus niet overgeschreven
2. uitgelijnd: dezelfde rij **of** dezelfde kolom
3. de afstand is niet nul
4. afstand ≤ `header.range`, **en** de kijkrichting bepaalt de as
5. de speler staat aan de kant waar hij naar kijkt

Drie dingen die de routine **niet** doet, elk een redelijke gok die fout is:

- **Geen muurtest.** De zwemster in Cerulean Gym daagt je uit over het bad
  heen, en de youngster op Route 9 over de rots. Allebei staan ze met naam in
  de testsuite, want ze zijn echt zo in onze eigen maps.
- **De speler wordt niet omgedraaid.** Je blijft kijken waar je liep.
- **Hij loopt niet op je cel.** `TrainerWalkUpToPlayer` schrijft `afstand - 1`
  stappen, dus hij stopt ernaast.

De volgorde van de scan is de volgorde van de sprites, dus de laagste index wint als
twee je tegelijk zien. Geen enkele cel in Kanto wordt door twee trainers
gezien — elke zichtlijn is tegen de maps gelegd — dus die knoop hoeft nooit
doorgehakt te worden. Hij staat er wel, want de dag dat een script een trainer
ergens anders neerzet, moet hij kloppen.

### Het uitroepteken

`CheckFightingMapTrainers` zet `EXCLAMATION_BUBBLE` tussen de muziek en de
wandeling. Zonder dat begint er een man zonder aanleiding naar je toe te lopen.

Wij tekenen het in de dioramalaag in plaats van de vier ROM-tegels te
extraheren: dat laatste kost een re-bake van elke wereld, en daarmee elke
meting die tegen de oude is gedaan, voor vier tegels. Het is een billboard en
geen voxels, om dezelfde reden als elk personage dat is. Het is wit zonder
omlijning, omdat het scherm additief is: de donkere helft van een Game
Boy-omlijning is daar niet donker, hij is afwezig.

De duur is het enige dat niet over te schrijven viel. De cartridge telt frames
omdat hij er altijd zestig heeft; de preview draait op ongeveer 3,5 fps op een
grote map, waar zestig frames zeventien seconden uitroepteken boven een hoofd
is — gemeten, niet gegokt. De lens leest dus de klok en de headless-harnas telt
frames, en allebei bedoelen één seconde.

## Pewter Gym, tegen `PewterGym.asm` gelegd

Vier verschillen gevonden en drie ervan gerepareerd:

- De gymtrainer viel nooit aan. Nu wel (bereik 5, kijkt naar rechts).
- Het advies werd bij de overwinning gezegd. `PewterGymScriptReceiveTM34` eindigt
  na de TM-regels; het advies is de tak van "al verslagen én TM binnen". De lens
  zei één pagina te veel op het moment van winnen, en dezelfde pagina nog eens
  bij het volgende gesprek.
- De badge rinkelde het verkeerde geluid, op de verkeerde plek.
  `PewterGymBrockReceivedBoulderBadgeText` is één tekst: de badge-regel, dan
  `sound_level_up`, dan de uitleg. Het geluid hoort tússen de pagina's, en
  `Victories.ts` beschreef het al zo terwijl de bouwer het ervoor zette.
- `ResetEvents EVENT_1ST_ROUTE22_RIVAL_BATTLE, EVENT_ROUTE22_RIVAL_WANTS_BATTLE`
  gebeurde niet, want de tabel kon alleen `true` schrijven. Nu is er een
  `clear`-veld.

## Wat er met opzet niet in zit

- **Het museum.** De ¥50-poort ontbreekt en de trap is bereikbaar zonder te
  betalen; het plan zet dit buiten stap 1.
- **De vangles van de oude man.** `field.oldManBattle` wordt geëxtraheerd en
  door niets gelezen. Het is een eigen gevechtsmodus (`BATTLE_TYPE_OLD_MAN`),
  geen script, en niemand hoeft er langs.
- **De museumgids-escorte in Pewter**, de tegenhanger van de gym-escorte.
- **De POWER_PLANT-uitzondering** staat er wel en bereikt niets: onze extractie
  modelleert die Voltorbs als statische gevechten en niet als trainers. De
  suite legt die vorm van de data vast, zodat de dag dat een re-bake dat
  verandert wordt opgemerkt in plaats van ontdekt.
- **Een muurtest op zichtlijnen.** De cartridge heeft er geen; dit is geen
  omissie maar een besluit dat al genomen was in 1996.

## Waar het bewijs staat

| Poort | Wat hij aantoont |
|---|---|
| `test/gates.test.mjs` | beide poorten door de echte engine, met en zonder de vlag; 42 checks |
| `test/trainersight.test.mjs` | alle 295 zichtlijnen aan het eind van hun bereik, één cel verder, één cel achter en één cel opzij; 39 checks |
| `test/script.test.mjs` | Brocks gesprek per tak, inclusief waar het jingle valt |
| `test/playloop.test.mjs` | de overwinning door de echte host, inclusief de twee vlaggen die omlaag gaan |
| LEAF `a-trainer-stops-you` | op de draaiende lens: hij staat getekend, aan, binnen het venster, naast je, en jij bent niet omgedraaid |
