/**
 * The WorldData schema: one interface per dataset the extractor produces.
 *
 * These shapes are derived from the golden JSON in tools/golden/json/, which
 * was produced by running gen1recomp's build_rom_data.py against the canonical
 * Pokemon Red ROM. The golden files ARE the contract: if a builder's output
 * does not serialise to byte-identical canonical JSON, the port is wrong,
 * regardless of how right it looks.
 *
 * Conventions that come straight from the golden files:
 *   - An optional property (`foo?:`) is a key the reference OMITS when it has
 *     no value. Emit `undefined` (or leave the key off); never emit `null`.
 *   - A `| null` property is a key the reference always emits, sometimes with
 *     a null value. Emit an explicit `null`; never omit it.
 *   - Dictionaries keyed by a numeric index use decimal STRING keys, because
 *     the reference passed through a Lua table.
 *   - Every dataset carries a `source` string naming where in the ROM it came
 *     from. Copy the reference's wording exactly.
 *
 * Lens Studio TypeScript restrictions apply to every type here: no Record<>,
 * Map<> or Set<>, no `export enum`. Dictionaries are plain index-signature
 * interfaces and enumerations are string union types.
 */

/* ------------------------------------------------------------------------ */
/* Shared primitives                                                         */
/* ------------------------------------------------------------------------ */

/** Any value that survives a round trip through canonical JSON. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Tile coordinate inside a map, or a pixel coordinate inside a sheet. */
export interface Point {
  x: number;
  y: number;
}

/** A generated image: where it will be written and how big it is. */
export interface ImageRef {
  height: number;
  path: string;
  width: number;
}

/** An image that also declares the tile index its first tile loads at. */
export interface TileImageRef extends ImageRef {
  tileBase: number;
}

/** A three-frame animation, as used by the intro cutscene. */
export interface AnimatedImageRef {
  frame1: ImageRef;
  frame2: ImageRef;
  frame3: ImageRef;
}

/** A single Pokemon in a party: what it is and what level. */
export interface PartyMon {
  level: number;
  species: string;
}

/* ------------------------------------------------------------------------ */
/* constants.json                                                            */
/* ------------------------------------------------------------------------ */

/** Grid size and map-id index for one map, before its blocks are decoded. */
export interface MapDimensions {
  height: number;
  index: number;
  width: number;
}

export interface ConstantsDef {
  /** Map ids in map-index order; the index into this list IS the map id. */
  mapOrder: string[];
  maps: { [mapId: string]: MapDimensions };
  moveOrder: string[];
  source: string;
  /** Internal species order, which is NOT Pokedex order. */
  speciesOrder: string[];
  spriteOrder: string[];
  tilesetOrder: string[];
  types: { [typeName: string]: number };
}

/* ------------------------------------------------------------------------ */
/* tilesets.json                                                             */
/* ------------------------------------------------------------------------ */

export interface TilesetDef {
  animation: string;
  /** One entry per block: 16 tile indices, 4x4, row-major. */
  blocks: number[][];
  counterTiles: number[];
  doorTiles: number[];
  /** Tile index that triggers wild encounters, or null when the set has none. */
  grassTile: number | null;
  id: string;
  image: string;
  imageHeight: number;
  imageWidth: number;
  source: string;
  tilesPerRow: number;
  walkable: number[];
  warpTiles: number[];
}

export interface TilesetTable {
  [tilesetId: string]: TilesetDef;
}

/* ------------------------------------------------------------------------ */
/* maps.json                                                                 */
/* ------------------------------------------------------------------------ */

export interface MapConnection {
  map: string;
  offset: number;
}

/**
 * Edge connections. Absent directions are omitted; a map with no connections
 * at all serialises as `[]`, which canonicalJson() handles.
 */
export interface MapConnections {
  north?: MapConnection;
  south?: MapConnection;
  east?: MapConnection;
  west?: MapConnection;
}

export type MapObjectMovement = "STAY" | "WALK";

export type MapObjectRange =
  | "NONE"
  | "ANY_DIR"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "UP_DOWN"
  | "LEFT_RIGHT"
  | "BOULDER_MOVEMENT_BYTE_2";

/**
 * An NPC, item ball, trainer or static encounter placed on a map.
 *
 * The three flavours are told apart by which optional keys are present:
 * `item` for a pickup, `trainerClass` + `trainerParty` for a battle, and
 * `pokemon` + `level` for a static encounter.
 */
export interface MapObject {
  hidden?: boolean;
  index: number;
  item?: string;
  level?: number;
  movement: MapObjectMovement;
  name: string;
  pokemon?: string;
  range: MapObjectRange;
  sprite: string;
  text: string;
  trainerClass?: string;
  trainerParty?: number;
  x: number;
  y: number;
}

export interface MapWarp {
  destMap: string;
  /** 1-based warp index on the destination map. */
  destWarp: number;
  x: number;
  y: number;
}

export interface MapSign {
  text: string;
  x: number;
  y: number;
}

export interface MapDef {
  /** width*height block indices into the tileset, row-major. */
  blocks: number[];
  borderBlock: number;
  connections: MapConnections;
  /** Size in BLOCKS (4x4 tiles), not tiles. */
  height: number;
  id: string;
  index: number;
  label: string;
  objects: MapObject[];
  signs: MapSign[];
  source: string;
  tileset: string;
  warps: MapWarp[];
  width: number;
}

export interface MapTable {
  [mapId: string]: MapDef;
}

/* ------------------------------------------------------------------------ */
/* font.json                                                                 */
/* ------------------------------------------------------------------------ */

export interface FontGlyph {
  code: number;
  seq: string;
}

export interface FontDef {
  charmap: FontGlyph[];
  extraBase: number;
  glyphsPerRow: number;
  image: string;
  imageExtra: string;
  mainBase: number;
  source: string;
}

/* ------------------------------------------------------------------------ */
/* sprites.json                                                              */
/* ------------------------------------------------------------------------ */

export interface SpriteDef {
  frames: number;
  id: string;
  image: string;
  source: string;
  /** True for sprites with a walk cycle, false for static props. */
  walker: boolean;
}

export interface SpriteTable {
  [spriteId: string]: SpriteDef;
}

/* ------------------------------------------------------------------------ */
/* moves.json                                                                */
/* ------------------------------------------------------------------------ */

export interface MoveAnimDef {
  flash?: boolean;
  pitch: number;
  shake?: boolean;
  sound: string;
  tempo: number;
}

export interface MoveDef {
  accuracy: number;
  anim: MoveAnimDef;
  effect: string;
  id: string;
  index: number;
  name: string;
  power: number;
  pp: number;
  source: string;
  type: string;
}

export interface MoveTable {
  [moveId: string]: MoveDef;
}

/* ------------------------------------------------------------------------ */
/* items.json                                                                */
/* ------------------------------------------------------------------------ */

/** TM/HM metadata; present only on machine items. */
export interface MachineDef {
  kind: string;
  move: string;
  number: number;
}

export interface ItemDef {
  id: string;
  /** Item index; absent for TMs and HMs, which are numbered separately. */
  index?: number;
  keyItem?: boolean;
  machine?: MachineDef;
  name: string;
  price: number;
  source: string;
}

export interface ItemTable {
  [itemId: string]: ItemDef;
}

/* ------------------------------------------------------------------------ */
/* type_chart.json                                                           */
/* ------------------------------------------------------------------------ */

export interface TypeMatchup {
  attacker: string;
  defender: string;
  /** Effectiveness x10: 0, 5 or 20. */
  multiplier: number;
}

export interface TypeChartDef {
  matchups: TypeMatchup[];
  names: string[];
  source: string;
}

/* ------------------------------------------------------------------------ */
/* palettes.json                                                             */
/* ------------------------------------------------------------------------ */

/** One palette: four colours, each [r, g, b] in 0-255. */
export type PaletteDef = number[][];

export interface PaletteSet {
  order: string[];
  palettes: { [paletteId: string]: PaletteDef };
  /** Species id -> palette id. */
  pokemon: { [species: string]: string };
  source: string;
}

/* ------------------------------------------------------------------------ */
/* icons.json                                                                */
/* ------------------------------------------------------------------------ */

export interface IconsDef {
  /** Icon id per Pokedex number, index 0 being dex #1. */
  byDex: string[];
  icons: { [iconId: string]: string };
  source: string;
}

/* ------------------------------------------------------------------------ */
/* pokemon.json                                                              */
/* ------------------------------------------------------------------------ */

export interface BaseStats {
  attack: number;
  defense: number;
  hp: number;
  special: number;
  speed: number;
}

export interface DexEntry {
  heightFt: number;
  heightIn: number;
  kind: string;
  /** Label of the flavour text stream in text.json. */
  text: string;
  /** Weight in tenths of a pound. */
  weight: number;
}

export interface EvolutionDef {
  /** Present only for stone evolutions. */
  item?: string;
  level: number;
  method: string;
  species: string;
}

export interface LearnsetEntry {
  level: number;
  move: string;
}

export interface SpeciesDef {
  baseExp: number;
  baseStats: BaseStats;
  catchRate: number;
  /** Pokedex number. */
  dex: number;
  dexEntry: DexEntry;
  evolutions: EvolutionDef[];
  /** Front sprite side in tiles. */
  frontSize: number;
  growthRate: string;
  id: string;
  /** Internal species index, which is NOT the Pokedex number. */
  index: number;
  learnset: LearnsetEntry[];
  level1Moves: string[];
  name: string;
  source: string;
  spriteBack: string;
  spriteFront: string;
  tmhm: string[];
  types: string[];
}

export interface SpeciesTable {
  [speciesId: string]: SpeciesDef;
}

/* ------------------------------------------------------------------------ */
/* trainers.json                                                             */
/* ------------------------------------------------------------------------ */

export interface TrainerDef {
  aiMods: number[];
  baseMoney: number;
  id: string;
  index: number;
  name: string;
  /** One party per numbered roster of this trainer class. */
  parties: PartyMon[][];
  /** Battle portrait path, or null for classes with no pic. */
  pic: string | null;
  source: string;
}

export interface TrainerTable {
  [trainerId: string]: TrainerDef;
}

/* ------------------------------------------------------------------------ */
/* encounters.json                                                           */
/* ------------------------------------------------------------------------ */

export interface EncounterSlot {
  level: number;
  species: string;
}

export interface EncounterGroup {
  /** Encounter chance per step, 0-255. */
  rate: number;
  slots: EncounterSlot[];
}

export interface EncounterTable {
  grass?: EncounterGroup;
  source: string;
  water?: EncounterGroup;
}

export interface EncounterTableSet {
  [mapId: string]: EncounterTable;
}

/* ------------------------------------------------------------------------ */
/* text.json, text_pointers.json, trainer_headers.json                        */
/* ------------------------------------------------------------------------ */

/** One decoded dialogue stream, as stored under its label in text.json. */
export type TextEntry = string;

export interface TextTable {
  [label: string]: TextEntry;
}

/** How one TEXT_* id on a map resolves: to a label, a mart list, or asm. */
export interface TextPointer {
  asm?: boolean;
  cableClub?: boolean;
  label: string;
  mart?: string[];
  nurse?: boolean;
  /** Label of the inner text stream when the outer one is a wrapper. */
  text?: string;
}

export interface TextPointerTable {
  [mapLabel: string]: { [textId: string]: TextPointer };
}

export interface TrainerHeader {
  after: string;
  battle: string;
  event: string;
  /** Sight range in tiles; omitted for the one header that has none. */
  range?: number;
  won: string;
}

export interface TrainerHeaderTable {
  [mapLabel: string]: { [index: string]: TrainerHeader };
}

/* ------------------------------------------------------------------------ */
/* battle_anims.json                                                         */
/* ------------------------------------------------------------------------ */

export interface FrameBlockPart {
  pal1?: boolean;
  prio?: boolean;
  tile: number;
  x: number;
  xflip: boolean;
  y: number;
  yflip: boolean;
}

export interface SubanimBlock {
  block: number;
  coord: number;
  mode: number;
}

export type SubanimType =
  | "NORMAL"
  | "HFLIP"
  | "HVFLIP"
  | "REVERSE"
  | "ENEMY"
  | "COORDFLIP";

export interface SubanimDef {
  blocks: SubanimBlock[];
  type: SubanimType;
}

/**
 * One step of a move's animation script. A step either plays a subanimation
 * (`subanim` + `tileset` + `delay`) or runs a special effect (`effect`), and
 * may additionally trigger a sound.
 */
export interface MoveAnimStep {
  delay?: number;
  effect?: string;
  sound?: string;
  subanim?: number;
  tileset?: number;
}

export interface MoveAnimScript {
  seq: MoveAnimStep[];
  source: string;
}

export interface AnimTilesheet {
  height: number;
  path: string;
  source: string;
  tiles: number;
  width: number;
}

export interface BattleAnimDef {
  baseCoords: { [index: string]: Point };
  frameBlocks: { [index: string]: FrameBlockPart[] };
  moveAnims: { [moveId: string]: MoveAnimScript };
  subanims: { [index: string]: SubanimDef };
  tilesheets: { [index: string]: AnimTilesheet };
}

/* ------------------------------------------------------------------------ */
/* field.json                                                                */
/* ------------------------------------------------------------------------ */

export interface BadgeGateGuard {
  badge: string;
  event: string;
  maxX?: number;
  sprite: number;
  text: string;
  y: number;
}

export interface BadgeGate {
  badge?: string;
  coords?: Point[];
  failText: string;
  guards?: BadgeGateGuard[];
  passText: string;
  text?: string;
}

export interface BattleHudDef {
  fontBattleExtra: TileImageRef;
  hud1: TileImageRef;
  hud2: TileImageRef;
  hud3: TileImageRef;
}

export interface BikeRidingDef {
  maps: string[];
  tilesets: string[];
}

export interface ClosedDoorDef {
  block: number;
  bx: number;
  by: number;
  /** Set when a single event opens the door. */
  event?: string;
  /** Set when several events must all fire. */
  events?: string[];
  open: number;
}

export interface CardKeyGate {
  gate: number;
  x: number;
  y: number;
}

export interface CardKeyDoorsDef {
  closedDoors: { [mapId: string]: ClosedDoorDef[] };
  doorTiles: number[];
  doors: { [mapId: string]: CardKeyGate[] };
  maps: string[];
  openBlock: number;
  silphCo11F: { doorTile: number; openBlock: number };
}

export interface CoinPurchase {
  coins: number;
  price: number;
}

export interface CreditLine {
  column: number;
  text: string;
}

export interface CreditScreen {
  copyright?: boolean;
  fade: boolean;
  lines: CreditLine[];
  mon?: string;
}

export interface TheEndDef {
  display: string;
  height: number;
  letterHeight: number;
  letterWidth: number;
  letters: string;
  path: string;
  /** Index into `letters` per cell, -1 for a gap. */
  pattern: number[];
  width: number;
}

export interface CreditsDef {
  mons: string[];
  screens: CreditScreen[];
  theEnd: TheEndDef;
}

export interface TileSwap {
  after: number;
  before: number;
}

export interface DarkMapsDef {
  entryMap: string;
  flashBadge: string;
  maps: string[];
  palOffset: number;
}

export interface MapRange {
  first: string;
  last: string;
}

export interface DungeonTransitionDef {
  maps: string[];
  ranges: MapRange[];
}

export interface EmotionBubble {
  h: number;
  name: string;
  w: number;
  x: number;
  y: number;
}

export interface EmotionBubblesDef extends ImageRef {
  bubbles: EmotionBubble[];
}

export interface ForcedMovementTile {
  mode: string;
  x: number;
  y: number;
}

export interface ForcedMovementDef {
  slopeMaps: string[];
  tiles: { [mapId: string]: ForcedMovementTile[] };
}

export interface GameCornerPosterDef {
  closedBlock: number;
  event: string;
  map: string;
  openBlock: number;
  poster: Point;
  posterText: string;
  x: number;
  y: number;
}

export interface HiddenCoin {
  coins: number;
  x: number;
  y: number;
}

export interface HiddenItem {
  item: string;
  x: number;
  y: number;
}

export interface FacingTile {
  facing: string;
  x: number;
  y: number;
}

export interface BenchGuy {
  facing: string;
  text: string;
  textFacing: string;
  x: number;
  y: number;
}

export interface TrashCan {
  can: number;
  x: number;
  y: number;
}

export interface TrashCansDef {
  /** Can index (decimal string key) -> indices of neighbouring cans. */
  adjacent: { [can: string]: number[] };
  cans: TrashCan[];
  columns: number;
  firstLockCandidates: number[];
  firstLockEvent: string;
  map: string;
  rows: number;
  /** Prose note describing the switch logic; copied from the manifest. */
  rules: string;
  secondLockEvent: string;
}

export interface HiddenExtrasDef {
  benchGuys: { [mapId: string]: BenchGuy[] };
  gymStatues: { [mapId: string]: FacingTile[] };
  pcTiles: { [mapId: string]: FacingTile[] };
  printTrash: { [mapId: string]: FacingTile[] };
  trashCans: TrashCansDef;
}

export interface IndoorEncountersDef {
  excludedTileset: string;
  firstIndoorMap: number;
}

export interface IntroDef {
  bigStar: ImageRef;
  fallingStar: ImageRef;
  fallingStarBlink: ImageRef;
  gamefreakLogo: ImageRef;
  gamefreakPresents: ImageRef;
  gamefreakText: ImageRef;
  gengar: AnimatedImageRef;
  nidorino: AnimatedImageRef;
}

export interface LedgeDef {
  facing: string;
  input: string;
  ledgeTile: number;
  standingTile: number;
}

export interface OakSpeechDef {
  shrink1: string;
  shrink2: string;
}

export interface OldManBattleDef {
  afterText: string;
  battleType: string;
  level: number;
  map: string;
  species: string;
  text: string;
}

export interface PresetNamesDef {
  customOption: string;
  player: string[];
  rival: string[];
}

export interface SeafoamHole {
  boulderEvent: string;
  hideObject: string;
  landsAt: Point;
  showObject: string;
  x: number;
  y: number;
}

export interface CurrentMove {
  count: number;
  dir: string;
}

export interface CurrentTile {
  moves: CurrentMove[];
  x: number;
  y: number;
}

export interface SeafoamForcedExit {
  activeUntilEvents: string[];
  coords: Point[];
}

export interface SeafoamMapDef {
  currents?: CurrentTile[];
  currentsDisabledByEvents?: string[];
  entryCurrent?: CurrentTile;
  forcedExit?: SeafoamForcedExit;
  holeDestination?: string;
  holes?: SeafoamHole[];
  pluggedByHolesOn?: { holes: SeafoamHole[]; map: string };
}

export interface SlotMachineDef {
  state: string;
  x: number;
  y: number;
}

export interface SlotSymbolDef {
  h: number;
  sheet: string;
  tiles: number;
  w: number;
  x: number;
  y: number;
}

export interface SlotTilemapDef {
  cols: number;
  rows: number;
  sheet: string;
  tileCols: number;
  tiles: number[][];
}

export interface SlotSymbolsDef {
  height: number;
  order: string[];
  sheet: string;
  sheets: { background: ImageRef; wheel: ImageRef };
  symbols: { [symbolId: string]: SlotSymbolDef };
  tilemap: SlotTilemapDef;
  width: number;
}

export interface SpinnerTile {
  moves: CurrentMove[];
  x: number;
  y: number;
}

export interface TilePair {
  a: number;
  b: number;
  tileset: string;
}

export interface TilePairsDef {
  land: TilePair[];
  water: TilePair[];
}

export interface TitleDef {
  copyright: ImageRef;
  gamefreakInc: ImageRef;
  logo: ImageRef;
  player: ImageRef;
  version: ImageRef;
}

export interface TownMapLocation {
  name: string;
  x: number;
  y: number;
}

export interface TownMapBackground {
  cursor: ImageRef;
  /** Run-length-expanded tile indices for the whole map image. */
  map: number[];
  tiles: ImageRef;
}

export interface TownMapDef {
  background: TownMapBackground;
  cursorOrder: string[];
  gridPixelSize: number;
  locations: { [mapId: string]: TownMapLocation };
}

export interface TradeDef {
  dialogset: number;
  get: string;
  give: string;
  nickname: string;
}

export interface WarpCarpetsDef {
  edgeMaps: string[];
  function2Maps: string[];
  function2Tilesets: string[];
  ssAnneBow: { map: string; tile: number };
  tiles: { down: number[]; left: number[]; right: number[]; up: number[] };
}

/**
 * Everything the overworld engine needs that is not a map, a tileset or a
 * battle table: gates, ledges, currents, the slot machines, the credits.
 * Most of it is manifest metadata; the image refs come from decoded graphics.
 */
export interface FieldDef {
  badgeGates: { [mapId: string]: BadgeGate };
  battleHud: BattleHudDef;
  bikeRiding: BikeRidingDef;
  cardKeyDoors: CardKeyDoorsDef;
  coinPurchases: CoinPurchase[];
  credits: CreditsDef;
  cutTreeSwaps: TileSwap[];
  darkMaps: DarkMapsDef;
  dungeonTransitionMaps: DungeonTransitionDef;
  emotionBubbles: EmotionBubblesDef;
  flyOrder: string[];
  flyWarps: { [mapId: string]: Point };
  forcedMovement: ForcedMovementDef;
  gameCornerPoster: GameCornerPosterDef;
  hiddenCoins: { [mapId: string]: HiddenCoin[] };
  hiddenExtras: HiddenExtrasDef;
  hiddenItems: { [mapId: string]: HiddenItem[] };
  indoorEncounters: IndoorEncountersDef;
  intro: IntroDef;
  ledges: LedgeDef[];
  oakSpeech: OakSpeechDef;
  oldManBattle: OldManBattleDef;
  overworldFx: { [effectId: string]: ImageRef };
  pcItemCap: number;
  presetNames: PresetNamesDef;
  seafoam: { [mapId: string]: SeafoamMapDef };
  slotMachines: { [mapId: string]: SlotMachineDef[] };
  slotSymbols: SlotSymbolsDef;
  slotWheels: string[][];
  source: string;
  spinners: { [mapId: string]: SpinnerTile[] };
  superRod: { [mapId: string]: EncounterSlot[] };
  tilePairs: TilePairsDef;
  title: TitleDef;
  townMap: TownMapDef;
  trades: TradeDef[];
  warpCarpets: WarpCarpetsDef;
  waterTilesets: string[];
}

/* ------------------------------------------------------------------------ */
/* WorldData                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Everything the Lens loads after a bake, one property per generated file.
 * Property names match the golden filenames so a dataset name, an output file
 * and a WorldData key are always the same word.
 */
export interface WorldData {
  battle_anims: BattleAnimDef;
  constants: ConstantsDef;
  encounters: EncounterTableSet;
  field: FieldDef;
  font: FontDef;
  icons: IconsDef;
  items: ItemTable;
  maps: MapTable;
  moves: MoveTable;
  palettes: PaletteSet;
  pokemon: SpeciesTable;
  sprites: SpriteTable;
  text: TextTable;
  text_pointers: TextPointerTable;
  tilesets: TilesetTable;
  trainer_headers: TrainerHeaderTable;
  trainers: TrainerTable;
  type_chart: TypeChartDef;
}

/* ------------------------------------------------------------------------ */
/* rom_manifest.json                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Loosely-typed manifest section.
 *
 * The manifest carries large hand-authored blobs (audio programs, the field
 * metadata, per-map object names) whose full shape is not worth mirroring
 * here: most of it is passed through to the output untouched. `any` is a
 * deliberate, contained escape hatch so a dataset builder can read a nested
 * manifest field without a cast at every hop. Validate what you read.
 */
export interface ManifestBlob {
  [key: string]: any;
}

export interface ManifestTilesetMeta {
  blockCount: number;
  id: string;
  imageBase: string;
  imageHeight: number;
  imageWidth: number;
  name: string;
}

export interface ManifestSpriteMeta {
  id: string;
  imageBase: string;
  imageHeight: number;
  imageWidth: number;
  label: string;
}

export interface ManifestTrainerPic {
  imageBase: string;
  label: string;
  path: string;
}

export interface ManifestPokemonAsset {
  back: string;
  backLabel: string;
  front: string;
  frontLabel: string;
}

export interface ManifestMapMeta {
  blockLength: number;
  label: string;
  objects: ManifestBlob[];
  signTexts: string[];
}

export interface ManifestTextMeta {
  /** Label -> [command, token] pairs to splice into the decoded stream. */
  dynamic: ManifestBlob;
  labels: string[];
  pointers: TextPointerTable;
  trainerHeaders: ManifestBlob;
}

/**
 * The bundled ROM metadata: symbol addresses, name tables and the port
 * metadata that assembly erased. MIT licensed, and it contains no ROM bytes,
 * which is why it can ship with the Lens while the cart cannot.
 */
export interface RomManifest {
  audio: ManifestBlob;
  battleAnimations: ManifestBlob;
  /** Byte value (decimal string) -> glyph. */
  charmap: { [code: string]: string };
  constants: ConstantsDef;
  dexEntryLabels: { [species: string]: string };
  dexOrder: string[];
  field: ManifestBlob;
  fontCharmap: FontGlyph[];
  format: number;
  growthRates: string[];
  hms: string[];
  iconOrder: string[];
  items: string[];
  maps: { [mapId: string]: ManifestMapMeta };
  moveEffects: string[];
  numItems: number;
  paletteOrder: string[];
  pokemonAssets: { [species: string]: ManifestPokemonAsset };
  /** SHA-1 of the one ROM revision these addresses are valid for. */
  romSha1: string;
  sfxKeys: { [code: string]: string };
  sprites: ManifestBlob;
  symbols: { [name: string]: number[] };
  text: ManifestTextMeta;
  tileAnimations: string[];
  tilesets: ManifestTilesetMeta[];
  tmhmMoves: string[];
  tms: string[];
  trainerPartyOverrides: { [trainerId: string]: PartyMon[] };
  trainerPics: ManifestTrainerPic[];
  trainers: string[];
  typeNameLabels: string[];
  [key: string]: unknown;
}
