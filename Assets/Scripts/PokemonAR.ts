import type { DPadState } from "./play/InputSource";
// Root controller. This is the ONLY script attached in the scene.
//
// Everything else -- meshes, materials, the player billboard, the status text -- is
// created here in code at start-up. That is not stylistic: the project has to move
// down to Lens Studio 5.15.4 for device testing on Spectacles (2024), and a scene
// built in code migrates by creating one object and setting a handful of inputs,
// while an editor-built scene has to be re-authored by hand.
//
// The world arrives as a bundle from a WorldSource. One source pulls it from the
// pairing bridge, another replays it from persistent storage. The game logic below
// cannot tell which, and after the first successful load the glasses never need the
// laptop again.

import { introSpecies } from "./play/script/MapScripts";
import { cartridgeVersion } from "./world/Cartridge";
import type { WorldBundle } from "./world/WorldData";
import { parseBundle, shippedFacing, unpackShades, unpackMask } from "./world/WorldData";
import { EMOTE_SECONDS, buildEmoteSheet } from "./world/EmoteBubble";
import type { SaveState } from "./world/WorldSource";
import type { PlayState } from "./play/PlayState";
import { canFight, markOwned, migratePlayState, newPlayState, PLAY_MODE_GAMEBOY, PLAY_MODE_DIORAMA }
  from "./play/PlayState";
import { PlayLoop } from "./play/PlayLoop";
import type { BattleView } from "./play/BattleRunner";
import { BattleRunner, RUNNER_DONE, RUNNER_LEARNING } from "./play/BattleRunner";
import { ANSWER_NO, ANSWER_PENDING, ANSWER_YES, pagesOf } from "./play/script/Host";
import type { HostServices } from "./play/script/Host";
import { isObjectHidden } from "./play/script/Dialogue";
import { ShopController, SHOP_CLOSED } from "./play/ShopController";
import { ChoiceController, CHOICE_CLOSED } from "./play/ChoiceController";
import { SlotController, SLOTS_CLOSED } from "./play/SlotController";
import { EVENT_IN_SAFARI, inSafariZone } from "./play/script/Safari";

/** The four rows a SAFARI ZONE battle offers, in the cartridge's order. */
const SAFARI_ROWS: string[] = ["ball", "bait", "rock", "run"];
import { PcController, PC_CLOSED } from "./play/PcController";
import { NpcMotion } from "./play/NpcMotion";
import type { NpcPose } from "./play/NpcMotion";
import { buildFontAtlas, DialogueBox, COLUMNS as BOX_COLUMNS } from "./play/script/DialogueBox";
import type { FontAtlas } from "./play/script/DialogueBox";
import { GlyphPanel } from "./play/script/GlyphPanel";
import { AudioDriver } from "./audio/AudioDriver";
import { AudioBanks } from "./audio/AudioBank";
import { Jukebox } from "./audio/Jukebox";
import { battleRole, victoryRole } from "./audio/Jukebox";
import { MoveLearnController, LEARN_ABANDONED, LEARN_CLOSED }
  from "./play/MoveLearnController";
import { EvolutionController, EVOLVE_CLOSED } from "./play/EvolutionController";
import { evolutionsDue, evolve, movesOnEvolution } from "./play/battle/Evolution";
import type { EvolutionDue } from "./play/battle/Evolution";
import type { ItemUseOutcome } from "./play/ItemUse";
import { learnMove, replaceMove, LEARN_NEEDS_ROOM } from "./play/battle/Party";
import type { BattleMon } from "./play/battle/types";
import { SFX_COLLISION, SFX_HEAL_AILMENT, SFX_LEDGE, SFX_PRESS_AB, SFX_PURCHASE, SFX_SAVE,
         SFX_START_MENU } from "./audio/Sfx";
import { TeachController, TEACH_CLOSED } from "./play/TeachController";
import { GHOST_PICTURE } from "./play/battle/Ghost";
import { Unveil } from "./play/battle/Unveil";
import { ELEVATOR_SHAKE_SECONDS, WorldShake } from "./play/WorldShake";
import { MenuController, MENU_CLOSED, MENU_FIELD_MOVE, MENU_FLY, MENU_ITEM,
         MENU_MOVE, MENU_NONE, MENU_OPTION, MENU_ROWS, MENU_RUN, MENU_SAVE,
         MENU_SWITCH, MENU_TEACH } from "./play/MenuController";
import { DONE, SUSPENDED, RUNNING } from "./play/script/ScriptVM";
import {
  BridgeWorldSource,
  HttpsWorldSource,
  loadBakedBundle,
  loadCachedBundle,
  loadSave,
  loadWizardSeen,
  storeBundle,
  forgetBundle,
  loadViewSettings,
  storeSave,
  storeViewSettings,
  storeWizardSeen,
} from "./world/WorldSource";
import type { WorldTransfer } from "./world/WorldSource";
import { claimUnowned } from "./play/Storage";
import { VoxelTerrain, curveDrop, VOXEL } from "./world/VoxelTerrain";
import { CM_PER_TILE, ZOOM_DEFAULT, plateSpanCm, zoomTilesAcross } from "./world/PlayArea";
import type { MapRuntime } from "./world/MapRuntime";
import { tileStatsFor, paletteTexels, PALETTE_TEXELS_ACROSS } from "./world/VoxelPalette";
import { tintFor, TIME_DAY, SATURATION_LEVELS, LEGIBILITY_LEVELS,
         SATURATION_HIGH } from "./world/DayTint";
import type { TileStats } from "./world/VoxelPalette";
import { spritePaletteFor, spriteHeightUnits } from "./world/SpritePalettes";
import { NpcWander, isWanderer } from "./play/NpcWander";
import type { Wanderer } from "./play/NpcWander";

/**
 * How much world a dark cave draws before Flash, in tiles ACROSS -- the same
 * unit as the ZOOM ladder, since the old name said "distance" and meant a
 * radius. The cartridge blacks out everything but a small patch around the
 * player; eleven tiles is the same statement in a voxel diorama.
 */
const DARK_WINDOW_TILES_ACROSS: number = 11;
import { Billboard, buildSpriteSheet, frameFor } from "./world/SpriteBillboard";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import type { WildEncounter } from "./play/Overworld";
import { Overworld } from "./play/Overworld";
import { BattleStage } from "./play/BattleStage";
import { frameBattle } from "./play/BattleFraming";
import { BattleAnimator } from "./play/BattleAnimator";
import { BattleDiscs } from "./play/BattleDiscs";
import { GroundShadow } from "./world/GroundShadow";
import { BattleActors } from "./play/BattleActors";
import { findArena } from "./world/BattleArena";
import type { Arena } from "./world/BattleArena";
import { DioramaHands } from "./play/DioramaHands";
import { DioramaPlacer, PLACE_SEARCHING, PLACE_ON_SURFACE } from "./play/DioramaPlacer";
import { onRim, overPlate, wrapRadians } from "./play/DioramaGrab";
import { playerOffsetLocal } from "./play/DioramaAnchor";
import type { InputSource } from "./play/InputSource";
import { RouteSource, personMoved } from "./play/RouteSource";
import { StickSource } from "./play/StickSource";
import { CellMarker, MARKER_RGB } from "./play/CellMarker";
import { paletteFor } from "./world/MapPalette";
import { findPath } from "./world/PathFind";
import {
  InputRouter,
  ScriptedInputSource,
  GameControllerSource,
  PinchSource,
  DPadEdge,
} from "./play/InputSource";
import { MotionControllerSource } from "./play/MotionControllerSource";
import { PanelSource } from "./play/PadPanel";
import { KeyboardKeys, VIEW_KEY_ZOOM_IN } from "./play/KeyboardKeys";
import { PadPanelView } from "./play/PadPanelView";
import { GbCanvas, GbFont, imageFromPacked, DMG_GREYS, DMG_GREEN, SCREEN_ROWS, SHADE_NONE,
         SHADE_GLASS, CODE_CURSOR, CODE_CURSOR_HOLLOW, TILE } from "./play/screen/GbCanvas";
import { ladderRows, ladderState } from "./play/debug/Ladder";
import { CreditsController, CREDITS_DONE } from "./play/screen/CreditsScreen";
import { playerSpriteId, playerPaletteId, SPRITE_PLAYER } from "./play/PlayerSprite";
import type { ShadeImage } from "./play/screen/GbCanvas";
import { GbScreenView } from "./play/screen/GbScreenView";
import { PhonePadView } from "./play/screen/PhonePadView";
import { BOX_TY } from "./play/screen/CanvasTextBox";
import { CanvasChoiceBox, CHOICE_PENDING, CHOICE_YES, CHOICE_TY }
  from "./play/screen/CanvasChoiceBox";
import { MessagePanelView } from "./play/screen/MessagePanelView";
import {
  TitleController, BootMenuController, TITLE_TO_MENU,
  BOOT_CONTINUE, BOOT_NEW_GAME, BOOT_TO_TITLE, BOOT_NEW_WORLD, defaultBootOptions, titleMonsFor,
} from "./play/screen/TitleScreen";
import type { TitleArt, BootOptions } from "./play/screen/TitleScreen";
import { NamingController, NAME_MAX_LENGTH } from "./play/screen/NamingScreen";
import {
  SetupWizard, WIZ_RETRY, WIZ_REPLACE, WIZ_RESCAN, WIZ_DONE, WIZ_FETCH_CODE,
  WIZ_KEYBOARD, WIZ_KEYBOARD_CLOSE,
  FAIL_NO_SOURCE, FAIL_BRIDGE, FAIL_BUNDLE, FAIL_WORLD, FAIL_CODE, FAIL_NET,
} from "./play/screen/SetupWizard";
import { EmptyPlate } from "./play/EmptyPlate";
import { LENS_NAME, LENS_VERSION } from "./Version";
import { DexEntryController } from "./play/screen/DexEntryScreen";
import { PictureController } from "./play/screen/PictureScreen";
import { paintCanvasMenu, paintCanvasBattleMenu } from "./play/screen/CanvasMenu";
import { paintBattleScreen } from "./play/screen/BattleScreen";
import { CanvasTextBox } from "./play/screen/CanvasTextBox";
import { IntroStage, ACK_TEXT_ID_PLAYER, ACK_TEXT_ID_RIVAL, RED_SPRITE_OBP0 } from "./play/screen/IntroScreen";
import type { IntroArt } from "./play/screen/IntroScreen";
import { OnboardingController } from "./play/screen/OnboardingScreen";
import { GameBoyShell, LCD_WIDTH_CM, SHELL_AHEAD_CM } from "./play/screen/GameBoyShell";
import { namePage } from "./play/screen/NamePage";
import type { PageModel } from "./play/screen/SpatialPage";
import { SpatialPage, listPage, pageKey } from "./play/screen/SpatialPage";
import { FloatingCodeKeyboard } from "./play/screen/FloatingCodeKeyboard";
import { GameBoyLabels } from "./play/screen/GameBoyLabels";
import { SpatialInput, PinchJoystick } from "./play/SpatialInput";
import { LooseButtons, looseButtonsWanted } from "./play/screen/LooseButtons";
import { ButtonCaps } from "./play/screen/ButtonCaps";
import type { PressableBox } from "./play/Pressable";
import { TouchPresser, FingerPresser } from "./play/Pressable";
import { TILT_DEGREES, ViewOptionsController, paintViewOptionRows, BUTTONS_AUTO, BUTTONS_ON,
         speedFactor, offeredRows, graphicsRows, centreRows, isGraphicsRow, rowLabel, rowValues, rowChosen, ROW_CANCEL, ROW_PLACE, ROW_FINDPAD,
         VIEW_CLOSE, VIEW_PLACE, VIEW_FINDPAD }
  from "./play/screen/ViewOptions";
import { sidePanelSpot, SIDE_WIDTH_CM, SIDE_REACH_CM }
  from "./play/screen/SidePanelPlacement";
import type { SidePanelSpot } from "./play/screen/SidePanelPlacement";
import type { ViewSettings } from "./play/screen/ViewOptions";
import { BATTLE_LIFE, BATTLE_TABLE, BATTLE_DISCS, BATTLE_LABELS, SHAPES_AUTHORED,
         MODE_GAMEBOY, MODE_DIORAMA, sanitiseViewSettings, VIEW_REVISION,
         CONTROLS_VIEW }
  from "./play/screen/ViewOptions";
import { panelShouldShow } from "./play/screen/PanelVisibility";
import { ViewCompass, seenFacing } from "./play/ViewRelativeInput";
import { paintEnemyHud, paintPlayerHud, ENEMY_PLATE, PLAYER_PLATE, BattleHudTiles }
  from "./play/screen/BattleHudScreen";
import { BattleStyleController, paintBattleStyle, STYLE_DONE }
  from "./play/screen/BattleStyleScreen";
import { paintBattleMenu } from "./play/screen/BattleMenuBox";
import { PanelFrame } from "./play/screen/PanelFrame";
import { HudBlockView } from "./play/screen/HudBlockView";
import { BATTLE_MON_UNITS } from "./play/BattleActors";
import { paintOverworld } from "./play/screen/OverworldCanvas";
import { GB_FPS, GameBoyAnimClock, buildGameBoyView } from "./play/screen/GameBoyView";
import { PadStatusPanel, LINGER_AFTER_LIVE_SECONDS } from "./play/screen/PadStatusPanel";

/**
 * A hand's pinch on a pad button is two events: SIK's trigger on the button
 * and, at release, the hand tracker's tap that is A anywhere else. A press
 * this recent is the same pinch, and its tap is dropped. DioramaHands calls
 * a hold of up to 0.6 s a tap.
 */
const PAD_TAP_SHADOW_SECONDS: number = 0.12;

/**
 * Whether the code is typed on the glasses' own keyboard where there is one.
 *
 * Off since 30 September. The system keyboard was chosen on the 28th, when a
 * wearer with only hands had no D-pad to walk a letter grid with; the Game
 * Boy has real buttons now. On the first glasses session with this page
 * Joshua never got a keyboard, which leaves the code page with no way to
 * type at all. (That session's log carries no "keyboard requested" line from
 * the device, so whether the request was made and ignored, or never made, is
 * not known.) The code page now uses a large spatial keyboard with targeted
 * letters; the same CodeEntry still supports a controller's D-pad. The
 * keyboard path is kept behind this switch rather than deleted: turn it on
 * once the keyboard has been seen to open on the glasses.
 */
const CODE_ON_SYSTEM_KEYBOARD: boolean = false;

/**
 * How often a running scan says it is still running.
 *
 * A sixty-second window over a quiet room prints nothing between its start and
 * its end, and a scan that has silently died looks identical from outside --
 * which is how a whole day went to a retry loop nobody could see.
 */
const PAD_HEARTBEAT_SECONDS: number = 10;

/**
 * How far the wearer must be from the diorama for their POSITION to say which
 * way they are looking at it, in centimetres.
 *
 * Nearer than this the horizontal part of the eye-to-model vector is short
 * enough that its direction is noise -- a wearer leaning over a small model on
 * a low table is almost directly above it -- so the compass falls back to
 * where they are LOOKING instead. See updateCompass.
 */
const COMPASS_REACH_CM: number = 12;

/** A Pokemon's nickname may be ten letters where a trainer's name takes seven. */
const NICKNAME_MAX_LENGTH: number = 10;

/** The text box and menu on the pad: glyph scale and the gap above the plate's edge. */
const HUD_GLYPH_SCALE: number = 1.1;
const HUD_GAP_CM: number = 1.2;
/** The menu panel is built 18 glyphs wide (see its construction). */
const MENU_COLUMNS: number = 18;

/** Glyph size for the menu when it hangs beside the message panel, not the pad. */
const PANEL_GLYPH_CM: number = 1.4;
/** How far above the message panel's centre the menu sits. */
const PANEL_MENU_LIFT_CM: number = 14;

/**
 * The plate's footprint when nothing has been built yet, in centimetres: the
 * default ZOOM rung at the standard scale. Both numbers live in PlayArea.
 */
const DEFAULT_PLATE_SPAN_CM: number = plateSpanCm(zoomTilesAcross(ZOOM_DEFAULT));
/** How deep the empty plate goes: about what the world's own earth does. */
const PLATE_THICKNESS_CM: number = 1.5 * CM_PER_TILE;

/**
 * What the status line says when a hand finds the handle.
 *
 * The whole control scheme in one line, because the handle cannot be drawn --
 * see PokemonAR.sayRimHint -- and a wearer who has just found the edge is the
 * one moment they are guaranteed to be looking for what it does.
 */
const RIM_HINT: string = "EDGE = MOVE     TWO HANDS = SIZE + TURN";

/**
 * The curve level the terrain is always built at: none.
 *
 * Decision of 9 September, after the second glasses playtest: the world is a
 * flat slab and there is no row that bends it. CURVE 3 rolled the world into
 * a ball on the glasses, because the drop scales with the window's half-extent
 * and the window had just been cut down to a play area, so the same rung that
 * read as a gentle horizon on a whole map read as a marble on a small one.
 * VoxelTerrain still knows how to bend -- curveDrop, CURVE_LEVELS and the
 * window's curveLevel are untouched -- but nothing chooses anything but this.
 */
const FLAT_CURVE: number = 0;

/** What one press of the zoom keys multiplies by, and the range they may reach. */
const ZOOM_STEP: number = 1.25;
const ZOOM_MIN: number = 0.35;
const ZOOM_MAX: number = 12;

/** OAK_SPEECH's own `warp`, reached before the world exists; see PokemonAR.beginOnboarding. */
interface PendingWarp {
  mapId: string;
  x: number;
  y: number;
  facing: string;
}

/**
 * OAK_SPEECH's own six show_text calls (MapScripts.ts), in the fixed order
 * the constant always sends them. HostServices.showLines carries only
 * lines, never the text id, so this order is the only way PokemonAR's own
 * showIntroLines() can tell which text is arriving.
 */
const INTRO_TEXT_IDS: string[] = [
  "_OakSpeechText1", "_OakSpeechText2A", "_OakSpeechText2B",
  "_IntroducePlayerText", "_IntroduceRivalText", "_OakSpeechText3",
];

// A Gen 1 character is 16px, which is exactly two 8px tiles. A shade over true
// scale keeps them findable across a table without dwarfing the doors they
// walk through, which three tiles did.
const CHARACTER_TILES: number = 2.2;
/** The mark's own quad, and the air between it and the head it hangs over. */
const EMOTE_HEIGHT_UNITS: number = 1.0;
const EMOTE_GAP_UNITS: number = 0.2;

/**
 * How wide a battle HUD block stands, in the diorama's own units.
 *
 * A map tile is 2 units and a battling Pokemon is 2.4 tall, so six units is
 * three tiles across -- about two and a half times the Pokemon's height, which
 * is roughly the proportion the reference's own footage shows. Wider and the
 * two blocks meet over the middle of the arena; narrower and eighteen columns
 * of Game Boy text stop being readable at table scale.
 */
const HUD_BLOCK_UNITS: number = 6;
/**
 * How wide a HUD block looks, in centimetres, whatever the world's scale.
 *
 * Held constant in the ROOM rather than in the world. Sized in world units it
 * grew with the fight's own framing until each block was wider than the gap
 * between the two Pokemon, and the pair of them slid over each other into
 * unreadable soup -- the 8 September preview. Eleven centimetres at the 65 cm
 * the fight is framed at puts one Game Boy glyph at about half a degree, which
 * is the smallest text worth putting in front of anyone.
 */
const HUD_BLOCK_CM: number = 11;
/**
 * How wide the patch under a fighter is, in world units.
 *
 * A Pokemon stands in one overworld square, which is two units, so a shadow a
 * little narrower than the square reads as cast by the thing above it rather
 * than as a mat it has been placed on.
 */
const BATTLE_SHADOW_UNITS: number = 0.75;
/** And under a walking character, who is slighter than a Pokemon. */
const CHARACTER_SHADOW_UNITS: number = 0.5;

/**
 * Where the wearer's own character is drawn: after the world, and after its
 * own shadow.
 *
 * Red was the one thing in the lens that could be hidden by the lens. The
 * battle pair have been drawn over the world since 8 September -- "a lab bench
 * cutting a Charmander in half" -- and the NPCs and the terrain were left as
 * they were, which was right until the map got its shapes. A tree canopy is
 * now eight voxels, two whole tiles, and a hedge is the same; the diorama is
 * looked DOWN at from a chair, so the row of trees between the eye and the
 * player is exactly the row that hides them. On top of that a billboard leans
 * back up to 45 degrees hinged at its feet, which puts its head a tile and a
 * half further from you -- into whatever is standing there.
 *
 * So the player draws over the world. The cartridge does the same: Red is
 * drawn over the tiles, never behind them. NPCs deliberately keep their depth
 * test -- someone standing behind a house SHOULD be behind it, and losing an
 * NPC costs the wearer nothing, while losing the character they are steering
 * costs them the game.
 *
 * 98 is the battle pair's own number. The two are never up at once: the player
 * billboard is switched off for the length of a fight.
 */
const PLAYER_RENDER_ORDER: number = 98;
/** The gap between a Pokemon's head and the block over it, in world units. */
const HUD_BLOCK_LIFT_UNITS: number = 0.6;

// Where the player's tile lands during a battle. At life-size the world really is
// underfoot, so this is a standing eyeline above the floor, and the tile sits a
// short step ahead rather than right under the chin.
const FLOOR_DROP_CM: number = 150;
const STANDING_FORWARD_CM: number = 120;

@component
export class PokemonAR extends BaseScriptComponent {
  @input
  @hint("An ImageMaterialPreset instance. Cloned per tileset; never used directly.")
  baseMaterial: Material;

  @input
  @allowUndefined
  @hint("The Game Boy the screen lives in (Assets/Models/gameboy.glb). It rises into view at the first run and carries the setup pages, the title and GAME BOY mode. Without it the screen hangs as a bare quad.")
  gameBoyPrefab: ObjectPrefab;

  @input
  @hint("Map to start on. PALLET_TOWN is where the original begins.")
  startMap: string = "PALLET_TOWN";

  @input
  @hint("Starting cell, in walkable steps from the map's top-left corner.")
  startCellX: number = 5;

  @input
  @hint("Starting cell, in walkable steps from the map's top-left corner.")
  startCellY: number = 6;

  @input
  @hint("Skip the bridge and use whatever is already cached in persistent storage.")
  preferCache: boolean = true;

  // Every asset and module input below is @allowUndefined. Each is read through
  // a null guard already -- loadBakedBundle, tryStartSurfaceTracking, the
  // internetModule branch and CryVoice's default all handle absence -- but the
  // generated wrapper checks every @input for undefined BEFORE any of that runs
  // and throws "Input X was not provided" on the first one missing. The code
  // degraded gracefully and the decorator never let it.
  @input
  @allowUndefined
  @hint("Optional baked world (a JsonAsset). Used before the bridge when present.")
  bakedWorld: Asset;

  // One codebase, two builds.
  //
  // OFF (the default): hands, the phone through the Spectacles App, and the
  // scripted fallback. Nothing here needs Experimental APIs, so the lens can be
  // published.
  //
  // ON: the vendored Bluetooth pad is constructed as well. It needs Experimental
  // APIs plus Extended Permissions, and a lens that uses those cannot be
  // published to the Lens store at all -- which is why this is an input and not
  // a constant. Turn it on for a pad in your hands, leave it off to ship.
  @input
  @hint("Bluetooth game pad (Xbox, SteelSeries). Needs Experimental APIs, which makes the lens UNPUBLISHABLE. Off = hands and phone only, and publishable.")
  enableBleController: boolean = false;

  // The pad's Bluetooth address, when discovery cannot find it.
  //
  // Snap's own Bluetooth doc points at nRF Connect for reading a peripheral's
  // details, and the one open-source client that demonstrably drives an Xbox
  // pad from a BLE central hardcodes the address for the same reason: on that
  // pad, discovery is the unreliable half. connectGatt() takes an address
  // directly, so with one filled in here the lens never scans at all.
  //
  // This is also the only route left if the pad advertises in a form the
  // glasses cannot see. A BLE 5 extended advertisement is invisible to a
  // legacy scanner -- ADV_EXT_IND is not a PDU type the 4.x specification
  // defines -- and the Xbox ESP32 libraries say plainly that BLE5 may be
  // needed to talk to these pads.
  @input
  @hint("Bluetooth address of the pad, e.g. 0A:1B:2C:3D:4E:5F, read with nRF Connect on a phone. Leave empty to scan for it instead.")
  padAddress: string = "";

  @input
  @hint("Start with the floating Game Boy face plate shown. Only until a save exists: after that the OPTION page's PAD row decides, and it defaults to off.")
  showPadPanel: boolean = false;

  @input
  @hint("Walk a fixed loop with no hardware. For preview checks and LEAF scenarios.")
  debugAutoWalk: boolean = false;

  @input
  @allowUndefined
  @hint("Optional. Add a WorldQueryModule asset to let the diorama land on a real surface.")
  worldQueryModule: Asset;

  @input
  @hint("Force one encounter a few seconds in, so the battle transition is testable.")
  debugForceEncounter: boolean = false;

  @input
  @hint("Ignore any saved position and start from the inputs above.")
  debugIgnoreSave: boolean = false;

  @input
  @hint("Skip the title screen and main menu: continue the save if there is one, else start a new game. For probes and LEAF.")
  debugSkipTitle: boolean = false;

  @input
  @hint("Run the first-run setup on every start, as if the lens had never run: the four pages on the Game Boy instead of the loading page, and the seen flag is not written. For testing the onboarding in the preview and on a headset that has been through it.")
  debugFirstRun: boolean = false;

  @input
  @hint("Diorama tilt in degrees. The original steps through 15, 35, 50 and 75.")
  @widget(new SliderWidget(0, 75, 5))
  tiltDegrees: number = 0;

  @input
  @hint("Zoom, as a rung of the OPTION page's ZOOM ladder: 0 is 14 tiles across, 1 is 20, 2 is 28, 3 is 40.")
  @widget(new SliderWidget(0, 3, 1))
  zoomRung: number = 1;

  @input
  @hint("Pin the diorama at a fixed spot instead of placing it in front of the wearer.")
  debugPinPlacement: boolean = false;

  @input
  @hint("Where to pin it, in world centimetres. Only used when pinning is on.")
  debugPinAt: vec3 = new vec3(0, -30, -110);

  @input
  @allowUndefined
  @hint("Audio Output the music, effects and cries stream into. Optional: without it the lens is silent rather than broken.")
  audioOutput: AudioComponent;
  @input
  @allowUndefined
  @hint("Required to reach the pairing bridge. Add an InternetModule asset. Without one the lens falls back to the baked world.")
  internetModule: InternetModule;

  @input
  @hint("The bridge machine's LAN address, used on device. Preview always uses localhost.")
  bridgeHost: string = "127.0.0.1";

  @input
  @hint("Which world the bridge should send. 'kanto' is every map.")
  bundleId: string = "kanto";

  // The published lens's way in. A player opens this site on their own
  // computer, drops their cartridge on it, and the page reads the cartridge in
  // THEIR browser, bakes the world and shows a six-character code. The lens
  // fetches the baked world under that code over https -- which a published
  // Spectacles lens may do -- and keeps it in persistent storage from then on.
  @input
  @hint("The world site, e.g. https://pocket-diorama.vercel.app. The lens fetches a baked world from it by the code the wearer types.")
  worldSite: string = "https://pocket-diorama.vercel.app";

  // Development only. ws:// needs Experimental APIs and cannot be published,
  // so this is off in the build that ships; on, the lens pulls the world from
  // tools/serve-world.sh on the Mac at bridgeHost instead of asking for a code.
  @input
  @hint("DEVELOPMENT ONLY: pull the world from the LAN bridge (tools/serve-world.sh at bridgeHost) over ws:// instead of asking for a code. Unpublishable.")
  useLanBridge: boolean = false;

  @input
  @hint("Ignore the cached and the baked world, so the intro pages and the code keyboard can be seen in the preview.")
  debugForceIngest: boolean = false;

  // The save ladder, for testing on the glasses. SELECT on the title screen
  // opens a list of ten places to drop into the game -- each gym, the caves,
  // the Game Corner, the Safari Zone, Silph Co, the mansion, the Elite Four --
  // with the party, badges and key items that stretch assumes, so two hours of
  // spot checks cover what fifteen hours of playing would. OFF in the build
  // that ships; see play/debug/Ladder.ts.
  @input
  @hint("TEST BUILDS ONLY: SELECT on the title screen lists ten places to drop into the game, with the party and badges that stretch assumes. Off in the published build.")
  debugLadder: boolean = false;

  private bundle: WorldBundle = null;
  private overworld: Overworld = null;
  private input: InputRouter = null;
  private scripted: ScriptedInputSource = null;
  private phone: MotionControllerSource = null;
  /** The Game Boy face plate: hands on the glasses, the mouse in the editor. */
  private pad: PanelSource = null;
  private padView: PadPanelView = null;
  /**
   * The Game Boy's own buttons with no Game Boy round them: what a wearer
   * with nothing but hands presses B, START, SELECT and a menu's rows on.
   * See LooseButtons.ts. Null when the scene carries no Game Boy model, and
   * then the old plate stands in.
   */
  private looseButtons: LooseButtons = null;
  private looseButtonsOn: boolean = false;
  /**
   * The fingertips as a way of pressing: the Game Boy's buttons and the
   * loose ones go down under a finger, not only under a pinch. See
   * FingerPresser in Pressable.ts.
   */
  private fingerPresser: FingerPresser = null;
  /** The shaded caps on the Game Boy's A, B, SELECT and START. See ButtonCaps.ts. */
  private shellCaps: ButtonCaps = null;
  private keyboard: KeyboardKeys = null;
  /** The router's last answer, so a hand-over is printed exactly once. */
  private lastInputName: string = "";

  // The boot: the cartridge's title screen and main menu on a Game Boy screen
  // floating where the world will be. "" once the world is running.
  private bootPhase: string = "";
  /**
   * The first-run wizard, or null once it has handed over.
   *
   * It is NOT a bootPhase: bootPhase's phases all need a bundle and the
   * cartridge's font, and this one exists precisely for the case where there is
   * neither. Its own field, checked before every one of them.
   */
  private wizard: SetupWizard = null;
  /** The Game Boy the screen is mounted in, when a prefab was given. */
  private shell: GameBoyShell = null;
  /**
   * The open bridge socket, so a retry can close the last one.
   *
   * loadWorld() built a fresh BridgeWorldSource on every call and closed it
   * only in onReady, which was harmless while it was called exactly once and
   * would leak one open WebSocket per attempt now that the wizard can retry.
   */
  private bridge: WorldTransfer = null;
  /** The slab under the wizard's pages, until a world takes its place. */
  private plate: EmptyPlate = null;
  /** The save ladder's list, while it is up over the title screen. */
  private ladderMenu: ChoiceController = null;
  /** The credits, while they roll; asked for by the HALL OF FAME's script. */
  private credits: CreditsController = null;
  private creditsWanted: boolean = false;
  /** The code keyboard's D-pad, edge-triggered with the pad's own repeat. */
  private wizardPad: DPadEdge = new DPadEdge();
  private codeKeyboard: FloatingCodeKeyboard = null;
  private spatialPage: SpatialPage = null;
  private spatialNameSymbols = false;
  private spatialOptionFirst = 0;
  private spatialAction = "";
  private spatialDirection = "";
  private looseScreen: GbScreenView = null;
  private housedScreen: GbScreenView = null;
  private gbFont: GbFont = null;
  private canvas: GbCanvas = null;
  private screen: GbScreenView = null;
  private title: TitleController = null;
  private titlePalette: (row: number) => number[][] = null;
  private bootMenu: BootMenuController = null;
  /** Whether a world sits in the lens's storage: what NEW WORLD on the main menu can forget. */
  private worldStored: boolean = false;
  private bootOptions: BootOptions = defaultBootOptions();
  /** The save as read at boot; applied by CONTINUE, ignored by NEW GAME. */
  private savedState: PlayState = null;
  private bootAutoSeconds: number = 0;
  /** What the screen last painted, so a still picture costs no upload. */
  private paintedVersion: number = -1;
  /** The naming screen the intro's name_entry routine is waiting on, or null. */
  private naming: NamingController = null;
  /** True once name_entry's own list/grid has closed and its ack page has loaded. */
  private namingAckShown: boolean = false;
  /** The Pokedex data page a push_screen DexEntryMenu is waiting on, or null. */
  private dexEntryScreen: DexEntryController = null;
  /** A picture in a box with its caption (PictureScreen.ts); owns the screen like the dex page. */
  private pictureScreen: PictureController = null;
  /** A sitting at a GAME CORNER slot machine; it owns the whole screen. */
  private slots: SlotController = null;
  /** A SAFARI ZONE battle's menu is up: its four rows, not the move list. */
  private safariMenu: boolean = false;
  /** "ball", "bait", "rock", "run" or "" -- what that menu came back with. */
  private safariChoice: string = "";
  private lastSteps: number = 0;
  private lastFacing: string = "";

  // The intro on the Game Boy screen (bootPhase "intro") and the onboarding
  // page after it (bootPhase "onboarding"): SPEC.md "The intro on the Game
  // Boy screen -- design" and "The onboarding page -- design". All null
  // except during a NEW GAME's own run through both; see beginIntro().
  private introStage: IntroStage = null;
  private introBox: CanvasTextBox = null;
  /** Which of INTRO_TEXT_IDS is loaded into introBox right now; -1 before the first. */
  private introTextIndex: number = -1;
  /** True once introBox holds the CURRENT text's pages; see showIntroLines(). */
  private introTextOpen: boolean = false;
  /** The pages just handed to introBox, so driveIntro can spot its own last one. */
  private introTextPages: string[][] = [];
  private introShrinkStarted: boolean = false;
  private introWhiteHoldStarted: boolean = false;
  /** True once `intro_stage player` has fired once; the second time is showPlayerAgain(). */
  private introPlayerShown: boolean = false;
  /** OAK_SPEECH's own `warp`, parked here until the onboarding page answers. */
  private pendingWarp: PendingWarp = null;
  private onboarding: OnboardingController = null;
  /** OnboardingController.step() wants an already edge-triggered move, unlike NamingController. */
  private onboardingPad: DPadEdge = null;

  // GAME BOY mode's own live overworld screen (SPEC.md "GAME BOY mode --
  // design"): non-null fields only while play.playMode is PLAY_MODE_GAMEBOY
  // and the bundle can actually show it (canRenderGameBoy()). See
  // updateGameBoyScreen() and hostServices()'s showLines/closeBox.
  private gbTextBox: CanvasTextBox = null;
  /** True while gbTextBox holds a page the player has not acknowledged yet. */
  private gbBoxOpen: boolean = false;
  /** The cartridge's own tile-animation counter, kept at the DMG's own rate. */
  private gbAnimClock: GameBoyAnimClock = new GameBoyAnimClock();
  /** play.playMode as last applied to the scene; a mismatch means something
   * changed it since (the OPTION row, live) and rebuildDiorama() must run
   * again -- see syncPlayMode(). Empty until the first world is built. */
  private lastAppliedPlayMode: string = "";
  /** Whether the floating plate is currently on screen; see applyPadPlate(). */
  private padPlateOn: boolean = true;
  /** The last cull result printed, so a steady state says nothing. */
  private npcCullSaid: string = "";
  /** Seconds until the pad says it is still looking. See updatePadReport. */
  private padHeartbeat: number = 0;
  /** viewSignature() as last applied to the mesh; empty before the first world. */
  private lastAppliedView: string = "";
  /** gradeSignature() the cached terrain materials were built at. */
  private terrainGrade: string = "";
  /** The in-game view page while it is open, null otherwise. */
  private viewPage: ViewOptionsController = null;
  private viewPad: DPadEdge = null;
  /**
   * The graphics rows' own surface, beside the diorama, and the canvas it is
   * painted on.
   *
   * A second surface rather than the Game Boy screen moved sideways: the two
   * halves of the page hang in different places and only one of them is ever
   * lit, so a screen that flew across the room every time the cursor crossed
   * the boundary would be the worst of both. Built on first use, because a
   * bundle with no font never opens this page at all.
   */
  private sidePanel: GbScreenView = null;
  private sideCanvas: GbCanvas = null;
  /**
   * An empty on the diorama's anchor, turned to the placement heading; the
   * side panel is pinned relative to it.
   *
   * Not the diorama root, which is the obvious candidate and the wrong one:
   * the root is dragged under the player every frame as the map scrolls
   * (applyDioramaScroll), and it carries the tilt and the zoom. Pinned to it,
   * the graphics page would walk across the table as the player did. The
   * anchor is the one point of the world that stands still.
   */
  private sideAnchorObject: SceneObject = null;
  /** Whether the side panel currently has the page, so the swap happens once. */
  private sideShown: boolean = false;
  /** True from a battle's first frame in GAME BOY mode; a test seam, see testState. */
  private enteredBattleAtGameBoy: boolean = false;

  private dioramaRoot: SceneObject = null;
  private worldObject: SceneObject = null;
  private playerObject: SceneObject = null;
  private statusText: Text = null;

  /** The SILPH SCOPE's fade over the foe's picture; see play/battle/Unveil.ts. */
  private unveil: Unveil = new Unveil();

  /** The node a lift jolts: the world, the player and the cast, never the plate. */
  private shakeRoot: SceneObject = null;
  private shake: WorldShake = new WorldShake();

  /** The pixel-voxel world under the player, chunk by chunk. */
  private terrain: VoxelTerrain = null;
  private tileStats: any = {};
  private terrainMaterials: any = {};
  /**
   * The palette TEXTURES, kept beside the materials so the water can be
   * repainted without building either again.
   */
  private terrainTextures: any = {};
  /** The animation step the palettes were last painted at. See animatedShade. */
  private terrainPhase: number = -1;
  /** Seconds of wall clock the wind has been blowing. See VoxelTerrain.animate. */
  private windSeconds: number = 0;
  /**
   * The UI Kit plate behind the battle box, or null where the package is not
   * installed. Decoration: see play/screen/PanelFrame.
   */
  private panelFrame: PanelFrame = null;
  private spriteMaterial: Material = null;
  /** The player's sheets by sprite id -- on foot, on the bike, on the water -- built once each. */
  private playerSheets: any = {};
  private playerSheetId: string = "";
  private playerBillboard: Billboard = null;
  private camera: Camera = null;
  private walkPhase: number = 0;
  private autoWalkSeconds: number = 0;
  private autoWalkIndex: number = 0;
  private diagnosticSeconds: number = 0;
  private forceEncounterSeconds: number = 4;
  private saveCooldown: number = 0;
  /** getTime() at the last persist(), so the play clock counts real seconds. */
  private lastPersistAt: number = 0;

  /** The playthrough, and the machinery that runs its scripts. */
  private play: PlayState = null;
  private loop: PlayLoop = null;
  private box: DialogueBox = null;
  /** Set by showLines, cleared once the player presses A on that page. */
  private pageWaiting: boolean = false;
  private pageAcked: boolean = false;
  private answerWanted: boolean = false;
  private answerGiven: number = -1;
  /** Set when a save was found that could not be read; stops the autosave. */
  private saveBlocked: boolean = false;
  private pendingBattleOver: boolean = true;
  private frameCount: number = 0;
  /**
   * The DMG's own frame count, accumulated from dt at 59.7275 Hz.
   *
   * What every script means by a frame. `wait` is the cartridge's DelayFrames
   * and the text pacing is letters * textSpeed of ITS frames, and both used to
   * be counted in LENS frames -- which are the same thing only at 60 fps. On a
   * big map the Lens Studio preview runs at about 3.5, where Bill's cell
   * separator's 192 frames of pauses is the better part of a minute and a page
   * of text prints a letter every third render. The headless harness has
   * stepped a fixed 1/60 s all along, so this is also what makes the two agree
   * (see EMOTE_FRAMES / EMOTE_SECONDS in world/EmoteBubble.ts for the same
   * rule stated the other way round).
   */
  private gbFrames: number = 0;
  /** Frames since the audio heartbeat last printed; see onUpdate. */
  private audioReportFrames: number = 0;
  /** The battle being fought, or null. */
  private runner: BattleRunner = null;
  /**
   * The question asked at the first fight, or null. See BattleStyleScreen.
   *
   * While it stands the RUNNER is frozen and everything else keeps going: the
   * pair are staged, the HUD is up, and moving the cursor restages the fight
   * for real. The option is the picture.
   */
  private battleStyle: BattleStyleController = null;
  private battleStylePad: DPadEdge = null;
  private moveMenu: string[] = [];
  private moveChoice: number = -1;
  private runRequested: boolean = false;
  private switchChoice: number = -1;
  private bagItemChoice: string = "";
  private bagTargetChoice: number = -1;
  /** The move an ETHER or a PP UP was pointed at in the battle bag; -1 otherwise. */
  private bagMoveChoice: number = -1;
  private lastBattleWon: boolean = false;
  /** Whether that battle ended with the foe in a ball, not on the floor. */
  private lastBattleCaught: boolean = false;
  /**
   * Whether this fight's victory fanfare has already been started.
   *
   * The fanfare is played when the fight is WON, which is when the last
   * opponent faints -- not when the last message box closes. See updateRunner.
   */
  private victorySounded: boolean = false;
  /** Set while a scripted walk this frame's command started is still going. */
  private walkPending: boolean = false;
  private menu: MenuController = null;
  private menuPanel: GlyphPanel = null;
  /** The Poke Mart while a clerk's script has handed the screen to it. */
  private shop: ShopController = null;
  /** A script's choice list -- a lift's floors, a prize counter. */
  private choice: ChoiceController = null;
  /** The row that list came back with, read by the script that opened it. */
  private choicePick: number = -1;
  private pc: PcController = null;
  private teach: TeachController = null;
  /** What is playing and why. Null until the bundle is in. */
  private jukebox: Jukebox = null;
  /** The speakers. Present even with no Audio Output wired; it just says so. */
  private readonly audio: AudioDriver = new AudioDriver();
  /** The map the jukebox was last told about, so a change is noticed once. */
  private musicMapId: string = "";
  /** The travelling song now sounding, so it is only set when it changes. */
  private musicRide: string = "";
  /** Which battle theme the fight now running was given; decides its fanfare. */
  private battleRoleNow: string = "";
  /** Whether last frame's step was blocked, so a held direction bumps once. */
  private bumpedLastFrame: boolean = false;
  /** The level-up's replace prompt while a battle is asking it, or null. */
  private battleLearn: MoveLearnController = null;
  /** Set when that prompt closes; cleared once the runner has read its answer. */
  private battleLearnDone: boolean = false;
  /** What the prompt last painted, so a page is not retyped every frame. */
  private battleLearnPainted: string = "";
  /** Party members waiting to evolve after the battle just fought. */
  private evolutions: EvolutionDue[] = [];
  /** The evolution being shown, or null. */
  private evolving: EvolutionController = null;
  /** Which party slot it belongs to. */
  private evolvingIndex: number = -1;
  /** Moves the new species learns at this level, still to be offered. */
  private evolveMoves: string[] = [];
  /** The replace prompt for one of those, or null. */
  private evolveLearn: MoveLearnController = null;
  /** The move that prompt is about. */
  private evolveLearnMove: string = "";
  /**
   * What a bag item used on the overworld still owes on screen once its own
   * lines have been read: a move the new level teaches, or an evolution. Held
   * until the VM is idle, because the learn prompt and the evolution scene
   * must come AFTER "grew to level 13!" has been dismissed, not over it.
   */
  private pendingItemUse: ItemUseOutcome = null;
  /** What the evolution sequence last painted. */
  private evolvePainted: string = "";
  private placer: DioramaPlacer = null;
  /** The last placement state announced, so it is said once and not per frame. */
  private placeStateSaid: string = "";
  /**
   * Where in the ROOM the player's own character stands, in world units.
   *
   * The diorama used to be anchored by its MESH ORIGIN -- the middle of the
   * map -- so walking moved the character across a plate that stayed put, and
   * the plate had to be big enough to hold the whole map or the character
   * walked off it. That is why a route was a metre-and-a-quarter slab.
   *
   * Anchoring by the PLAYER instead turns it round: the character stands at
   * this point and the map scrolls underneath, which is the cartridge's own
   * camera and the reference's, and it means the plate only ever has to be as
   * big as the window. Nothing else changes -- the whole subtree is simply
   * translated, so mesh coordinates, the battle's pivot and every NPC's cell
   * keep meaning exactly what they meant.
   */
  private dioramaAnchor: vec3 = null;
  /** The Bluetooth pad, when one was asked for. Null otherwise. */
  private gamepad: GameControllerSource = null;
  /** A pinch, as the A button. Added to whatever else is driving. */
  private pinch: PinchSource = null;
  /** The pinch-to-walk: a d-pad that walks a route. See RouteSource. */
  private route: RouteSource = null;
  /** The person a route walks up to (the map object), so the walk can follow. */
  private routeBody: any = null;
  /** The hand as a joystick: a pinch held inside the plate. See StickSource. */
  private stick: StickSource = null;
  private spatialInput: SpatialInput = new SpatialInput();
  private pinchJoystick: PinchJoystick = new PinchJoystick();

  /** The frame around the cell being walked to, or the one the stick asks for. */
  private cellMarker: CellMarker = null;
  /** The last pad state announced, for the same reason as placeStateSaid. */
  private padStateSaid: string = "";
  /**
   * The panel that says what the pad is doing, where the wearer can read it.
   *
   * Built only when enableBleController is on: a wearer with no pad has
   * nothing to be told, and an empty notice is the worst kind.
   */
  private padStatus: PadStatusPanel = null;
  /** Seconds the panel stays up after the pad finally reports. */
  private padLinger: number = 0;
  private battle: BattleStage = null;
  /** The two Pokemon standing on the ground while a battle runs. */
  private battleActors: BattleActors = null;
  /**
   * The battle HUD's own tiles, out of the bundle.
   *
   * Built once with the world rather than per frame: it unpacks four sheets,
   * and the HUD is repainted every frame.
   */
  private hudTiles: BattleHudTiles = null;
  /** The dark patch under each fighter, so they stand on the world. */
  private battleShadows: GroundShadow[] = [];
  /** And under the wearer's own character. */
  private playerShadow: GroundShadow = null;
  /** Two platforms for a fight with nowhere to happen. Built on first use. */
  private discs: BattleDiscs = null;
  /** A plain white pixel, so a disc's material has something to tint. */
  private discTexture: Texture = null;
  /** What the pair DOES: lunges, blinks, and the bar travelling. */
  private battleAnim: BattleAnimator = new BattleAnimator();
  /** The two HUD blocks standing beside the pair. Built on the first battle. */
  private hudMine: HudBlockView = null;
  private hudTheirs: HudBlockView = null;
  /** Where this fight is being staged, or null between fights. */
  private arena: Arena = null;
  private battleHoldSeconds: number = 0;
  /**
   * DIORAMA mode's message box: the cartridge's own frame on a panel in the
   * room, built when the pad plate is not (SPEC.md "HUD panels in space").
   * Null when the pad carries the HUD instead.
   */
  private messagePanel: MessagePanelView = null;
  private panelCanvas: GbCanvas = null;
  private panelTextBox: CanvasTextBox = null;
  /** True while panelTextBox holds a page the player has not acknowledged. */
  private panelBoxOpen: boolean = false;
  /** The pad the glasses draw on the wearer's phone, while one is connected. */
  private phonePad: PhonePadView = null;

  /** The cartridge's YES/NO box while a script waits for an answer. */
  private choiceBox: CanvasChoiceBox = null;
  /** Its cursor's own repeat, so holding a direction does not flap the choice. */
  private choiceEdge: DPadEdge = new DPadEdge();
  /** Where the menu hangs when there is no pad to hang it on. */
  private menuHolder: SceneObject = null;

  private dioramaScale: number = 1;
  /**
   * The wearer's own zoom, multiplied onto every map's plate scale.
   *
   * A pinch-and-hold dive writes whatever scale it stops at back here
   * (onDiveScale), and the preview keys step it, so the zoom survives walking
   * through a door -- rebuildTerrain() used to reset the dive to the new map's
   * base and the world snapped back to tabletop on every warp.
   */
  private viewZoom: number = 1;
  /**
   * The wearer's own rotation of the world, in radians about the up axis.
   *
   * COMPOSED with the placement heading rather than replacing it -- see
   * dioramaYaw() -- because both are real: the placer says which way north
   * pointed when the world was put down, and this says how far the wearer has
   * since turned it. Cleared by OPTION -> PLACE, which puts the world down
   * afresh and re-takes the heading with it.
   */
  private userYaw: number = 0;

  /**
   * How far the wearer's view is turned from the map's north.
   *
   * Owned here because it needs the camera and the diorama's heading, and
   * spent in three places: the walk (Overworld.viewTurns), the player's sprite
   * frame and the NPCs'. See play/ViewRelativeInput.
   */
  private compass: ViewCompass = new ViewCompass();
  /** Whether the status line is currently offering the grab hint. */
  private rimHintShown: boolean = false;
  private npcRoot: SceneObject = null;
  private npcBillboards: Billboard[] = [];
  /**
   * The mark over a trainer's head while he is spotting you, or nothing.
   *
   * One at a time by construction: the script that raises it is the only thing
   * running, and it waits under it. Parented to the NPC's own holder so it
   * travels with a body that moves, which also means rebuildNpcs has to drop
   * it before it destroys the cast.
   */
  private emoteHolder: SceneObject = null;
  private emoteBillboard: Billboard = null;
  private emoteMaterial: Material = null;
  private emoteSheet: any = null;
  /** getTime() at which the mark comes down. */
  private emoteUntil: number = 0;
  /** True from the frame an `emote` op put its mark up until it took it down. */
  private emoteRunning: boolean = false;
  /** Holder and billboard per NPC name, for the walks scripts ask for. */
  private npcByName: any = {};
  /** Where every NPC a script has moved or turned stands. Pure; see NpcMotion. */
  private npcMotion: NpcMotion = new NpcMotion();
  /** The WALK-movement NPCs' random steps, the cartridge's way. Pure; see NpcWander. */
  private wander: NpcWander = new NpcWander(() => Math.random());
  /** The object the player last talked to, so facePlayer knows whom to turn. */
  private talkTarget: any = null;
  private npcMaterials: any = {};
  private hands: DioramaHands = null;
  // The MeshBuilder must outlive the call that made it or its mesh goes invalid.
  private lastEncounter: WildEncounter = null;
  private encounterBannerSeconds: number = 0;

  onAwake(): void {
    // The one line Snap's checklist asks for: which build a bug report is about.
    print("Lens Opened: v" + LENS_VERSION + " (" + LENS_NAME + ")");
    this.scripted = new ScriptedInputSource();
    const sources: InputSource[] = [];

    // Real hardware first, so a pad paired mid-session takes over from the fallback.
    if (this.enableBleController) {
      const pad = GameControllerSource.tryCreate(() => {
        // Vendored under Assets rather than installed as a package, so the path
        // survives the 5.15 downgrade's fresh meta generation. It still has to be
        // allowed to fail: the Bluetooth module does not exist in preview, and on
        // device it needs Experimental APIs plus Extended Permissions.
        const module: any = require("./vendor/GameController/GameController");
        return module && module.GameController ? module.GameController.getInstance() : null;
      });
      if (pad) {
        sources.push(pad);
        this.gamepad = pad;
        // The scan itself waits for onStart -- see startPadScan(). Building the
        // singleton does not scan, and the package only re-scans on disconnect,
        // which cannot happen before a first connection, so SOMETHING has to
        // ask; it just must not be this early.
        const editor = pad.inEditorNow();
        print("[PokemonAR] pad: controller stack ready, scanning at start" +
              " (running in " + (editor ? "PREVIEW -- no radio here" : "the glasses") + ")");
      } else {
        print("[PokemonAR] pad: no Bluetooth controller stack " +
              "(preview, or Experimental APIs and Extended Permissions are off)");
      }
    }

    // The publishable controller: the wearer's own phone, through the Spectacles
    // App. No package, no pairing, no Experimental APIs -- and it does not exist
    // in preview either, so it has to be allowed to fail exactly like the pad.
    this.phone = MotionControllerSource.tryCreate(() => {
      return require("LensStudio:MotionControllerModule");
    });
    if (this.phone) {
      sources.push(this.phone);
    }

    // The panel needs no hardware at all, so it is what a wearer without a
    // phone or a pad plays on -- and what the editor's mouse and keyboard reach.
    // It sits behind real hardware and ahead of the scripted fallback.
    this.pad = new PanelSource();
    sources.push(this.pad);
    this.keyboard = new KeyboardKeys();
    const keys = this.keyboard.bind(
      (name: string) => this.createEvent(name as any), this.pad,
      (key: string) => this.zoomBy(key === VIEW_KEY_ZOOM_IN ? ZOOM_STEP : 1 / ZOOM_STEP));
    print("[PokemonAR] keyboard: " + (keys
      ? "on (arrows or IJKL walk, Z=A, X=B, space=START, O/P zoom out/in)"
      : "unavailable"));

    sources.push(this.scripted);
    this.input = new InputRouter(sources);
    // A pinch is the A button, and it is LAYERED rather than ranked: it has to
    // work while the phone is driving the walk, while a pad is, and on its
    // own. See PinchSource.
    this.pinch = new PinchSource();
    this.input.setOverlay(this.pinch);
    // A pinch ON the world walks Red there: the route owns the d-pad until it
    // arrives or a real thumb takes over. See RouteSource and pinchAt().
    this.route = new RouteSource();
    this.input.setRoute(this.route);
    // A held pinch is a joystick anchored on the player; it outranks the route.
    this.stick = new StickSource();
    this.input.setStick(this.stick);

    // Print what the router BELIEVES it holds, not merely that it was built. A
    // source that exists but never reports is exactly how the pad won the router
    // and swallowed every input, and "silent" here is the shape of that bug.
    let inventory = "";
    for (let i = 0; i < sources.length; i++) {
      inventory += (i > 0 ? " " : "") + sources[i].name + "=" +
                   (sources[i].isConnected() ? "reporting" : "silent");
    }
    print("[PokemonAR] input sources: " + inventory +
          " (ble pad " + (this.enableBleController ? "on" : "off") + ")" +
          "; pinch = A");

    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind((event: UpdateEvent) => this.onUpdate(event));
  }

  /**
   * Asks the pad to look, at START rather than at AWAKE.
   *
   * Snap's own BLE Game Controller sample calls scanForControllers() from
   * onStart (SceneController.ts:47), and the difference is not cosmetic. At
   * onAwake this lens read an adapter status of 5 on the glasses -- a value
   * that appears in no BluetoothStatus enum in either 5.15 or 5.23, whose four
   * members are 0 to 3. A number outside its own enum is what a module that
   * has not finished coming up looks like, and asking it anything then is
   * asking too early.
   *
   * The source is still BUILT in onAwake, because the input router has to have
   * it before the first frame; only the scan moves.
   */
  private startPadScan(): void {
    if (!this.gamepad) {
      return;
    }
    // An address given by hand skips discovery entirely, which is the point:
    // it is what to do when discovery is what is broken.
    const address = this.padAddress ? this.padAddress.trim() : "";
    if (address.length > 0) {
      print("[PokemonAR] pad: connecting straight to " + address +
            " -- no scan (padAddress is set)");
      this.gamepad.connectDirectly(address);
      return;
    }
    const asked = this.gamepad.beginScan();
    print("[PokemonAR] pad: " + (asked
      ? "scanning for a Bluetooth controller"
      : "cannot scan -- " +
        (this.gamepad.problem() ? this.gamepad.problem() : "no Bluetooth here")));
  }

  private onStart(): void {
    this.startPadScan();
    try {
      this.camera = WorldCameraFinderProvider.getInstance().getComponent();
    } catch (e) {
      print("[PokemonAR] no SIK camera provider: " + e);
    }
    this.buildScaffold();

    this.battle = new BattleStage(this.dioramaRoot);
    this.battle.setCharacterUnits(CHARACTER_TILES);

    this.hands = new DioramaHands();
    const handsReady = this.hands.bind(() => {
      // A named export, not a default one -- reaching for .default is what made
      // this report "unavailable" while the package was sitting right there.
      const module: any = require("SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData");
      const klass = module ? module.HandInputData : null;
      return klass && klass.getInstance ? klass.getInstance() : null;
    });
    print("[PokemonAR] hand control: " + (handsReady ? "on" : "unavailable"));
    this.placer = new DioramaPlacer(this.dioramaRoot, this.camera);
    // Pinning exists so a sweep across curvature levels or tilt angles is
    // comparable: placing in front of the wearer means the diorama follows the
    // preview camera, and every frame of the sweep would be framed differently.
    let tracking = false;
    if (this.debugPinPlacement) {
      this.dioramaRoot.getTransform().setWorldPosition(this.debugPinAt);
      this.placer.markPlaced();
    } else {
      tracking = this.placer.tryStartSurfaceTracking(this.worldQueryModule);
      this.placer.placeInFront();
    }
    // The heading the placer just took has to reach the model. applyView does
    // this on every map load too; doing it here as well means the very first
    // frame is already turned the right way rather than being turned a frame
    // later, which reads as the town swinging round as it appears.
    this.applyDioramaRotation();
    // Wherever placement put the root is where the PLAYER will stand: the
    // world hangs off the character, not the other way round.
    const firstPlacement = this.placer.takePlacement();
    if (firstPlacement) {
      this.dioramaAnchor = new vec3(firstPlacement.x, firstPlacement.y, firstPlacement.z);
    } else {
      this.takeDioramaAnchor();
    }
    const at = this.dioramaRoot.getTransform().getWorldPosition();
    // The camera's own pose goes in the same line. Where the diorama landed is
    // meaningless without it: the fallback places relative to the head, and a
    // head pitched at the floor is the difference between a table and a chin.
    let pose = "no camera";
    if (this.camera) {
      const ct = this.camera.getTransform();
      const eye = ct.getWorldPosition();
      const fwd = ct.forward;
      pose = "eye " + eye.x.toFixed(1) + "," + eye.y.toFixed(1) + "," + eye.z.toFixed(1) +
             " fwd " + fwd.x.toFixed(2) + "," + fwd.y.toFixed(2) + "," + fwd.z.toFixed(2);
    }
    print("[PokemonAR] surface tracking: " + (tracking ? "on" : "off (fallback placement)") +
          "; diorama at " + at.x.toFixed(1) + "," + at.y.toFixed(1) + "," + at.z.toFixed(1) +
          " facing " + (this.placer.facing() * 180 / Math.PI).toFixed(0) + " deg" +
          "; " + pose);

    // The screen exists BEFORE the world does. This is the whole answer to
    // "nu is het gewoon zwart zonder iets als de rom niet goed geladen is":
    // until tonight nothing in this lens created a drawing surface until
    // beginBoot() had a bundle in hand, so a world that never arrived cost not
    // just the title screen but every pixel. GbScreenView needs the scene
    // object and baseMaterial and nothing else -- no bundle, no font.
    // The speakers before the world: the setup pages' buttons click.
    this.startEarlyAudio();
    if (!this.debugSkipTitle && !this.debugAutoWalk && this.ensureScreen()) {
      this.wizard = new SetupWizard(
        this.debugFirstRun || !loadWizardSeen(),
        BridgeWorldSource.defaultUrl(this.bridgeHost),
        this.bundleId,
        this.bakedWorld !== null && this.bakedWorld !== undefined,
        this.internetModule !== null && this.internetModule !== undefined,
        this.worldSite,
        CODE_ON_SYSTEM_KEYBOARD && this.systemKeyboardAvailable());
      this.paintedVersion = -1;
      this.setScreenEnabled(true);
      // The pages hang above an empty plate on the table -- the size the
      // world will be, and already the hands' to move -- so that a wearer
      // with no world yet, a reviewer included, is looking at the thing the
      // lens is about rather than at a page in an empty room.
      this.plate = new EmptyPlate(this.dioramaRoot, DEFAULT_PLATE_SPAN_CM, PLATE_THICKNESS_CM,
                                  (t: Texture) => this.flatMaterial(t));
      print("[PokemonAR] setup wizard: on, above an empty plate of " +
            DEFAULT_PLATE_SPAN_CM.toFixed(0) + " cm");
    }

    this.setStatus("Loading world...");
    this.loadWorld();
  }

  /** Creates every scene object this lens uses. Nothing is authored in the editor. */
  private buildScaffold(): void {
    const root = this.getSceneObject();

    this.dioramaRoot = global.scene.createSceneObject("Diorama");
    this.dioramaRoot.setParent(root);

    // Everything that STANDS IN the world hangs off this one node, and the
    // node is what a lift jolts (play/WorldShake.ts). The plate's own place on
    // the table belongs to the placer and to the wearer's hands, so the shake
    // may not touch the root -- and the message box and the menus hang off the
    // root for the same reason, because a panel of text that jumps is a
    // different thing from a world that does.
    this.shakeRoot = global.scene.createSceneObject("Shake");
    this.shakeRoot.setParent(this.dioramaRoot);

    this.worldObject = global.scene.createSceneObject("World");
    this.worldObject.setParent(this.shakeRoot);
    this.terrain = new VoxelTerrain(this.worldObject);

    this.playerObject = global.scene.createSceneObject("Player");
    this.playerObject.setParent(this.shakeRoot);

    // Everything that stands on the ground is parented to the diorama, so it
    // grows with the world and ends up life-size beside the player rather than
    // needing any scaling of its own -- the battling pair included.
    this.npcRoot = global.scene.createSceneObject("NPCs");
    this.npcRoot.setParent(this.shakeRoot);

    const textObject = global.scene.createSceneObject("Status");
    textObject.setParent(root);
    textObject.getTransform().setLocalPosition(new vec3(0, 30, 0));
    this.statusText = textObject.createComponent("Component.Text") as Text;
    this.statusText.text = "";
    this.statusText.size = 32;

    // The pad's own surface. The status line above is shared with the map
    // name, the active source and the surface search, all of which overwrite
    // it, and it does not follow the head -- so it is not somewhere a wearer
    // holding a pairing button will ever read.
    if (this.enableBleController) {
      this.padStatus = new PadStatusPanel(root);
    }
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.text = message;
    }
    print("[PokemonAR] " + message);
  }

  private loadWorld(): void {
    // Re-entrant, because the wizard can ask for another go. Without this every
    // retry would leave its WebSocket open behind it.
    if (this.bridge) {
      this.bridge.close();
      this.bridge = null;
    }

    // The cache is the normal path: after the first bake the laptop is not needed.
    if (this.preferCache && !this.debugForceIngest) {
      const cached = loadCachedBundle();
      if (cached) {
        this.setStatus("Loading cached world...");
        if (this.wizard) {
          this.wizard.sourceFound("CACHE");
        }
        this.acceptBundle(cached, false);
        return;
      }
    }

    // A baked world beats the bridge: no network permission, no laptop, and it is
    // the same bundle shape the ROM path produces, so nothing downstream changes.
    const baked = this.debugForceIngest ? null : loadBakedBundle(this.bakedWorld);
    if (baked) {
      this.setStatus("Loading baked world...");
      if (this.wizard) {
        this.wizard.sourceFound("BAKED");
      }
      // Seed the cache from the baked asset. That is useful on its own -- the
      // asset does not exist on 5.15, so the cache is the only path there -- and
      // it means the cache round-trip gets exercised on every 5.23 run instead of
      // being first tried on a headset with no way to see what went wrong.
      this.acceptBundle(baked, true);
      return;
    }

    if (!this.internetModule) {
      this.setStatus("No InternetModule and no baked world; nothing to load");
      if (this.wizard) {
        this.wizard.failed(FAIL_NO_SOURCE, "no InternetModule and no baked world asset");
      }
      return;
    }

    // Nothing on the glasses. The published lens asks the wearer for the code
    // the world site showed them; only a development build with the LAN
    // bridge switched on pulls the world from the Mac instead. A build with
    // no wizard to ask on (the smoke tests) falls back to the bridge too.
    if (!this.useLanBridge && this.wizard) {
      this.setStatus("No world here yet; asking for a code");
      this.wizard.needCode();
      return;
    }
    const url = BridgeWorldSource.defaultUrl(this.bridgeHost);
    this.setStatus("Pairing with bridge at " + url);
    if (this.wizard) {
      this.wizard.beginBridge(url);
    }
    const source = new BridgeWorldSource(this.internetModule, url, this.bundleId);
    this.bridge = source;
    source.connect({
      onProgress: (fraction: number, message: string) => {
        this.setStatus(message + " " + Math.round(fraction * 100) + "%");
        if (this.wizard) {
          this.wizard.progress(fraction, message);
        }
      },
      onReady: (text: string) => {
        this.acceptBundle(text, true);
        source.close();
        if (this.bridge === source) {
          this.bridge = null;
        }
      },
      onError: (message: string) => {
        this.setStatus("Bridge: " + message);
        if (this.wizard) {
          this.wizard.failed(FAIL_BRIDGE, message);
        }
      },
    });
  }

  /**
   * The world under a code, over https from the world site.
   *
   * What the wizard asks for when the keyboard's OK is pressed. A code the
   * site does not know goes back to the keyboard; a site that does not answer
   * is retried by the wizard on its own clock; anything else is the same
   * acceptBundle every other source lands in, with the cache written so the
   * site is never asked again.
   */
  private fetchWorld(code: string): void {
    if (this.bridge) {
      this.bridge.close();
      this.bridge = null;
    }
    if (!this.internetModule) {
      this.setStatus("No InternetModule; cannot fetch a world");
      if (this.wizard) {
        this.wizard.failed(FAIL_NO_SOURCE, "no InternetModule on the PokemonAR object");
      }
      return;
    }
    const url = HttpsWorldSource.bundleUrl(this.worldSite, code);
    this.setStatus("Fetching world " + code + " from " + HttpsWorldSource.hostOf(url));
    const source = new HttpsWorldSource(this.internetModule, url);
    this.bridge = source;
    source.connect({
      onProgress: (fraction: number, message: string) => {
        this.setStatus(message + " " + Math.round(fraction * 100) + "%");
        if (this.wizard) {
          this.wizard.progress(fraction, message);
        }
      },
      onReady: (text: string) => {
        if (this.bridge === source) {
          this.bridge = null;
        }
        this.acceptBundle(text, true);
      },
      onNotFound: (message: string) => {
        this.setStatus("World site: " + message);
        if (this.bridge === source) {
          this.bridge = null;
        }
        if (this.wizard) {
          this.wizard.failed(FAIL_CODE, message);
        }
      },
      onError: (message: string) => {
        this.setStatus("World site: " + message);
        if (this.bridge === source) {
          this.bridge = null;
        }
        if (this.wizard) {
          this.wizard.failed(FAIL_NET, message);
        }
      },
    });
  }

  /**
   * Entry point for a loaded bundle, wherever it came from.
   *
   * The whole body is guarded, not just the parse. Reached from the baked
   * asset this runs on the main thread and anything it throws is printed by the
   * runtime; reached from the BRIDGE it runs inside an async socket callback,
   * where a throw becomes an unhandled rejection and Lens Studio prints
   * NOTHING. On 5.15 -- where the bridge is the only way in -- that showed up as
   * a log that stopped dead after "cached bundle: ok" and a lens that drew
   * nothing, with no error anywhere to say why.
   */
  acceptBundle(text: string, cache: boolean): void {
    try {
      this.acceptBundleOrThrow(text, cache);
    } catch (e) {
      print("[PokemonAR] world could not be started: " + e);
      this.setStatus("World failed: " + e);
      if (this.wizard) {
        this.wizard.failed(FAIL_WORLD, "" + e);
      }
    }
  }

  private acceptBundleOrThrow(text: string, cache: boolean): void {
    try {
      this.bundle = parseBundle(text);
    } catch (e) {
      this.setStatus("Bundle rejected: " + e);
      if (this.wizard) {
        this.wizard.failed(FAIL_BUNDLE, "" + e);
      }
      return;
    }
    // A world that came OUT of the cache is stored by definition.
    this.worldStored = !cache;
    if (cache) {
      // Cache before rendering: a bake that renders but is not persisted would
      // silently make the lens laptop-dependent again on the next launch.
      const stored = storeBundle(text, this.bundle.romSha1);
      print("[PokemonAR] cached bundle: " + (stored ? "ok" : "FAILED"));
      this.worldStored = stored;
    }
    // Read the save now and apply it later: the title's CONTINUE row exists
    // only when there is one, and NEW GAME has to be able to ignore it.
    this.savedState = null;
    if (!this.debugIgnoreSave) {
      const save = loadSave();
      // migratePlayState handles both shapes: the position-only save that is in
      // the field, and a full playthrough. It returns null for anything it
      // cannot understand, and null is NOT "no save" -- see below.
      const migrated = save ? migratePlayState(save as any, this.bundle.romSha1) : null;
      if (migrated && this.bundle.maps[migrated.mapId]) {
        this.savedState = migrated;
      } else if (save) {
        // Something was there and could not be used. Do NOT start a fresh game
        // over the top of it: the autosave would overwrite whatever was
        // recoverable within a few frames, before the player could be told.
        print("[PokemonAR] a save exists but does not fit this world; not overwriting it");
        this.saveBlocked = true;
      }
    }
    this.startAudio();

    // The wizard owns the hand-over from here: it has a world to report, and
    // the title screen is what it hands over TO. startAudio stays above so the
    // title's music is ready the moment it does.
    if (this.wizard) {
      this.wizard.worldReady(text.length, this.bundle.romSha1);
      return;
    }

    if (this.debugSkipTitle || !this.beginBoot()) {
      this.startWorld(this.savedState);
    }
  }

  /**
   * The 160x144 surface everything readable in this lens draws on.
   *
   * Lifted out of beginBoot, where it used to sit BELOW the bundle guard. That
   * placement is what made a missing world a black screen: the canvas and the
   * screen were built only once a bundle had already been parsed and found to
   * carry a font and title art, so the failure cases had nothing to be drawn
   * on. Neither object needs the bundle -- GbScreenView wants this scene object
   * and baseMaterial, and baseMaterial is a plain @input set in both scenes --
   * so a screen can exist from onStart with no world at all.
   */
  private ensureScreen(): boolean {
    if (!this.baseMaterial) {
      return false;
    }
    if (!this.canvas) {
      this.canvas = new GbCanvas();
    }
    if (!this.screen) {
      this.screen = new GbScreenView(this.getSceneObject(),
                                    (t: Texture) => this.readingMaterial(t));
      if (this.gameBoyPrefab) {
        // The screen rides in a Game Boy: the anchor places the shell and the
        // quad sits in its LCD window (GameBoyShell.ts).
        this.shell = new GameBoyShell(this.getSceneObject(), this.gameBoyPrefab, this.ledMaterial());
        this.screen.mountIn(this.shell.root, this.shell.screenMount, LCD_WIDTH_CM, SHELL_AHEAD_CM);
        // The print on the face -- A, B, SELECT, START -- in the setup font.
        new GameBoyLabels(this.shell.body(), (t: Texture) => this.decalMaterial(t));
        // ...and the buttons' shading, drawn in: the model's own are flat discs.
        this.shellCaps = new ButtonCaps(this.shell.body(), (t: Texture) => this.decalMaterial(t));
        print("[PokemonAR] screen mounted in the Game Boy shell");
        // Its buttons press the pad: the mouse in the preview, a hand on the
        // glasses. This is how the setup pages are turned without a keyboard.
        if (this.pad) {
          // In the editor the mouse gets its own path (Pressable.ts): SIK's
          // mouse needs a click to park on a button and a second to press,
          // and a tester clicking once saw nothing happen.
          let presser: TouchPresser = null;
          if (TouchPresser.wanted() && this.camera) {
            presser = new TouchPresser(this, this.camera, this.pad,
              (box: PressableBox) => box.tag !== "lcd" || !this.wizard || !this.wizard.onGridPage());
          }
          const wired = this.shell.buildButtons(this.pad, presser, true, this.fingers());
          if (presser) {
            presser.bind();
          }
          print("[PokemonAR] Game Boy buttons: " + wired + " of 8 wired to SIK" +
                (presser ? ", and the editor's click" : ""));
        }
      }
    }
    return true;
  }

  /** Print on a surface: flat, alpha where there is no ink, tested against depth but not written. */
  private decalMaterial(texture: Texture): Material {
    const material = this.flatMaterial(texture);
    material.mainPass.blendMode = BlendMode.Normal;
    material.mainPass.depthWrite = false;
    return material;
  }

  /** A plain lit-looking dot for the shell's battery LED: one white texel, tinted. */
  private ledMaterial(): Material {
    const texture = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm);
    (texture.control as ProceduralTextureProvider).setPixels(0, 0, 1, 1, new Uint8Array([255, 255, 255, 255]));
    const material = this.flatMaterial(texture);
    material.mainPass.baseColor = new vec4(0.15, 0.02, 0.02, 1);
    return material;
  }

  /**
   * Places the screen on the wearer's line of sight, steps the shell's
   * entrance when there is one, and keeps the LCD dark until the Game Boy
   * has arrived. Every phase that shows the screen calls this once a frame.
   */
  private placeScreen(dt: number): void {
    if (!this.screen) {
      return;
    }
    this.screen.place(this.camera, dt);
    if (this.shell && this.screen.mounted()) {
      this.shell.step(dt);
      const pressed = this.shell.pressButtons(this.pad, dt);
      if (this.shellCaps && this.pad) {
        this.shellCaps.update(this.pad);
      }
      // On the setup pages the Game Boy clicks for itself; in the game the
      // cartridge's own sounds answer the press.
      if (pressed > 0 && this.wizard && this.jukebox) {
        this.jukebox.playClick();
      }
      this.screen.setQuadVisible(!this.shell.entering());
    }
  }

  /** Whether a code can be typed on the system keyboard: on the glasses, not in the editor. */
  private systemKeyboardAvailable(): boolean {
    const tis: any = (global as any).textInputSystem;
    const info: any = (global as any).deviceInfoSystem;
    const inEditor = !!(info && typeof info.isEditor === "function" && info.isEditor());
    return !!(tis && typeof tis.requestKeyboard === "function") && !inEditor;
  }

  /** Puts the Spectacles keyboard up for the code page; its text goes to the wizard. */
  private openCodeKeyboard(): void {
    const tis: any = (global as any).textInputSystem;
    if (!tis || !this.wizard) {
      return;
    }
    const options = new TextInputSystem.KeyboardOptions();
    options.enablePreview = false;
    options.keyboardType = TextInputSystem.KeyboardType.Text;
    options.returnKeyType = TextInputSystem.ReturnKeyType.Done;
    options.initialText = this.wizard.typedCode();
    options.onTextChanged = (text: string, range: vec2) => {
      if (this.wizard) {
        this.wizard.keyboardText(text);
      }
    };
    options.onReturnKeyPressed = () => {
      if (this.wizard) {
        this.wizard.keyboardReturn();
      }
    };
    options.onKeyboardStateChanged = (open: boolean) => {
      if (this.wizard) {
        this.wizard.keyboardState(open);
      }
    };
    try {
      tis.requestKeyboard(options);
      print("[PokemonAR] keyboard requested for the code");
    } catch (e) {
      print("[PokemonAR] keyboard request failed: " + e);
    }
  }

  private closeCodeKeyboard(): void {
    const tis: any = (global as any).textInputSystem;
    if (tis && typeof tis.dismissKeyboard === "function") {
      try {
        tis.dismissKeyboard();
      } catch (e) {
        // A keyboard that is not up cannot be dismissed; nothing to do.
      }
    }
  }

  /**
   * The title screen, if the bundle can draw one. False on a bundle baked
   * before the title art was carried, and the game then starts as it used to.
   */
  private beginBoot(): boolean {
    const titleArt: any = (this.bundle as any).title;
    if (!GbFont.available(this.bundle) || !titleArt || !titleArt.logo || !this.ensureScreen()) {
      return false;
    }
    this.gbFont = new GbFont(this.bundle);
    const art: TitleArt = {
      logo: imageFromPacked(titleArt.logo),
      version: imageFromPacked(titleArt.version),
      player: imageFromPacked(titleArt.player),
      copyright: imageFromPacked(titleArt.copyright),
      gamefreakInc: imageFromPacked(titleArt.gamefreakInc),
      screen: titleArt.screen ? imageFromPacked(titleArt.screen) : null,
    };
    this.title = new TitleController(art, (species: string) => this.frontImage(species),
                                     () => Math.random(), titleMonsFor(this.bundle.romSha1));
    this.titlePalette = TitleController.paletteForRow(this.bundle.palettes);
    this.bootMenu = null;
    this.bootOptions = defaultBootOptions();
    this.restoreViewSettings();
    this.bootPhase = "title";
    this.setScreenEnabled(true);
    if (this.jukebox) {
      this.jukebox.setOverride("Music_TitleScreen");
    }
    print("[PokemonAR] title screen");
    return true;
  }

  /** A species' battle portrait as a shade image, for the title's cycling Pokemon. */
  private frontImage(species: string): ShadeImage {
    const def = this.bundle.species ? this.bundle.species[species] : null;
    return def && def.front ? imageFromPacked(def.front) : null;
  }

  /**
   * One frame of the first-run wizard. Runs instead of everything else, before
   * there is a world to run.
   *
   * It reports the two things the lens has never told anyone: where the placer
   * put the diorama, and which input source is actually driving the buttons.
   * "I cannot tell whether the controller works" was a playtest finding rather
   * than something a wearer could glance at.
   */
  private driveWizard(dt: number): void {
    const codeKeyboardShown = this.syncCodeKeyboard(dt);
    if (this.screen && !codeKeyboardShown) {
      this.placeScreen(dt);
    }
    // The surface probe runs here too, or PLACE would sit on "looking for a
    // table" for as long as the wizard is up: onUpdate's own call to it is
    // below the early return this frame took.
    if (this.placer) {
      this.placer.requestSurfacePlacement(dt);
    }
    // The hands work on the empty plate exactly as they will on the world:
    // the edge moves it, two hands size and turn it. Untargeted A is disabled
    // on the code page. The normal world-hands pass skips the wizard.
    this.driveWizardHands(dt);
    this.wizard.observe(this.placer ? this.placer.state() : "",
                        this.gamepad ? this.gamepad.padState() : "",
                        this.input.activeName());
    // The plate shows only on the pages about placing it.
    if (this.plate) {
      this.plate.setEnabled(this.wizard.showsPlate());
    }
    const edge = this.wizardPad.step(this.input.dpad(), dt);
    const out = this.wizard.step(dt, this.input.pressedA(), this.input.pressedB(),
                                 this.input.pressedStart(), edge);
    this.syncCodeKeyboard(0);
    if (this.wizard.stateVersion() !== this.paintedVersion) {
      this.paintedVersion = this.wizard.stateVersion();
      this.wizard.paint(this.canvas);
      // In the Game Boy shell the pages are drawn in the LCD's own green.
      this.screen.upload(this.canvas, () => (this.shell ? DMG_GREEN : DMG_GREYS));
    }
    if (out === WIZ_RETRY) {
      this.setStatus("Trying the world again...");
      this.loadWorld();
      return;
    }
    if (out === WIZ_KEYBOARD) {
      this.openCodeKeyboard();
      return;
    }
    if (out === WIZ_KEYBOARD_CLOSE) {
      this.closeCodeKeyboard();
      return;
    }
    if (out === WIZ_FETCH_CODE) {
      this.closeCodeKeyboard();
      this.fetchWorld(this.wizard.enteredCode());
      return;
    }
    if (out === WIZ_RESCAN) {
      this.rescanForPad();
      return;
    }
    if (out === WIZ_REPLACE) {
      this.replaceDiorama();
      // replaceDiorama switches the screen off -- it assumes the page asking
      // for it is a page you cannot see the world through. The wizard IS the
      // page, so it has to come straight back or it vanishes on B.
      this.setScreenEnabled(true);
      return;
    }
    if (out === WIZ_DONE) {
      if (!this.debugFirstRun) {
        storeWizardSeen();
      }
      this.closeCodeKeyboard();
      if (this.codeKeyboard) this.codeKeyboard.setEnabled(false);
      this.wizard = null;
      this.removePlate();
      // paintedVersion is shared with driveBoot, driveIntro and the view page.
      // Left at the wizard's last number, driveBoot's own version test could be
      // satisfied by it and the title would never paint -- the wizard's last
      // page would simply sit there.
      this.paintedVersion = -1;
      print("[PokemonAR] setup wizard: done");
      if (this.debugSkipTitle || !this.beginBoot()) {
        this.startWorld(this.savedState);
      }
    }
  }

  /**
   * The hands, while there is only a plate to hold.
   *
   * The same gestures as the world's, with two things left out on purpose:
   * a two-handed dive does not write the ZOOM setting (there is no map to
   * zoom, and startWorld sets the scale from the OPTION page anyway), and
   * the fight is never asked whether it owns the rotation, because there is
   * no fight.
   */
  private driveWizardHands(dt: number): void {
    if (!this.hands || !this.battle) {
      return;
    }
    const rootScale = this.battle.currentScale();
    const half = DEFAULT_PLATE_SPAN_CM * (rootScale > 0 ? rootScale : 1) / 2;
    // With the plate out of view there is nothing to move or size. A free
    // pinch advances the intro, but code entry accepts targeted keys only.
    const plateShown = this.plate !== null && this.wizard !== null && this.wizard.showsPlate();
    this.hands.update(dt, {
      canGrab: (at: vec3) => {
        if (!plateShown) {
          return false;
        }
        const local = this.toPlateAxes(at);
        return local ? onRim(local[0], local[1], half) : true;
      },
      canSpan: (at: vec3) => {
        if (!plateShown) {
          return false;
        }
        const local = this.toPlateAxes(at);
        return local ? overPlate(local[0], local[1], half) : true;
      },
      onTap: () => {
        // A missed spatial key must do nothing, never type the D-pad cursor's letter.
        if ((this.wizard && this.wizard.onGridPage()) ||
            (this.codeKeyboard && this.codeKeyboard.blocksUntargetedPinch()) ||
            (this.spatialPage && this.spatialPage.blocksPinch())) return;
        if (this.pinch && !this.padShadowsTap()) {
          this.pinch.tap();
        }
      },
      onHoverRim: (over: boolean) => this.sayRimHint(over),
      onMove: (delta: vec3) => {
        this.battle.moveBy(delta);
        this.moveDioramaAnchor(delta);
        if (this.placer) {
          this.placer.markPlaced();
        }
      },
      onDiveScale: (pivot: vec3, factor: number) => {
        this.battle.scaleAbout(pivot, factor, 0.5, 3);
        if (this.placer) {
          this.placer.markPlaced();
        }
      },
      onTwist: (radians: number) => {
        this.userYaw = wrapRadians(this.userYaw + radians);
        this.applyDioramaRotation();
        if (this.placer) {
          this.placer.markPlaced();
        }
      },
    });
  }

  /** Replace the small LCD grid only while typing; restore the Game Boy on other pages. */
  private syncCodeKeyboard(dt: number): boolean {
    const wanted = this.wizard !== null && this.wizard.onGridPage();
    if (wanted && !this.codeKeyboard) {
      this.codeKeyboard = new FloatingCodeKeyboard(this, this.camera,
        (texture: Texture) => this.readingMaterial(texture),
        (row: number, column: number) => {
          if (this.wizard && this.wizard.onGridPage()) {
            this.wizard.queueCodeCell(row, column);
            if (this.jukebox) this.jukebox.playClick();
          }
        });
    }
    if (!this.codeKeyboard) return false;
    if (wanted !== this.codeKeyboard.isEnabled()) {
      this.codeKeyboard.setEnabled(wanted);
      if (this.screen) this.screen.setEnabled(!wanted);
      this.paintedVersion = -1;
    }
    if (wanted) {
      this.codeKeyboard.update(this.camera, dt, this.wizard.typedCode(), this.wizard.codeCursor());
    }
    return wanted;
  }

  /** The empty plate goes the moment there is a world to stand there. */
  private removePlate(): void {
    if (this.plate) {
      this.plate.destroy();
      this.plate = null;
    }
    // A dive on the plate scaled the root; the world starts from its own
    // scale, set from the ZOOM row, not from wherever the hands left it.
    if (this.dioramaRoot) {
      this.dioramaRoot.getTransform().setLocalScale(new vec3(1, 1, 1));
    }
  }

  /**
   * The credits, on the Game Boy screen, after the HALL OF FAME.
   *
   * The cartridge resets to the title when they end; the lens hands the
   * player back to the room instead, saved, standing where they were. A
   * headset does not want a reboot at the end of a game it has just played
   * for forty hours, and the room's door still leads out.
   */
  private beginCredits(): void {
    const data: any = (this.bundle as any).field ? (this.bundle as any).field.credits : null;
    if (!data || !data.screens || !GbFont.available(this.bundle) || !this.ensureScreen()) {
      print("[PokemonAR] credits: nothing to roll");
      return;
    }
    if (!this.gbFont) {
      this.gbFont = new GbFont(this.bundle);
    }
    storeSave(this.play as any);
    const titleArt: any = (this.bundle as any).title;
    this.credits = new CreditsController(
      data.screens, (species: string) => this.frontImage(species),
      titleArt && titleArt.copyright ? imageFromPacked(titleArt.copyright) : null);
    this.bootPhase = "credits";
    this.paintedVersion = -1;
    this.setScreenEnabled(true);
    if (this.jukebox) {
      this.jukebox.setOverride("Music_Credits");
    }
    print("[PokemonAR] credits: rolling, " + data.screens.length + " screens");
  }

  private driveCredits(dt: number): void {
    if (this.screen) {
      this.placeScreen(dt);
    }
    if (!this.credits) {
      this.bootPhase = "";
      return;
    }
    const out = this.credits.step(Math.min(dt, 0.1) * GB_FPS, this.input.pressedStart());
    if (this.credits.stateVersion() !== this.paintedVersion) {
      this.paintedVersion = this.credits.stateVersion();
      this.credits.paint(this.canvas, this.gbFont);
      const palette = this.credits.palette();
      this.screen.upload(this.canvas, () => palette);
    }
    if (out === CREDITS_DONE) {
      this.credits = null;
      this.bootPhase = "";
      this.paintedVersion = -1;
      this.handBackScreen();
      if (this.jukebox) {
        this.jukebox.setOverride("");
        this.jukebox.resume();
      }
      print("[PokemonAR] credits: done");
    }
  }

  /** One frame of the title or the menu. Runs instead of the world until a choice is made. */
  private driveBoot(dt: number): void {
    if (this.screen) {
      this.placeScreen(dt);
    }
    let pressedA = this.input.pressedA();
    let pressedB = this.input.pressedB();
    let pressedStart = this.input.pressedStart();
    // The unattended smoke test presses A every half second, so it still
    // reaches the world on its own.
    if (this.debugAutoWalk) {
      this.bootAutoSeconds += dt;
      if (this.bootAutoSeconds >= 0.5) {
        this.bootAutoSeconds = 0;
        pressedA = true;
      }
    }
    if (this.bootPhase === "title") {
      // The save ladder sits over the title: SELECT opens it, A drops in, B
      // closes it. A test build's thing; the input is off in the one that ships.
      if (this.debugLadder && this.ladderMenu === null && this.input.pressedSelect()) {
        const rows = ladderRows();
        const labels: string[] = [];
        const notes: string[] = [];
        for (let i = 0; i < rows.length; i++) {
          labels.push(rows[i][0]);
          notes.push(rows[i][1]);
        }
        this.ladderMenu = new ChoiceController(["LADDER"], labels, notes);
        this.paintedVersion = -1;
        print("[PokemonAR] ladder: open");
        return;
      }
      if (this.ladderMenu !== null) {
        const picked = this.ladderMenu.step(this.input.dpad(), pressedA, pressedB, dt);
        if (picked === CHOICE_CLOSED) {
          const rung = this.ladderMenu.picked();
          this.ladderMenu = null;
          this.paintedVersion = -1;
          if (rung >= 0) {
            const state = ladderState(this.bundle, rung);
            print("[PokemonAR] ladder: rung " + rung + " -> " + state.mapId + " " +
                  state.cellX + "," + state.cellY + ", " + state.party.length + " in the party");
            this.finishBoot(state);
          }
          return;
        }
        this.paintLadder();
        return;
      }
      const out = this.title.step(pressedA, pressedStart, dt);
      if (this.title.visualVersion() !== this.paintedVersion) {
        this.paintedVersion = this.title.visualVersion();
        this.title.paint(this.canvas);
        this.screen.upload(this.canvas, this.titlePalette);
      }
      if (out === TITLE_TO_MENU) {
        if (this.jukebox) {
          this.jukebox.playCry(this.title.currentSpecies());
        }
        const s = this.savedState;
        this.bootMenu = new BootMenuController(s !== null, {
          playerName: s ? s.playerName : "",
          badges: s ? PokemonAR.countTrue(s.badges) : 0,
          dexOwned: s ? PokemonAR.countTrue(s.dexOwned) : 0,
          playTimeSeconds: s ? s.playTimeSeconds : 0,
        }, this.bootOptions, this.worldStored);
        this.bootPhase = "menu";
        this.paintedVersion = -1;
        print("[PokemonAR] main menu" + (s ? " (save found)" : ""));
      }
      return;
    }
    const out = this.bootMenu.step(this.input.dpad(), pressedA, pressedB, dt);
    if (this.bootMenu.stateVersion() !== this.paintedVersion) {
      this.paintedVersion = this.bootMenu.stateVersion();
      this.bootMenu.paint(this.canvas, this.gbFont);
      this.screen.upload(this.canvas, () => DMG_GREYS);
    }
    if (out === BOOT_TO_TITLE) {
      this.title.restart();
      this.bootPhase = "title";
      this.paintedVersion = -1;
    } else if (out === BOOT_CONTINUE) {
      this.finishBoot(this.savedState);
    } else if (out === BOOT_NEW_GAME) {
      this.bootOptions = this.bootMenu.options();
      this.finishBoot(null);
    } else if (out === BOOT_NEW_WORLD) {
      // The stored world goes and the save stays. The menu is already showing
      // its closing page; the next start finds no cache and asks for a code.
      if (forgetBundle()) {
        this.worldStored = false;
        print("[PokemonAR] NEW WORLD: the stored world is forgotten; the next start asks for a code");
      } else {
        this.bootMenu.worldKept();
      }
    }
  }

  /** The ladder's rows in a full-screen box, the cursor beside the chosen one. */
  private paintLadder(): void {
    if (this.ladderMenu === null || !this.gbFont || !this.canvas || !this.screen) {
      return;
    }
    const rows = this.ladderMenu.rows();
    this.canvas.clear(0);
    this.gbFont.box(this.canvas, 0, 0, 20, 18);
    this.gbFont.text(this.canvas, "WHERE TO?", 2 * TILE, 1 * TILE);
    for (let i = 0; i < rows.length; i++) {
      this.gbFont.text(this.canvas, rows[i], 2 * TILE, (3 + i * 2) * TILE);
    }
    this.gbFont.code(this.canvas, CODE_CURSOR, 1 * TILE, (3 + this.ladderMenu.cursorRow() * 2) * TILE);
    this.gbFont.text(this.canvas, "A=GO  B=BACK", 2 * TILE, 16 * TILE);
    this.screen.upload(this.canvas, () => DMG_GREYS);
  }

  private finishBoot(state: PlayState): void {
    print("[PokemonAR] " + (state ? "CONTINUE" : "NEW GAME"));
    // NEW GAME with the boot art available: OAK_SPEECH runs on the Game Boy
    // screen and the world is not built until the onboarding page answers
    // (SPEC.md "The intro on the Game Boy screen -- design"). CONTINUE, and a
    // bundle baked before the intro art existed, keep today's behaviour.
    if (state === null && this.beginIntro()) {
      return;
    }
    this.bootPhase = "";
    this.handBackScreen();
    if (this.jukebox) {
      // The map's own music from here: the title and Oak are the only two
      // things that override it before the world exists.
      this.jukebox.resume();
    }
    this.startWorld(state);
  }

  /**
   * NEW GAME's own intro, on the Game Boy screen instead of the bedroom
   * appearing at once. False when the bundle carries no intro art (an older
   * bake): the caller falls back to building the world directly, exactly as
   * it did before this phase existed.
   *
   * The world is deliberately NOT built here: PlayLoop/PlayHost never touch
   * `overworld` until OAK_SPEECH's own `warp` names a destination, and
   * hostServices() routes every call that would otherwise need the world
   * (showLines, closeBox, introStage, fade, warp/warpTo, currentMap) to the
   * canvas instead for as long as `this.overworld` stays null -- the smaller
   * change of the two the task called out, over building the diorama early
   * and hiding it: PlayLoop already tolerates an unattached world (`update()`
   * guards on `this.world === null`), so there is nothing to hide.
   */
  /**
   * SPRITE_RED's first frame (facing down), 16x16, remapped through OBP0 the
   * way the cartridge draws an object -- the shrink's last stage. Null when
   * the bundle has no such sprite; IntroStage then draws nothing there.
   */
  private static redDownSpriteFrame(bundle: WorldBundle): ShadeImage {
    const sprite: any = bundle.sprites ? (bundle.sprites as any)["SPRITE_RED"] : null;
    if (!sprite || !sprite.shades || !sprite.alpha || sprite.width < 16 || sprite.height < 16) {
      return null;
    }
    const frameSize = 16;
    const pixelCount = sprite.width * sprite.height;
    const rawShades = unpackShades(sprite.shades, pixelCount);
    const rawAlpha = unpackMask(sprite.alpha, pixelCount);
    const shades = new Uint8Array(frameSize * frameSize);
    const alpha = new Uint8Array(frameSize * frameSize);
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const si = y * sprite.width + x;
        const di = y * frameSize + x;
        alpha[di] = rawAlpha[si];
        shades[di] = RED_SPRITE_OBP0[rawShades[si]];
      }
    }
    return { width: frameSize, height: frameSize, shades: shades, alpha: alpha };
  }

  private beginIntro(): boolean {
    const art: any = (this.bundle as any).introArt;
    // Red's NIDORINO, Yellow's PIKACHU: the one Oak shows the world.
    const shown = introSpecies(cartridgeVersion(this.bundle.romSha1));
    const nidorino = this.bundle.species ? this.bundle.species[shown] : null;
    if (!art || !art.oak || !art.rival || !art.player || !art.shrink1 || !art.shrink2 ||
        !nidorino || !nidorino.front) {
      return false;
    }
    this.play = newPlayState(this.bundle.romSha1);
    this.play.options = {
      textSpeed: this.bootOptions.textSpeed,
      battleAnimations: this.bootOptions.battleAnimations,
      battleStyle: this.bootOptions.battleStyle,
      view: this.bootOptions.view,
      battleAsked: false,
    };
    // The onboarding page below overwrites this; diorama is just the value
    // it holds before that page answers.
    this.play.playMode = this.bootOptions.playMode;

    const introArt: IntroArt = {
      oak: imageFromPacked(art.oak),
      rival: imageFromPacked(art.rival),
      player: imageFromPacked(art.player),
      shrink1: imageFromPacked(art.shrink1),
      shrink2: imageFromPacked(art.shrink2),
    };
    // The shrink's last stage is Red's own walking sprite (INTRO.md: frames
    // 72-134 of the shrink), drawn as an object through OBP0. Decoded here,
    // not in IntroStage, which never touches bundle data.
    this.introStage = new IntroStage(introArt, imageFromPacked(nidorino.front),
                                     PokemonAR.redDownSpriteFrame(this.bundle));
    this.introBox = new CanvasTextBox(this.play.options.textSpeed);
    this.introTextIndex = -1;
    this.introTextOpen = false;
    this.introTextPages = [];
    this.introShrinkStarted = false;
    this.introWhiteHoldStarted = false;
    this.introPlayerShown = false;
    this.namingAckShown = false;
    this.pendingWarp = null;
    this.onboarding = null;
    this.naming = null;

    this.loop = new PlayLoop(this.bundle, this.play, this.hostServices());
    this.loop.startIntroIfNeeded();

    this.bootPhase = "intro";
    if (this.jukebox) {
      this.jukebox.setOverride("Music_MeetProfOak");
    }
    this.paintedVersion = -1;
    this.setScreenEnabled(true);
    print("[PokemonAR] intro");
    return true;
  }

  private static countTrue(flags: boolean[]): number {
    let n = 0;
    for (let i = 0; flags && i < flags.length; i++) {
      if (flags[i]) n++;
    }
    return n;
  }

  /**
   * The lens never STARTS in GAME BOY, whatever the save says.
   *
   * PLAY MODE lives in TWO places and I only fixed one. `restoreViewSettings`
   * stopped reading it back out of the settings file -- and the SAVE carries
   * its own copy (`PlayState.playMode`, migratePlayState line 500), which is
   * what CONTINUE adopts. So the lens went on opening in GAME BOY after the
   * settings file had stopped asking for it: "ik merk dat de lens nogsteeds in
   * gameboy ipv diarama wordt gespeeld bij het starten".
   *
   * Forced here, where every path into a world passes, rather than in
   * migratePlayState: that function is pure, well covered, and answers a
   * different question -- what the save SAID. This answers what the lens does
   * with it.
   */
  private startInDiorama(): void {
    if (!this.play) {
      return;
    }
    if (this.play.playMode !== PLAY_MODE_DIORAMA) {
      print("[PokemonAR] play mode: the save said " + this.play.playMode +
            "; starting in " + PLAY_MODE_DIORAMA + " anyway");
    }
    this.play.playMode = PLAY_MODE_DIORAMA;
    if (this.play.options && this.play.options.view) {
      this.play.options.view.mode = MODE_DIORAMA;
    }
  }

  /** Builds the world for a saved game, or for a new one when `state` is null. */
  private startWorld(state: PlayState): void {
    this.removePlate();
    // The play clock starts HERE, not at getTime() 0: the title screen, the
    // boot menu and the intro are not play, and counting them would put ten
    // minutes on the counter of a game that has not been walked a step.
    this.lastPersistAt = getTime();
    let startMap = this.startMap;
    let startX = this.startCellX;
    let startY = this.startCellY;
    let facing = "";
    if (state) {
      this.play = state;
      startMap = state.mapId;
      startX = state.cellX;
      startY = state.cellY;
      facing = state.facing;
      print("[PokemonAR] resuming at " + state.mapId + " " +
            state.cellX + "," + state.cellY +
            " with " + state.party.length + " in the party");
    } else {
      this.play = newPlayState(this.bundle.romSha1);
      this.play.mapId = startMap;
      this.play.cellX = startX;
      this.play.cellY = startY;
      // The OPTION screen's edits belong to the new game, as wOptions does.
      this.play.options = {
        textSpeed: this.bootOptions.textSpeed,
        battleAnimations: this.bootOptions.battleAnimations,
        battleStyle: this.bootOptions.battleStyle,
        view: this.bootOptions.view,
        // A new game has not been asked how a fight should look. It is asked
        // at the first one, where the answer can be seen rather than guessed.
        battleAsked: false,
      };
      // The OPTION screen's fourth row is the lens's own addition (no
      // wOptions equivalent); a new game inherits it exactly like the three
      // cartridge rows above it.
      this.play.playMode = this.bootOptions.playMode;
    }

    // Every play session starts with the framed diorama. Explicit OPTION edits
    // can still change staging during this session, without a first-fight prompt.
    this.play.options.view.battle = BATTLE_TABLE;
    this.play.options.battleAsked = true;

    this.overworld = new Overworld(this.bundle, startMap, startX, startY, null);
    if (facing) {
      this.overworld.facing = facing;
    }
    // Before the first update: a save written mid-surf and restored on foot
    // puts the player on a water cell with no legal move anywhere.
    this.overworld.surfing = this.play.surfing === true;
    this.overworld.riding = this.play.riding === true;
    this.overworld.darkened = this.play.darkened === true;
    this.overworld.steps = this.play.steps;
    this.buildDialogueBox();
    this.loop = new PlayLoop(this.bundle, this.play, this.hostServices());
    // The world reads what the save owns: reveals, and the blocks flags open.
    this.loop.attach(this.overworld);
    // Every map entry from here on marks a town visited, drops the flags that
    // map clears and re-stamps the barriers a boulder has already opened. The
    // constructor's own entry reached nothing, so this runs it for the boot map.
    this.loop.bindWorld(this.overworld);
    // A save made indoors remembers which town or route its exit leads to.
    this.overworld.lastMapId = this.play.lastMapId ? this.play.lastMapId : "";
    // A save that has never seen Oak's speech gets it now; the VM runs it from
    // the first frame, once the world below has been built.
    this.loop.startIntroIfNeeded();
    // A save written on a trigger cell: the cartridge polls coordinates every
    // frame, so the standing cell is read once at boot too.
    this.loop.stepped(this.overworld.map.def, this.overworld.cellX, this.overworld.cellY);
    this.menu = new MenuController(this.bundle, this.play);
    // Before rebuildDiorama, which reads the mode to decide whether to build
    // a world at all. Only on the way INTO a world from a save: the onboarding
    // page and the OPTION row set the mode deliberately and must keep working.
    this.startInDiorama();
    this.rebuildDiorama();
    this.lastAppliedPlayMode = this.play.playMode;
    this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");
  }


  /**
   * The Game Boy message box, parented to the diorama so it scales with it.
   *
   * Built here rather than in buildScaffold because the font comes out of the
   * bundle, and the bundle is not there yet when the scaffold goes up.
   */
  private buildDialogueBox(): void {
    if (this.box || !this.baseMaterial) {
      return;
    }
    const atlas = buildFontAtlas(this.bundle, [0, 0, 0, 255]);
    if (!atlas) {
      print("[PokemonAR] no font in the bundle; dialogue will be invisible");
      return;
    }
    const material = this.baseMaterial.clone();
    const pass = material.mainPass;
    pass.baseTex = atlas.texture;
    pass.baseColor = new vec4(1, 1, 1, 1);
    pass.blendMode = BlendMode.Normal;
    pass.depthWrite = false;
    pass.depthTest = false;
    pass.twoSided = true;
    // The one material every glyph in the lens is drawn with, and the only one
    // that never asked for point sampling: an 8x8 ROM font read through a
    // bilinear sampler is a smear, and the menu and the pad's own labels are
    // clones of this pass.
    PokemonAR.useNearestFiltering(pass);

    const object = global.scene.createSceneObject("MessageBox");
    object.setParent(this.dioramaRoot);
    this.box = new DialogueBox(object, atlas, material, 1);
    this.box.setEnabled(false);

    // The menu sits above the message box, so both can be up at once -- which
    // they are whenever a battle asks for a move while a line is still being
    // read.
    const menuObject = global.scene.createSceneObject("Menu");
    menuObject.setParent(this.dioramaRoot);
    menuObject.getTransform().setLocalPosition(new vec3(0, 10, 0));
    this.menuPanel = new GlyphPanel(menuObject, atlas, material.clone(), 1, MENU_ROWS, 18);
    this.menuPanel.setEnabled(false);

    // The panel is the HUD, always, whenever the bundle can draw it. It used
    // to be the plate's ALTERNATIVE -- `showPadPanel` chose between them -- and
    // the scene shipped with the plate on, so the glasses got the plate's older
    // glyph HUD, which has no YES/NO box at all. That is why the 7 September
    // playtest could not see a choice menu: not a placement bug, a whole
    // different HUD. The plate is buttons now and nothing else.
    const panel = this.buildMessagePanel();
    // Built either way so the OPTION page's PAD row can show it without having
    // to keep an atlas and a material alive for a later build; hidden unless
    // asked for, which is the default since that playtest.
    this.buildPad(atlas, material.clone());
    if (!panel) {
      // No cartridge font in the bundle: the plate's own glyph HUD is the only
      // one left, so it rides the plate and the plate has to be visible.
      print("[PokemonAR] no message panel; the HUD falls back onto the pad plate");
      this.mountHudOnPad();
    }
    this.applyPadPlate();
  }

  /**
   * Shows or hides the loose buttons, from the OPTION page's BUTTONS row and
   * from what is connected.
   *
   * Safe to call every frame: it only touches a SceneObject when the answer
   * has changed, so the row and the controller can be read from the update
   * loop rather than needing something to remember to announce a change.
   *
   * The old plate is still built, and is shown in the two cases the loose
   * buttons cannot cover: a scene with no Game Boy model to take buttons
   * from, and a bundle with no cartridge font, where the plate carries the
   * HUD and hiding it would hide the dialogue.
   */
  private applyPadPlate(): void {
    if (!this.padView) {
      return;
    }
    const wanted = this.looseButtonsWantedNow();
    if (this.looseButtons && wanted !== this.looseButtonsOn) {
      this.looseButtonsOn = wanted;
      this.looseButtons.setEnabled(wanted);
      if (!wanted && this.pad) {
        // A button held when the buttons went away would stay held forever.
        this.pad.releaseAll();
      }
      print("[PokemonAR] loose buttons " + (wanted ? "shown" : "hidden"));
    }
    const plate = this.messagePanel === null ? true : (this.looseButtons === null && wanted);
    if (plate === this.padPlateOn) {
      return;
    }
    this.padPlateOn = plate;
    this.padView.setEnabled(plate);
    if (!plate && this.pad) {
      this.pad.releaseAll();
    }
    print("[PokemonAR] pad plate " + (plate ? "shown" : "hidden"));
  }

  /**
   * Whether a controller that has its own B, START and D-pad is connected:
   * the wearer's phone through the Spectacles App, or a Bluetooth pad.
   */
  private controllerConnected(): boolean {
    return (this.phone !== null && this.phone.isConnected()) ||
           (this.gamepad !== null && this.gamepad.isConnected());
  }

  /** Whether the loose buttons belong on screen this frame. See looseButtonsWanted. */
  private looseButtonsWantedNow(): boolean {
    // Full input pages own their targets; the anchored frame returns in the same place.
    if ((this.naming && this.naming.isOpen()) || this.viewPage) return false;
    const gameBoyOnScreen = this.shell !== null && this.screen !== null && this.screen.isEnabled();
    return looseButtonsWanted(this.viewSettings(), this.controllerConnected(), gameBoyOnScreen);
  }


  /**
   * The message box as a panel in the room, for a lens with no pad plate.
   *
   * It draws through CanvasTextBox onto a Game Boy canvas -- the same box the
   * cartridge draws, the same typing pace and blinking arrow GAME BOY mode and
   * the intro are pixel-compared against -- rather than through DialogueBox's
   * loose glyph quads, which had no frame at all and read as a white strip per
   * word hanging in the air.
   */
  private buildMessagePanel(): boolean {
    if (this.messagePanel) {
      return true;
    }
    // debugSkipTitle never runs beginBoot, so the font may not exist yet.
    if (!this.gbFont) {
      if (!GbFont.available(this.bundle)) {
        print("[PokemonAR] no Game Boy font in the bundle; the HUD stays on the pad");
        return false;
      }
      this.gbFont = new GbFont(this.bundle);
    }
    this.panelCanvas = new GbCanvas();
    this.panelTextBox = new CanvasTextBox(this.play ? this.play.options.textSpeed : 3);
    this.messagePanel = new MessagePanelView(
      this.getSceneObject(), (t: Texture) => this.readingMaterial(t));

    // The menu has nowhere to hang without a plate, so it gets its own holder
    // and rides just above the panel.
    this.menuHolder = global.scene.createSceneObject("MenuHolder");
    this.menuHolder.setParent(this.getSceneObject());
    if (this.menuPanel) {
      const menuObject = this.menuPanel.sceneObject();
      menuObject.setParent(this.menuHolder);
      const t = menuObject.getTransform();
      t.setLocalRotation(quat.quatIdentity());
      t.setLocalScale(new vec3(PANEL_GLYPH_CM, PANEL_GLYPH_CM, PANEL_GLYPH_CM));
      t.setLocalPosition(new vec3(0, 0, 0));
    }
    print("[PokemonAR] message panel: the cartridge's own box, pinned in the room");
    return true;
  }

  /** An unlit, nearest-sampled clone of the base material around one texture. */
  /**
   * The Game Boy screen and the message box are one surface between them.
   *
   * Both hang in the same place now, so both up at once is two sheets of paper
   * in the same spot: a playtest saw the naming grid with a strip of a message
   * box floating in front of it reading "case". Whichever is showing, the other
   * is not -- and when a full screen closes, the box comes back only if it
   * still has a page to show.
   */
  /**
   * Turns the Game Boy screen off -- unless GAME BOY mode is what is playing on
   * it, in which case turning it off turns the GAME off.
   *
   * There were six places that switched the screen back off and five of them
   * remembered to ask. The sixth was closeViewSurfaces(), so closing the OPTION
   * menu in GAME BOY mode cleared the terrain (the mode's own rebuild) and then
   * darkened the only surface left: "als ik van mode van diorama naar gameboy
   * ga dan verdwijnt heel het spel" (Joshua, 10 September).
   *
   * A rule that has to be remembered at six call sites is a rule that will be
   * forgotten at a seventh, so it lives here now and the call sites ask for
   * this instead.
   */
  private handBackScreen(separateInput: boolean = false): void {
    if (this.isGameBoyMode() && !separateInput) {
      this.setScreenEnabled(true);
      return;
    }
    this.setScreenEnabled(false);
  }

  private setScreenEnabled(on: boolean): void {
    if (on && this.screen) {
      if (!this.housedScreen) this.housedScreen = this.screen;
      const separate = !this.isGameBoyMode() && (!!this.dexEntryScreen || !!this.pictureScreen || !!this.viewPage);
      if (separate && !this.looseScreen) this.looseScreen = new GbScreenView(this.getSceneObject(),
        (t: Texture) => this.readingMaterial(t), 48, 110, false, "InformationPage");
      const wanted = separate ? this.looseScreen : this.housedScreen;
      if (this.screen !== wanted) { this.screen.setEnabled(false); this.screen = wanted; }
    }
    if (!this.screen) {
      return;
    }
    const wasOn = this.screen.isEnabled();
    this.screen.setEnabled(on);
    if (on && !wasOn && this.shell && this.screen.mounted()) {
      // The Game Boy arrives every time the screen comes back: from below,
      // settling, and lighting its LCD a beat later (GameBoyShell.ts).
      this.shell.beginEntrance();
      this.screen.setQuadVisible(false);
    }
    if (this.messagePanel) {
      // ...and while the view page is open, the dialogue box stays shut even
      // when the Game Boy screen goes dark, because what took the frame is the
      // page's OTHER surface beside the world rather than nothing at all.
      this.messagePanel.setEnabled(!on && this.viewPage === null && this.panelBoxOpen);
    }
  }

  /**
   * The material for a surface the wearer READS: the message box and the Game
   * Boy screen.
   *
   * Same as flatMaterial except that it ignores depth entirely. Those two hang
   * about 58 cm in front of the eye, and the diorama is on a table that can be
   * nearer than that -- so the floor was drawn over the bottom half of the
   * dialogue box and the lab counter over the bottom of the dex page. Cut in
   * half by the furniture is not a readable box, and it is the same fault in
   * both reports. A panel you read is a HUD: it belongs in front of
   * everything, which is what the render order at the other end of this does.
   */
  private readingMaterial(texture: Texture): Material {
    const material = this.flatMaterial(texture);
    material.mainPass.depthWrite = false;
    material.mainPass.depthTest = false;
    // The panel's texture now carries alpha: SHADE_NONE uploads as fully
    // transparent so a battle HUD is two blocks floating over the diorama
    // rather than a white 160x144 slab in front of it. Opaque blending would
    // throw that alpha away and put the slab back.
    material.mainPass.blendMode = BlendMode.Normal;
    return material;
  }

  private flatMaterial(texture: Texture): Material {
    const material = this.baseMaterial.clone();
    const pass = material.mainPass;
    pass.baseTex = texture;
    pass.baseColor = new vec4(1, 1, 1, 1);
    pass.depthWrite = true;
    pass.depthTest = true;
    // TWO-SIDED, and for the terrain that is now a cost rather than a
    // necessity. It forbids the card from discarding the back of anything, so
    // every wall in the world is rasterised from both sides.
    //
    // It was hiding a real fault: the voxel mesh's caps faced out of the
    // ground and its walls faced into it, in the same mesh, so culling would
    // have made half the world vanish. That is fixed -- see VoxelTerrain's
    // pushQuad and test/terrainwinding, which measures every triangle of three
    // maps against the column field and now finds none facing inward.
    //
    // Turning it off for the terrain is the next thing to try, and it is NOT
    // one line here: this method also dresses the billboards, the message
    // panel and the button plate, and a sprite quad seen from behind has to
    // keep drawing. It needs its own material path for the terrain alone.
    //
    // Worth being honest about the size: walls are about a third of the quads
    // a map emits, and only the ones facing away would be discarded, so the
    // saving is a fraction of a third of the rasterising -- real, bounded, and
    // no substitute for a Lens Power reading that says where the frame goes.
    pass.twoSided = true;
    PokemonAR.useNearestFiltering(pass);
    return material;
  }

  /**
   * The face plate lives beside the lens root, not inside the diorama: it must
   * not grow with a dive or bend with the world, and it follows the wearer
   * rather than the table.
   */
  private buildPad(atlas: FontAtlas, labelMaterial: Material): void {
    if (this.padView || !this.pad) {
      return;
    }
    this.padView = new PadPanelView(this.getSceneObject(), this.pad,
                                    (t: Texture) => this.flatMaterial(t), atlas, labelMaterial);
    print("[PokemonAR] pad panel: " + this.padView.wiredButtons() + " of 8 buttons wired to SIK");
    this.buildLooseButtons();
  }

  /** The one fingertip presser every button volume is handed to, made on first use. */
  private fingers(): FingerPresser {
    if (!this.fingerPresser && this.pad) {
      this.fingerPresser = new FingerPresser(this.pad);
    }
    return this.fingerPresser;
  }

  /**
   * The loose buttons, out of the same model the first run's Game Boy is
   * made of. Without that model there is nothing to take them from, and the
   * plate above stays the way to press a button with a hand.
   */
  private buildLooseButtons(): void {
    if (this.looseButtons || !this.pad || !this.gameBoyPrefab) {
      return;
    }
    // The editor's mouse gets its own path here too; see Pressable.ts.
    let presser: TouchPresser = null;
    if (TouchPresser.wanted() && this.camera) {
      presser = new TouchPresser(this, this.camera, this.pad);
    }
    this.looseButtons = new LooseButtons(this.getSceneObject(), this.gameBoyPrefab, this.pad,
                                         (t: Texture) => this.decalMaterial(t),
                                         (t: Texture) => this.readingMaterial(t), presser, this.fingers());
    if (presser) {
      presser.bind();
    }
    print("[PokemonAR] loose buttons: " + this.looseButtons.wiredButtons() + " of 8 wired to SIK" +
          (presser ? ", and the editor's click" : ""));
  }

  /**
   * Builds the synth and connects it to the speakers.
   *
   * The output's own sample rate decides the synth's: a chip synth run at the
   * wrong rate is not slightly wrong, every note in the game is out of tune by
   * the ratio. With no Audio Output asset wired the jukebox is still built, at
   * a nominal rate, so every call site works and the lens is merely silent --
   * which is how a finished cry synth sat in this project for weeks without
   * anyone hearing it.
   */
  /**
   * The synth without banks, connected at start: the setup pages have a
   * click for their buttons (Jukebox.playClick) before any world has come
   * with its sound banks. startAudio replaces it once one has.
   */
  private startEarlyAudio(): void {
    if (this.jukebox) {
      return;
    }
    const rate = this.audio.attach(this.audioOutput);
    this.jukebox = new Jukebox(null, null, rate > 0 ? rate : 44100);
    this.audio.setJukebox(this.jukebox);
  }

  private startAudio(): void {
    const rate = this.audio.attach(this.audioOutput);
    const banks = new AudioBanks(this.bundle.audio);
    this.jukebox = new Jukebox(banks, this.bundle.cries, rate > 0 ? rate : 44100);
    this.audio.setJukebox(this.jukebox);
    if (!this.audio.connected) {
      print("[PokemonAR] no Audio Output wired: the lens will be silent");
      return;
    }
    if (!banks.playable) {
      // Not an audio fault, and it must not read like one. The synth, the
      // driver and the wiring are all fine; the WORLD is older than they are.
      // This cost an evening once: the log said "NO BANKS in this bundle" from
      // the first run and was read as the audio being broken, while the actual
      // fault was a bundle the bridge had been serving since the day before the
      // sound banks existed. On screen, not just in the log, so the next person
      // sees it without going looking.
      this.setStatus("World has no sound banks: re-bake it (this one predates them)");
      return;
    }
    print("[PokemonAR] audio " + rate + " Hz, " + banks.musicLabels().length + " songs");
  }

  /**
   * Keeps the music with the map.
   *
   * Read every frame rather than announced by whatever changes the map: there
   * are four places that do, and the one that forgets is the one where the
   * music stops.
   */
  private syncMusic(): void {
    if (!this.jukebox || !this.overworld) {
      return;
    }
    // How the player is travelling outranks the map (home/audio.asm:21-27):
    // a bicycle has its own song, and so does the water. Checked every frame
    // because getting on one is not a map change.
    const ride = this.overworld.riding ? "Music_BikeRiding"
      : this.overworld.surfing ? "Music_Surfing" : "";
    if (ride !== this.musicRide) {
      this.musicRide = ride;
      this.jukebox.setRide(ride);
      print("[PokemonAR] music: " + this.jukebox.wanted() + " (travelling)");
    }
    const mapId = this.overworld.mapId;
    if (mapId === this.musicMapId) {
      return;
    }
    this.musicMapId = mapId;
    this.jukebox.setMap(mapId);
    print("[PokemonAR] music: " + this.jukebox.wanted() + " for " + mapId);
  }

  /**
   * Writes the playthrough to storage, position and all.
   *
   * The clock counts the time SINCE THE LAST WRITE, not a constant twenty
   * seconds. It used to add twenty on every call because the autosave was the
   * only caller and it ran on a twenty-second timer; SAVE from the menu and,
   * now, logging off the PC are event-driven, and each of those was worth
   * twenty seconds of play the player never had.
   */
  private persist(): void {
    if (!this.play) {
      return;
    }
    this.play.mapId = this.overworld.mapId;
    this.play.cellX = this.overworld.cellX;
    this.play.cellY = this.overworld.cellY;
    this.play.facing = this.overworld.facing;
    this.play.steps = this.overworld.steps;
    this.play.lastMapId = this.overworld.lastMapId;
    this.play.surfing = this.overworld.surfing;
    const now = getTime();
    const since = now - this.lastPersistAt;
    // getTime() restarts near zero every launch, so the first write of a
    // session -- and any that follows a restart -- counts from the launch.
    this.play.playTimeSeconds = this.play.playTimeSeconds + (since > 0 ? since : 0);
    this.lastPersistAt = now;
    this.play.index = this.play.index + 1;
    // The backstop for the one field that cannot be repaired later. Every
    // path that hands the player a Pokemon already claims it, but this is the
    // single place a save is written, so a path written next month that
    // forgets still cannot produce an ownerless Pokemon on disk. See
    // Storage.claimUnowned.
    claimUnowned(this.play as any);
    storeSave(this.play as any);
  }

  /**
   * One frame of the menu, and what its answer means.
   *
   * The menu never touches the bag or the party itself: it reports what the
   * player picked and this decides what that costs. `report.ok` from the engine
   * means the action was LEGAL, not that the item was used, so an item is only
   * taken out of the bag when the engine says it did something.
   */
  private spatialPad(): DPadState {
    if (!this.spatialDirection) return this.input.dpad();
    return {up:this.spatialDirection==="up",down:this.spatialDirection==="down",
      left:this.spatialDirection==="left",right:this.spatialDirection==="right"};
  }

  private driveMenu(dt: number): void {
    const pad = this.spatialPad();
    const outcome = this.menu.step(pad, this.spatialAction === "a" || this.input.pressedA(),
                                   this.spatialAction === "b" || this.input.pressedB(), dt);
    this.paintMenu();
    if (outcome === MENU_NONE) {
      return;
    }
    if (outcome === MENU_CLOSED) {
      this.paintMenu();
      return;
    }
    if (outcome === MENU_OPTION) {
      // The view rows, on the Game Boy screen the boot menu already uses --
      // the same page, the same frame, the same ladders. The START menu
      // closes: the page owns the frame until B or CANCEL.
      this.menu.close();
      this.paintMenu();
      this.openViewPage();
      return;
    }
    if (outcome === MENU_SAVE) {
      if (this.loop && this.loop.canSave()) {
        this.persist();
        if (this.jukebox) {
          this.jukebox.playEffect(SFX_SAVE);
        }
        this.setStatus("Saved.");
      }
      this.menu.close();
      this.paintMenu();
      return;
    }
    if (this.runner === null) {
      if (outcome === MENU_FIELD_MOVE) {
        // The party menu's own entry for CUT, SURF, STRENGTH, FLY or FLASH.
        // The menu closes first: the VM owns the frame from here, and the
        // script it starts shows the cartridge's own lines.
        const index = this.menu.chosenIndex();
        const move = this.menu.chosenMove();
        this.menu.close();
        this.paintMenu();
        const used = this.loop.useFieldMove(this.overworld, index, move);
        if (used.pickFly) {
          this.menu.openFly(this.loop.visitedTowns());
          this.paintMenu();
        }
        return;
      }
      if (outcome === MENU_FLY) {
        const destination = this.menu.chosenMap();
        // The town map plays SFX_HEAL_AILMENT the moment a town is chosen
        // (engine/items/town_map.asm:208-217); the bird's own SFX_FLY comes
        // from the fly routine itself (Host.call).
        this.jukebox.playEffect(SFX_HEAL_AILMENT);
        this.menu.close();
        this.paintMenu();
        this.loop.fly(this.overworld, destination);
        return;
      }
      if (outcome === MENU_TEACH) {
        // Built AFTER the menu closes and driven from the NEXT frame, so the A
        // press that opened it is not also read as its first answer.
        const machine = this.menu.chosenItem();
        this.menu.close();
        this.paintMenu();
        this.teach = new TeachController(this.bundle, this.play, machine);
        this.paintTeach();
        return;
      }
      if (outcome === MENU_ITEM) {
        // A bag item outside a battle (ItemUse.ts). The menu closes first: the
        // VM owns the frame from here and shows the cartridge's own lines. What
        // is left on screen afterwards -- a learn prompt, an evolution -- waits
        // in pendingItemUse until those lines are gone.
        const item = this.menu.chosenItem();
        const target = this.menu.chosenIndex();
        // The move an ETHER or a PP UP was pointed at; -1 for everything else.
        const moveSlot = this.menu.chosenRow();
        this.menu.close();
        this.paintMenu();
        const used = this.loop.useItem(this.overworld, item, target, moveSlot);
        if (used !== null && (used.learn.length > 0 || used.evolveTo !== "")) {
          this.pendingItemUse = used;
        }
        return;
      }
      // Overworld: nothing else the menu can report is wired here.
      this.menu.close();
      this.paintMenu();
      return;
    }
    if (outcome === MENU_MOVE && this.safariMenu) {
      const row = this.menu.chosenRow();
      this.safariChoice = row >= 0 && row < SAFARI_ROWS.length ? SAFARI_ROWS[row] : "";
    } else if (outcome === MENU_MOVE) {
      // The ROW, not the slot. BattleRunner's port takes a row and maps it to a
      // slot itself; handing it the slot would translate twice and pick a third
      // move. chosenIndex() is the slot, for callers that do not.
      this.moveChoice = this.menu.chosenRow();
    } else if (outcome === MENU_RUN && this.safariMenu) {
      this.safariChoice = "run";
    } else if (outcome === MENU_RUN) {
      this.runRequested = true;
    } else if (outcome === MENU_SWITCH) {
      this.switchChoice = this.menu.chosenIndex();
    } else if (outcome === MENU_ITEM) {
      this.bagItemChoice = this.menu.chosenItem();
      this.bagTargetChoice = this.menu.chosenIndex();
      this.bagMoveChoice = this.menu.chosenRow();
    }
  }

  /** One frame of a TM or HM being taught. */
  private driveTeach(dt: number): void {
    const outcome = this.teach.step(this.spatialPad(), this.spatialAction === "a" || this.input.pressedA(),
                                    this.spatialAction === "b" || this.input.pressedB(), dt);
    if (outcome === TEACH_CLOSED) {
      this.teach = null;
      if (this.menuPanel) {
        this.menuPanel.setEnabled(false);
      }
      if (this.box) {
        this.box.setEnabled(false);
      }
      return;
    }
    this.paintTeach();
  }

  /**
   * The level-up's "forget which move?" prompt, one frame.
   *
   * Runs from inside the battle's own frame, before updateRunner(), so the
   * runner sees an answer on the frame after it is given rather than a frame
   * late -- which for a prompt that ends a battle would show the victory text
   * behind the question.
   */
  private driveBattleLearn(dt: number): void {
    if (this.battleLearn === null) {
      return;
    }
    const outcome = this.battleLearn.step(this.spatialPad(), this.spatialAction === "a" || this.input.pressedA(),
                                          this.spatialAction === "b" || this.input.pressedB(), dt);
    this.paintBattleLearn();
    if (outcome === LEARN_CLOSED) {
      // Kept until the runner has READ the decision; clearing it here would
      // make learnDecision() answer LEARN_ABANDONED for a move just learned.
      this.battleLearnDone = true;
    }
  }

  /**
   * Its list in the menu panel and its message in the box, like the teach
   * prompt's -- but only when something has CHANGED.
   *
   * presentPage() restarts the box's letter-by-letter typing, so painting every
   * frame would leave the text permanently on its first character. The teach
   * prompt does not have this problem because it draws through DialogueBox,
   * which has no typing to restart.
   */
  private paintBattleLearn(): void {
    if (this.battleLearn === null) {
      return;
    }
    const rows = this.battleLearn.rows();
    const lines = this.battleLearn.lines();
    const signature = rows.join("|") + "#" + this.battleLearn.cursorRow() +
      "#" + (lines === null ? "" : lines.join("|"));
    if (signature === this.battleLearnPainted) {
      return;
    }
    this.battleLearnPainted = signature;
    if (this.menuPanel) {
      if (rows.length > 0) {
        this.menuPanel.setRows(rows);
        this.menuPanel.setCursorRow(this.battleLearn.cursorRow());
        this.menuPanel.setEnabled(this.isGameBoyMode());
      } else {
        this.menuPanel.setEnabled(false);
      }
    }
    if (lines !== null) {
      this.presentPage(lines);
      this.pageAcked = false;
    }
  }

  /** Its list in the menu panel and its message in the box, like the shop's. */
  private paintTeach(): void {
    if (this.teach === null) {
      return;
    }
    const rows = this.teach.rows();
    if (this.menuPanel) {
      if (rows.length > 0) {
        this.menuPanel.setRows(rows);
        this.menuPanel.setCursorRow(this.teach.cursorRow());
        this.menuPanel.setEnabled(this.isGameBoyMode());
      } else {
        this.menuPanel.setEnabled(false);
      }
    }
    const lines = this.teach.lines();
    if (this.box) {
      if (lines !== null) {
        this.box.setLines(lines);
        this.box.setEnabled(this.isGameBoyMode() || rows.length === 0);
      } else {
        this.box.setEnabled(false);
      }
    }
  }

  /** One frame of the Poke Mart: buttons in, rows and lines out. */
  private driveShop(dt: number): void {
    // The Mart's own till. ShopController answers only "open" or "closed", and
    // giving it a third answer would mean changing it and its suite for one
    // sound -- while the money moving is the same event, already recorded, and
    // right for a sale as well as a purchase.
    const moneyBefore = this.play ? this.play.money : 0;
    const outcome = this.shop.step(this.spatialPad(), this.spatialAction === "a" || this.input.pressedA(),
                                   this.spatialAction === "b" || this.input.pressedB(), dt);
    if (this.jukebox && this.play && this.play.money !== moneyBefore) {
      this.jukebox.playEffect(SFX_PURCHASE);
    }
    if (outcome === SHOP_CLOSED) {
      this.shop = null;
      if (this.menuPanel) {
        this.menuPanel.setEnabled(false);
      }
      if (this.box) {
        this.box.setEnabled(false);
      }
      return;
    }
    this.paintShop();
  }

  /** One frame of a choice list: buttons in, a row out. */
  private driveChoice(dt: number): void {
    const outcome = this.choice.step(this.spatialPad(), this.spatialAction === "a" || this.input.pressedA(),
                                     this.spatialAction === "b" || this.input.pressedB(), dt);
    if (outcome === CHOICE_CLOSED) {
      this.choicePick = this.choice.picked();
      this.choice = null;
      if (this.menuPanel) {
        this.menuPanel.setEnabled(false);
      }
      if (this.box) {
        this.box.setEnabled(false);
      }
      return;
    }
    this.paintChoice();
  }

  /** Its rows in the menu panel and its question in the box. */
  private paintChoice(): void {
    if (this.choice === null) {
      return;
    }
    const rows = this.choice.rows();
    if (this.menuPanel) {
      if (rows.length > 0) {
        this.menuPanel.setRows(rows);
        this.menuPanel.setCursorRow(this.choice.cursorRow());
        this.menuPanel.setEnabled(this.isGameBoyMode());
      } else {
        this.menuPanel.setEnabled(false);
      }
    }
    const lines = this.choice.lines();
    if (this.box) {
      if (lines !== null) {
        this.box.setLines(lines);
        this.box.setEnabled(this.isGameBoyMode() || rows.length === 0);
      } else {
        this.box.setEnabled(false);
      }
    }
  }

  /** The shop's list in the menu panel and its message in the box. */
  private paintShop(): void {
    if (this.shop === null) {
      return;
    }
    const rows = this.shop.rows();
    if (this.menuPanel) {
      if (rows.length > 0) {
        this.menuPanel.setRows(rows);
        this.menuPanel.setCursorRow(this.shop.cursorRow());
        this.menuPanel.setEnabled(this.isGameBoyMode());
      } else {
        this.menuPanel.setEnabled(false);
      }
    }
    const lines = this.shop.lines();
    if (this.box) {
      if (lines !== null) {
        this.box.setLines(lines);
        this.box.setEnabled(this.isGameBoyMode() || rows.length === 0);
      } else {
        this.box.setEnabled(false);
      }
    }
  }

  /** One frame of the PC: buttons in, rows and lines out. */
  private drivePc(dt: number): void {
    const outcome = this.pc.step(this.spatialPad(), this.spatialAction === "a" || this.input.pressedA(),
                                 this.spatialAction === "b" || this.input.pressedB(), dt);
    if (outcome === PC_CLOSED) {
      this.pc = null;
      if (this.menuPanel) {
        this.menuPanel.setEnabled(false);
      }
      if (this.box) {
        this.box.setEnabled(false);
      }
      // Logging off is what commits a deposit: the save is the only place the
      // box and the item store live, and a lens that quits here would put the
      // Pokemon back in the party on the next load.
      this.persist();
      return;
    }
    this.paintPc();
  }

  /** The PC's list in the menu panel and its message in the box. */
  private paintPc(): void {
    if (this.pc === null) {
      return;
    }
    const rows = this.pc.rows();
    if (this.menuPanel) {
      if (rows.length > 0) {
        this.menuPanel.setRows(rows);
        this.menuPanel.setCursorRow(this.pc.cursorRow());
        this.menuPanel.setEnabled(this.isGameBoyMode());
      } else {
        this.menuPanel.setEnabled(false);
      }
    }
    const lines = this.pc.lines();
    if (this.box) {
      if (lines !== null) {
        this.box.setLines(lines);
        this.box.setEnabled(this.isGameBoyMode() || rows.length === 0);
      } else {
        this.box.setEnabled(false);
      }
    }
  }

  /**
   * Draws whatever the menu is showing, or takes it off screen.
   *
   * A FIGHT's menu is not drawn here at all: it goes into the message panel's
   * own canvas, in a box, next to the text it answers -- see BattleMenuBox.
   * The loose GlyphPanel has no frame and never did, which was survivable
   * while it sat on the button plate and stopped being so when the plate
   * became buttons; over a field of grass it is white letters on green.
   */
  private paintMenu(): void {
    if (!this.menuPanel || !this.menu) {
      return;
    }
    // GAME BOY mode draws the list on its own screen (CanvasMenu); the panel
    // out in the room stays dark there.
    if (!this.menu.isOpen() || this.runner !== null || this.isGameBoyMode()) {
      this.menuPanel.setEnabled(false);
      return;
    }
    if (!this.isGameBoyMode()) { this.menuPanel.setEnabled(false); return; }
    this.menuPanel.setRows(this.menu.rows());
    this.menuPanel.setCursorRow(this.menu.cursorRow());
    this.menuPanel.setEnabled(true);
  }

  /**
   * The battle view: the message box the runner writes into, and the menu.
   *
   * The move menu is the status line for now. A proper four-slot menu with a
   * cursor is UI work; what matters first is that the engine, the runner and the
   * player are joined at all, and that the choice is genuinely the player's --
   * the runner's own selftest fails if it starts choosing moves by itself.
   */
  private battleView(): BattleView {
    const self = this;
    return {
      showLines: (lines: string[]) => {
        self.presentPage(lines);
        self.pageAcked = false;
      },
      sound: (key: string) => {
        if (self.jukebox) {
          self.jukebox.playEffect(key);
        }
      },
      askLearn: (mon: BattleMon, moveId: string) => {
        // The same prompt a TM opens, on the same two surfaces. It is built
        // here and driven from onUpdate, because the runner only asks: it has
        // no buttons and should not grow any.
        self.battleLearn = new MoveLearnController(self.bundle, mon, moveId);
        self.paintBattleLearn();
      },
      learnDecision: () => {
        return self.battleLearn === null ? LEARN_ABANDONED : self.battleLearn.decision();
      },
      acknowledged: () => self.pageAcked,
      hideBox: () => {
        // The PANEL, not just the old loose box.
        //
        // This closed `box` alone, which is the surface DIORAMA mode has not
        // used since the message panel arrived -- so a battle's last page stayed
        // on screen after the runner had already finished and been cleared.
        // Nothing owned it any more, so nothing could ever acknowledge it: a
        // fight would end on "abc gained 23 EXP. Points!" and simply stop
        // there, which is what the 8 September playtest hit and could not press
        // its way out of.
        //
        // The same three lines the script host's own closeBox uses. There is no
        // reason a battle's box should close differently from a sign's.
        if (self.messagePanel) {
          self.panelBoxOpen = false;
          self.closeChoiceBox();
          self.messagePanel.setEnabled(false);
        } else if (self.box) {
          self.box.setEnabled(false);
        }
        self.pageWaiting = false;
      },
      showMoves: (names: string[]) => {
        self.moveMenu = names;
        self.moveChoice = -1;
        // The runner knows which SLOT each row stands for; the menu needs both
        // so it can report the slot rather than the row.
        self.menu.openBattle(names, self.runner ? self.runner.moveSlotsForMenu() : [],
                             self.runner ? self.runner.displayParty() : self.play.party);
        self.paintMenu();
      },
      chosenMove: () => self.moveChoice,
      // The SAFARI ZONE's four rows, in the cartridge's own order. The balls
      // are counted on the first one because they are a counter and not a bag
      // slot, so there is nowhere else for the player to read them.
      showSafariMenu: (ballsLeft: number) => {
        self.safariMenu = true;
        self.safariChoice = "";
        self.moveMenu = SAFARI_ROWS;
        self.moveChoice = -1;
        self.menu.openBattle(["BALL×" + ballsLeft, "BAIT", "ROCK", "RUN"],
                             [0, 1, 2, 3],
                             self.runner ? self.runner.displayParty() : self.play.party);
        self.paintMenu();
      },
      chosenSafari: () => self.safariChoice,
      hideMoves: () => {
        self.moveMenu = [];
        self.moveChoice = -1;
        self.safariMenu = false;
        self.safariChoice = "";
        self.menu.close();
        self.paintMenu();
        self.switchChoice = -1;
        self.bagItemChoice = "";
        self.bagTargetChoice = -1;
        self.bagMoveChoice = -1;
        // The run request is a REQUEST, not a setting. Leaving it latched means
        // a failed escape ("Can't escape!") re-offers the menu, the runner sees
        // the flag still set before it ever looks at a move, and the player
        // flees again -- and again -- without touching a button, until the
        // battle ends some other way.
        self.runRequested = false;
      },
      wantsToRun: () => self.runRequested,
      chosenSwitch: () => self.switchChoice,
      chosenBagItem: () => self.bagItemChoice,
      chosenBagTarget: () => self.bagTargetChoice,
      chosenBagMove: () => self.bagMoveChoice,
    };
  }

  /** Starts a battle and grows the diorama around it. */
  private startBattle(begin: (r: BattleRunner) => boolean): void {
    if (this.runner !== null) {
      return;
    }
    const runner = new BattleRunner(this.bundle, this.play, this.battleView());
    // Cleared BEFORE the runner may refuse: a refused start leaves runner null,
    // so battleOver() is true next frame, and battleWon() would otherwise report
    // the PREVIOUS battle -- a victory awarded for a fight that never happened.
    this.lastBattleWon = false;
    this.lastBattleCaught = false;
    this.victorySounded = false;
    if (!begin(runner)) {
      print("[PokemonAR] battle refused; nothing to send out");
      return;
    }
    this.runner = runner;
    // The music the fight is fought to, and the fanfare it will end on. Taken
    // from the runner rather than from the call site: four places start a
    // battle and only the runner knows what it turned into.
    this.battleRoleNow = battleRole(runner.isWild() ? "" : runner.trainer());
    if (this.jukebox) {
      this.jukebox.setOverride(this.jukebox.battleSong(this.battleRoleNow));
    }
    this.battleAnim.reset();
    if (this.isGameBoyMode()) {
      // The fight is the flat screen (paintGameBoyBattle): no arena, no
      // staging, no growth. The screen is already lit for the overworld.
      this.enteredBattleAtGameBoy = true;
    } else {
      // The arena is cleared either way: the pair needs open ground to stand
      // on whether you are looking down at the table or standing on it.
      this.enterArena();
      this.applyDiscStaging(false);
      if (this.wantsLifeSizeBattle()) {
        this.growToLifeSize();
      } else {
        this.frameBattleShot();
      }
    }
    if (this.play && this.play.options) this.play.options.battleAsked = true;

  }

  /**
   * The question, while it stands. Returns true if the fight must wait.
   *
   * Every cursor move restages the fight for real -- toggleBattleStaging is
   * what SELECT calls, and this calls the same thing -- so the three answers
   * are not described, they are shown.
   */
  private updateBattleStyle(dt: number): boolean {
    if (!this.battleStyle) {
      return false;
    }
    if (this.runner === null) {
      // The fight went away underneath the question: a refused start, a warp,
      // a reload. Nothing left to ask about.
      this.closeBattleStyle(false);
      return false;
    }
    const dpad = this.battleStylePad.step(this.input.dpad(), dt);
    const before = this.battleStyle.chosen();
    const answer = this.battleStyle.step(dpad, this.input.pressedA(), this.input.pressedStart());
    const now = this.battleStyle.chosen();
    if (now !== before) {
      // The same call SELECT makes, so the three answers are staged by the one
      // piece of code that knows how -- the discs, the framing, the life-size
      // grow. By value, not by steps: one press of left goes TABLE to LIFE.
      this.setBattleStaging(now);
    }
    if (answer === STYLE_DONE) {
      this.closeBattleStyle(true);
      return false;
    }
    // The panel itself has to be up; what goes ON it is painted by the one
    // painter, in updateMessagePanel.
    if (this.messagePanel) {
      this.messagePanel.setEnabled(true);
    }
    return true;
  }

  /** Puts the question away, and remembers that it was asked. */
  private closeBattleStyle(answered: boolean): void {
    this.battleStyle = null;
    this.battleStylePad = null;
    if (answered && this.play && this.play.options) {
      this.play.options.battleAsked = true;
      this.setStatus("BATTLE: " + BATTLE_LABELS[this.battleStaging()] + "  (SELECT changes it)");
    }
    // Left ENABLED: the fight's first line is about to arrive on this same
    // panel, and blinking it off and on again between the question and
    // "Wild PIDGEY appeared!" reads as the lens dropping a frame.
  }

  /**
   * Brings the arena to the wearer: the fight's own shot.
   *
   * Staging the fight where it happens and leaving the diorama alone is what
   * the 8 September preview did, and it put the pair 112 cm away at 6.7 cm
   * tall -- three and a half degrees, which reads as two specks on a table.
   * The reference gets its framing by dropping ITS camera next to the pair; we
   * cannot move the wearer, so the world comes to them instead.
   *
   * See BattleFraming for the shot itself and why each number is what it is.
   */
  private frameBattleShot(): void {
    if (!this.overworld || !this.arena || !this.camera || !this.battle.isIdle()) {
      return;
    }
    const map = this.overworld.map;
    const middle = this.arenaMiddleCell();
    const mx = -map.widthTiles / 2 + middle[0] * 2 + 1;
    const mz = -map.heightTiles / 2 + middle[1] * 2 + 1;
    const transform = this.camera.getTransform();
    const eye = transform.getWorldPosition();
    // A Lens Studio camera LOOKS along its own -Z while `forward` is +Z, which
    // is why growToLifeSize subtracts it too. Passing `forward` straight in
    // frames the fight behind the wearer's head.
    const ahead = transform.forward;
    const shot = frameBattle(
      this.arena.playerCell, this.arena.enemyCell,
      map.widthTiles, map.heightTiles, this.groundY(mx, mz),
      [eye.x, eye.y, eye.z], [-ahead.x, -ahead.y, -ahead.z],
      // Where the town is already standing. The fight happens THERE: the
      // wearer's placement is an instruction, not a starting point. See
      // BattleFraming's `rest`.
      //
      // The diorama's CENTRE, not its root. The root is where the scroll had
      // to push the mesh's origin to bring the player's cell under the anchor,
      // which on Route 17 is over three metres from the town -- and framing on
      // it is what the third playtest saw: "een gevecht gebeurt heel ergens
      // anders dan op de exacte locatie van waar de game zich hoort af te
      // spelen." See DioramaAnchor for the two positions and why only one of
      // them is a place.
      this.dioramaCentre()
    );
    this.battle.frameTo(
      new vec3(shot.position[0], shot.position[1], shot.position[2]),
      shot.yaw, shot.scale,
      {
        onEnterComplete: () => {},
        onExitComplete: () => {
          this.dioramaScale = this.battle.currentScale();
          this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");
        },
      }
    );
  }

  /**
   * SELECT, mid-fight: table to life-size and back, and the choice is kept.
   *
   * Writing the setting rather than a scratch flag is deliberate. A wearer who
   * grew the world once wants the next fight that way too, and the OPTION page
   * has to agree with what they are looking at -- a BATTLE row reading TABLE
   * while the wearer stands inside the world is the kind of quiet disagreement
   * that reads as a bug in the row.
   */
  private toggleBattleStaging(): void {
    // Battle presentation is configured explicitly in options, not on a stray SELECT.
  }

  /**
   * Stages the fight the way `next` asks, whatever it is staged as now.
   *
   * By value rather than by steps, because the first-fight question can jump
   * two rungs in one frame -- TABLE to LIFE is one press of left -- and walking
   * there by repeated toggles ran two transitions in a single frame. The second
   * found the stage mid-animation and did nothing coherent. Every pair composes
   * here: the discs go on or off, and then the stage is grown, shrunk or framed
   * once.
   */
  private setBattleStaging(next: number): void {
    if (this.play && this.play.options && this.play.options.view) {
      this.play.options.view.battle = next;
    }
    this.applyDiscStaging(next === BATTLE_DISCS);
    if (next === BATTLE_LIFE) {
      this.growToLifeSize();
    } else if (!this.battle.isIdle()) {
      // Coming down from life-size. The shrink's own callback puts the fight
      // back in its framing, so there is nothing more to do here.
      this.battle.exit();
    } else if (!this.battle.isFramed()) {
      this.frameBattleShot();
    }
    // Say which one, because two of the three look alike until you notice the
    // scenery has gone.
    this.setStatus("BATTLE: " + BATTLE_LABELS[next]);
  }

  /** Which rung of the BATTLE row is chosen. */
  private battleStaging(): number {
    const view = this.viewSettings();
    return view ? view.battle : BATTLE_TABLE;
  }

  /** Whether the OPTION page's BATTLE row asks for the life-size staging. */
  private wantsLifeSizeBattle(): boolean {
    return this.battleStaging() === BATTLE_LIFE;
  }

  /**
   * Puts the fight on two platforms and switches the terrain off, or undoes it.
   *
   * The terrain is a CHILD of the diorama root and the fight is not, so one
   * flag empties the world and leaves the pair, their HUD blocks and the
   * framing exactly where they were. That is the whole trick: the discs are not
   * a separate scene, they are the same scene with the scenery gone.
   */
  private applyDiscStaging(on: boolean): void {
    if (this.worldObject) {
      this.worldObject.enabled = !on;
    }
    if (!on) {
      if (this.discs) {
        this.discs.hide();
      }
      return;
    }
    if (!this.overworld || !this.arena || !this.dioramaRoot) {
      return;
    }
    if (!this.discs) {
      this.discs = new BattleDiscs(this.dioramaRoot, (colour: number[]) => this.discMaterial(colour));
    }
    const map = this.overworld.map;
    this.discs.show(this.arena.playerCell, this.arena.enemyCell,
                    map.widthTiles, map.heightTiles,
                    (x: number, z: number) => this.groundY(x, z));
  }

  /**
   * One white pixel, for anything that only wants a flat colour.
   *
   * The base material samples a texture whatever we do, so a quad without one
   * takes whatever was bound last -- which on 8 September would have been the
   * Game Boy screen.
   */
  private whitePixel(): Texture {
    if (!this.discTexture) {
      // createWithFormat, not create(): every other procedural texture in this
      // project is built this way and works on both 5.15 and 5.23.
      const texture = ProceduralTextureProvider.createWithFormat(
        1, 1, TextureFormat.RGBA8Unorm);
      (texture.control as ProceduralTextureProvider).setPixels(
        0, 0, 1, 1, new Uint8Array([255, 255, 255, 255]));
      this.discTexture = texture;
    }
    return this.discTexture;
  }

  /**
   * A shadow: black at partial alpha, over our own geometry.
   *
   * This is the one way a shadow can exist on an optical see-through display.
   * Black is transparent there -- the panel emits light, it cannot subtract it
   * -- so nothing can darken the real table. But blending black OVER terrain we
   * drew ourselves lowers the light that terrain gives off, and that reads
   * exactly as a shadow on it. Where there is no terrain the quad blends
   * against passthrough and disappears, which is the right answer too.
   */
  private shadowMaterial(alpha: number): Material {
    const material = this.baseMaterial.clone();
    const pass = material.mainPass;
    pass.baseTex = this.whitePixel();
    pass.baseColor = new vec4(0, 0, 0, alpha);
    pass.blendMode = BlendMode.Normal;
    pass.depthWrite = false;
    // Depth-TESTED: a shadow belongs on the ground it is cast on, and should be
    // hidden by anything standing between it and the eye.
    pass.depthTest = true;
    pass.twoSided = true;
    return material;
  }

  /** A flat, untextured colour for a platform. */
  private discMaterial(colour: number[]): Material {
    const material = this.baseMaterial.clone();
    const pass = material.mainPass;
    pass.baseTex = this.whitePixel();
    // Set on the CLONE every time: 5.15 resets a clone's values to the graph's
    // defaults, so a colour left on the asset never arrives.
    pass.baseColor = new vec4(colour[0], colour[1], colour[2], colour[3]);
    pass.blendMode = BlendMode.Normal;
    pass.depthWrite = true;
    pass.depthTest = true;
    pass.twoSided = true;
    return material;
  }

  /**
   * Grows the diorama until the wearer is standing in the fight.
   *
   * Split out of startBattle so SELECT can call it mid-battle. The pivot is the
   * middle of the PAIR rather than the player's own tile: the old pivot put the
   * two Pokemon off to one side once the growth landed, and the middle of the
   * two is what the wearer came to watch.
   */
  private growToLifeSize(): void {
    if (!this.overworld || !this.battle.isIdle()) {
      return;
    }
    const map = this.overworld.map;
    const middle = this.arenaMiddleCell();
    const pivotX = -map.widthTiles / 2 + middle[0] * 2 + 1;
    const pivotZ = -map.heightTiles / 2 + middle[1] * 2 + 1;
    const pivot = new vec3(pivotX, this.groundY(pivotX, pivotZ), pivotZ);
    let standing = new vec3(0, -FLOOR_DROP_CM, -STANDING_FORWARD_CM);
    if (this.camera) {
      const eye = this.camera.getTransform().getWorldPosition();
      const forward = this.camera.getTransform().forward;
      standing = new vec3(
        eye.x - forward.x * STANDING_FORWARD_CM,
        eye.y - FLOOR_DROP_CM,
        eye.z - forward.z * STANDING_FORWARD_CM
      );
    }
    this.battle.enter(pivot, standing, {
      onEnterComplete: () => {},
      onExitComplete: () => {
        if (this.runner !== null) {
          // SELECT, mid-fight, back down from life-size. The fight is still on,
          // so it wants its own shot rather than the plain tabletop -- and if
          // it never had one (the fight opened life-size) it gets one now.
          if (!this.battle.isFramed()) {
            this.frameBattleShot();
          }
          return;
        }
        // Life-size grew FROM the fight's framing, so shrinking lands back in
        // it rather than on the table. Unframe from there, and let that
        // transition restore the status line when it finishes.
        if (this.battle.isFramed()) {
          this.battle.unframe();
          return;
        }
        this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");
      },
    });
  }

  /**
   * Clears a patch of the map for the fight and takes the cast off it.
   *
   * "The arena is empty, and that is what makes it an arena" is the reference's
   * own line, and it is not decoration: an overworld full of people standing
   * about behind two Pokemon reads as a crowd scene rather than as a battle.
   * The cast is only HIDDEN -- nobody moves, so a trainer's dialogue afterwards
   * still comes from someone standing where they were.
   */
  private enterArena(): void {
    if (!this.overworld) {
      return;
    }
    // Finish the world BEFORE framing a fight on it.
    //
    // On a map bigger than the window, chunks trickle in a few a frame as the
    // player walks -- and the only thing driving that trickle is the overworld
    // update, which returns early the moment a battle is running. So a fight
    // that starts mid-walk freezes the terrain half-built, and the arena can be
    // standing on ground that was never made.
    //
    // Measured on 8 September, walking out of Pallet Town into Route 1's grass:
    // the built chunks covered local z -20..+20 and the arena was at z=+33.
    // The pair and their HUD blocks hung thirteen units past the edge of the
    // world, over nothing, which is exactly what the preview showed.
    if (this.terrain) {
      this.terrain.flush();
    }
    this.arena = findArena(this.overworld.map, this.overworld.cellX,
                           this.overworld.cellY, this.overworld.facing);
    const map = this.overworld.map;
    const middle = this.arenaMiddleCell();
    const mx = -map.widthTiles / 2 + middle[0] * 2 + 1;
    const mz = -map.heightTiles / 2 + middle[1] * 2 + 1;
    // Whether the terrain actually HAS ground there. surfaceY answers null when
    // the point is outside the built window, and groundY then guesses -- which
    // is how a fight ends up floating beside the world rather than on it. Say
    // so, rather than leaving it to be spotted in a screenshot.
    const onWorld = this.terrain !== null && this.terrain.surfaceY(mx, mz) !== null;
    print("[PokemonAR] arena: " + this.arena.shape +
          " yours " + this.arena.playerCell.join(",") +
          " theirs " + this.arena.enemyCell.join(",") +
          " at " + mx.toFixed(0) + "," + mz.toFixed(0) +
          (onWorld ? " on built ground" : " OFF THE BUILT WORLD -- terrain window too small"));
    if (this.npcRoot) {
      this.npcRoot.enabled = false;
    }
    if (this.playerObject) {
      this.playerObject.enabled = false;
    }
  }

  /** Puts the cast back and takes the pair off the field. */
  private leaveArena(): void {
    this.arena = null;
    if (this.battleActors) {
      this.battleActors.hide();
    }
    this.hideHudBlocks();
    this.hideBattleShadows();
    // The terrain comes back with the cast: a fight left on discs would hand
    // the wearer an empty world to walk around in.
    this.applyDiscStaging(false);
    if (this.npcRoot) {
      this.npcRoot.enabled = true;
    }
    // GAME BOY mode draws the player on its own screen and keeps this hidden;
    // restoring it there would put a billboard in an empty room.
    if (this.playerObject && !this.isGameBoyMode()) {
      this.playerObject.enabled = true;
    }
  }

  /** The cell between the two Pokemon: what the world grows around. */
  private arenaMiddleCell(): number[] {
    if (!this.arena) {
      return [this.overworld.cellX, this.overworld.cellY];
    }
    return [
      Math.round((this.arena.playerCell[0] + this.arena.enemyCell[0]) / 2),
      Math.round((this.arena.playerCell[1] + this.arena.enemyCell[1]) / 2),
    ];
  }

  /**
   * The pair, every frame a battle is running: whoever is out now, standing on
   * the arena's own cells, square to the wearer.
   */
  private updateBattleActors(): void {
    if (!this.runner || !this.arena || !this.dioramaRoot) {
      return;
    }
    // The PICTURES, not the species: a ghost nobody has identified is drawn
    // as the ghost, and falls back to its species in a bundle without one.
    const onField = this.runner.picturesOnField();
    if (onField.length !== 2) {
      return;
    }
    if (onField[1] === GHOST_PICTURE && !(this.bundle.pictures && this.bundle.pictures.ghost)) {
      onField[1] = this.runner.onField()[1];
    }
    if (!this.battleActors) {
      this.battleActors = new BattleActors(this.dioramaRoot, () => this.spriteMaterialClone());
    }
    // The SILPH SCOPE's fade. The runner says what the foe IS; the unveil says
    // what is on screen while the ghost washes out and the species washes back
    // in behind the white (play/battle/Unveil.ts). Every other change of foe
    // passes straight through it.
    this.unveil.step(Math.min(getDeltaTime(), 0.1), onField[1]);
    onField[1] = this.unveil.picture();
    this.battleActors.setWash(this.unveil.wash());
    // Real seconds, not the game's: a world running at 4x should not make a hit
    // too quick to see.
    const sides = this.runner.hudSides();
    if (sides.length === 2) {
      this.battleAnim.update(Math.min(getDeltaTime(), 0.1),
                             sides[0].hp, sides[0].maxHp, sides[1].hp, sides[1].maxHp);
      this.battleActors.setMotion(this.battleAnim.lungeReach(true),
                                  this.battleAnim.visible(true),
                                  this.battleAnim.lungeReach(false),
                                  this.battleAnim.visible(false));
    }
    const map = this.overworld.map;
    this.battleActors.show(this.bundle, this.arena, onField[0], onField[1],
                           map.widthTiles, map.heightTiles,
                           (x: number, z: number) => this.groundY(x, z));
    if (this.camera) {
      this.battleActors.faceCamera(this.camera.getTransform().getWorldPosition());
    }
    this.updateHudBlocks();
    this.updateBattleShadows();
  }

  /**
   * A dark patch under each fighter.
   *
   * Placed on the arena's own cells rather than under wherever a lunge has
   * carried the attacker: a shadow that slides with the swing reads as the
   * ground moving, and the cartridge's own lunge does not take the Pokemon off
   * the square it is standing on.
   */
  private updateBattleShadows(): void {
    if (!this.dioramaRoot || !this.arena || !this.overworld) {
      return;
    }
    if (this.battleShadows.length !== 2) {
      const make = (alpha: number) => this.shadowMaterial(alpha);
      this.battleShadows = [
        new GroundShadow(this.dioramaRoot, make, BATTLE_SHADOW_UNITS),
        new GroundShadow(this.dioramaRoot, make, BATTLE_SHADOW_UNITS),
      ];
    }
    const map = this.overworld.map;
    const cells = [this.arena.playerCell, this.arena.enemyCell];
    for (let i = 0; i < 2; i++) {
      const x = -map.widthTiles / 2 + cells[i][0] * 2 + 1;
      const z = -map.heightTiles / 2 + cells[i][1] * 2 + 1;
      this.battleShadows[i].placeLocal(x, this.groundY(x, z), z);
      this.battleShadows[i].setEnabled(true);
    }
  }

  /** Takes the fighters' shadows off the field. */
  private hideBattleShadows(): void {
    for (let i = 0; i < this.battleShadows.length; i++) {
      this.battleShadows[i].setEnabled(false);
    }
  }

  /**
   * The two HUD blocks, standing over the Pokemon they belong to.
   *
   * Built on the first battle rather than at startup: they need the message
   * panel's texture, and the panel is itself built lazily. Both are quads onto
   * that one texture -- nothing is uploaded here, and nothing is painted here
   * either; BattleHudScreen has already put both blocks on the canvas.
   */
  private updateHudBlocks(): void {
    if (!this.messagePanel || !this.dioramaRoot || !this.arena || !this.overworld) {
      return;
    }
    if (!this.hudMine) {
      const texture = this.messagePanel.sharedTexture();
      if (!texture) {
        return;
      }
      const make = (t: Texture) => this.readingMaterial(t);
      this.hudMine = new HudBlockView(this.dioramaRoot, texture, make,
                                      PLAYER_PLATE, HUD_BLOCK_UNITS);
      this.hudTheirs = new HudBlockView(this.dioramaRoot, texture, make,
                                        ENEMY_PLATE, HUD_BLOCK_UNITS);
      print("[PokemonAR] battle HUD: two blocks beside the pair");
    }
    const map = this.overworld.map;
    this.standHudBlock(this.hudMine, this.arena.playerCell, this.arena.enemyCell, map);
    this.standHudBlock(this.hudTheirs, this.arena.enemyCell, this.arena.playerCell, map);
    if (this.camera) {
      const eye = this.camera.getTransform().getWorldPosition();
      this.hudMine.faceCamera(eye);
      this.hudTheirs.faceCamera(eye);
      this.hudMine.keepInView(this.camera);
      this.hudTheirs.keepInView(this.camera);
    }
  }

  /**
   * Stands one block over the cell its Pokemon is on, pushed outward.
   *
   * Outward ALONG the line between the two, away from the other one, by its own
   * half width. That is what guarantees they cannot meet: however wide the
   * blocks are, their centres end up further apart than the blocks are wide.
   * Hanging both straight over their Pokemon put two panels 34 cm across on a
   * 22 cm gap, and they interleaved into something unreadable.
   *
   * It also lands where the cartridge puts them -- out at the corners, theirs
   * beyond and yours nearer -- rather than stacked over the middle of the fight.
   */
  private standHudBlock(block: HudBlockView, cell: number[], other: number[], map: any): void {
    if (!block || !cell) {
      return;
    }
    block.setWidthCm(HUD_BLOCK_CM, this.battle.currentScale());
    const x = -map.widthTiles / 2 + cell[0] * 2 + 1;
    const z = -map.heightTiles / 2 + cell[1] * 2 + 1;
    let outX = 0;
    let outZ = 0;
    if (other) {
      const ox = -map.widthTiles / 2 + other[0] * 2 + 1;
      const oz = -map.heightTiles / 2 + other[1] * 2 + 1;
      const dx = x - ox;
      const dz = z - oz;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length > 1e-6) {
        const push = block.halfWidthLocal();
        outX = dx / length * push;
        outZ = dz / length * push;
      }
    }
    // Clear of the Pokemon's own head, plus half the block, so the gap below it
    // is the gap you see rather than the block's centre line.
    const y = this.groundY(x, z) + BATTLE_MON_UNITS + HUD_BLOCK_LIFT_UNITS +
              block.halfHeightLocal();
    block.placeLocal(new vec3(x + outX, y, z + outZ));
    block.setEnabled(true);
  }

  /** Takes the blocks off the field. */
  private hideHudBlocks(): void {
    if (this.hudMine) {
      this.hudMine.setEnabled(false);
    }
    if (this.hudTheirs) {
      this.hudTheirs.setEnabled(false);
    }
  }

  /**
   * A material for a battling Pokemon: alpha-blended art, drawn over the world.
   *
   * depthTest is OFF, which is not the overworld's rule and should not be. A
   * character standing behind a house ought to be hidden by the house; the two
   * Pokemon in a fight are the subject, and in the 8 September preview a lab
   * bench cut a Charmander in half and a rug swallowed a Bulbasaur. Read from
   * the room that is a sprite glitching through the floor.
   *
   * Only reached by BattleActors, so nothing else changes behaviour with it.
   */
  private spriteMaterialClone(): Material {
    const material = this.baseMaterial.clone();
    const pass = material.mainPass;
    pass.baseColor = new vec4(1, 1, 1, 1);
    pass.blendMode = BlendMode.Normal;
    pass.depthWrite = false;
    pass.depthTest = false;
    pass.twoSided = true;
    PokemonAR.useNearestFiltering(pass);
    return material;
  }

  /** One frame of the battle that is running, if any. */
  private updateRunner(): void {
    if (this.runner === null) {
      return;
    }
    // The first fight's question freezes the FIGHT and nothing else: the pair
    // are staged, the HUD is up, and the world behind the box is the preview.
    if (this.battleStyle !== null) {
      return;
    }
    this.runner.update();
    // The runner has read the answer and moved on: the prompt can go. Held
    // until now on purpose -- clearing it the moment it closed would make
    // learnDecision() answer "keep what you have" for a move just chosen.
    if (this.battleLearnDone && this.runner.state() !== RUNNER_LEARNING) {
      this.battleLearn = null;
      this.battleLearnDone = false;
      this.battleLearnPainted = "";
      if (this.menuPanel) {
        this.menuPanel.setEnabled(false);
      }
    }
    // Whoever is out NOW: a faint, a switch or a capture changes the pair
    // without anything having to tell this.
    this.updateBattleActors();
    // The music turns at the FAINT, not at the last message box.
    //
    // The cartridge starts the victory theme the moment the opponent goes
    // down, and the "gained EXP" and "grew to level" lines are read over it.
    // We played it at RUNNER_DONE instead -- after the last box had closed --
    // so all of it landed on the overworld: a measured 12.6 seconds for a wild
    // or trainer win and 36.4 for a gym leader, of battle music following the
    // wearer down the road. That is "toen ik klaar was met de battle bleef het
    // geluid van de battle winnen doorgaan", and won() is true here because
    // BattleState.settleFaints finishes the battle before it queues the
    // experience lines.
    if (!this.victorySounded && this.runner.won() && this.jukebox) {
      this.victorySounded = true;
      this.jukebox.setOverride("");
      this.jukebox.playFanfare(
        this.jukebox.battleSong(victoryRole(this.battleRoleNow)));
    }
    if (this.runner.state() !== RUNNER_DONE) {
      return;
    }
    this.lastBattleWon = this.runner.won();
    this.lastBattleCaught = this.runner.caught();
    // Asked BEFORE the runner is dropped, and asked of the RUNNER rather than
    // worked out from the save. See BattleRunner.whiteout().
    const warpedHome = this.runner.whiteout();
    if (this.jukebox) {
      // The map's own music comes back either way. A win has already started
      // its fanfare above; a loss, a capture that got away and a successful
      // run all end here with the override still to give back.
      this.jukebox.setOverride("");
    }
    this.runner = null;
    this.moveMenu = [];
    this.runRequested = false;
    // Who grew enough to evolve. Asked AFTER the battle, which is when the
    // cartridge asks: the box has closed, the world is back, and B can stop it.
    // A fainted Pokemon is skipped, so a party wipe evolves nobody.
    this.evolutions = evolutionsDue(this.bundle, this.play.party);
    if (this.evolutions.length > 0) {
      print("[PokemonAR] evolving: " + this.evolutions.length + " ready");
    }
    // The cast comes back and the pair leaves the field before the world
    // shrinks, so the shrink is of a world with people in it again.
    this.leaveArena();
    if (!this.battle.isIdle()) {
      // Still standing life-size: shrink, and its own callback unframes after.
      this.battle.exit();
    } else if (this.battle.isFramed()) {
      this.battle.unframe();
    } else {
      // Nothing was moved for this fight, so nothing will finish and restore
      // the status line -- do it here, or the trainer's name stays in it.
      this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");
    }
    // A whiteout moved the player to their healing point, so the world has to
    // be rebuilt around where they now are.
    //
    // ONLY on a whiteout. This used to fire whenever play.mapId disagreed with
    // the overworld's, which is not the same question at all: play.mapId is
    // written by the twenty second autosave and by nothing else, so the two
    // disagree for most of any walk and permanently once the autosave is
    // blocked. One loss to the rival left the heal point sitting in play.mapId
    // and every wild encounter afterwards -- won, lost, caught, fled -- ended
    // with the player standing in Red's house. Three of the 8 September test
    // recordings end exactly that way.
    if (warpedHome) {
      // The runner wrote the heal point into play.mapId/cellX/cellY. Warp 1 of
      // that map is the door mat, not the heal point; stand where the save says.
      this.overworld.enterMapAt(this.play.mapId, this.play.cellX, this.play.cellY, "down");
      this.rebuildDiorama();
    }
  }

  /** True while the evolution sequence owns the frame. */
  private isEvolving(): boolean {
    return this.evolving !== null || this.evolveLearn !== null ||
      this.evolutions.length > 0;
  }

  /**
   * One frame of "What? X is evolving!", and everything it drags with it.
   *
   * Three states in sequence, all of them the cartridge's: the evolution
   * itself, then any move the NEW species learns at this level, then the next
   * party member. B on the first page stops one evolution and only that one --
   * the cartridge asks again after the next battle, and nothing here remembers
   * the refusal.
   */
  private driveEvolution(dt: number): void {
    if (this.evolveLearn !== null) {
      this.driveEvolveLearn(dt);
      return;
    }
    if (this.evolving === null) {
      if (this.evolutions.length === 0) {
        return;
      }
      const due = this.evolutions.shift();
      const mon = this.play.party[due.index];
      // The party may have changed under us -- a script, a deposit -- between
      // the battle ending and this running. Only evolve what is still there.
      if (!mon || mon.species !== due.from) {
        return;
      }
      this.evolvingIndex = due.index;
      this.evolving = new EvolutionController(this.bundle, mon.name, due.to);
      this.paintEvolution();
      return;
    }

    const outcome = this.evolving.step(this.input.dpad(), this.input.pressedA(),
                                       this.input.pressedB(), dt);
    this.paintEvolution();
    if (outcome !== EVOLVE_CLOSED) {
      return;
    }
    const evolved = this.evolving.evolved();
    const into = this.evolving.into();
    this.evolving = null;
    this.evolvePainted = "";
    if (!evolved) {
      print("[PokemonAR] evolution stopped");
      this.closeEvolutionBox();
      return;
    }
    this.applyEvolution(this.evolvingIndex, into);
  }

  /** The species change, the dex, and the moves that come with it. */
  private applyEvolution(index: number, into: string): void {
    const before = this.play.party[index];
    const after = evolve(this.bundle, before, into);
    this.play.party[index] = after;
    const def = this.bundle.species ? this.bundle.species[into] : null;
    if (def && typeof def.dex === "number") {
      markOwned(this.play, def.dex);
    }
    print("[PokemonAR] " + before.species + " evolved into " + into +
          " (HP " + after.hp + "/" + after.maxHp + ")");
    // The cartridge checks the NEW species' learnset at the CURRENT level on
    // the same breath, so a stage that learns something at exactly its
    // evolution level does not wait for the next one.
    this.evolveMoves = movesOnEvolution(this.bundle, into, after.level);
    this.nextEvolveMove();
  }

  /**
   * The next move the evolution offers: learned outright, or a prompt.
   *
   * Same controller the level-up uses, for the same reason -- it is the same
   * question, and the cartridge asks it in the same words.
   */
  /**
   * Hand a finished item use its screens: LearnMoveFromLevelUp for the new
   * level, through the same queue an evolution's moves take, then the
   * evolution itself through the same queue a battle's take. The cartridge
   * runs them in exactly this order after a RARE CANDY (.useRareCandy:
   * LearnMoveFromLevelUp, then TryEvolvingMon).
   */
  private settleItemUse(): void {
    const used = this.pendingItemUse;
    this.pendingItemUse = null;
    if (used.evolveTo !== "" && used.evolveIndex >= 0) {
      const mon = this.play.party[used.evolveIndex];
      if (mon) {
        this.evolutions.push({ index: used.evolveIndex, from: mon.species, to: used.evolveTo });
      }
    }
    if (used.learn.length > 0 && used.learnIndex >= 0 && this.play.party[used.learnIndex]) {
      this.evolvingIndex = used.learnIndex;
      this.evolveMoves = used.learn.slice();
      this.nextEvolveMove();
    }
  }

  private nextEvolveMove(): void {
    while (this.evolveMoves.length > 0) {
      const moveId = this.evolveMoves.shift();
      const mon = this.play.party[this.evolvingIndex];
      const learned = learnMove(this.bundle, mon, moveId);
      if (learned.outcome === LEARN_NEEDS_ROOM) {
        this.evolveLearnMove = moveId;
        this.evolveLearn = new MoveLearnController(this.bundle, mon, moveId);
        this.evolvePainted = "";
        this.paintEvolution();
        return;
      }
      if (learned.slot >= 0) {
        this.play.party[this.evolvingIndex] = learned.mon;
        print("[PokemonAR] and learned " + moveId);
      }
    }
    this.closeEvolutionBox();
  }

  private driveEvolveLearn(dt: number): void {
    const outcome = this.evolveLearn.step(this.input.dpad(), this.input.pressedA(),
                                          this.input.pressedB(), dt);
    this.paintEvolution();
    if (outcome !== LEARN_CLOSED) {
      return;
    }
    const slot = this.evolveLearn.decision();
    if (slot >= 0) {
      const replaced = replaceMove(this.bundle, this.play.party[this.evolvingIndex],
                                   slot, this.evolveLearnMove);
      if (replaced.slot >= 0) {
        this.play.party[this.evolvingIndex] = replaced.mon;
      }
    }
    this.evolveLearn = null;
    this.evolveLearnMove = "";
    this.evolvePainted = "";
    // A species can learn two moves at one level; the loop picks the next up.
    this.nextEvolveMove();
  }

  /** Puts the box and the list away once the whole sequence is finished. */
  private closeEvolutionBox(): void {
    this.evolvingIndex = -1;
    this.evolveMoves = [];
    this.evolvePainted = "";
    if (this.evolutions.length > 0) {
      // The next one opens its own box on the next frame.
      return;
    }
    if (this.menuPanel) {
      this.menuPanel.setEnabled(false);
    }
    if (this.messagePanel) {
      this.panelBoxOpen = false;
      this.messagePanel.setEnabled(false);
    }
    if (this.box) {
      this.box.setEnabled(false);
    }
    this.pageWaiting = false;
  }

  /** The sequence's page, and the move list when one is up. Change-guarded. */
  private paintEvolution(): void {
    const source: any = this.evolveLearn !== null ? this.evolveLearn : this.evolving;
    if (source === null) {
      return;
    }
    const rows: string[] = source.rows();
    const lines: string[] = source.lines();
    const signature = rows.join("|") + "#" + source.cursorRow() +
      "#" + (lines === null ? "" : lines.join("|"));
    if (signature === this.evolvePainted) {
      return;
    }
    this.evolvePainted = signature;
    if (this.menuPanel) {
      if (rows.length > 0) {
        this.menuPanel.setRows(rows);
        this.menuPanel.setCursorRow(source.cursorRow());
        this.menuPanel.setEnabled(true);
      } else {
        this.menuPanel.setEnabled(false);
      }
    }
    if (lines !== null) {
      this.presentPage(lines);
      this.pageAcked = false;
    }
  }

  /**
   * The intro's name_entry routine: opens the naming screen and holds the
   * script until it closes, then writes the name into the save. Without the
   * boot screens (an old bundle) the preset stands, as it always did.
   *
   * During the intro itself (introStage non-null) player and rival get two
   * things a nickname never does, measured in tools/oracle/INTRO.md's "two
   * corrections": the portrait slides right to make room for the list and
   * back once picked, and a one-page acknowledgement (the report's
   * ackTextIds) before the routine hands the frame back to OAK_SPEECH.
   */
  private nameEntry(who: string): number {
    if (!this.naming) {
      if (!this.gbFont || !this.screen || !this.canvas) {
        return DONE;
      }
      const field: any = this.bundle.field;
      const presets = field && field.presetNames && field.presetNames[who]
        ? field.presetNames[who]
        : (who === "rival" ? ["BLUE", "GARY", "JOHN"] : ["RED", "ASH", "JACK"]);
      if (who.indexOf("party:") === 0) {
        // A Pokemon's nickname: no presets, ten letters, as the cartridge's
        // NICKNAME? screen.
        this.naming = new NamingController("NICKNAME?", [], NICKNAME_MAX_LENGTH);
      } else {
        this.naming = new NamingController(who === "rival" ? "RIVAL's NAME?" : "YOUR NAME?",
                                           presets, NAME_MAX_LENGTH);
      }
      this.namingAckShown = false;
      if (this.introStage && PokemonAR.isIntroNaming(who)) {
        this.introStage.slideListOpen();
      }
      this.handBackScreen(true);
      this.paintedVersion = -1;
      print("[PokemonAR] naming: " + who);
      return SUSPENDED;
    }
    if (this.naming.isOpen()) {
      return SUSPENDED;
    }
    const introAck = this.introStage !== null && PokemonAR.isIntroNaming(who);
    if (introAck && !this.namingAckShown) {
      // The pick just closed the list/grid: write it, slide the portrait
      // back, and load the one-page acknowledgement -- driveIntro's own ack
      // loop (the same one every show_text page uses) advances it from here.
      print("[PokemonAR] named " + who + " " + this.applyNamingResult(who));
      this.introStage.slideListClosed();
      const ackId = who === "rival" ? ACK_TEXT_ID_RIVAL : ACK_TEXT_ID_PLAYER;
      const body = this.bundle.text ? this.bundle.text[ackId] : null;
      if (body && this.introBox) {
        this.introBox.show(pagesOf(body, this.play, "", -1));
      }
      this.namingAckShown = true;
      this.setScreenEnabled(true);
      return SUSPENDED;
    }
    if (introAck) {
      const boxDone = !this.introBox || !this.introBox.isOpen();
      if (!this.introStage.isListSlideSettled() || !boxDone) {
        return SUSPENDED;
      }
    } else {
      print("[PokemonAR] named " + who + " " + this.applyNamingResult(who));
    }
    this.naming = null;
    this.namingAckShown = false;
    // The intro's own naming leaves the screen on: OAK_SPEECH keeps going
    // (the rival's own naming, OakSpeechText3, the shrink) on the same
    // canvas. The nickname/fallback path -- which briefly borrows the screen
    // while the world already exists -- hands it back.
    if (!introAck) {
      if (this.isGameBoyMode()) this.setScreenEnabled(true);
      else this.handBackScreen();
    }
    return DONE;
  }

  /** "player" or "rival": the intro's own two names, which get the slide and the ack page. */
  private static isIntroNaming(who: string): boolean {
    return who === "player" || who === "rival";
  }

  /** Writes the naming screen's result into the save; "" leaves the preset default standing. */
  private applyNamingResult(who: string): string {
    const name = this.naming.result();
    if (name !== "") {
      if (who === "rival") {
        this.play.rivalName = name;
      } else if (who.indexOf("party:") === 0) {
        // "party:last" is a Pokemon just received; "party:<n>" is the one the
        // NAME RATER was shown (Keepers.ts).
        const party = this.play.party;
        const asked = parseInt(who.substring("party:".length), 10);
        const index = isNaN(asked) ? party.length - 1 : asked;
        if (index >= 0 && index < party.length) {
          party[index].name = name;
        }
      } else {
        this.play.playerName = name;
      }
    }
    return name;
  }

  private driveNaming(dt: number): void {
    this.naming.step(this.input.dpad(), this.input.pressedA(), this.input.pressedB(),
                     this.input.pressedStart(), this.input.pressedSelect(), dt);

  }

  /**
   * One frame of bootPhase "intro" or "onboarding": OAK_SPEECH running on
   * the canvas, or the "HOW DO YOU WANT TO PLAY?" page after its last fade.
   * See SPEC.md "The intro on the Game Boy screen -- design" and "The
   * onboarding page -- design".
   */
  private driveIntro(dt: number): void {
    if (this.screen) {
      this.placeScreen(dt);
    }
    if (this.bootPhase === "onboarding") {
      this.driveOnboarding(dt);
      return;
    }
    const pressedA = this.input.pressedA();
    const pressedB = this.input.pressedB();
    // Whichever canvas controller is open gets the input: the text box (A/B
    // acknowledge, only once ready()) first, else the naming screen.
    if (this.introBox.isOpen()) {
      if (this.introBox.ready() && (pressedA || pressedB)) {
        this.introBox.ack();
        this.pageAcked = true;
      } else if (pressedA || pressedB) {
        // Same as the overworld box: a press while the line is still arriving
        // fills it in. The intro is the longest stretch of text in the lens
        // and the one a returning player least wants to sit through.
        this.introBox.hurry();
      }
    } else if (this.naming) {
      this.naming.step(this.input.dpad(), pressedA, pressedB, this.input.pressedStart(),
                       this.input.pressedSelect(), dt);
    }
    this.loop.update();
    // intro_stage and name_entry both return DONE/SUSPENDED synchronously in
    // Host.ts's call(), so nothing else steps these animations forward --
    // see IntroStage and CanvasTextBox's own step(frames) contracts.
    this.introStage.step(this.speed());
    this.introBox.step(this.speed());
    // The shrink starts once OakSpeechText3's own last page is up and ready,
    // concurrent with that page rather than a step of its own (INTRO.md
    // "The shrink").
    if (!this.introShrinkStarted && this.introTextIndex === INTRO_TEXT_IDS.length - 1 &&
        this.introBox.isOpen() && this.introBox.ready() &&
        this.introBox.pageIndex() === this.introTextPages.length - 1) {
      this.introStage.startShrink();
      this.introShrinkStarted = true;
    }
    this.paintIntro();
  }

  /** One frame of the onboarding page; a pick builds the world (completeIntro). */
  private driveOnboarding(dt: number): void {
    // OnboardingController wants the already edge-triggered move ("up" /
    // "down" / ""), the same shape BootMenuController derives from its own
    // DPadEdge -- unlike NamingController, it does not keep one itself.
    const moved = this.onboardingPad.step(this.input.dpad(), dt);
    const result = this.onboarding.step(moved, this.input.pressedA(),
                                        this.input.pressedB(), this.input.pressedStart());
    if (result !== "") {
      this.play.playMode = result;
      print("[PokemonAR] mode picked: " + result);
      this.completeIntro();
      return;
    }
    this.paintIntro();
  }

  /**
   * Draws whichever of the intro's canvas controllers is current, and
   * uploads it under IntroStage's own palette -- the BGP-style ramp SPEC.md
   * calls for, through the row-palette callback screen.upload already takes.
   *
   * The naming grid takes the WHOLE screen (INTRO.md's own beat 25); its
   * preceding preset list does not, so the portrait and the still-open text
   * box (INTRO.md beat 90: the question stays up underneath the list) stay
   * visible behind it -- naming.paintPresets() draws only its own rectangle.
   */
  private paintIntro(): void {
    this.canvas.clear(0);
    if (this.bootPhase === "onboarding") {
      this.onboarding.paint(this.canvas, this.gbFont);
    } else if (this.naming && this.naming.isOpen() && this.naming.inGrid()) {
      this.naming.paint(this.canvas, this.gbFont);
    } else {
      this.introStage.paint(this.canvas);
      this.introBox.paint(this.canvas, this.gbFont);
      if (this.naming && this.naming.isOpen()) {
        this.naming.paintPresets(this.canvas, this.gbFont);
      }
    }
    this.screen.upload(this.canvas, () => PokemonAR.bgpPalette(this.introStage.bgp()));
  }

  /**
   * The intro's own `show_text`: PlayHost calls this once per PAGE, but
   * CanvasTextBox wants a whole text's pages up front (one show() per
   * show_text op, so its own hard-clear and cont-scroll timings hold -- see
   * CanvasTextBox.ts's header). So only the FIRST page of a new text loads
   * it, found by position in INTRO_TEXT_IDS since HostServices.showLines
   * carries only lines, never the text id; PlayHost's own later calls for
   * that text's later pages are pure polling from here on -- introBox and
   * the ack loop in driveIntro() advance them together (see showLines in
   * hostServices() for how self.pageAcked stays in step with both).
   */
  private showIntroLines(lines: string[]): void {
    if (this.introTextOpen) {
      return;
    }
    this.introTextIndex++;
    const textId = this.introTextIndex >= 0 && this.introTextIndex < INTRO_TEXT_IDS.length
      ? INTRO_TEXT_IDS[this.introTextIndex] : "";
    const body = textId && this.bundle.text ? this.bundle.text[textId] : null;
    // The fallback (no direct text) should not happen for OAK_SPEECH's own
    // six texts; showing at least the one page PlayHost already computed
    // beats a blank box if a future edit ever adds a seventh.
    this.introTextPages = body ? pagesOf(body, this.play, "", -1) : [lines];
    this.introBox.show(this.introTextPages);
    this.introTextOpen = true;
  }

  /**
   * OAK_SPEECH's own `warp`, reached before the world exists: remembers the
   * destination and opens the onboarding page instead of moving a player
   * who is not there yet (SPEC.md "The intro on the Game Boy screen --
   * design", the `warp` row). completeIntro() builds the world there once a
   * mode is picked.
   */
  private beginOnboarding(mapId: string, x: number, y: number, facing: string): void {
    this.pendingWarp = { mapId: mapId, x: x, y: y, facing: facing };
    this.onboarding = new OnboardingController();
    this.onboardingPad = new DPadEdge();
    this.bootPhase = "onboarding";
    this.paintedVersion = -1;
    print("[PokemonAR] onboarding");
  }

  /**
   * The onboarding page's own pick: builds the world at the intro's warp
   * destination, the way NEW GAME always has past this point, then lets the
   * parked VM finish (the `fade in` it is sitting on, then the closing
   * `set_flag`) on the next ordinary frame through the normal isBusy() path.
   */
  private completeIntro(): void {
    const to = this.pendingWarp;
    const mapId = to ? to.mapId : this.startMap;
    const x = to && to.x >= 0 ? to.x : this.startCellX;
    const y = to && to.y >= 0 ? to.y : this.startCellY;
    this.overworld = new Overworld(this.bundle, mapId, x, y, null);
    if (to && to.facing) {
      this.overworld.facing = to.facing;
    }
    this.overworld.surfing = this.play.surfing === true;
    this.overworld.riding = this.play.riding === true;
    this.overworld.darkened = this.play.darkened === true;
    this.overworld.steps = this.play.steps;
    this.buildDialogueBox();
    this.loop.attach(this.overworld);
    this.loop.bindWorld(this.overworld);
    this.overworld.lastMapId = this.play.lastMapId ? this.play.lastMapId : "";
    this.loop.stepped(this.overworld.map.def, this.overworld.cellX, this.overworld.cellY);
    this.menu = new MenuController(this.bundle, this.play);
    this.rebuildDiorama();
    this.lastAppliedPlayMode = this.play.playMode;
    this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");

    this.introStage = null;
    this.introBox = null;
    this.onboarding = null;
    this.onboardingPad = null;
    this.pendingWarp = null;
    this.naming = null;
    this.bootPhase = "";
    if (this.jukebox) {
      // The other way out of the boot: the onboarding page, after the intro.
      this.jukebox.resume();
    }
    // GAME BOY mode's rebuildDiorama() call above already turned the screen
    // ON for the overworld it now owns; only DIORAMA hands it back off.
    this.handBackScreen();
  }

  /** BGP's own colour mapping (bits 1-0 -> colour 0, 3-2 -> colour 1, ...), as grey. */
  private static bgpPalette(bgp: number): number[][] {
    const out: number[][] = [];
    for (let colour = 0; colour < 4; colour++) {
      out.push(DMG_GREYS[(bgp >> (colour * 2)) & 3]);
    }
    return out;
  }

  /**
   * push_screen DexEntryMenu: opens the Pokedex data page and holds the
   * script until it closes, the same shape as nameEntry() above.
   */
  private dexEntry(species: string): number {
    if (!this.dexEntryScreen) {
      if (!this.gbFont || !this.screen || !this.canvas || !this.bundle.species ||
          !this.bundle.species[species]) {
        return DONE;
      }
      this.dexEntryScreen = new DexEntryController(this.bundle, species);
      this.setScreenEnabled(true);
      this.paintedVersion = -1;
      print("[PokemonAR] dex entry: " + species);
      return SUSPENDED;
    }
    if (this.dexEntryScreen.isOpen()) {
      return SUSPENDED;
    }
    this.dexEntryScreen = null;
    // GAME BOY mode keeps the screen on for the overworld underneath it.
    this.handBackScreen();
    return DONE;
  }

  /**
   * The museum's fossils and the bird through the binoculars: the script is
   * suspended while the picture and its caption are up, exactly as dexEntry()
   * suspends it for a Pokedex page.
   */
  private picture(key: string, pages: string[][]): number {
    if (!this.pictureScreen) {
      if (!this.gbFont || !this.screen || !this.canvas) {
        return DONE;
      }
      this.pictureScreen = new PictureController(this.bundle, key, pages);
      this.setScreenEnabled(true);
      this.paintedVersion = -1;
      print("[PokemonAR] picture: " + key);
      return SUSPENDED;
    }
    if (this.pictureScreen.isOpen()) {
      return SUSPENDED;
    }
    this.pictureScreen = null;
    // GAME BOY mode keeps the screen on for the overworld underneath it.
    this.handBackScreen();
    return DONE;
  }

  private drivePictureScreen(dt: number): void {
    if (this.screen) {
      this.placeScreen(dt);
    }
    this.pictureScreen.step(this.input.pressedA());
    if (this.pictureScreen.stateVersion() !== this.paintedVersion) {
      this.paintedVersion = this.pictureScreen.stateVersion();
      this.pictureScreen.paint(this.canvas, this.gbFont);
      this.screen.upload(this.canvas, () => DMG_GREYS);
    }
  }

  /** One frame at a slot machine: buttons in, reels and box out. */
  private driveSlots(dt: number): void {
    if (this.screen) {
      this.placeScreen(dt);
    }
    const outcome = this.slots.step(this.input.dpad(), this.input.pressedA(),
                                    this.input.pressedB(), dt);
    const sound = this.slots.takeSound();
    if (sound !== "" && this.jukebox) {
      this.jukebox.playNamed(sound);
    }
    if (this.slots.stateVersion() !== this.paintedVersion) {
      this.paintedVersion = this.slots.stateVersion();
      this.slots.paint(this.canvas, this.gbFont);
      this.screen.upload(this.canvas, () => DMG_GREYS);
    }
    if (outcome === SLOTS_CLOSED) {
      this.slots = null;
    }
  }

  private driveDexEntryScreen(dt: number): void {
    if (this.screen) {
      this.placeScreen(dt);
    }
    this.dexEntryScreen.step(this.input.pressedA());
    if (this.dexEntryScreen.stateVersion() !== this.paintedVersion) {
      this.paintedVersion = this.dexEntryScreen.stateVersion();
      this.dexEntryScreen.paint(this.canvas, this.gbFont);
      this.screen.upload(this.canvas, () => DMG_GREYS);
    }
  }

  /**
   * One page of text on screen, and in the log.
   *
   * The log line is not a courtesy: it is the only way a headless run of the
   * preview -- a person watching the log, an agent driving keys -- knows what
   * the game just said, and whether a D-pad press that moved nothing was
   * ignored or merely waiting behind this page.
   */
  /**
   * The cartridge's YES/NO box, for as long as a script waits on an answer.
   *
   * DIORAMA mode had no yes/no at all -- A meant yes, B meant no, and nothing
   * was drawn, so a wearer asked whether to name a Pokemon pressed a button on
   * faith. The box only goes up once the question has finished printing, which
   * is the cartridge's own rule, and the panel grows to show it because the box
   * sits ABOVE the message box rather than inside it.
   *
   * GAME BOY mode keeps A and B on their own: its screen is the cartridge's
   * whole frame and its own box belongs there, which is its own step.
   */
  private driveAnswer(textReady: boolean, pressedA: boolean, pressedB: boolean,
                      dt: number): void {
    if (!textReady) {
      // A question's own text arrives letter by letter like any other, and it
      // was the ONE page a press could not hurry: this branch is taken instead
      // of the overworld's, and it used to return here without looking at the
      // buttons. So the one page a player is waiting on -- because it wants an
      // answer -- was the one they had to sit through.
      if ((pressedA || pressedB) && !this.isGameBoyMode() && this.panelTextBox) {
        if (this.panelTextBox.hurry() && this.jukebox) {
          this.jukebox.playEffect(SFX_PRESS_AB);
        }
      }
      return;
    }
    // Nothing can be DRAWN without the cartridge's font, and a question nobody
    // can see still has to be answerable: A is yes, B is no. That branch used
    // to be taken in GAME BOY mode too, so the nickname question was invisible
    // there by construction -- the 7 September playtest's "keuzemenu's niet
    // zichtbaar", one of its two causes.
    const canDraw = this.gbFont !== null &&
      (this.isGameBoyMode() ? this.canvas !== null : this.messagePanel !== null);
    if (!canDraw) {
      if (pressedA) {
        this.answerGiven = ANSWER_YES;
      } else if (pressedB) {
        this.answerGiven = ANSWER_NO;
      }
      return;
    }
    if (!this.choiceBox) {
      this.choiceBox = new CanvasChoiceBox(false);
      this.choiceEdge.reset();
      if (this.messagePanel) {
        // From the box's own top row to the bottom of the screen: the question
        // and the choice, and nothing above them. The flat screen already shows
        // the whole screen, so it needs no crop.
        this.messagePanel.setCropRows(CHOICE_TY, SCREEN_ROWS - CHOICE_TY);
      }
      return;
    }
    const move = this.choiceEdge.step(this.input.dpad(), dt);
    this.choiceBox.step(move, pressedA, pressedB, this.speed());
    const answer = this.choiceBox.answer();
    if (answer === CHOICE_PENDING) {
      return;
    }
    this.answerGiven = answer === CHOICE_YES ? ANSWER_YES : ANSWER_NO;
    this.closeChoiceBox();
  }

  /** Puts the panel back to the message box alone. Safe to call twice. */
  private closeChoiceBox(): void {
    if (!this.choiceBox) {
      return;
    }
    this.choiceBox = null;
    if (this.messagePanel) {
      this.messagePanel.setFull(false);
    }
  }

  private presentPage(lines: string[]): void {
    if (this.messagePanel) {
      // One page at a time, as its own little book: PlayHost hands pages down
      // one by one, exactly as it does for GAME BOY mode's own box (see
      // presentGameBoyPage).
      if (!this.panelTextBox) {
        this.panelTextBox = new CanvasTextBox(this.play ? this.play.options.textSpeed : 3);
      }
      this.panelTextBox.show([lines]);
      if (!this.panelBoxOpen) {
        // Placed at the moment it opens and then left alone: the wearer is
        // looking at the world just now, so this is where they will read it.
        this.messagePanel.snapTo(this.camera);
      }
      this.panelBoxOpen = true;
      this.messagePanel.setEnabled(true);
    } else if (this.box) {
      this.box.setLines(lines);
      this.box.setEnabled(true);
    }
    this.pageWaiting = true;
    print("[PokemonAR] page: " + lines.join(" | "));
  }

  /**
   * The lens's side of the ScriptHost port.
   *
   * PlayHost is pure logic; everything that needs a SceneObject is here. Each of
   * these is small on purpose -- what a page of text or a fade IS belongs to the
   * host, and only how to draw it belongs to the lens.
   */
  private hostServices(): HostServices {
    const self = this;
    return {
      // Before the world exists (the intro, running with no overworld
      // attached -- see beginIntro) these two route to the canvas box
      // instead of the HUD one; every other call below that touches
      // self.overworld is never reached in that window, since OAK_SPEECH
      // uses none of them (see the audit in beginIntro's own comment).
      showLines: (lines: string[]) => {
        if (self.overworld === null) {
          self.showIntroLines(lines);
        } else if (self.isGameBoyMode()) {
          // SPEC.md "GAME BOY mode -- design": the overworld's own message
          // box goes through CanvasTextBox on the canvas, not the pad's HUD.
          self.presentGameBoyPage(lines);
        } else {
          self.presentPage(lines);
        }
        self.pageAcked = false;
      },
      pageAcknowledged: () => self.pageAcked,
      closeBox: () => {
        if (self.overworld === null) {
          self.introTextOpen = false;
        } else if (self.isGameBoyMode()) {
          self.gbBoxOpen = false;
        } else if (self.messagePanel) {
          self.panelBoxOpen = false;
          self.closeChoiceBox();
          self.messagePanel.setEnabled(false);
        } else if (self.box) {
          self.box.setEnabled(false);
        }
        self.pageWaiting = false;
        self.answerWanted = false;
        self.answerGiven = ANSWER_PENDING;
      },
      requestAnswer: () => {
        self.answerWanted = true;
        self.answerGiven = ANSWER_PENDING;
      },
      answer: () => self.answerGiven,

      currentMap: () => self.overworld ? self.overworld.map.def : null,
      facePlayer: () => {
        // The NPC being spoken to turns toward the player: the opposite of the
        // way the player faces.
        if (self.talkTarget && self.talkTarget.kind === "object") {
          const f = self.overworld.facing;
          const toward = f === "up" ? "down" : f === "down" ? "up" : f === "left" ? "right" : "left";
          self.npcMotion.face(self.talkTarget.name, self.talkTarget.x, self.talkTarget.y, toward);
          self.placeNpc(self.talkTarget.name, self.npcMotion.pose(self.talkTarget.name));
        }
      },
      faceNpc: (npc: string, direction: string) => {
        const shipped = self.shippedCell(npc);
        if (shipped) {
          self.npcMotion.face(npc, shipped[0], shipped[1], direction);
          self.placeNpc(npc, self.npcMotion.pose(npc));
        }
      },
      npcPose: (npc: string) => self.npcMotion.pose(npc),
      emote: (npc: string, kind: string) => {
        // Its own flag, not the holder: in GAME BOY mode the NPC has no
        // holder, showEmote puts nothing up, and reading "nothing up" as
        // "not started yet" re-armed the timer every time it ran out. The
        // rival's "!" over the Eevee ball never ended (19 September).
        if (!self.emoteRunning) {
          self.showEmote(npc, kind);
          self.emoteUntil = getTime() + EMOTE_SECONDS;
          self.emoteRunning = true;
          return RUNNING;
        }
        if (getTime() < self.emoteUntil) {
          return RUNNING;
        }
        self.hideEmote();
        self.emoteRunning = false;
        return DONE;
      },
      // The loop has already written the save's toggle; this only redraws.
      setNpcRevealed: () => {
        self.rebuildNpcs();
      },
      moveNpc: (npc: string, path: string[]) => self.requestNpcWalk(npc, path),
      movePlayer: (direction: string, steps: number) => {
        if (!self.walkPending) {
          self.overworld.walkScripted(direction, steps);
          self.walkPending = true;
          return RUNNING;
        }
        if (self.overworld.isWalkingScripted()) {
          return RUNNING;
        }
        self.walkPending = false;
        return DONE;
      },
      facePlayerDir: (direction: string) => {
        self.overworld.facing = direction;
      },
      walkNpc: (npc: string, direction: string, steps: number) => {
        const path: string[] = [];
        for (let i = 0; i < steps; i++) {
          path.push(direction);
        }
        return self.requestNpcWalk(npc, path);
      },
      placeNpc: (npc: string, x: number, y: number, facing: string) => {
        self.npcMotion.place(npc, x, y, facing);
        if (self.overworld) {
          self.overworld.map.moveObject(npc, x, y);
        }
        // Only a drawn NPC has a holder to move; a hidden one is seated from
        // this pose when show_object rebuilds the cast.
        self.placeNpc(npc, self.npcMotion.pose(npc));
      },
      moveNpcTo: (npc: string, x: number, y: number) => {
        const shipped = self.shippedCell(npc);
        if (!shipped) {
          return DONE;
        }
        const pose = self.npcMotion.pose(npc);
        const fromX = pose ? pose.x : shipped[0];
        const fromY = pose ? pose.y : shipped[1];
        return self.requestNpcWalk(npc, self.npcMotion.pathTo(fromX, fromY, x, y));
      },
      warp: (mapId: string, warpIndex: number) => {
        if (self.overworld === null) {
          self.beginOnboarding(mapId, -1, -1, "");
          return;
        }
        self.overworld.takeWarp({ destMap: mapId, destWarp: warpIndex });
        self.rebuildDiorama();
      },
      warpTo: (mapId: string, x: number, y: number, facing: string) => {
        if (self.overworld === null) {
          self.beginOnboarding(mapId, x, y, facing);
          return;
        }
        self.overworld.enterMapAt(mapId, x, y, facing);
        self.rebuildDiorama();
      },

      openShop: (stock: string[]) => {
        self.shop = new ShopController(self.bundle, self.play, stock);
        self.paintShop();
      },
      shopOpen: () => self.shop !== null && self.shop.isOpen(),
      // A list to pick one row from (ChoiceController). Same contract as the
      // shop: the script is suspended until it closes, and the row it came
      // back with waits in choicePick.
      openChoice: (title: string, labels: string[], notes: string[]) => {
        self.choicePick = -1;
        self.choice = new ChoiceController(title.split("\n"), labels, notes);
        self.paintChoice();
      },
      choiceOpen: () => self.choice !== null && self.choice.isOpen(),
      choicePicked: () => self.choicePick,
      openPc: (kind: string) => {
        self.pc = new PcController(self.bundle, self.play, kind);
        self.paintPc();
      },
      pcOpen: () => self.pc !== null && self.pc.isOpen(),
      // A slot machine draws its own reels, message and menu over the whole
      // Game Boy screen, so it takes the frame the way a Pokedex entry does
      // rather than borrowing the message panel.
      openSlots: (chance: number) => {
        self.slots = new SlotController(self.bundle, self.play, chance,
                                        () => Math.random());
      },
      slotsOpen: () => self.slots !== null && self.slots.isOpen(),
      beginTrainerBattle: (trainerId: string, partyIndex: number) => {
        self.startBattle((r: BattleRunner) =>
          r.startTrainer(trainerId, partyIndex, () => Math.random()));
      },
      beginStaticBattle: (species: string, level: number) => {
        // A legendary is a WILD battle with the roll taken out: it can be
        // caught, which is the entire point of standing in front of Mewtwo
        // with a Master Ball.
        // WITH the map, as a grass encounter has: the tower's MAROWAK is a
        // ghost until the SILPH SCOPE is in the bag (battle/Ghost.ts), and
        // without the map id here she could simply be fought and beaten.
        self.startBattle((r: BattleRunner) =>
          r.startWild(species, level, () => Math.random(), self.overworld.mapId));
      },
      beginDemoBattle: (species?: string, level?: number, thrower?: string, catches?: boolean) => {
        self.startBattle((r: BattleRunner) =>
          r.startDemo(() => Math.random(), species, level, thrower, catches !== false));
      },
      battleOver: () => self.runner === null,
      battleWon: () => self.lastBattleWon,
      battleCaught: () => self.lastBattleCaught,

      // The cry seam was already here, dispatched by the VM for both `cry` and
      // `play_cry` and implemented in PlayHost -- stubbed at this one line
      // because nothing could make a sound yet. Guarded because a fresh clone of
      // this project has no Audio Output asset, and a throw here happens on the
      // frame an NPC speaks.
      playCry: (species: string) => {
        if (self.jukebox) {
          try {
            self.jukebox.playCry(species);
          } catch (e) {
            print("[PokemonAR] cry failed for " + species + ": " + e);
          }
        }
      },
      // Every fade with a world already built is currently the one measured
      // frame cut: instant. Before the world exists, this is the intro's own
      // pair (SPEC.md "The intro on the Game Boy screen -- design", the
      // `fade` row): "out" holds white for the measured 62 frames
      // (IntroStage.startWhiteHold/isWhiteHoldDone); "in" -- reached in the
      // SAME frame as `warp` opens the onboarding page, since warp always
      // returns DONE and the VM keeps going -- parks here (RUNNING) until a
      // mode is picked and completeIntro() has built the world.
      fade: (direction: string, colour: string) => {
        if (self.overworld !== null) {
          return DONE;
        }
        if (direction === "out") {
          if (!self.introWhiteHoldStarted) {
            self.introStage.startWhiteHold();
            self.introWhiteHoldStarted = true;
          }
          return self.introStage.isWhiteHoldDone() ? DONE : RUNNING;
        }
        return RUNNING;
      },
      playOnce: () => DONE,
      // Four seams the script VM has always had and nothing has ever filled.
      // The ported maps use two of them (Get_Item1, Get_Key_Item) and PlayLoop
      // two more (Go_Inside, and the Pokecenter's jingle, which is music).
      playMusic: (track: string) => {
        if (self.jukebox) self.jukebox.setOverride(track);
      },
      stopMusic: () => {
        if (self.jukebox) self.jukebox.silence();
      },
      playDefaultMusic: () => {
        if (self.jukebox) self.jukebox.resume();
      },
      textSound: (name: string) => {
        if (self.jukebox) self.jukebox.playNamed(name);
      },
      frames: () => Math.floor(self.gbFrames),

      playerFacing: () => self.overworld ? self.overworld.facing : "down",
      playerCell: () => self.overworld ? [self.overworld.cellX, self.overworld.cellY] : [0, 0],
      blocksChanged: () => self.rebuildDiorama(),

      cutTreeAhead: () => {
        const cut = self.overworld.cutAhead();
        if (cut) {
          self.rebuildTerrain();
        }
        return cut;
      },
      startSurf: () => self.overworld.startSurf(),
      activateStrength: () => { self.overworld.strengthActive = true; },
      flyTo: (mapId: string) => {
        if (self.overworld.flyTo(mapId)) {
          self.play.lastMapId = self.overworld.lastMapId;
          self.rebuildDiorama();
        }
      },
      lightArea: () => {
        self.overworld.lightArea();
        self.rebuildTerrain();
      },
      redrawTerrain: () => self.rebuildTerrain(),

      // A no-op on a bundle with no on-canvas intro (introStage null: the
      // fallback path in beginIntro/finishBoot) -- unchanged from before
      // this phase existed. Otherwise: Oak and the rival fade, Nidorino and
      // the player's first appearance slide, and the player's SECOND
      // occurrence (OAK_SPEECH's own op 12) is showPlayerAgain()'s measured
      // ramp rather than another slide -- introPlayerShown is what tells the
      // two calls apart, since OAK_SPEECH sends "player" both times.
      introStage: (who: string) => {
        if (!self.introStage) {
          return;
        }
        if (who === "player" && self.introPlayerShown) {
          self.introStage.showPlayerAgain();
          return;
        }
        self.introStage.show(who);
        if (who === "player") {
          self.introPlayerShown = true;
        }
      },
      nameEntry: (who: string) => self.nameEntry(who),
      picture: (key: string, pages: string[][]) => self.picture(key, pages),
      dexEntry: (species: string) => self.dexEntry(species),
      // Noted here and started once the script has let go of the world, so
      // the roll does not begin under OAK's last page.
      rollCredits: () => { self.creditsWanted = true; },
      shakeWorld: (seconds: number) => { self.shake.start(seconds); },
      random: () => Math.random(),
    };
  }

  /**
   * Sample every texture on a pass with nearest-neighbour filtering.
   *
   * This is not a preference. At the battle scale one 8-pixel tile is stretched to
   * roughly half a metre, and bilinear filtering turns the whole world into a blur
   * of pastel smears -- the pixel art stops being pixel art exactly when you are
   * closest to it. The sampler name differs per material, so every sampler on the
   * pass is set rather than guessing at "baseTex".
   */
  /**
   * An 8x8 Game Boy tile blown up to a handspan across a table is the one thing
   * that must never be interpolated, and the documented sampler default is
   * Bilinear.
   *
   * `pass.samplers` is a dynamic-property proxy whose keys are the shader's own
   * texture parameters. It enumerates NOTHING, so the `for..in` this used to be
   * touched zero samplers and reported success. Name them instead, and say so
   * when none of the names match rather than shipping a blurred world.
   */
  private static readonly SAMPLER_NAMES: string[] =
    ["baseTex", "mainTex", "texture0", "diffuseTexture"];

  private static useNearestFiltering(pass: any): void {
    let applied = 0;
    for (let i = 0; i < PokemonAR.SAMPLER_NAMES.length; i++) {
      try {
        const samplers = pass.samplers;
        const sampler = samplers ? samplers[PokemonAR.SAMPLER_NAMES[i]] : null;
        if (sampler) {
          sampler.filtering = FilteringMode.Nearest;
          applied++;
        }
      } catch (e) {
        // Not a texture parameter of this shader; try the next name.
      }
    }
    if (applied === 0) {
      print("[PokemonAR] nearest filtering matched no sampler -- tiles will blur");
    }
  }

  /** A tileset's pixels and per-tile majority shade, unpacked once. */
  private statsFor(tilesetId: string): TileStats {
    if (!this.tileStats[tilesetId]) {
      this.tileStats[tilesetId] = tileStatsFor(this.bundle.tilesets[tilesetId]);
    }
    return this.tileStats[tilesetId];
  }

  /**
   * One material per map palette: a 43x43 texture of every colour a voxel can
   * be, sampled nearest. The category colours are the same everywhere; only
   * the fallback slot -- tiles without a category -- takes the map's palette.
   */
  private terrainMaterialFor(paletteName: string): Material {
    // The cache is per palette NAME, and the grade is baked into the texture,
    // so a new hour has to throw the old textures away rather than hand back a
    // noon one under the same name.
    const grade = this.gradeSignature();
    if (this.terrainGrade !== grade) {
      this.terrainGrade = grade;
      this.terrainMaterials = {};
      this.terrainTextures = {};
    }
    if (!this.terrainMaterials[paletteName]) {
      const texture = ProceduralTextureProvider.createWithFormat(
        PALETTE_TEXELS_ACROSS, PALETTE_TEXELS_ACROSS, TextureFormat.RGBA8Unorm
      );
      this.terrainTextures[paletteName] = texture;
      this.paintPalette(paletteName);
      this.terrainMaterials[paletteName] = this.flatMaterial(texture);
    }
    return this.terrainMaterials[paletteName];
  }

  /** One palette's texture, repainted at the current hour and animation step. */
  private paintPalette(paletteName: string): void {
    const texture = this.terrainTextures[paletteName];
    if (!texture) {
      return;
    }
    (texture.control as ProceduralTextureProvider).setPixels(
      0, 0, PALETTE_TEXELS_ACROSS, PALETTE_TEXELS_ACROSS,
      paletteTexels((this.bundle as any).tilePalettes, this.bundle.palettes[paletteName],
                    this.worldTint(), this.worldSaturation(),
                    this.terrainPhase < 0 ? 0 : this.terrainPhase, this.worldLegibility())
    );
  }

  /**
   * The cartridge's own animation clock, on the diorama's water.
   *
   * Gen 1 rotates the water tile every 21 frames and we cannot: a column's
   * colour is a UV baked into the vertex buffer. What moves instead is the
   * PALETTE -- see VoxelPalette.animatedShade -- so the pattern already in the
   * mesh trades its crests for its troughs and the pond ripples. The whole
   * cost is one 43x43 texture written about three times a second, which is
   * 7,396 bytes and no geometry at all.
   *
   * Deliberately unconditional on there being water in view: finding out
   * costs more than the write does.
   */
  private updateWaterPhase(): void {
    const phase = this.gbAnimClock.phase();
    if (phase === this.terrainPhase) {
      return;
    }
    this.terrainPhase = phase;
    for (const name in this.terrainTextures) {
      this.paintPalette(name);
    }
  }

  /**
   * The mode actually in effect right now -- PLAY_MODE_GAMEBOY only when the
   * bundle can actually show that screen (canRenderGameBoy()). A bundle
   * baked before the boot art existed keeps rendering the diorama
   * regardless of the saved choice, exactly like beginIntro()'s own
   * fallback for a missing intro; every caller below reads THIS, not
   * play.playMode directly, so the fallback is one decision, not several
   * that could disagree.
   */
  private isGameBoyMode(): boolean {
    return this.play !== null && this.play.playMode === PLAY_MODE_GAMEBOY &&
      this.canRenderGameBoy();
  }

  /** Whether the Game Boy screen exists at all -- see beginBoot(). */
  private canRenderGameBoy(): boolean {
    return this.gbFont !== null && this.screen !== null && this.canvas !== null;
  }

  /**
   * Rebuilds the world for the current map: the voxel diorama and its
   * billboards in DIORAMA mode, or -- SPEC.md "GAME BOY mode -- design" --
   * no 3D geometry at all in GAME BOY mode, where OverworldCanvas draws the
   * same map on the flat screen every frame instead (updateGameBoyScreen()).
   *
   * Called on every map change, warp and connection crossing in either
   * mode, so it is also the one place a live mode switch (the OPTION row,
   * SPEC.md "the onboarding page -- design") would land: tearing the
   * diorama down or building it is exactly what already happens here on a
   * plain map change, just against the SAME map instead of a new one.
   */
  private rebuildDiorama(): void {
    // A new map (or a mode switch on the same one): every NPC is back where
    // it ships, and any wander in progress forgets where it was.
    this.npcMotion.reset();
    this.wander.reset();
    if (this.isGameBoyMode()) {
      // No terrain, no player or NPC billboards -- rebuildNpcs() below still
      // builds the CAST (npcByName) scripted walks and wanderers need; it
      // just skips the 3D half of it in this mode.
      this.terrain.clear();
      if (this.playerObject) {
        this.playerObject.enabled = false;
      }
      this.rebuildNpcs();
      if (!this.gbTextBox) {
        this.gbTextBox = new CanvasTextBox(this.play.options.textSpeed);
      }
      this.gbBoxOpen = false;
      this.setScreenEnabled(true);
      return;
    }
    if (this.gbTextBox !== null) {
      // Was driving the GAME BOY screen a moment ago (a live switch back to
      // DIORAMA): hand it back rather than leaving it lit over the diorama.
      // isGameBoyMode() is false in this branch, so this is the plain switch
      // off -- said through the same door as every other one, so that door
      // stays the only one.
      this.handBackScreen();
      this.gbTextBox = null;
    }
    if (this.playerObject) {
      this.playerObject.enabled = true;
    }
    this.rebuildTerrain();
    this.ensurePlayerBillboard();
    this.rebuildNpcs();
  }

  /**
   * Notices a play.playMode that changed since it was last applied to the
   * scene -- today that is only the onboarding page and CONTINUE, both
   * already followed by their own rebuildDiorama() call, so this is a
   * no-op on every frame that follows; it exists so the OPTION row SPEC.md
   * "the onboarding page -- design" describes ("changes the mode live on
   * the next frame") needs nothing more than setting play.playMode to work,
   * the moment that row exists.
   */
  private syncPlayMode(): void {
    if (!this.play || !this.overworld || this.play.playMode === this.lastAppliedPlayMode) {
      return;
    }
    this.lastAppliedPlayMode = this.play.playMode;
    this.rebuildDiorama();
  }

  /**
   * The same for the view rows: a tilt, a rim or a zoom changed on the menu
   * takes effect on the next frame, without the menu having to know that a
   * mesh exists.
   *
   * Terrain only. rebuildDiorama() would reset every walked NPC to its
   * shipped cell, and none of these rows moves anybody.
   */
  private syncView(): void {
    if (!this.play || !this.overworld || this.isGameBoyMode()) {
      return;
    }
    const signature = this.viewSignature();
    if (signature === this.lastAppliedView) {
      return;
    }
    const first = this.lastAppliedView === "";
    this.lastAppliedView = signature;
    if (!first) {
      print("[PokemonAR] view: " + signature);
      this.terrain.invalidate();
      this.rebuildTerrain();
    }
  }

  /**
   * The mesh and the material only.
   *
   * Split out of rebuildDiorama because a cut tree, a boulder on a switch and
   * a Flash all change the world WITHOUT changing the map: calling the whole
   * rebuild would reset every walked NPC to its shipped cell and destroy the
   * billboards mid-frame.
   */
  private rebuildTerrain(): void {
    // cutTreeAhead/lightArea/redrawTerrain call this directly (not through
    // rebuildDiorama()) whenever a Cut, a Flash or a pushed boulder changes
    // the map WITHOUT changing it -- SPEC.md "GAME BOY mode -- design"'s own
    // no-caching answer to the same case: OverworldCanvas reads MapRuntime
    // live every paint, so the flat screen already shows a cut tree or a lit
    // area on its next frame with no rebuild at all. Building the voxel mesh
    // here too would be wasted work at best; left enabled, it would also be
    // a SECOND, unwanted world sitting next to the flat one.
    if (this.isGameBoyMode()) {
      return;
    }
    const map = this.overworld.map;
    // Towns own their palette; routes share one. Falling back to the bundle
    // default is what made Pallet Town borrow Route 1's green.
    // The rule the bake used, applied again here: a world baked before an
    // interior knew its town still gets the town's palette, as long as the
    // bundle carries it.
    const ruled = paletteFor(map.def.id, map.def.tileset);
    const paletteName = this.bundle.palettes && this.bundle.palettes[ruled] ? ruled
      : map.def.palette ? map.def.palette : this.bundle.defaultPalette;
    // The window follows the player, so a big map costs what is near them rather
    // than what it contains.
    const view = this.viewSettings();
    // A dark cave draws a small window around the player until Flash: the
    // cartridge blacks out everything else, and an eleven-tile window is the
    // nearest thing a voxel diorama has to that.
    const windowAcross = this.overworld.isDark()
      ? DARK_WINDOW_TILES_ACROSS : zoomTilesAcross(view.zoom);
    this.terrain.setMaterial(this.terrainMaterialFor(paletteName));
    // Before setMap, so the first window is built with the shapes it will keep:
    // setShapes drops the structures and the window, and doing that AFTER
    // setMap would build the map once and then throw it away.
    this.terrain.setShapes(view.shapes === SHAPES_AUTHORED);
    // Always flat. CURVE was a row on the OPTION page until 9 September, and
    // on the glasses its third rung rolled the world into a ball, because the
    // bend scaled with the window's half-extent and the window had just been
    // made small. The machinery is still in VoxelTerrain; nothing selects it.
    // Never a soft edge. The square play area's own sides ARE its edge, and they
    // are what a hand takes hold of; rounding them off made the plate disagree
    // with the grab rule about where the world stops.
    this.terrain.setMap(map, this.statsFor(map.def.tileset), FLAT_CURVE, windowAcross,
                        false);
    this.terrain.update(this.overworld.cellX * 2, this.overworld.cellY * 2);
    // A map change builds the whole window now; only a walk across a big map
    // trickles chunks in over frames.
    this.terrain.flush();
    // The column field is only readable once the window exists, so everyone
    // placed against the PREVIOUS one is re-seated here.
    this.refreshNpcGround();

    // Presentation tilt, as the original's OFF/15/35/50. Purely visual: collision
    // and movement never see it, exactly as the reference keeps it out of the
    // simulation and in the draw path. Composed with the placement heading --
    // see applyDioramaRotation.
    this.applyDioramaRotation();

    const scale = this.plateScale() * this.viewZoom;
    this.dioramaScale = scale;
    this.battle.setBaseScale(scale);

    print(
      "[PokemonAR] " + map.def.id + ": " + this.terrain.quadCount() + " quads in " +
      this.terrain.chunkCount() + " chunks, " + map.widthTiles + "x" + map.heightTiles +
      " tiles, scale " + scale.toFixed(3) + " zoom " + this.viewZoom.toFixed(2) +
      // What the play area ASKED for against what it got. A LEAF run measured a
      // 42-tile window on a route where the ZOOM row asked for 20, which is four
      // times the quads and the very complaint the play area exists to answer;
      // without both numbers on one line that took an afternoon to see.
      " -- window asks " + windowAcross + ", terrain holds " +
      this.terrain.windowAsked() + ", cover " + this.terrain.coverChunksAcross() +
      " chunks, built " +
      (this.terrain.currentWindow()
        ? (this.terrain.currentWindow().maxTileX - this.terrain.currentWindow().minTileX + 1) +
          "x" +
          (this.terrain.currentWindow().maxTileZ - this.terrain.currentWindow().minTileZ + 1)
        : "nothing")
    );
  }

  /**
   * START -> OPTION: the view page, on the Game Boy screen.
   *
   * The screen exists already -- it is what the title, the main menu and the
   * intro are drawn on -- and it is idle while the world is running in
   * DIORAMA mode, so the page costs one canvas and no new geometry.
   */
  private openViewPage(): void {
    if (!this.camera || !this.play) {
      print("[PokemonAR] view page needs a running world and camera");
      return;
    }
    // The MODE row reads play.playMode, not the saved view. Those two can
    // legitimately disagree: play.playMode is written when a game STARTS, from
    // the boot page, and the saved view knows nothing about it. Opening the page
    // on a stale value would show a wearer in GAME BOY mode a row reading
    // DIORAMA, and one press would then appear to do nothing.
    this.play.options.view.mode =
      this.play.playMode === PLAY_MODE_GAMEBOY ? MODE_GAMEBOY : MODE_DIORAMA;
    this.viewPage = new ViewOptionsController(this.play.options.view);
    print("[PokemonAR] view page: " + JSON.stringify(this.viewPage.values()));
    this.viewPad = new DPadEdge();
    this.sideShown = false;
    this.spatialOptionFirst = 0;
    this.handBackScreen(true);
    this.paintViewPage();
  }

  /** One frame of the view page. Returns true while it owns the frame. */
  private driveViewPage(dt: number): boolean {
    if (!this.viewPage) {
      return false;
    }
    const moved = this.spatialDirection || this.viewPad.step(this.input.dpad(), dt);
    const answer = this.viewPage.step(moved, this.spatialAction === "a" || this.input.pressedA(),
      this.spatialAction === "b" || this.input.pressedB());
    this.play.options.view = this.viewPage.values();
    // Written on every change rather than on close. A wearer who takes the
    // glasses off mid-menu, or whose lens is killed by the OS, has still made
    // the change -- and losing it is indistinguishable from the row not
    // working, which is the complaint this is answering.
    storeViewSettings(this.play.options.view);
    // The MODE row is the one view setting that is not a view setting: it lives
    // on play.playMode, because the rest of the lens has always read it there
    // and syncPlayMode() has been waiting for a row to move it. Written here
    // rather than inside ViewOptions so that module stays pure and knows nothing
    // about a PlayState.
    this.play.playMode = this.play.options.view.mode === MODE_GAMEBOY
      ? PLAY_MODE_GAMEBOY : PLAY_MODE_DIORAMA;
    if (answer === VIEW_PLACE) {
      this.replaceDiorama();
      return true;
    }
    if (answer === VIEW_FINDPAD) {
      // Stays on the page: the pad's own panel is what says whether it took,
      // and closing the menu to watch it would be a menu that hides its result.
      this.rescanForPad();
      this.paintViewPage();
      return true;
    }
    if (answer === VIEW_CLOSE) {
      this.viewPage = null;
      this.viewPad = null;
      this.closeViewSurfaces();
      // The rows only reach the mesh here; syncView() sees the change on the
      // next frame and rebuilds the terrain once, not once a keypress.
      return true;
    }
    this.paintViewPage();
    return true;
  }

  /**
   * OPTION -> PLACE: put the world down again in front of where the wearer is
   * now, and start looking for a surface under it afresh.
   *
   * It closes the page, because the page is a screen hanging in front of the
   * world and you cannot see where the world landed through it.
   *
   * A fight is put back first. Re-placing mid-fight would move the world out
   * from under a framing that is holding it somewhere else, and the fight
   * would fly back to the OLD place when it ended.
   */
  private replaceDiorama(): void {
    this.viewPage = null;
    this.viewPad = null;
    this.closeViewSurfaces();
    if (!this.placer) {
      return;
    }
    if (this.battle && this.battle.isFramed() && this.battle.isSettled()) {
      this.battle.unframe();
    }
    this.placer.replace();
    // And forget the wearer's own twist. PLACE puts the world down in front of
    // where they are NOW and re-takes the heading with it; keeping a rotation
    // taken against the old heading would leave the world facing away from
    // them again, which is the whole thing PLACE exists to fix.
    this.userYaw = 0;
    this.applyDioramaRotation();
    // Where it was just put is where the player will stand. Read as the
    // placement EVENT rather than off the transform, so this cannot pick up a
    // scroll offset that the next frame would apply a second time.
    const placed = this.placer.takePlacement();
    if (placed) {
      this.dioramaAnchor = new vec3(placed.x, placed.y, placed.z);
    } else {
      this.takeDioramaAnchor();
    }
    this.placeStateSaid = "";
    this.setStatus("PLACED IN FRONT OF YOU");
  }

  /**
   * Says what the placer is doing, once per change.
   *
   * The lens has looked for a table since the first day and never said so, so
   * from the wearer's side there was no placement step at all -- the world
   * simply appeared, and then silently moved when a hit came back. Saying it
   * costs one line and turns an invisible mechanism into something you can
   * watch, aim and, with OPTION -> PLACE, run again.
   */
  private reportPlacement(): void {
    if (!this.placer) {
      return;
    }
    const now = this.placer.state();
    if (now === this.placeStateSaid) {
      return;
    }
    this.placeStateSaid = now;
    if (now === PLACE_SEARCHING) {
      this.setStatus("LOOKING FOR A TABLE...");
    } else if (now === PLACE_ON_SURFACE) {
      this.setStatus("ON THE TABLE");
      // The heading is re-taken when a surface lands, so print the one that
      // actually applies rather than the one from onAwake.
      print("[PokemonAR] on a surface, facing " +
            (this.placer.facing() * 180 / Math.PI).toFixed(0) + " deg");
    }
  }

  /**
   * Look for a Bluetooth pad again, because the first look is over long
   * before the wearer is ready for it.
   *
   * The scan budget is three twenty-second windows with five-second gaps: it
   * is spent seventy seconds after the lens starts, and it was terminal. That
   * is the wrong seventy seconds. The glasses are going on, the diorama is
   * being placed, and the pad's pairing button has not been held yet -- and
   * the Bluetooth permission prompt itself is answered inside that window, so
   * the early attempts are made against a radio that has not been permitted.
   */
  /**
   * Puts back the view settings the wearer left, PLAY MODE included.
   *
   * Every field goes through sanitiseViewSettings, which clamps each index
   * against the ladder as it exists TODAY. Rows have been added and removed
   * three times this week; a stored file naming a rung that no longer exists
   * must fall back to the default rather than put the cursor or the mesh
   * somewhere neither can come back from.
   *
   * PLAY MODE is restored too, by Joshua's choice on 10 September over my
   * recommendation to pin it to DIORAMA. So a session ended in GAME BOY starts
   * in GAME BOY -- which is the point, and also the one way this can look like
   * a broken world on the next launch. The MODE row is how you come back.
   */
  private restoreViewSettings(): void {
    const stored = loadViewSettings();
    if (!stored) {
      return;
    }
    this.bootOptions.view = sanitiseViewSettings(stored);
    // PLAY MODE is NOT restored. It was, for half a day: Joshua asked for
    // "echt alles, PLAY MODE ook" over my recommendation, tried it, and came
    // back with "kan je ervoor zorgen dat diorama de standaard playstyle wordt
    // en niet gameboy". Trying GAME BOY once is enough to be started in it for
    // ever after, and a lens that opens on a flat screen where a diorama used
    // to be reads as a broken world rather than as a remembered choice.
    //
    // The row still works, live, and the value is still WRITTEN -- it is only
    // the reading back that stops here, so nothing else about the file
    // changes.
    this.bootOptions.view.mode = MODE_DIORAMA;
    this.bootOptions.playMode = PLAY_MODE_DIORAMA;
    print("[PokemonAR] view settings restored: tilt=" + this.bootOptions.view.tilt +
          " zoom=" + this.bootOptions.view.zoom +
          " time=" + this.bootOptions.view.time +
          " colour=" + this.bootOptions.view.colour +
          " shapes=" + this.bootOptions.view.shapes +
          " mode=" + this.bootOptions.playMode + " (mode is never restored)");
  }

  private rescanForPad(): void {
    if (!this.gamepad) {
      print("[PokemonAR] pad: nothing to look with -- Bluetooth pad is off");
      return;
    }
    // The panel only lives while a scan does now, so asking for one has to put
    // it back up -- otherwise FIND PAD looks like a dead row, which is exactly
    // what it looked like: "als ik vanuit het menu find pads klik zie ik niks
    // gebeuren en verandert er niks".
    this.padLinger = LINGER_AFTER_LIVE_SECONDS;
    const already = this.gamepad.report().state();
    this.gamepad.retry();
    if (this.gamepad.report().state() === already) {
      // rearm() leaves a scan in flight alone, on purpose. Say so, rather than
      // letting a press that changed nothing read as a press that did nothing.
      print("[PokemonAR] pad: already " + already + "; the panel is back up");
      return;
    }
    print("[PokemonAR] pad: looking again at the wearer's request");
  }

  /**
   * Runs the pad's state machine and puts it where the wearer can read it.
   *
   * The pairing has no screen and no code to type -- the package connects to
   * the first compatible controller it finds -- so the only thing a wearer can
   * be given is a running commentary. Without it, holding the pad's pairing
   * button is indistinguishable from the lens not looking, which is exactly
   * what it was doing.
   *
   * Called from the TOP of onUpdate. The previous version was one line on the
   * shared status text, written only on a change, from a call site six early
   * returns down -- so during the title screen, the menu, the intro and the
   * onboarding page, which is the whole of the time a wearer spends holding a
   * pairing button, it did not run at all.
   */
  private updatePadReport(dt: number): void {
    if (!this.gamepad) {
      return;
    }
    // The clocks first: the scan's deadline, the connect's deadline and the
    // bounded retry loop all live in here, and a machine nobody ticks is the
    // silence this whole thing is about.
    this.gamepad.tick(dt);
    const scan = this.gamepad.report();

    // The panel is up while a scan is actually RUNNING, and for a few seconds
    // after it stops, whatever it stopped as. Then it goes.
    //
    // It used to be up whenever the pad was not live, which on a lens with no
    // controller is for ever: "dit menu'tje met deze logs zitten constant in
    // mn game en gaan niet weg" (Joshua, 10 September). A notice that never
    // leaves is not a notice, it is scenery -- and this one sat over the game.
    // FIND PAD in the OPTION menu, and START on the wizard's PAD page, are how
    // it comes back.
    const busy = scan.isSearching();
    let wanted = true;
    if (busy) {
      this.padLinger = LINGER_AFTER_LIVE_SECONDS;
    } else {
      this.padLinger = this.padLinger > 0 ? this.padLinger - dt : 0;
      wanted = this.padLinger > 0;
    }
    if (this.padStatus) {
      this.padStatus.setEnabled(wanted);
      if (wanted) {
        this.padStatus.show(scan.lines(), scan.stateVersion());
        this.padStatus.follow(this.camera, Math.min(dt, 0.1));
      }
    }

    // A heartbeat while it is looking. A sixty-second window over a quiet room
    // prints nothing at all between its start and its end, and a scan that has
    // silently died looks exactly the same from outside -- which is how a
    // whole day went to a retry loop nobody could see.
    if (scan.isSearching()) {
      this.padHeartbeat = this.padHeartbeat - dt;
      if (this.padHeartbeat <= 0) {
        this.padHeartbeat = PAD_HEARTBEAT_SECONDS;
        print("[PokemonAR] " + scan.logLine());
      }
    } else {
      this.padHeartbeat = 0;
    }

    const now = this.gamepad.padState();
    if (now === this.padStateSaid) {
      return;
    }
    this.padStateSaid = now;
    // One line per change in the log as well, because a recording of a
    // playtest is the only place this can be read afterwards.
    print("[PokemonAR] " + scan.logLine());
  }

  /** Options stay on one directly targeted page while the cursor scrolls. */
  private paintViewPage(): void {
    if (this.sidePanel) this.sidePanel.setEnabled(false);
    if (this.screen) this.screen.setEnabled(false);
  }

  /** Both of the view page's surfaces down, and the dialogue box back if it has a page. */
  private closeViewSurfaces(): void {
    this.sideShown = false;
    if (this.sidePanel) {
      this.sidePanel.setEnabled(false);
    }
    // NOT setScreenEnabled(false): in GAME BOY mode this screen IS the game,
    // and closing the menu used to switch it off with the terrain already
    // cleared, leaving nothing at all.
    this.handBackScreen();
  }

  /**
   * The graphics page's surface, built on first use, or null when this bundle
   * cannot draw one.
   */
  private ensureSidePanel(): GbScreenView {
    if (this.sidePanel) {
      return this.sidePanel;
    }
    if (!this.baseMaterial || !this.gbFont) {
      return null;
    }
    this.sideCanvas = new GbCanvas();
    this.sidePanel = new GbScreenView(this.getSceneObject(),
                                      (t: Texture) => this.readingMaterial(t),
                                      SIDE_WIDTH_CM, SIDE_REACH_CM, true, "GbSidePanel");
    this.sidePanel.setEnabled(false);
    print("[PokemonAR] graphics page: a panel beside the world");
    return this.sidePanel;
  }

  /**
   * Stands the graphics page beside the world, once, as it goes up.
   *
   * Where exactly is SidePanelPlacement's decision and is stated there. What
   * is decided HERE is what happens when there is nothing to stand beside --
   * no world placed yet, the world behind the wearer, GAME BOY mode, where
   * the "world" is itself a screen on the line of sight. The page then hangs
   * where every other screen in this lens hangs, which is a page in front of
   * the wearer: worse than beside the world, better than a page in the floor.
   */
  private anchorSidePanel(): void {
    if (!this.sidePanel) {
      return;
    }
    const spot = this.sidePanelSpot();
    if (!spot || !spot.beside) {
      this.sidePanel.unpin();
      return;
    }
    this.sidePanel.pinAt(this.sideAnchorSpace(),
                         new vec3(spot.at[0], spot.at[1], spot.at[2]));
  }

  /** Where the graphics page belongs right now, or null when nowhere. */
  private sidePanelSpot(): SidePanelSpot {
    if (!this.camera || !this.dioramaAnchor || this.isGameBoyMode()) {
      return null;
    }
    const eyeTransform = this.camera.getSceneObject().getTransform();
    const eye = eyeTransform.getWorldPosition();
    const rotation = eyeTransform.getWorldRotation();
    const look = rotation.multiplyVec3(new vec3(0, 0, -1));
    const up = rotation.multiplyVec3(new vec3(0, 1, 0));
    return sidePanelSpot(
      [eye.x, eye.y, eye.z], [look.x, look.y, look.z], [up.x, up.y, up.z],
      [this.dioramaAnchor.x, this.dioramaAnchor.y, this.dioramaAnchor.z],
      this.rimSizeCm() / 2, SIDE_WIDTH_CM / 2, SIDE_REACH_CM);
  }

  /** The empty the side panel is pinned relative to. See sideAnchorObject. */
  private sideAnchorSpace(): SceneObject {
    if (!this.sideAnchorObject) {
      this.sideAnchorObject = global.scene.createSceneObject("SidePanelSpace");
      this.sideAnchorObject.setParent(this.getSceneObject());
    }
    this.followSideAnchor();
    return this.sideAnchorObject;
  }

  /**
   * Keeps that empty on the diorama's anchor and turned the way the world is.
   *
   * Cheap, and it has to be every frame: the wearer can drag and turn the
   * world by hand while the page is open -- which is exactly when he would --
   * and the page has to come along rather than being left over the table it
   * used to be beside.
   */
  private followSideAnchor(): void {
    if (!this.sideAnchorObject || !this.dioramaAnchor) {
      return;
    }
    const transform = this.sideAnchorObject.getTransform();
    transform.setWorldPosition(new vec3(this.dioramaAnchor.x, this.dioramaAnchor.y,
                                        this.dioramaAnchor.z));
    transform.setWorldRotation(
      quat.angleAxis(this.placer ? this.placer.facing() : 0, new vec3(0, 1, 0)));
  }

  /**
   * The view settings in force: the playthrough's own once there is one, and
   * the scene inputs before that, so a probe with no save still gets what
   * the Inspector says.
   */
  private viewSettings(): ViewSettings {
    if (this.play && this.play.options && this.play.options.view) {
      return this.play.options.view;
    }
    return {
      tilt: PokemonAR.nearestTilt(this.tiltDegrees),
      zoom: Math.round(this.zoomRung),
      // Before there is a save the game runs at its own speed, and the
      // buttons are on AUTO unless the scene's own switch asks for them
      // whatever is connected, which is all `showPadPanel` decides now.
      speed: 0,
      buttons: this.showPadPanel ? BUTTONS_ON : BUTTONS_AUTO,
      // ...and the d-pad follows the wearer, as it does for anyone who has not
      // opened the OPTION page.
      controls: CONTROLS_VIEW,
      // Before there is a save, a fight is staged on the table. See
      // ViewOptions BATTLE_LABELS for why that is the default and not LIFE.
      battle: BATTLE_TABLE,
      // And it is a diorama. Without a PlayState there is no playMode to read,
      // and a probe with no save should see the thing this lens is for.
      mode: MODE_DIORAMA,
      // And lit at noon, carrying all the colour the ladder has. Both of
      // these track defaultViewSettings deliberately: this branch is what a
      // probe with no save sees, and a probe that saw a different world from
      // the one a wearer boots into would be measuring the wrong lens.
      time: 0,
      colour: SATURATION_HIGH,
      // ...and with the shape library on, which is what the lens draws for
      // anyone who has not opened the OPTION page.
      shapes: SHAPES_AUTHORED,
      // Not a row, and nothing here was loaded from a store, so there is
      // nothing to migrate: this block is already current by construction.
      rev: VIEW_REVISION,
    };
  }

  /**
   * The game's speed multiplier, from the OPTION page's SPEED row.
   *
   * Everything the GAME does is scaled by this: the seconds a walk takes, the
   * frames a page of text is typed over, the tick of the animation clocks.
   * Nothing the AUDIO does is: the jukebox runs off the wall clock, so a
   * sped-up world plays over a tune at its own tempo and its own pitch.
   */
  private speed(): number {
    return speedFactor(this.viewSettings());
  }

  /**
   * The hour the world is lit at, as a multiplier per channel.
   *
   * SYNC reads the wearer's own clock. Indoors it is always noon: the
   * reference keeps its own night out of buildings for the same reason, which
   * is that a room lit by the evening sky it cannot see is a room lit wrongly.
   */
  private worldTint(): number[] {
    const view = this.viewSettings();
    if (this.overworld && !this.overworld.isOutside()) {
      return tintFor(TIME_DAY, 12);
    }
    return tintFor(view ? view.time : TIME_DAY, new Date().getHours());
  }

  /** How far the world's colours sit from grey. */
  private worldSaturation(): number {
    const view = this.viewSettings();
    const at = view ? view.colour : 1;
    return SATURATION_LEVELS[at >= 0 && at < SATURATION_LEVELS.length ? at : 0];
  }

  /**
   * How much of the legibility regrade the COLOUR row is asking for.
   *
   * The same rung picks both, so a repaint is still one texture write: nothing
   * about this costs a frame. See Legibility.ts for what it does and why the
   * ground is the thing that sinks.
   */
  private worldLegibility(): number {
    const view = this.viewSettings();
    const at = view ? view.colour : 1;
    return LEGIBILITY_LEVELS[at >= 0 && at < LEGIBILITY_LEVELS.length ? at : 0];
  }

  /** The rung of the tilt ladder nearest to a free-typed degree value. */
  private static nearestTilt(degrees: number): number {
    let best = 0;
    let bestGap = Math.abs(TILT_DEGREES[0] - degrees);
    for (let i = 1; i < TILT_DEGREES.length; i++) {
      const gap = Math.abs(TILT_DEGREES[i] - degrees);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  }

  /**
   * A signature of the view settings, so a change made on a menu rebuilds
   * the world without anything having to remember to say so.
   */
  private viewSignature(): string {
    const v = this.viewSettings();
    // TIME and COLOUR are in here even though they change no vertex: they are
    // baked into the palette TEXTURE, which is cached per palette name, so
    // without them a change to either would be invisible until the next map.
    return v.tilt + "," + v.zoom +
           "," + v.time + "," + v.colour + "," + v.shapes;
  }

  /** The grade the cached terrain materials were built at. */
  private gradeSignature(): string {
    const v = this.viewSettings();
    return v.time + "," + v.colour + "," + (this.overworld && !this.overworld.isOutside() ? "in" : "out");
  }

  /**
   * A map's scale at zoom 1, in centimetres per tile.
   *
   * A map no wider than the reference viewport fills the plate, so a bedroom
   * stays the size it has always been. Anything bigger holds the reference
   * number of tiles across the plate instead of the whole map, so a town is
   * drawn at the same centimetres a tile as Pallet rather than shrinking as
   * the map grows. What falls outside the plate is still built -- the render
   * distance decides that, not this.
   */
  /**
   * Remembers where the root is now as the point the player stands at.
   *
   * Called after anything that PLACES the world rather than scrolls it: the
   * first placement, OPTION -> PLACE, and a hand that has dragged it.
   */
  private takeDioramaAnchor(): void {
    if (!this.dioramaRoot) {
      return;
    }
    const at = this.dioramaRoot.getTransform().getWorldPosition();
    this.dioramaAnchor = new vec3(at.x, at.y, at.z);
  }

  /**
   * The world point the play area is centred on, or null if there is no world.
   *
   * The player's own cell is the one point of the diorama the scroll holds
   * still, so it is the only one whose world position a wearer can point at.
   * The root is the other position the diorama has, and it is not a place --
   * see DioramaAnchor.
   *
   * The anchor IS this point by construction, and it carries the tilt exactly,
   * so it is preferred whenever we have one. Without one the sum is run
   * backwards off the root instead, through the same offset applyDioramaScroll
   * ran forwards, so the two cannot drift apart. Null only before the world
   * exists, and frameBattle reads that as "no placement known" and puts the
   * shot in front of the wearer -- better than a confident wrong place.
   */
  private dioramaCentre(): number[] {
    if (this.dioramaAnchor) {
      return [this.dioramaAnchor.x, this.dioramaAnchor.y, this.dioramaAnchor.z];
    }
    if (!this.dioramaRoot || !this.overworld) {
      return null;
    }
    const transform = this.dioramaRoot.getTransform();
    const local = playerOffsetLocal(
      this.overworld.visualCell(), this.overworld.map.widthTiles,
      this.overworld.map.heightTiles, transform.getLocalScale().x);
    const offset = transform.getWorldRotation()
      .multiplyVec3(new vec3(local[0], local[1], local[2]));
    const at = transform.getWorldPosition();
    return [at.x + offset.x, at.y + offset.y, at.z + offset.z];
  }

  /** Slides the anchor by a hand's own movement. */
  private moveDioramaAnchor(delta: vec3): void {
    if (!this.dioramaAnchor) {
      this.takeDioramaAnchor();
      return;
    }
    this.dioramaAnchor = new vec3(this.dioramaAnchor.x + delta.x,
                                  this.dioramaAnchor.y + delta.y,
                                  this.dioramaAnchor.z + delta.z);
  }

  /**
   * Puts the root where the player's own cell lands on the anchor.
   *
   * root = anchor - R(yaw) * (playerLocal * scale). The player's local
   * position is the map coordinate of their cell, so subtracting it is exactly
   * "scroll the map until this cell is under the anchor".
   *
   * Skipped while a fight has the world: BattleStage is flying it somewhere of
   * its own and writing the position every frame, and the fight's pivot is
   * already the player.
   */
  private applyDioramaScroll(): void {
    if (!this.dioramaRoot || !this.dioramaAnchor || !this.overworld) {
      return;
    }
    if (this.battle && (this.battle.isFramed() || !this.battle.isSettled())) {
      return;
    }
    const map = this.overworld.map;
    const transform = this.dioramaRoot.getTransform();
    // The offset lives in DioramaAnchor because dioramaCentre has to run this
    // same sum backwards, and two hand-written copies of it would eventually
    // disagree about where the world is.
    const local = playerOffsetLocal(
      this.overworld.visualCell(), map.widthTiles, map.heightTiles,
      transform.getLocalScale().x);
    const offset = transform.getWorldRotation()
      .multiplyVec3(new vec3(local[0], local[1], local[2]));
    transform.setWorldPosition(new vec3(
      this.dioramaAnchor.x - offset.x,
      this.dioramaAnchor.y - offset.y,
      this.dioramaAnchor.z - offset.z
    ));
  }

  /**
   * How wide the drawn world is, in centimetres.
   *
   * The window's tile span times the scale, and the default plate before
   * anything has been built.
   */
  private rimSizeCm(): number {
    const scale = this.dioramaScale > 0 ? this.dioramaScale : 1;
    const window = this.terrain ? this.terrain.currentWindow() : null;
    if (!window) {
      return DEFAULT_PLATE_SPAN_CM;
    }
    const across = Math.max(window.maxTileX - window.minTileX + 1,
                            window.maxTileZ - window.minTileZ + 1);
    return across * scale;
  }

  /**
   * A world point in the plate's own axes, as [x, z] centimetres from its
   * centre; null when there is no plate to speak of yet.
   *
   * The plate is a SQUARE and both grab rules are square, because a circular
   * test would refuse the corners while accepting the middle of each edge a
   * long way out. Turning the point by the diorama's own yaw is what makes the
   * rules follow the world when the wearer twists it -- without it the handle
   * stayed where the world used to be.
   */
  private toPlateAxes(at: vec3): number[] {
    if (!this.dioramaAnchor) {
      return null;
    }
    const yaw = this.dioramaYaw();
    const dx = at.x - this.dioramaAnchor.x;
    const dz = at.z - this.dioramaAnchor.z;
    const c = Math.cos(-yaw);
    const sn = Math.sin(-yaw);
    return [dx * c + dz * sn, -dx * sn + dz * c];
  }

  /**
   * Whether a world point is on the plate's EDGE, which is where ONE hand may
   * take hold.
   *
   * There is no drawn handle and there cannot be one. It was tried on 9
   * September -- a rounded rectangle from the UI Kit, transparent inside -- and
   * it came back from the glasses as a dark plate lying over the world: "de
   * frame zit boven de wereld waardoor je op een zwarte grond loopt". The
   * component fills its background whatever alpha it is given, so what was
   * meant to be an outline was a lid.
   *
   * So the band was made WIDE instead (DioramaGrab.RIM_BAND), and the lens says
   * out loud when a hand is in it. The narrow one was unfindable: "ik kan de
   * wereld helemaal niet verplaatsen". What the rule still prevents is the
   * other reported fault -- a pinch over the middle of the world dragging the
   * town across the table.
   */
  private onDioramaRim(at: vec3): boolean {
    const local = this.toPlateAxes(at);
    if (!local) {
      return true;
    }
    return onRim(local[0], local[1], this.rimSizeCm() / 2);
  }

  /**
   * Whether a world point is over the world at all, which is what TWO hands
   * need: the whole plate, not just its edge.
   *
   * Two hands pinching at once is deliberate in a way one hand near the world
   * is not, so the two-handed scale-and-turn asks only that the wearer is
   * reaching at the world rather than at something across the room.
   */
  private overDiorama(at: vec3): boolean {
    const local = this.toPlateAxes(at);
    if (!local) {
      return true;
    }
    return overPlate(local[0], local[1], this.rimSizeCm() / 2);
  }

  /**
   * A tap-pinch: over the world it is "walk there", anywhere else it is A.
   *
   * The pinch was A everywhere until 19 September, and walking meant the plate's
   * cross or the phone. Pointing at the ground of a diorama is what a hand does
   * unasked, so a pinch on a cell walks Red to it over the cartridge's own
   * collision (PathFind), and a pinch on something that cannot be stood on --
   * a person, a sign -- walks up beside it, which is where you stand to talk.
   * A pinch on Red's own cell, or the cell he faces, is still A: that is how you
   * talk to whoever is in front of you. A pinch off the world is A, as before.
   */
  private pinchAt(at: vec3): void {
    if (this.padShadowsTap()) {
      // The pinch was ON a button -- the plate's or the Game Boy's -- and SIK
      // has already pressed it. The hand tracker's own reading of the same
      // pinch is not a second press, and not a walk.
      return;
    }
    if (this.walkTo(at)) {
      return;
    }
    if (this.pinch) {
      this.pinch.tap();
    }
  }

  /**
   * Whether a button was pressed so recently that a hand's tap is that press
   * seen twice. SIK triggers at the pinch's start and DioramaHands reports a
   * tap at its release, at most TAP_SECONDS later; the shadow outlasts that.
   */
  private padShadowsTap(): boolean {
    return this.pad !== null && this.pad.secondsSincePress() < PAD_TAP_SHADOW_SECONDS;
  }

  /**
   * Whether a hand is ON a button: one is down, or was pressed a moment ago.
   *
   * The world's own hand rules look at a pinch from above -- is it over the
   * plate, is it over the rim -- and know nothing of height. The loose
   * buttons hang in front of the wearer, and with the world close, large or
   * life-size they hang over it too. A D-pad arm held to scroll a list would
   * then also be a held pinch inside the plate, which is the joystick, or a
   * pinch on the rim, which moves the world. The button wins: while one is
   * in use the hand is not steering and is not holding the world.
   */
  private padInUse(): boolean {
    return this.pad !== null && (this.pad.anyHeld() || this.padShadowsTap());
  }

  /**
   * The held pinch as a joystick. The player is the fixed point of the
   * diorama, so the hand's offset from the plate's centre, in the plate's
   * own axes, IS its offset from the player; StickSource turns that into
   * the direction held (or nothing, inside the dead zone).
   */
  private steerWith(at: vec3): void {
    if (!this.stick || !this.dioramaRoot) {
      return;
    }
    const local = this.toPlateAxes(at);
    if (!local) {
      return;
    }
    const cmPerCell = 2 * this.dioramaRoot.getTransform().getLocalScale().x;
    const held = this.stick.aim(local[0] / cmPerCell, local[1] / cmPerCell);
    if (held !== "" && this.route && this.route.isActive()) {
      this.route.cancel();
    }
  }

  private stopSteering(): void {
    if (this.stick) {
      this.stick.release();
    }
  }

  /**
   * The frame on the ground: around the cell a route is walking to, else one
   * cell ahead in the direction the stick holds, else nowhere.
   */
  private updateCellMarker(dt: number): void {
    if (!this.dioramaRoot || !this.overworld) {
      return;
    }
    if (!this.cellMarker) {
      this.cellMarker = new CellMarker(this.dioramaRoot, this.markerMaterial());
    }
    let target: number[] = null;
    if (this.stick && this.stick.isActive()) {
      const d = Overworld.facingDelta(this.stick.heldDirection());
      target = [this.overworld.cellX + d[0], this.overworld.cellY + d[1]];
    } else if (this.route && this.route.isActive()) {
      target = this.route.destination();
    }
    if (target && !this.isGameBoyMode() && this.overworld.map.inBounds(target[0], target[1])) {
      const map = this.overworld.map;
      const x = -map.widthTiles / 2 + target[0] * 2 + 1;
      const z = -map.heightTiles / 2 + target[1] * 2 + 1;
      this.cellMarker.showAt(target[0], target[1], x, this.groundY(x, z), z);
    } else {
      this.cellMarker.hide();
    }
    this.cellMarker.step(dt);
  }

  /** The marker's paint: one texel of the reference's green, unlit, over the ground. */
  private markerMaterial(): Material {
    const texture = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm);
    (texture.control as ProceduralTextureProvider).setPixels(0, 0, 1, 1,
      new Uint8Array([MARKER_RGB[0], MARKER_RGB[1], MARKER_RGB[2], 255]));
    const material = this.flatMaterial(texture);
    material.mainPass.depthWrite = false;
    return material;
  }

  /** Whether the pinch was on the world and became a route (or was swallowed). */
  private walkTo(at: vec3): boolean {
    if (!this.route || !this.overworld || !this.dioramaRoot || !at ||
        this.isGameBoyMode() || this.worldIsBusy() || !this.overDiorama(at)) {
      return false;
    }
    // Cells are laid two tiles apart about the map's centre; see placeNpc.
    const local = this.dioramaRoot.getTransform().getInvertedWorldTransform().multiplyPoint(at);
    const map = this.overworld.map;
    const cx = Math.floor((local.x + map.widthTiles / 2) / 2);
    const cy = Math.floor((local.z + map.heightTiles / 2) / 2);
    if (!map.inBounds(cx, cy)) {
      return false;
    }
    const px = this.overworld.cellX;
    const py = this.overworld.cellY;
    const ahead = this.overworld.facingCell();
    if ((cx === px && cy === py) || (ahead && cx === ahead[0] && cy === ahead[1])) {
      return false;
    }
    const path = findPath(map, px, py, cx, cy);
    if (path === null) {
      this.setStatus("NO WAY THERE");
      print("[PokemonAR] pinch at " + cx + "," + cy + ": no way there from " + px + "," + py);
      return true;
    }
    // A cell you cannot stand on -- a person, a sign, a shelf, a wall -- is
    // walked up to, turned to, and pressed: pointing at someone means talking
    // to them. A cell you can stand on is only walked to.
    const face = map.canEnter(cx, cy) ? null : [cx, cy];
    const exit = face ? "" : this.exitDirectionAt(cx, cy);
    // A person may walk off before Red arrives; a sign or a shelf will not.
    this.routeBody = face ? map.objectAt(cx, cy) : null;
    this.route.setRoute(path, exit, face);
    print("[PokemonAR] pinch at " + cx + "," + cy + ": walking " + path.length + " cells" +
          (exit ? ", then out " + exit : "") + (face ? ", then facing it" : ""));
    return true;
  }

  /**
   * Keeps a route pointed at its person. Both of Pallet Town's NPCs wander, so
   * the girl who stood on the pinched cell is elsewhere by the time a walk
   * ends, and the talk would land on grass. Whenever she has moved, the walk
   * is planned again from where Red is to where she stands now; a pinch on a
   * person means "walk up to her", not "walk to where she was".
   */
  private followRouteBody(): void {
    if (!this.routeBody || !this.route || !this.overworld) {
      return;
    }
    if (!this.route.isActive()) {
      this.routeBody = null;
      return;
    }
    const map = this.overworld.map;
    const now = map.objectCell(this.routeBody);
    if (!personMoved(this.route, now)) {
      return;
    }
    const path = findPath(map, this.overworld.cellX, this.overworld.cellY, now[0], now[1]);
    if (path === null) {
      print("[PokemonAR] " + this.routeBody.name + " walked off to " + now[0] + "," + now[1] + ": no way there");
      this.route.cancel();
      this.routeBody = null;
      return;
    }
    this.route.setRoute(path, "", [now[0], now[1]]);
    print("[PokemonAR] " + this.routeBody.name + " walked off to " + now[0] + "," + now[1] +
          ": following, " + path.length + " cells");
  }

  /**
   * The edge to press into once a pinched cell is reached, when that cell is
   * an exit mat: a warp whose tile is not a door or warp tile fires only with
   * the pad held toward the map edge (Overworld.extraWarpCheck), so a route
   * that merely ARRIVES on it leaves Red standing in the doorway. "" for
   * every other cell, and for a mat on a carpet map, whose direction is the
   * carpet's and not the edge's.
   */
  private exitDirectionAt(cx: number, cy: number): string {
    const world = this.overworld;
    const map = world.map;
    if (world.pendingWarpAt(cx, cy) === null || map.isWarpTile(cx, cy)) {
      return "";
    }
    if (cy === map.heightCells - 1) return "down";
    if (cy === 0) return "up";
    if (cx === 0) return "left";
    if (cx === map.widthCells - 1) return "right";
    return "";
  }

  /** The line the status text falls back to: which map, and what is driving it. */
  private idleStatusLine(): string {
    return (this.overworld ? this.overworld.mapId : "") +
           "  [" + this.input.activeName() + "]";
  }

  /**
   * Whether something else owns the frame: a script, a box, a menu, a fight.
   *
   * Two callers now want the same answer for opposite reasons -- the wanderers
   * must not walk during one, and the grab hint must not talk over one.
   */
  private worldIsBusy(): boolean {
    return (this.loop !== null && this.loop.isBusy()) || this.pageWaiting ||
      (this.menu !== null && this.menu.isOpen()) || this.runner !== null ||
      this.shop !== null || this.choice !== null || this.pc !== null || this.teach !== null ||
      this.slots !== null ||
      (this.battle !== null && !this.battle.isIdle());
  }

  /**
   * Says, or stops saying, that the world can be picked up here.
   *
   * This is the other half of the fix for "ik kan de wereld helemaal niet
   * verplaatsen". The band was widened so a hand can find it blind; this is
   * what tells the hand it has. Nothing may be DRAWN -- the 9 September rim
   * arrived on the glasses as a black lid over the world -- so the handle
   * announces itself in words instead, and takes no geometry, no material and
   * no draw call to do it.
   *
   * It keeps out of the way of anything with more to say. The status line is
   * shared, and a hint is the least important thing on it.
   */
  private sayRimHint(over: boolean): void {
    if (over === this.rimHintShown || (over && this.worldIsBusy())) {
      return;
    }
    this.rimHintShown = over;
    if (over) {
      this.setStatus(RIM_HINT);
    } else if (!this.worldIsBusy()) {
      this.setStatus(this.idleStatusLine());
    }
  }

  /**
   * Centimetres per map tile at zoom 1 -- the same for every map, which is the
   * whole of decision 8 of 9 September.
   *
   * What stood here divided a fixed 70 cm plate by the map's own longest side
   * (capped at 20 tiles), so EVERY map came out 70 cm wide: Red's 16-tile
   * bedroom at 4.375 cm a tile and Pallet Town at 3.5, and a one-room
   * schoolhouse the size of a city. Holding the centimetres fixed and letting
   * the plate change size is what makes a room read as a room.
   *
   * It takes no map any more, and that is the point: nothing about the map
   * may change the answer.
   */
  private plateScale(): number {
    return CM_PER_TILE;
  }

  /**
   * One frame of the compass: where the wearer is standing, in map terms.
   *
   * The quantity is the direction from the WEARER toward the diorama, turned
   * into the diorama's own space -- not the wearer's gaze. Gaze would rotate
   * the controls when he merely glanced at the wall; where he is STANDING is
   * what "loop ik om het spel heen" means, and it survives a turn of the head.
   *
   * The gaze is the fallback for the one case that has no answer: a wearer
   * leaning directly over the model, where the horizontal part of that vector
   * is too short to have a direction. A Lens Studio camera looks along its own
   * -Z while `forward` is +Z, which is why the fallback is negated.
   *
   * GAME BOY mode switches the whole thing off. There is no table to walk
   * round there -- the screen follows the head -- so north is up, as the
   * cartridge has it.
   */
  private updateCompass(): void {
    const wanted = this.viewRelativeControls() && !this.isGameBoyMode();
    if (this.compass.isFollowing() !== wanted) {
      this.compass.setFollowing(wanted);
    }
    let local = [0, 0];
    const centre = this.dioramaCentre();
    if (centre && this.camera) {
      const eye = this.camera.getTransform().getWorldPosition();
      let dx = centre[0] - eye.x;
      let dz = centre[2] - eye.z;
      if (Math.sqrt(dx * dx + dz * dz) < COMPASS_REACH_CM) {
        const ahead = this.camera.getTransform().forward;
        dx = -ahead.x;
        dz = -ahead.z;
      }
      // Into the diorama's own frame: undo its heading, so the answer is in
      // the same axes the map is drawn on. A rotation by -yaw about +Y.
      const yaw = this.dioramaYaw();
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      local = [dx * c - dz * sn, dx * sn + dz * c];
    }
    const turns = this.compass.update(
      local,
      this.overworld ? this.overworld.directionHeld : false,
      this.overworld ? this.overworld.isMoving() : false);
    if (this.overworld && this.overworld.viewTurns !== turns) {
      this.overworld.viewTurns = turns;
      // The standing NPCs were painted for the side the wearer used to be on.
      this.repaintNpcFacings();
      print("[PokemonAR] view turns: " + turns + " (up walks " +
            ["north", "east", "south", "west"][turns] + ")");
    }
  }

  /**
   * A map facing, as the side of the character the WEARER is looking at.
   *
   * The other half of the compass, and the thing Joshua described as "mijn
   * karakter draait mee": the billboard turns to face the eye but the FRAME on
   * it was picked from the map direction, so from the far side of the table
   * Red walks toward you showing you the back of his head. The reference does
   * both halves -- RESEARCH-voxel-mods-and-vr.md 2.4, "toont het frame dat bij
   * die kant hoort" -- and this is the half that was missing.
   *
   * With no turn in force it is the identity, so a wearer on the side the
   * world was placed facing sees exactly what the cartridge drew. The flat
   * Game Boy screen never comes through here at all: OverworldCanvas draws the
   * cartridge's own view, where north is up by definition.
   */
  private drawnFacing(facing: string): string {
    return seenFacing(facing, this.compass.quarterTurns());
  }

  /**
   * Repaints the NPCs who are standing still, after the compass has turned.
   *
   * The ones who are WALKING repaint themselves every frame from their pose.
   * The ones who are not are painted once, when the map is built, and would
   * otherwise keep facing the way they faced when the wearer was standing
   * somewhere else. Called only on a change, which happens when a wearer walks
   * round a table and at no other time.
   */
  private repaintNpcFacings(): void {
    for (const name in this.npcByName) {
      const entry = this.npcByName[name];
      if (!entry || !entry.billboard || !entry.restFacing) {
        continue;
      }
      const frame = frameFor(this.drawnFacing(entry.restFacing), false);
      entry.billboard.setFrame(frame[0], frame[1]);
    }
  }

  /** Whether the CONTROLS row asks for the d-pad to follow the wearer. */
  private viewRelativeControls(): boolean {
    const view = this.viewSettings();
    return view ? view.controls === CONTROLS_VIEW : true;
  }

  /**
   * Which way the world is turned, in radians about the up axis: the heading
   * it was placed at PLUS however far the wearer has twisted it since.
   *
   * One expression, read by everything that needs the heading -- the rotation
   * that is written to the transform and the grab rules that have to follow it
   * -- so a twist cannot turn the world without also turning its handle.
   */
  private dioramaYaw(): number {
    return (this.placer ? this.placer.facing() : 0) + this.userYaw;
  }

  /**
   * The diorama's rotation: the heading, then the tilt.
   *
   * ONE place writes it, because there are now three authors and they used to
   * disagree. The tilt came from the OPTION page at every map load and the
   * heading came from nowhere at all -- the model always faced world -Z, which
   * is where a Lens Studio camera looks when it has no rotation, so it was
   * right in the preview and wrong in every chair. "Als ik ga zitten is het
   * spel niet naar mij toe gedraaid", and with it the d-pad, because UP on the
   * pad is north on the map.
   *
   * The third author is the wearer's own two-handed twist, and it goes INSIDE
   * this composition rather than writing the transform itself. A gesture that
   * set the rotation directly would be overwritten by the next map load, and
   * one that multiplied onto it would pick up the tilt as an axis and roll the
   * world instead of turning it.
   *
   * Skipped while a fight has the world: BattleStage is flying it somewhere
   * and writing its rotation every frame. It is still told the tilt, so what
   * it flies back to has one.
   */
  private applyDioramaRotation(): void {
    if (!this.dioramaRoot) {
      return;
    }
    const view = this.viewSettings();
    const tilt = TILT_DEGREES[view ? view.tilt : 0] * Math.PI / 180;
    if (this.battle) {
      this.battle.setTilt(tilt);
    }
    if (this.battle && this.battle.isFramed()) {
      return;
    }
    this.dioramaRoot.getTransform().setLocalRotation(
      quat.angleAxis(this.dioramaYaw(), new vec3(0, 1, 0))
        .multiply(quat.angleAxis(tilt, new vec3(1, 0, 0))));
  }

  /**
   * Steps the zoom and applies it about the diorama's own centre.
   *
   * Used by the preview's zoom keys. The pinch dive on the glasses goes the
   * other way round -- it scales first and reports the result through
   * noteZoomFromScale -- so both end up writing the same field.
   */
  private zoomBy(factor: number): void {
    if (!this.overworld || !this.battle || !this.playerObject) {
      return;
    }
    // About the player, not about the diorama's corner. Growing around the
    // root's origin walks the world out of the frame: zooming in on Pallet
    // Town pushed the player off the side of the view within four presses.
    const pivot = this.playerObject.getTransform().getWorldPosition();
    const base = this.plateScale();
    this.battle.scaleAbout(pivot, factor, base * ZOOM_MIN, base * ZOOM_MAX);
    this.dioramaScale = this.battle.currentScale();
    this.noteZoomFromScale(this.dioramaScale);
    if (this.placer) {
      this.placer.markPlaced();
    }
    print("[PokemonAR] zoom " + this.viewZoom.toFixed(2) + " (" +
          this.dioramaScale.toFixed(2) + " cm a tile)");
  }

  /**
   * A pinch dive has left the world at `scale`; remember it as a zoom so the
   * next map keeps it.
   */
  private noteZoomFromScale(scale: number): void {
    if (!this.overworld) {
      return;
    }
    const base = this.plateScale();
    if (base > 0) {
      this.viewZoom = scale / base;
    }
  }

  /**
   * The map's object events: as billboards in DIORAMA mode (they already
   * exist in the data and already block movement; without this the player
   * walks around invisible people), or as the bookkeeping OverworldCanvas's
   * view needs in GAME BOY mode -- `npcByName`, which every scripted walk
   * and every wanderer reads regardless of mode (shippedCell(),
   * tickWanderers()), is built here either way. Rebuilt per map, since the
   * cast changes; also rebuilt on a live mode switch (rebuildDiorama()), so
   * whatever the PREVIOUS mode built has to go first, always.
   */
  /**
   * Raise the mark over an NPC, if there is a body to raise it over.
   *
   * There is not always one. In GAME BOY mode the cast has no 3D holders at
   * all (OverworldCanvas draws the LCD from the object list), so the mark is
   * not drawn there -- the honest way to put it back would be the four
   * cartridge tiles in the bundle, and that costs a re-bake of every world.
   * The sixty frames still pass either way, so the walk begins when it should
   * in both modes.
   */
  private showEmote(npc: string, kind: string): void {
    const entry = this.npcByName[npc];
    if (!entry || !entry.holder) {
      return;
    }
    if (!this.emoteSheet) {
      this.emoteSheet = buildEmoteSheet(kind);
      this.emoteMaterial = this.spriteMaterialClone();
      this.emoteMaterial.mainPass.baseTex = this.emoteSheet.texture;
    }
    const holder = global.scene.createSceneObject("emote");
    holder.setParent(entry.holder);
    // Just clear of the head: the body's quad runs from its feet at y=0 to its
    // own height, so the mark starts a little above that and is half as tall.
    const head = spriteHeightUnits(entry.object.sprite, CHARACTER_TILES);
    holder.getTransform().setLocalPosition(new vec3(0, head + EMOTE_GAP_UNITS, 0));
    this.emoteHolder = holder;
    this.emoteBillboard = new Billboard(holder, this.emoteSheet, this.emoteMaterial,
                                        EMOTE_HEIGHT_UNITS);
    this.emoteBillboard.setFrame(0, 0);
    // It outranks the bodies for the same reason the message box does: a
    // warning behind the thing it warns about is not a warning.
    this.emoteBillboard.setRenderOrder(99);
  }

  /** Take it down. Safe to call when there is nothing up. */
  private hideEmote(): void {
    if (this.emoteHolder) {
      this.emoteHolder.destroy();
    }
    this.emoteHolder = null;
    this.emoteBillboard = null;
  }

  private rebuildNpcs(): void {
    // The mark hangs off a body that is about to be destroyed.
    this.hideEmote();
    // Objects are per-map (and per-mode), so whatever stood here goes.
    const previous = this.npcRoot.children;
    for (let i = previous.length - 1; i >= 0; i--) {
      previous[i].destroy();
    }
    this.npcBillboards = [];
    this.npcByName = {};

    const gameboy = this.isGameBoyMode();
    const map = this.overworld.map;
    const objects = map.def.objects;
    const drawn: string[] = [];

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      const sprite = this.bundle.sprites[object.sprite];
      if (!sprite) {
        continue;
      }
      // The same rule the talk layer uses. Drawing on the sprite alone put the
      // thirty-two objects the cartridge ships hidden in plain sight, and left
      // every NPC a script hid standing in the room, untalkable.
      if (isObjectHidden(map.def.id, object, this.loop ? this.loop.reveals() : null)) {
        continue;
      }

      if (gameboy) {
        // OverworldCanvas draws this one every frame from the SAME object
        // list (play/screen/GameBoyView.ts); no 3D holder or billboard.
        this.npcByName[object.name] = { holder: null, billboard: null, object: object };
        drawn.push(object.sprite);
        continue;
      }

      // Each walker in its own colours; the map palette painted everyone green.
      const sheet = buildSpriteSheet(sprite, { own: spritePaletteFor(object.sprite) }, "own");

      // One material per sprite id: the texture differs, everything else does not.
      let material: Material = this.npcMaterials[object.sprite];
      if (!material) {
        material = this.baseMaterial.clone();
        const pass = material.mainPass;
        pass.baseColor = new vec4(1, 1, 1, 1);
        pass.blendMode = BlendMode.Normal;
        pass.depthWrite = false;
        pass.depthTest = true;
        pass.twoSided = true;
        PokemonAR.useNearestFiltering(pass);
        this.npcMaterials[object.sprite] = material;
      }
      material.mainPass.baseTex = sheet.texture;

      const holder = global.scene.createSceneObject(object.name);
      holder.setParent(this.npcRoot);
      const x = -map.widthTiles / 2 + object.x * 2 + 1;
      const z = -map.heightTiles / 2 + object.y * 2 + 1;
      holder.getTransform().setLocalPosition(new vec3(x, this.npcGroundY(object.sprite,x,z), z));

      // A prop stands its own height: a ball on a counter is not a person.
      const billboard = new Billboard(holder, sheet, material,
                                      spriteHeightUnits(object.sprite, CHARACTER_TILES));
      // The range field says which way they are looking when they stand still.
      const facing = shippedFacing(object);
      const frame = frameFor(this.drawnFacing(facing), false);
      billboard.setFrame(frame[0], frame[1]);
      this.npcBillboards.push(billboard);
      // restFacing is kept so repaintNpcFacings can redraw this one when the
      // wearer walks round to another side. The MAP facing, not the drawn one:
      // what the character is doing does not change because someone moved.
      this.npcByName[object.name] = { holder: holder, billboard: billboard,
                                      object: object, restFacing: facing };
      // A reveal mid-cutscene rebuilds the cast; whoever has walked stays walked.
      this.placeNpc(object.name, this.npcMotion.pose(object.name));
      drawn.push(object.sprite);
    }

    print("[PokemonAR] " + drawn.length + " NPCs on " + map.def.id +
          (drawn.length ? ": " + drawn.join(", ") : ""));
    // Anyone NOT standing on the floor, with the column they are standing on.
    //
    // A cast at the wrong height is invisible rather than obviously wrong: the
    // three starter balls sat at y=0 inside Oak's counter and were reported as
    // missing, twice, before this line existed. Only the raised ones are
    // printed, so a route full of people on flat ground says nothing.
    let raised = "";
    for (let i = 0; i < objects.length; i++) {
      const entry = this.npcByName[objects[i].name];
      if (!entry || !entry.holder) {
        continue;
      }
      const at = entry.holder.getTransform().getLocalPosition();
      const report = this.terrain ? this.terrain.columnReport(at.x, at.z) : [-1, -1, -1, -1];
      if (at.y === 0 && report[2] === 0) {
        continue;
      }
      raised += (raised ? "  " : "") + objects[i].name +
                "@" + objects[i].x + "," + objects[i].y + " y=" + at.y.toFixed(2) +
                " [top " + report[0] + " tall " + report[1] + " struct " + report[2] + "]";
    }
    if (raised) {
      print("[PokemonAR] standing on something: " + raised);
    }
  }

  /** One of the player's three sheets, built the first time it is asked for. */
  private playerSheet(spriteId: string): any {
    if (!this.playerSheets[spriteId]) {
      const sprite = this.bundle.sprites[spriteId];
      if (!sprite) {
        return null;
      }
      this.playerSheets[spriteId] = buildSpriteSheet(
        sprite, { own: spritePaletteFor(playerPaletteId(spriteId)) }, "own");
    }
    return this.playerSheets[spriteId];
  }

  /**
   * The sheet for the player's state: RED on foot, RedBikeSprite on the
   * BICYCLE, the SEEL on the water (play/PlayerSprite.ts). The three share
   * one frame layout, so only the texture changes.
   */
  private syncPlayerSheet(): void {
    if (!this.spriteMaterial || !this.overworld) {
      return;
    }
    const wanted = playerSpriteId(this.overworld.riding, this.overworld.surfing, this.bundle);
    if (wanted === this.playerSheetId) {
      return;
    }
    const sheet = this.playerSheet(wanted);
    if (!sheet) {
      return;
    }
    this.spriteMaterial.mainPass.baseTex = sheet.texture;
    this.playerSheetId = wanted;
  }

  /** Builds the player billboard once; the sheet does not change between maps. */
  private ensurePlayerBillboard(): void {
    if (this.playerBillboard) {
      return;
    }
    const sprite = this.bundle.sprites[SPRITE_PLAYER];
    if (!sprite) {
      print("[PokemonAR] no SPRITE_RED in bundle; player will be invisible");
      return;
    }
    const sheet = this.playerSheet(SPRITE_PLAYER);

    if (!this.spriteMaterial) {
      // A separate clone: characters need alpha blending and must not write depth,
      // or a billboard punches a hole in the world behind it.
      const material = this.baseMaterial.clone();
      const pass = material.mainPass;
      pass.baseTex = sheet.texture;
      pass.baseColor = new vec4(1, 1, 1, 1);
      pass.blendMode = BlendMode.Normal;
      pass.depthWrite = false;
      // No depth test, and a render order above the world: see
      // PLAYER_RENDER_ORDER. The order alone would not do it -- ordering says
      // when a thing is drawn, the depth test says whether it survives being
      // drawn -- so both have to go.
      pass.depthTest = false;
      pass.twoSided = true;
      PokemonAR.useNearestFiltering(pass);
      this.spriteMaterial = material;
    } else {
      this.spriteMaterial.mainPass.baseTex = sheet.texture;
    }

    this.playerBillboard = new Billboard(
      this.playerObject,
      sheet,
      this.spriteMaterial,
      CHARACTER_TILES
    );
    this.playerBillboard.setRenderOrder(PLAYER_RENDER_ORDER);
    this.playerBillboard.setFrame(0, 0);
    this.playerSheetId = SPRITE_PLAYER;
  }

  /**
   * The hands, every frame the world exists: BEFORE the router reads its
   * buttons, and before any of the frame's owners return early.
   *
   * This ran at the end of the overworld's own frame, after the early returns
   * for a page being read, a menu, a script and a battle -- so a pinch did
   * nothing on exactly the frames a pinch is for: the page of text, the FIGHT
   * menu, the life-size battle. On the 19 September preview a pinch beside the
   * world during Oak's "Hey! Wait!" went unanswered, which is how it was found.
   * The world may still be picked up and resized mid-fight (the fight owns
   * only the rotation, see onTwist); a route from a pinch is refused by walkTo
   * while the world is busy.
   */
  /** One owner for targeted UI, serviced before generic hands and the input router. */
  private syncSpatialPage(dt: number): void {
    this.spatialAction = this.spatialDirection = "";
    let model: PageModel = null;
    const page = this.spatialPage;
    const auxiliary = this.battleLearn && this.battleLearn.isOpen() ? this.battleLearn :
      this.shop || this.choice || this.pc || this.teach;
    const context = auxiliary === this.battleLearn ? "learn" : auxiliary === this.shop ? "shop" :
      auxiliary === this.choice ? "choice-list" : auxiliary === this.pc ? "pc" : "teach";
    if (this.naming && this.naming.isOpen()) {
      const action = page ? page.take("name") : "";
      if (action === "symbols") this.spatialNameSymbols = !this.spatialNameSymbols;
      else if (action) this.naming.spatialPick(action);
      if (this.naming.isOpen()) {
        model = namePage(this.naming, this.spatialNameSymbols);
        this.handBackScreen(true);
      }
    } else if (this.viewPage) {
      const action = page ? page.take("options") : "";
      const all = offeredRows(this.viewPage.values());
      if (action === "up" || action === "down") {
        this.spatialOptionFirst = Math.max(0, Math.min(all.length-6,
          this.spatialOptionFirst + (action === "up" ? -5 : 5)));
      } else if (action === "back") this.spatialAction = "b";
      else if (action) {
        const parts = action.split(":");
        const row = Number(parts[1]);
        this.viewPage.pointRow(row);
        if (parts[0] === "less") this.spatialDirection = "left";
        if (parts[0] === "more") this.spatialDirection = "right";
        if (parts[0] === "do") this.spatialAction = "a";
      }
      // Pad navigation scrolls the same surface; pointing never jumps to another screen.
      const at = all.indexOf(this.viewPage.cursorRow());
      if (!action && (this.input.dpad().up || this.input.dpad().down)) {
        if (at < this.spatialOptionFirst) this.spatialOptionFirst = at;
        if (at >= this.spatialOptionFirst+6) this.spatialOptionFirst = at-5;
      }
      const rows = all.slice(this.spatialOptionFirst,this.spatialOptionFirst+6);
      model = listPage("options","OPTIONS",[], -1);
      rows.forEach((row,i)=>{
        const y=19+i*17;
        const actionRow = row===ROW_CANCEL || row===ROW_PLACE || row===ROW_FINDPAD;
        if (actionRow) model.keys.push(pageKey("do:"+row,rowLabel(row),3,y,154,14));
        else {
          const values=rowValues(row), chosen=rowChosen(row,this.viewPage.values());
          model.keys.push(pageKey("row:"+row,rowLabel(row)+" "+(values[chosen]||"--"),3,y,114,14));
          model.keys.push(pageKey("less:"+row,"<",121,y,16,14));
          model.keys.push(pageKey("more:"+row,">",141,y,16,14));
        }
      });
      model.selected="row:"+this.viewPage.cursorRow();
    } else if (!this.isGameBoyMode() && auxiliary && auxiliary.rows().length > 0) {
      const action=page ? page.take(context) : "";
      if(action.indexOf("row:")===0 && auxiliary.pointRow(Number(action.substring(4))))this.spatialAction="a";
      else if(action==="back")this.spatialAction="b";
      else if(action==="up"||action==="down")this.spatialDirection=action;
      model=listPage(context,context==="choice-list"?"CHOOSE":context.toUpperCase(),auxiliary.rows(),auxiliary.cursorRow());
      const lines=auxiliary.lines();
      if(lines&&lines.length){
        model.text=lines.slice(0,2).join("\n");
        model.keys.filter(k=>k.id.indexOf("row:")===0).forEach((k,i)=>{k.y=42+i*13;k.h=12;});
      }
      if(this.menuPanel)this.menuPanel.setEnabled(false);
      if(this.messagePanel)this.messagePanel.setEnabled(false);
      if(this.box)this.box.setEnabled(false);
    } else if (!this.isGameBoyMode() && this.menu && this.menu.isOpen() && !this.pageWaiting) {
      const action = page ? page.take("menu") : "";
      if (action.indexOf("row:")===0 && this.menu.pointRow(Number(action.substring(4)))) this.spatialAction="a";
      else if (action==="back") this.spatialAction="b";
      else if (action==="up"||action==="down") this.spatialDirection=action;
      model=listPage("menu",this.runner ? "BATTLE" : "MENU",this.menu.rows(),this.menu.cursorRow());
      if (this.menuPanel) this.menuPanel.setEnabled(false);
      if (this.messagePanel) this.messagePanel.setEnabled(false);
      if (this.panelFrame) this.panelFrame.setEnabled(false);
    } else if (!this.isGameBoyMode() && this.choiceBox && this.panelTextBox && this.panelTextBox.ready()) {
      const action=page ? page.take("choice") : "";
      if (action==="yes"||action==="no") this.choiceBox.choose(action==="yes"?0:1);
      const lines=this.panelTextBox.visibleLines();
      model={context:"choice",title:lines[0]||"CHOOSE",text:lines[1]||"",keys:[
        pageKey("yes","YES",12,59,62,25),pageKey("no","NO",86,59,62,25)]};
      if (this.messagePanel) this.messagePanel.setEnabled(false);
    }
    if (!model) { if (page) page.hide(); return; }
    if (!this.spatialPage) this.spatialPage=new SpatialPage(this,this.camera,(t:Texture)=>this.readingMaterial(t));
    this.spatialPage.show(model,this.camera,dt);
  }

  private driveWorldHands(dt: number): void {
    if (!this.hands || !this.overworld || this.wizard ||
        this.bootPhase === "title" || this.bootPhase === "menu" ||
        this.bootPhase === "intro" || this.bootPhase === "onboarding" ||
        this.bootPhase === "credits" || this.isGameBoyMode()) {
      this.spatialInput.reset();
      this.pinchJoystick.reset();
      this.stopSteering();
      return;
    }
    const walking = !this.worldIsBusy() && !this.viewPage && !(this.spatialPage && this.spatialPage.isEnabled());
    const samples = this.hands.samples();
    this.sayRimHint(walking && samples.some(hand => hand.tracked &&
      this.onDioramaRim(new vec3(hand.x,hand.y,hand.z))));
    this.spatialInput.update(samples,dt,{
      target: (hand) => {
        const menu = this.spatialPage ? this.spatialPage.target(hand) : "";
        if(menu)return menu;
        const panel = this.looseButtons ? this.looseButtons.target(hand) : "";
        if (panel) return panel;
        return this.dioramaAnchor &&
          this.onDioramaRim(new vec3(hand.x,hand.y,hand.z)) ? "world" : "";
      },
      overWorld: (hand) => this.dioramaAnchor !== null &&
        this.overDiorama(new vec3(hand.x,hand.y,hand.z)),
      // UI gets ownership for this pinch. The remaining closed hand cannot
      // turn into a joystick when the button's short pulse expires.
      blocked: (this.pad !== null && (this.pad.anyHeld() || this.pad.secondsSincePress() < 0.12)) ||
        (this.spatialPage && this.spatialPage.interacting() && !this.spatialInput.holding("menu") &&
          !samples.some(hand=>this.spatialPage.target(hand)==="menu")),
      walking: walking,
      onStickStart: () => {
        this.pinchJoystick.reset();
        if (this.route) this.route.cancel();
      },
      onStick: (dx, dz, elapsed) => {
        // Hand displacement from its pinch origin, in centimetres. Independent
        // of the player's location, world scale and camera movement.
        const yaw = -this.dioramaYaw(), c = Math.cos(yaw), sn = Math.sin(yaw);
        const direction = this.pinchJoystick.aim(dx*c+dz*sn,-dx*sn+dz*c,elapsed);
        if (this.stick) this.stick.hold(direction);
      },
      onStop: () => { this.stopSteering(); this.pinchJoystick.reset(); },
      onMove: (target, dx, dy, dz) => {
        const delta = new vec3(dx,dy,dz);
        if(target === "menu") {
          if(this.spatialPage)this.spatialPage.moveBy(delta);
          return;
        }
        if (target === "controls") {
          if (this.looseButtons) this.looseButtons.moveBy(delta);
          return;
        }
        this.battle.moveBy(delta);
        this.moveDioramaAnchor(delta);
        if (this.placer) this.placer.markPlaced();
      },
      onSpan: (factor, radians) => {
        const base = this.plateScale();
        this.battle.scaleAbout(this.dioramaAnchor,factor,base*ZOOM_MIN,base*ZOOM_MAX);
        this.dioramaScale = this.battle.currentScale();
        this.noteZoomFromScale(this.dioramaScale);
        this.userYaw = wrapRadians(this.userYaw+radians);
        this.applyDioramaRotation();
        if (this.placer) this.placer.markPlaced();
      },
      // A short stationary pinch talks; a pinch used to walk or grab never confirms.
      onTap: () => { if (this.pinch && !this.padShadowsTap() &&
        !(this.spatialPage && this.spatialPage.blocksPinch())) this.pinch.tap(); },
      onRecall: () => { if (this.looseButtons) this.looseButtons.recall(); },
    });
    if (this.looseButtons) this.looseButtons.highlight(this.spatialInput.holding("controls"));
    if (this.spatialPage) this.spatialPage.setDragging(this.spatialInput.holding("menu"));
  }

  private onUpdate(event: UpdateEvent): void {
    this.frameCount = this.frameCount + 1;
    this.gbFrames = this.gbFrames + Math.min(getDeltaTime(), 0.1) * GB_FPS;
    // Before every early return: the music has to keep streaming through a
    // menu, a battle and a page of text, and a frame the synth is not asked
    // for is a frame of silence.
    this.audio.tick();
    // ...and before every early return for the same kind of reason: the world
    // is loaded during the wizard, which is upstream of everything below, and
    // a bundle transfer that stops halfway has no other way to be noticed. See
    // BridgeWorldSource.tick.
    if (this.bridge) {
      this.bridge.tick(Math.min(getDeltaTime(), 0.1));
    }
    // A heartbeat for the one failure that has no other signal: everything
    // reports connected, the synth renders a peak of 0.6 off the headset, and
    // the room is silent. Frames delivered and underruns tell those apart, and
    // nothing else in the lens can. Cheap: one line every three seconds.
    this.audioReportFrames = this.audioReportFrames + 1;
    if (this.audioReportFrames >= 180) {
      this.audioReportFrames = 0;
      print("[AudioDriver] " + this.audio.report() +
            " connected=" + this.audio.connected +
            " playing=" + (this.jukebox ? this.jukebox.wanted() : "-"));
    }
    // Before every early return, for the same reason the music is: the wearer
    // holding a pairing button is standing on the TITLE SCREEN, and this used
    // to run six early returns further down -- past the title, the menu, the
    // intro, the onboarding page, a missing overworld, the view page, a battle
    // and an evolution. It never ran once during the only minutes it mattered,
    // which is why the pad was reported as having no UI at all.
    this.updatePadReport(Math.min(getDeltaTime(), 0.1));
    // A preview frame can spike; a huge dt would teleport the player across a wall.
    // The cap TIGHTENS as the speed goes up, so 4X cannot turn one slow frame
    // into a step through a wall: 0.05s of game time either way, four times over.
    const speed = this.speed();
    const realDt = Math.min(getDeltaTime(), 0.1);
    const dt = speed > 1 ? Math.min(getDeltaTime(), 0.1 / speed) * speed : realDt;
    // The pad's pulse clocks run before the router reads it, so a click that
    // expired this frame is already up when the game looks. On REAL time: a
    // press lasts as long as a press, whatever speed the world is running at.
    // A finger on a button, before the pad's clocks and before the router
    // reads it, on every frame of every phase: the setup pages are pressed
    // this way too.
    if (this.fingerPresser && this.hands) {
      this.fingerPresser.update(this.hands.fingertips());
    }
    if (this.pad) {
      this.pad.tick(realDt);
    }
    // Update the compass before sources compensate their directions and the
    // router samples them. Otherwise the first press after a turn uses two
    // different orientations and can walk the opposite way for one frame.
    if (this.overworld) this.updateCompass();
    if (this.route && this.overworld) {
      // The route reads the player's cell in the map's frame and presses in
      // the wearer's, so it is told both every frame. A script, a box or a
      // fight taking the frame ends the walk: whatever it was walking toward
      // has been overtaken by something that wants the player where they are.
      this.route.setViewTurns(this.overworld.viewTurns);
      this.followRouteBody();
      this.route.observe(this.overworld.cellX, this.overworld.cellY, realDt,
                         this.overworld.facing, this.overworld.isMoving());
      if (this.route.isActive() && this.worldIsBusy()) {
        this.route.cancel();
      }
    }
    if (this.stick && this.overworld) {
      this.stick.setViewTurns(this.overworld.viewTurns);
      // A box, a script or a fight taking the frame lets go of the stick as
      // it drops a route; the hand has to pinch again once the world is back.
      if (this.stick.isActive() && this.worldIsBusy()) {
        this.stick.release();
      }
    }
    this.updateCellMarker(realDt);
    // The OPTION page's BUTTONS row and the controllers are read here rather
    // than announced, so a change takes effect the frame it happens however
    // it happened: the row turned, a phone connected, the Game Boy came up.
    this.applyPadPlate();
    const worldCentre = this.dioramaRoot ? this.dioramaRoot.getTransform().getWorldPosition() : null;
    if (this.looseButtons && this.looseButtonsOn) {
      this.looseButtons.follow(this.camera, realDt, this.dioramaAnchor || worldCentre);
      this.looseButtons.press(this.pad, realDt);
    }
    if (this.padView && this.padPlateOn) {
      this.padView.follow(this.camera, dt, worldCentre);
      this.padView.reportScreenPositions(this.camera);
    }
    // The animation clock runs in BOTH modes now. It used to tick only inside
    // updateGameBoyScreen, so the diorama's water was frozen at whatever step
    // the flat screen last left it on -- which was step 0 for anyone who never
    // opened the Game Boy view, meaning most people.
    if (!this.isGameBoyMode()) {
      this.gbAnimClock.tick(dt);
    }
    this.updateWaterPhase();
    // The wind. On the WALL clock, not the game's: grass does not blow four
    // times as fast because the player put the game on 4X.
    this.windSeconds = this.windSeconds + realDt;
    if (this.terrain) {
      this.terrain.animate(this.windSeconds);
    }
    this.driveShake(realDt);
    this.updateVisibilityCutaway(realDt);
    this.updateMessagePanel();
    this.updatePhonePad();
    // Hands come before the router reads its buttons (a pinch is A on the
    // very frame it lands) and before placement: once you have moved the
    // world by hand, the placer must stop trying to put it back.
    this.syncSpatialPage(realDt);
    this.driveWorldHands(realDt);
    this.input.update();
    // Which source is driving is the first thing to know when nothing moves,
    // and the status text only refreshes on a map change.
    const inputName = this.input.activeName();
    if (inputName !== this.lastInputName) {
      this.lastInputName = inputName;
      print("[PokemonAR] input now: " + inputName);
    }
    // Before every boot phase: those all need a bundle, and this is the page
    // for when there is not one yet.
    if (this.wizard) {
      this.driveWizard(dt);
      return;
    }
    if (this.bootPhase === "title" || this.bootPhase === "menu") {
      this.driveBoot(dt);
      return;
    }
    if (this.bootPhase === "credits") {
      this.driveCredits(dt);
      return;
    }
    if (this.creditsWanted && this.overworld && this.loop && !this.loop.isBusy() && !this.pageWaiting) {
      this.creditsWanted = false;
      this.beginCredits();
      return;
    }
    if (this.bootPhase === "intro" || this.bootPhase === "onboarding") {
      this.driveIntro(dt);
      return;
    }
    if (!this.overworld) {
      return;
    }
    this.syncPlayMode();
    this.syncMusic();
    this.syncView();
    if (this.driveViewPage(dt)) {
      return;
    }
    if (this.naming) {
      this.driveNaming(dt);
    }
    if (this.dexEntryScreen) {
      this.driveDexEntryScreen(dt);
    }
    if (this.pictureScreen) {
      this.drivePictureScreen(dt);
    }
    if (this.slots) {
      this.driveSlots(dt);
    }

    if (this.debugAutoWalk) {
      this.driveAutoWalk(dt);
    }

    this.battle.update(dt);

    // The world is frozen while the encounter plays out; walking mid-transition
    // would drag the pivot out from under the growth.
    if (!this.battle.isIdle()) {
      this.updateBattle(dt);
      if (this.runner === null) {
        this.updatePlayerTransform(dt);
        return;
      }
      // A battle that is actually running keeps its input and its engine: the
      // stage is only the room it happens in, and returning here left the
      // fight frozen behind a grown world with nothing to press.
    }

    // A RARE CANDY's new moves and a stone's evolution, once its lines are read.
    if (this.pendingItemUse !== null && this.loop !== null && !this.loop.isBusy() && !this.pageWaiting) {
      this.settleItemUse();
    }

    // Evolution owns the frame between the battle and the world coming back:
    // the cartridge asks it with the box closed and the map up, and B has to
    // reach it rather than the overworld's own A/B handling.
    if (this.isEvolving()) {
      this.driveEvolution(dt);
      this.updatePlayerTransform(dt);
      return;
    }

    // A press means one of three things, in this order: acknowledge the page
    // being read, answer a yes/no, or talk to whatever is in front. Checking
    // them in the other order would have an A press that closes a message box
    // immediately reopen the conversation it closed.
    const pressedA = this.input.pressedA();
    if (this.pageWaiting) {
      // The cartridge ignores A and B until the page it is printing is
      // complete (tools/oracle, 6 sep); battle's own box does not run
      // through the loop's host at all, so textReady() is always true for
      // one and this reads the same as before this fix. GAME BOY mode's
      // overworld box paces itself (gbTextBox.ready(), the same formula
      // Host.ts's own textReady() computes -- see CanvasTextBox.ts's
      // header), read directly here the same way driveIntro() reads
      // introBox.ready(), rather than through the loop.
      const textReady = this.isGameBoyMode()
        ? this.gbTextBox !== null && this.gbTextBox.ready()
        : this.messagePanel !== null && this.panelBoxOpen
          ? this.panelTextBox !== null && this.panelTextBox.ready()
          : (!this.loop || this.loop.textReady());
      if (this.answerWanted) {
        this.driveAnswer(textReady, pressedA, this.input.pressedB(), dt);
      } else if (pressedA && textReady) {
        this.pageAcked = true;
        if (this.jukebox) {
          this.jukebox.playEffect(SFX_PRESS_AB);
        }
      } else if (pressedA && !textReady && !this.isGameBoyMode() && this.panelTextBox) {
        // A while the line is still arriving fills it in, rather than doing
        // nothing. Joshua asked for this on 7 September to raise the pace.
        //
        // It is NOT done in GAME BOY mode: the cartridge ignores A and B until
        // a page has finished printing (measured, tools/oracle, 6 September)
        // and that mode's whole claim is that it matches PyBoy frame for
        // frame. The diorama's box is ours and can be quicker.
        //
        // The press is spent here and does not also acknowledge the page --
        // hurry() reports whether it skipped anything precisely so one press
        // cannot do both and skip every page the instant it appears.
        if (this.panelTextBox.hurry() && this.jukebox) {
          this.jukebox.playEffect(SFX_PRESS_AB);
        }
      }
    }

    // A battle owns the frame ahead of everything else: it is started BY a script
    // in a trainer's case, so a script may be suspended waiting for it.
    if (this.runner !== null) {
      // The first fight's question owns the frame before any of them. It has
      // to: it takes A, and A is also what advances a page of battle text, so
      // a question that shared the frame would answer itself.
      if (this.updateBattleStyle(dt)) {
        this.updatePlayerTransform(dt);
        return;
      }
      // The prompt owns the frame while it is up: the menu must not also take
      // the buttons, and the runner is waiting on it rather than on a page.
      if (this.battleLearn !== null) {
        this.driveBattleLearn(dt);
      } else if (this.menu.isOpen() && !this.pageWaiting) {
        this.driveMenu(dt);
      }
      this.updateRunner();
      this.updatePlayerTransform(dt);
      return;
    }

    // The mart owns the frame while it is up. The clerk's script is suspended
    // inside open_mart and polls shopOpen(); it resumes the frame after this
    // closes it.
    if (this.shop !== null) {
      this.driveShop(dt);
      this.updatePlayerTransform(dt);
      return;
    }

    // A choice list owns it the same way: the script that opened it is
    // suspended until the player picks a row or backs out.
    if (this.choice !== null) {
      this.driveChoice(dt);
      this.updatePlayerTransform(dt);
      return;
    }

    // The PC owns it the same way: the tile's one-command script is suspended
    // inside open_pc until the player logs off.
    if (this.pc !== null) {
      this.drivePc(dt);
      this.updatePlayerTransform(dt);
      return;
    }

    // A machine being taught owns the frame the same way, and for the same
    // reason: nothing is written to storage while it is up.
    if (this.teach !== null) {
      this.driveTeach(dt);
      this.updatePlayerTransform(dt);
      return;
    }

    if (this.loop && this.loop.isBusy()) {
      this.loop.update();
      // A running script owns the frame: the buttons do nothing, grass does not
      // bite, and nothing is written to storage until it finishes. The world
      // still ticks while a SCRIPTED walk is in progress, or the walk the script
      // is waiting on would never take a step and the lens would hold.
      if (this.overworld.isWalkingScripted() || this.overworld.isMoving()) {
        this.overworld.encountersEnabled = false;
        const walked = this.overworld.update(dt, this.input);
        const landing = this.loop.afterStep(this.overworld, walked, true);
        if (walked.mapChanged || landing.warped) {
          this.play.lastMapId = this.overworld.lastMapId;
          this.rebuildDiorama();
        }
      }
      this.updatePlayerTransform(dt);
      return;
    }
    this.pageAcked = false;

    // START opens the overworld menu. It owns the frame while it is up: no
    // walking, no encounters, and no autosave in the middle of a bag transfer.
    if (this.menu && this.menu.isOpen()) {
      this.driveMenu(dt);
      this.updatePlayerTransform(dt);
      return;
    }
    if (this.menu && this.input.pressedStart()) {
      this.menu.openOverworld(this.play.party);
      if (this.jukebox) {
        this.jukebox.playEffect(SFX_START_MENU);
      }
      this.paintMenu();
      this.updatePlayerTransform(dt);
      return;
    }

    // Not mid-step: the cell is already the target's, and the cartridge ignores
    // A while the walk counter runs.
    if (this.loop && pressedA && !this.overworld.isMoving()) {
      const ahead = Overworld.facingDelta(this.overworld.facing);
      const counter = this.overworld.map.isCounter(this.overworld.cellX + ahead[0],
                                                   this.overworld.cellY + ahead[1]);
      const target = this.loop.interact(this.overworld.map.def, this.overworld.cellX,
                                        this.overworld.cellY, this.overworld.facing, counter,
                                        (object: any) => this.overworld.map.objectCell(object));
      if (target) {
        this.talkTarget = target;
        this.setStatus(target.name);
      }
    }

    this.overworld.encountersEnabled = this.loop ? this.loop.encountersAllowed() : false;
    // Before the walk, because it decides what the walk's buttons MEAN. It
    // reads directionHeld from the frame just gone, which is the point: the
    // mapping is allowed to move only in the gaps between presses.
    const result = this.overworld.update(dt, this.input);
    // A bump and a hop are the two things a step can be that are not a step,
    // and both are sounds on the cartridge. Bumping is edge-triggered on the
    // FACING change above rather than on `blocked`, which is true on every
    // frame a direction is held into a wall -- that would be a buzz, not a bump.
    if (this.jukebox) {
      if (result.hopped) {
        this.jukebox.playEffect(SFX_LEDGE);
      } else if (result.blocked && this.overworld.facing === this.lastFacing &&
                 !this.bumpedLastFrame) {
        this.jukebox.playEffect(SFX_COLLISION);
      }
      this.bumpedLastFrame = result.blocked;
    }
    if (result.pushed && this.loop) {
      // Strength moved a boulder: the collision has already moved inside the
      // MapRuntime, so this is the save's half -- a switch opened, or a hole
      // swallowed it -- plus the billboard sliding one cell.
      this.loop.afterPush(this.overworld, result.pushed);
      this.npcMotion.request(result.pushed.name, result.pushed.fromX, result.pushed.fromY,
                             [result.pushed.direction]);
    }
    // Warps and, later, step triggers live in the loop: it decides what a
    // landing amounted to, and the encounter comes from ITS answer.
    const outcome = this.loop
      ? this.loop.afterStep(this.overworld, result, false)
      : { warped: false, encounter: result.encounter };
    // A step you can feel. The counter, not a flag, because a step lands inside
    // Overworld.update and this is the only thing that changes when one does.
    if (this.overworld.steps !== this.lastSteps) {
      this.lastSteps = this.overworld.steps;
      if (this.phone) {
        this.phone.hapticStep();
      }
      // One line per landed step. It is what an editor-driven playtest reads
      // to know that a key or a button actually moved Red, and it is the only
      // per-step record there is: the 3-second diagnostic only runs in
      // auto-walk, which is how a whole session of walking left no trace.
      print("[PokemonAR] step " + this.overworld.steps + " -> " +
            this.overworld.cellX + "," + this.overworld.cellY + " " + this.overworld.facing +
            " [" + this.input.activeName() + "]");
    }
    // A turn without a step is the other half of what a press can mean, and
    // the way to tell "blocked" from "never pressed" without a per-frame print.
    if (this.overworld.facing !== this.lastFacing) {
      this.lastFacing = this.overworld.facing;
      print("[PokemonAR] facing " + this.overworld.facing + " at " +
            this.overworld.cellX + "," + this.overworld.cellY +
            (result.blocked ? " (blocked)" : ""));
    }
    if (result.mapChanged || outcome.warped) {
      this.play.lastMapId = this.overworld.lastMapId;
      this.rebuildDiorama();
      this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");
    } else if (result.landed && this.overworld.isDark()) {
      // The lit window is a few tiles around the player, so it has to follow
      // them. Terrain only: rebuilding the diorama would reset every NPC.
      this.rebuildTerrain();
    }
    if (outcome.encounter) {
      this.onEncounter(outcome.encounter);
      // Inside the Zone, the grass rustles the same way and the battle is a
      // different one: nobody fights, and the menu is BALL / BAIT / ROCK / RUN
      // (script/Safari.ts).
      const safari = inSafariZone(this.overworld.mapId) &&
        this.play.flags[EVENT_IN_SAFARI] === true;
      this.startBattle((r: BattleRunner) =>
        safari
          ? r.startSafari(outcome.encounter.species, outcome.encounter.level,
                          () => Math.random())
          : r.startWild(outcome.encounter.species, outcome.encounter.level,
                        () => Math.random(), this.overworld.mapId));
    } else if (this.debugForceEncounter && this.forceEncounterSeconds > 0) {
      // Waiting on a 25/256 roll makes the battle transition awkward to verify;
      // this fires exactly one encounter from the map's own table instead.
      this.forceEncounterSeconds -= dt;
      if (this.forceEncounterSeconds <= 0) {
        const forced = this.overworld.firstEncounterOfMap();
        if (forced) {
          print("[PokemonAR] forcing an encounter for the transition test");
          this.onEncounter(forced);
          this.startBattle((r: BattleRunner) =>
            r.startWild(forced.species, forced.level, () => Math.random(),
                        this.overworld.mapId));
        }
      }
    }

    // Keep asking for a surface until one is found. Retrying costs nothing in
    // preview (no session, immediate return) and means the diorama settles onto
    // the table as soon as the wearer looks at one. The placer owns its own
    // cadence, so it gets the real frame time rather than a made-up interval.
    if (this.placer && !this.placer.isPlaced()) {
      this.placer.requestSurfacePlacement(dt);
    }
    if (this.placer) {
      // A hit test answers on a callback, so a surface found this frame has to
      // be collected rather than waited for. It becomes the point the player
      // stands on; the map scrolls to suit.
      const placed = this.placer.takePlacement();
      if (placed) {
        this.dioramaAnchor = new vec3(placed.x, placed.y, placed.z);
        // The heading is re-taken with it, and a heading nobody applies is a
        // heading nobody has: without this line the new one waited for the
        // next map load, which on a route is a long walk away.
        this.applyDioramaRotation();
      }
    }
    this.reportPlacement();

    this.updatePlayerTransform(dt);

    // Persist on a timer rather than per step: a step is cheap, a storage write
    // is not, and losing a few seconds of walking is not worth paying for one.
    this.saveCooldown -= dt;
    if (this.saveCooldown <= 0 && !this.saveBlocked &&
        this.play && this.loop && this.loop.canSave()) {
      // Twenty seconds, not five. A save is a write plus a read-back of some
      // thirteen kilobytes through persistentStorageSystem, and the preview
      // logged a "Javascript execution has timed out" inside persist() at the
      // five-second cadence while the project was recompiling. The read-back is
      // load-bearing -- it is what catches a truncated write -- so the cadence
      // gives way instead. Twenty seconds of walking is a cheap thing to lose;
      // a stalled frame is not.
      this.saveCooldown = 20;
      this.persist();
    }

    // A diagnostic heartbeat: without it a stalled walk and a walk that simply is
    // not rolling encounters look identical from the outside.
    this.diagnosticSeconds += dt;
    if (this.diagnosticSeconds >= 3) {
      this.diagnosticSeconds = 0;
      print(
        "[PokemonAR] steps=" + this.overworld.steps +
        " cell=" + this.overworld.cellX + "," + this.overworld.cellY +
        " facing=" + this.overworld.facing +
        " grass=" + this.overworld.lastCellWasGrass +
        " blocked=" + result.blocked +
        // Whether a roll is even possible. "I cannot find any Pokemon" and
        // "encounters are switched off" look identical from the grass.
        " enc=" + this.overworld.encountersEnabled +
        " input=" + this.input.activeName()
      );
    }

    if (this.encounterBannerSeconds > 0) {
      this.encounterBannerSeconds -= dt;
      if (this.encounterBannerSeconds <= 0) {
        this.setStatus(this.overworld.mapId + "  [" + this.input.activeName() + "]");
      }
    }
  }

  /**
   * The world's own part of a battle: grow, hold, shrink.
   *
   * The hold used to be a timer, because the only thing a battle did was show a
   * portrait for six seconds. With a battle actually running, a timer is the
   * bug: the world grew, the six seconds were already spent (nothing set them
   * on this path), the stage shrank on the very next frame -- and the fight
   * carried on invisibly on a tabletop. That is the "it zooms in and then
   * nothing happens" that was reported. A running battle holds the world open
   * and closes it itself when it ends.
   */
  private updateBattle(dt: number): void {
    // The pair is on the ground while the world is still growing around it, so
    // the fight is already there when the growth lands rather than appearing
    // afterwards. GAME BOY mode has no pair and no ground: its fight is the
    // flat screen, repainted here because the overworld's own repaint stops
    // the moment a battle starts.
    if (this.isGameBoyMode()) {
      this.updateGameBoyScreen(dt);
    } else {
      this.updateBattleActors();
    }
    if (this.battle.isBusy()) {
      return;
    }
    // SELECT walks between the two stagings while the fight is on. It is the
    // one button the battle does not already use, and this is the beat the
    // reference footage is built around -- worth a press, not worth taking the
    // room every time a patch of grass rustles. Which one you left it on is
    // remembered, so the next fight opens the way this one ended.
    if (this.runner !== null && this.input.pressedSelect()) {
      this.toggleBattleStaging();
      return;
    }
    if (this.runner !== null) {
      return;
    }
    if (this.battleHoldSeconds > 0) {
      this.battleHoldSeconds -= dt;
    }
    // Only a stage that is actually holding has anything to exit. Without the
    // guard this ran every frame after a fight in TABLE mode or after the
    // shrink had already landed, and exit() said "exit ignored" 158 times in
    // one run of the 11 September log.
    if ((this.battleHoldSeconds <= 0 || this.input.pressedB()) && this.battle.isHeld()) {
      this.battle.exit();
    }
  }

  /**
   * Holds each direction for a beat in turn. Enough to prove that stepping,
   * turning, collision and the walk cycle all work without a controller in hand.
   */
  /**
   * The self-driving smoke test behind `debugAutoWalk`.
   *
   * It walks a small square AND reads whatever is on screen, because a driver
   * that only walks stops dead at the first message box: the intro puts one up
   * on the very first frame and nothing else in the lens ever runs. Pressing A
   * answers yes/no boxes and starts battles too, which for a smoke test is the
   * point -- one flag exercises the whole chain without hardware.
   *
   * The press is QUEUED, so InputSource.update() hands it to the frame after
   * this one; that is also what paces the pages at something readable.
   */
  private driveAutoWalk(dt: number): void {
    const plan = ["down", "down", "right", "right", "up", "up", "left", "left"];
    this.autoWalkSeconds += dt;
    if (this.autoWalkSeconds < 0.45) {
      return;
    }
    this.autoWalkSeconds = 0;
    // A box, a question, a shop or a machine owns the frame: read it, do not
    // try to walk through it.
    if (this.pageWaiting || this.slots !== null ||
        this.shop !== null || this.choice !== null || this.pc !== null || this.teach !== null ||
        (this.menu !== null && this.menu.isOpen())) {
      this.scripted.hold("");
      this.scripted.press("a");
      return;
    }
    this.autoWalkIndex = (this.autoWalkIndex + 1) % plan.length;
    this.scripted.hold(plan[this.autoWalkIndex]);
  }

  /**
   * A wild Pokemon appeared: the announcement, the cry and the buzz.
   *
   * It used to also put a lone 40-pixel portrait three tiles ahead, blown up to
   * two and a half times a character -- the "it towers over the houses" the
   * reference warns about -- and grow the world for a six-second look at it.
   * Both were from before battles ran at all. startBattle() now stages the pair
   * properly and holds the world open for as long as the fight lasts, and it is
   * called on the same frame as this, so a second growth here fought the first.
   */
  private onEncounter(encounter: WildEncounter): void {
    this.lastEncounter = encounter;
    if (this.phone) {
      this.phone.hapticEncounter();
    }
    const name = this.overworld.speciesName(encounter.species);
    this.setStatus("Wild " + name + " appeared!  Lv" + encounter.level);
    this.encounterBannerSeconds = 0;
    if (this.jukebox) {
      this.jukebox.playCry(encounter.species);
    }
  }

  /**
   * Ground height at a point, so anything standing on the world stands ON it.
   *
   * Read off the terrain's own column field, not recomputed. The old version
   * claimed to do that and did not: it re-ran the curve and added a FIXED one
   * voxel, which is only right where the column happens to be one voxel tall.
   * Everywhere else the cast was wrong by the difference -- a voxel proud on
   * flat ground, a voxel INSIDE a ledge during a hop, two voxels above the
   * water while surfing, and, with curvature on, up to a third of a
   * character's height buried by the dome rising toward the map's centre.
   *
   * A point the window has not built yet falls back to the old constant rather
   * than to zero: one wrong voxel for a frame is better than the floor.
   */
  private npcGroundY(sprite: string, x: number, z: number): number {
    if(this.terrain && spriteHeightUnits(sprite,CHARACTER_TILES)<CHARACTER_TILES) {
      const top=this.terrain.propSurfaceY(x,z);if(top!==null)return top;
    }
    return this.groundY(x,z);
  }

  private visibilitySeconds = 0;
  private updateVisibilityCutaway(dt: number): void {
    if(!this.terrain||!this.overworld||!this.camera||!this.worldObject)return;
    this.visibilitySeconds+=dt;
    if(this.visibilitySeconds<0.1)return;
    dt=this.visibilitySeconds;this.visibilitySeconds=0;
    const targets: {x:number;y:number;z:number;ground:number}[]=[];
    const inv=this.worldObject.getTransform().getInvertedWorldTransform();
    const add=(o:SceneObject,height:number)=>{
      if(!o||!o.isEnabledInHierarchy)return;
      const p=inv.multiplyPoint(o.getTransform().getWorldPosition());
      targets.push({x:p.x,y:p.y+height*0.55,z:p.z,ground:p.y});
    };
    if(!this.isGameBoyMode()) {
      add(this.playerObject,CHARACTER_TILES);
      // Nearby cast includes the person addressed across a counter and the starter props.
      const player=this.playerObject?inv.multiplyPoint(this.playerObject.getTransform().getWorldPosition()):null;
      for(const name in this.npcByName){
        const e=this.npcByName[name];if(!e.holder)continue;
        const p=inv.multiplyPoint(e.holder.getTransform().getWorldPosition());
        if(player && Math.abs(p.x-player.x)+Math.abs(p.z-player.z)<=6)
          add(e.holder,spriteHeightUnits(e.object.sprite,CHARACTER_TILES));
      }
      if(this.runner && this.battleActors) {
        for(const o of this.battleActors.visibleHolders()) add(o,BATTLE_MON_UNITS);
      }
    }
    this.terrain.cutaway(this.camera.getTransform().getWorldPosition(),targets,dt);
  }

  private groundY(x: number, z: number): number {
    const surface = this.terrain ? this.terrain.surfaceY(x, z) : null;
    if (surface !== null) {
      return surface;
    }
    const w = this.terrain ? this.terrain.currentWindow() : null;
    if (!w) {
      return VOXEL;
    }
    return curveDrop(x - w.centreX, z - w.centreZ, w.halfExtent, w.curveLevel) + VOXEL;
  }

  /** The shipped cell of an NPC on the current map, or null. */
  private shippedCell(npc: string): number[] {
    const entry = this.npcByName[npc];
    return entry ? [entry.object.x, entry.object.y] : null;
  }

  /** A walk request from the host, in the poll-until-DONE shape the VM uses. */
  private requestNpcWalk(npc: string, path: string[]): number {
    const shipped = this.shippedCell(npc);
    if (!shipped) {
      // Not on this map (or hidden): nothing to walk. DONE, not a hang.
      return DONE;
    }
    return this.npcMotion.request(npc, shipped[0], shipped[1], path);
  }

  /** Put an NPC's billboard where its pose says, mid-step included. No-op in
   * GAME BOY mode, where rebuildNpcs() built no holder for it -- the pose is
   * still tracked there (see npcByName's own comment) for OverworldCanvas to
   * read on the next screen paint. */
  private placeNpc(npc: string, pose: NpcPose): void {
    const entry = this.npcByName[npc];
    if (!entry || !entry.holder || pose === null) {
      return;
    }
    const map = this.overworld.map;
    const x = -map.widthTiles / 2 + pose.visualX * 2 + 1;
    const z = -map.heightTiles / 2 + pose.visualY * 2 + 1;
    entry.holder.getTransform().setLocalPosition(new vec3(x, this.npcGroundY(entry.object.sprite,x,z), z));
    const frame = frameFor(this.drawnFacing(pose.facing),
                           pose.walking && (Math.floor(getTime() * 8) % 2 === 0));
    entry.billboard.setFrame(frame[0], frame[1]);
  }

  /**
   * The lift's jolt, on the node that holds the world and everyone in it.
   *
   * Real seconds: a world running at 4X should not shake four times as fast.
   * The offset is written every frame it runs and once more when it stops, so
   * nothing is left hanging a quarter of a tile off its own ground.
   */
  private driveShake(realDt: number): void {
    if (!this.shakeRoot) {
      return;
    }
    const was = this.shake.running();
    if (!was) {
      return;
    }
    this.shake.step(realDt);
    this.shakeRoot.getTransform().setLocalPosition(new vec3(0, this.shake.offset(), 0));
  }

  /**
   * Re-reads the ground under everyone who is standing still.
   *
   * placeNpc only runs for an NPC that has a pose, which means one that has
   * walked; a cast that never moves keeps the height it was built at. That is
   * fine until the terrain changes under them -- a cut tree, a Flash, a pushed
   * boulder all rebuild the window -- and then they hang above or below it for
   * the rest of the map.
   */
  private refreshNpcGround(): void {
    const map = this.overworld ? this.overworld.map : null;
    if (!map) {
      return;
    }
    for (const name in this.npcByName) {
      const entry = this.npcByName[name];
      if (!entry || !entry.holder) {
        continue;
      }
      const at = entry.holder.getTransform().getLocalPosition();
      entry.holder.getTransform().setLocalPosition(
        new vec3(at.x, this.npcGroundY(entry.object.sprite,at.x,at.z), at.z));
    }
  }

  /**
   * The message box and the menu ride on the Game Boy panel, just beyond
   * its far edge, once both exist. Glyphs are 1 cm; HUD_GLYPH_SCALE makes
   * them legible at the pad's 55 cm.
   */
  private mountHudOnPad(): void {
    if (!this.padView) {
      return;
    }
    if (this.box) {
      // The box draws its two rows downward from its origin.
      this.padView.attachAbove(this.box.sceneObject(), HUD_GAP_CM + 2 * HUD_GLYPH_SCALE, HUD_GLYPH_SCALE,
                               BOX_COLUMNS * HUD_GLYPH_SCALE);
    }
    if (this.menuPanel) {
      this.padView.attachAbove(this.menuPanel.sceneObject(),
                               HUD_GAP_CM + 2 * HUD_GLYPH_SCALE + HUD_GAP_CM + MENU_ROWS * HUD_GLYPH_SCALE,
                               HUD_GLYPH_SCALE, MENU_COLUMNS * HUD_GLYPH_SCALE);
    }
  }

  /**
   * Hides everyone standing where no terrain has been built.
   *
   * NPCs, wandering Pokemon and objects are placed from their MAP coordinates,
   * which exist for the whole map -- while the terrain is a window on part of
   * it. Nothing connected the two, so on the glasses a route showed characters
   * and Pokemon standing in mid-air out past the built edge: "ik zie dan in de
   * verte in niks ineens personages en pokemon en objecten" (Joshua, 10
   * September).
   *
   * Run over every holder each frame rather than inside placeNpc, because
   * placeNpc is one of four places that move a body -- scripts and the map
   * rebuild are the others -- and a cull that has to be remembered at four
   * call sites is a cull that will be forgotten at a fifth.
   */
  /** How many of the cast the last cull hid; a test seam, see testState. */
  private castHiddenCount: number = 0;

  private cullNpcsToWindow(): void {
    if (!this.terrain || !this.overworld) {
      return;
    }
    let hidden = 0;
    let shown = 0;
    for (const name in this.npcByName) {
      const entry = this.npcByName[name];
      if (!entry || !entry.holder) {
        continue;
      }
      const at = entry.holder.getTransform().getLocalPosition();
      // Ask the TERRAIN, not arithmetic. The first version of this converted
      // the holder's position back into map cells and compared them against
      // the window's tile bounds; the conversion was right on paper and people
      // still stood in mid-air on the glasses, so there is no coordinate maths
      // here to be wrong any more.
      //
      // coversPoint is the question, and until 20 September this asked
      // surfaceY() instead -- "is there ground built here". Those stopped
      // being the same question on 11 September, when the terrain began
      // building a COVER wider than the view and cutting the view out of it:
      // ground two tiles past the plate is built and not drawn, so everyone
      // standing on it was left visible, floating beside the model. That is
      // the "lege objecten" of the fifth playtest's screenshot.
      //
      // It also answers for ground that is queued but not yet built, which
      // surfaceY cannot: a row of chunks takes a frame or two to arrive at a
      // chunk boundary, and asking about built-ness blinked everyone standing
      // on the incoming row out and back at every boundary crossed
      // ("personages glitchen", 11 September).
      const inside = this.terrain.coversPoint(at.x, at.z);
      if (inside) {
        shown = shown + 1;
      } else {
        hidden = hidden + 1;
      }
      if (entry.holder.enabled !== inside) {
        entry.holder.enabled = inside;
      }
    }
    this.castHiddenCount = hidden;
    // Said once per change, because a cull that silently does nothing is what
    // the first version was, and there was no way to tell from the outside.
    const said = hidden + "/" + (hidden + shown);
    if (said !== this.npcCullSaid) {
      this.npcCullSaid = said;
      print("[PokemonAR] cast: " + hidden + " of " + (hidden + shown) +
            " hidden, standing where nothing is built");
    }
  }

  /** The cast as placed: {name, cellX, cellY, y, enabled} per body; see testState. */
  private castReport(): any[] {
    const out: any[] = [];
    if (!this.overworld) {
      return out;
    }
    const map = this.overworld.map;
    for (const name in this.npcByName) {
      const entry = this.npcByName[name];
      if (!entry || !entry.holder) {
        continue;
      }
      const at = entry.holder.getTransform().getLocalPosition();
      out.push({
        name: name,
        cellX: Math.round((at.x + map.widthTiles / 2 - 1) / 2),
        cellY: Math.round((at.z + map.heightTiles / 2 - 1) / 2),
        y: Math.round(at.y * 1000) / 1000,
        enabled: entry.holder.enabled,
      });
    }
    return out;
  }

  /** NPCs hidden although they stand on promised ground; see testState. */
  private castHiddenInsideCover(): number {
    if (!this.terrain) {
      return 0;
    }
    let n = 0;
    for (const name in this.npcByName) {
      const entry = this.npcByName[name];
      if (!entry || !entry.holder || entry.holder.enabled) {
        continue;
      }
      const at = entry.holder.getTransform().getLocalPosition();
      // The same question the cull honours, or this measures nothing: ground
      // the wearer can SEE. Cover built past the view is not ground anyone can
      // see, and a body hidden there is hidden rightly.
      if (this.terrain.coversPoint(at.x, at.z)) {
        n = n + 1;
      }
    }
    return n;
  }

  /** Advance every scripted NPC walk and every wanderer, and draw them. */
  private updateNpcMotion(dt: number): void {
    this.tickWanderers(dt);
    this.npcMotion.update(dt);
    const names = this.npcMotion.names();
    for (let i = 0; i < names.length; i++) {
      const pose = this.npcMotion.pose(names[i]);
      this.placeNpc(names[i], pose);
      // The body follows the sprite in the collision map: a wanderer that
      // has moved blocks its new cell and is talked to there, and pokered
      // reserves the destination cell for the whole step.
      if (pose) {
        this.overworld.map.moveObject(names[i], pose.x, pose.y);
      }
    }
    this.cullNpcsToWindow();
  }

  /**
   * The cartridge's UpdateNPCSprite for WALK sprites: a random step or turn
   * every few seconds, never while a script or a box owns the frame, never
   * onto a wall, a warp, another body or the player.
   */
  private tickWanderers(dt: number): void {
    const wanderers: Wanderer[] = [];
    for (const name in this.npcByName) {
      const object = this.npcByName[name].object;
      if (!isWanderer(object)) {
        continue;
      }
      const pose = this.npcMotion.pose(name);
      wanderers.push({ name: name, x: pose ? pose.x : object.x, y: pose ? pose.y : object.y,
                       range: object.range });
    }
    if (wanderers.length === 0) {
      return;
    }
    const frozen = this.worldIsBusy();
    const map = this.overworld.map;
    const px = this.overworld.cellX;
    const py = this.overworld.cellY;
    const canStep = (x: number, y: number): boolean =>
      map.inBounds(x, y) && map.isWalkable(x, y) && map.warpAt(x, y) === null &&
      map.objectAt(x, y) === null && !(x === px && y === py);
    this.wander.tick(dt, wanderers, this.npcMotion, canStep, frozen);
  }

  private updatePlayerTransform(dt: number): void {
    // Presentation follows ALL movement, including Oak's escort, trainer
    // approaches and forced walks. Keep streaming during dialogue as well,
    // so a queued row finishes even when input is suspended by a script.
    if (!this.isGameBoyMode() && this.terrain && this.overworld) {
      const before = this.terrain.currentWindow();
      this.terrain.update(this.overworld.cellX * 2, this.overworld.cellY * 2);
      if (this.terrain.currentWindow() !== before) this.refreshNpcGround();
    }
    this.updateNpcMotion(dt);
    if (this.isGameBoyMode()) {
      this.updateGameBoyScreen(dt);
      return;
    }
    const cell = this.overworld.visualCell();
    const map = this.overworld.map;
    const x = -map.widthTiles / 2 + cell[0] * 2 + 1;
    const z = -map.heightTiles / 2 + cell[1] * 2 + 1;
    this.playerObject.getTransform().setLocalPosition(new vec3(x, this.groundY(x, z), z));
    // ...and the whole model slides so that cell lands on the anchor. The
    // character is the fixed point of the diorama; the map moves.
    this.applyDioramaScroll();

    if (!this.playerBillboard) {
      return;
    }

    // Two-frame walk cycle, advanced only while actually moving so the character
    // stands still rather than marching on the spot.
    const moving = this.overworld.isMoving();
    if (moving) {
      this.walkPhase += dt * 6;
    } else {
      this.walkPhase = 0;
    }
    const walking = moving && Math.floor(this.walkPhase) % 2 === 1;
    // spriteFacing, not facing: on an arrow tile's slide the sprite turns a
    // quarter on every step while the walk keeps its direction.
    const frame = frameFor(this.drawnFacing(this.overworld.spriteFacing()), walking);
    this.syncPlayerSheet();
    this.playerBillboard.setFrame(frame[0], frame[1]);

    if (this.camera) {
      const eye = this.camera.getTransform().getWorldPosition();
      this.playerBillboard.faceCamera(eye);
      for (let i = 0; i < this.npcBillboards.length; i++) {
        this.npcBillboards[i].faceCamera(eye);
      }
      if (this.emoteBillboard) {
        this.emoteBillboard.faceCamera(eye);
      }
    }
    this.updatePlayerShadow(x, z);
  }

  /**
   * The patch under the wearer's own character.
   *
   * Only the player's, not every NPC's. A shadow each would be one more object
   * and one more draw per person on a map that can hold a dozen, and the
   * character your eye is following is the one whose footing you notice.
   */
  private updatePlayerShadow(x: number, z: number): void {
    if (!this.dioramaRoot) {
      return;
    }
    if (!this.playerShadow) {
      this.playerShadow = new GroundShadow(
        this.dioramaRoot, (alpha: number) => this.shadowMaterial(alpha),
        CHARACTER_SHADOW_UNITS);
    }
    this.playerShadow.placeLocal(x, this.groundY(x, z), z);
    this.playerShadow.setEnabled(this.playerObject !== null && this.playerObject.enabled);
  }

  /**
   * One frame of GAME BOY mode's own overworld (SPEC.md "GAME BOY mode --
   * design"): OverworldCanvas.paintOverworld, fed the SAME live
   * Overworld/NpcMotion state the diorama would have used
   * (play/screen/GameBoyView.ts builds the view), uploaded to the Game Boy
   * screen that stayed on since rebuildDiorama() switched into this mode.
   *
   * Skipped while naming or the Pokedex data page owns the canvas -- both
   * leave the screen ON in this mode instead of turning it off (nameEntry(),
   * dexEntry()) so this resumes painting the instant they hand it back,
   * with nothing to reset: every call here is a full repaint, never a
   * dirty-checked one, so there is no stale "paintedVersion" to clear.
   */
  /**
   * Paces, paints and places the room's message panel.
   *
   * Runs every frame the panel exists, even with nothing to say, because the
   * menu rides on the same spot and has to follow the wearer too.
   */
  /**
   * The pad on the phone, every frame there is a phone.
   *
   * Built only once a phone actually reports, so a wearer playing on the panel
   * or a pad never pays for it, and taken off the moment the phone goes quiet.
   */
  private updatePhonePad(): void {
    // Off, by Joshua on 10 September: "kan je de layover van de UI van de
    // buttons op de telefoon controller weghalen". A Game Boy pad drawn in the
    // glasses on top of the handset you are already holding is a second
    // picture of a thing you can see, and it sits between you and the world.
    //
    // The phone still DRIVES the game. PhoneInputSource reads its touches and
    // its zones exactly as before and the haptic tick under the thumb still
    // fires; only the drawing is gone. The view is still torn down here rather
    // than simply never built, so a lens that has already drawn one this
    // session -- a live reload, in the editor -- does not leave it hanging.
    if (this.phonePad) {
      this.phonePad.setEnabled(false);
    }
  }

  private updateMessagePanel(): void {
    if (!this.messagePanel || !this.dioramaRoot) {
      return;
    }
    // A fight's text is pinned to the diorama; everything else follows the
    // head. The reference made the same change in its 2.1.2 -- "NPC dialogue
    // boxes are pinned and no longer head tracked" -- and the reason is what a
    // fight is FOR here: you lean in, you walk round the table, you film it.
    // A box that rides every one of those movements cannot be read and cannot
    // be filmed. Outside a fight the wearer is walking a map and the box has
    // to come with them.
    //
    // Pinned only once the world has STOPPED, not the moment it is framed. The
    // framing flies the diorama at the wearer over about half a second, and
    // isFramed() is true for every frame of that flight -- it is set when the
    // flight starts, because it is what unframe() later undoes. Pinning on it
    // measured the box against where the world used to be and left it wherever
    // the flight ended: the trainer fight whose menu was "verderop", and the
    // wild encounter whose menu was nowhere at all.
    //
    // isSettled() is also what makes SELECT safe mid-fight: growing to
    // life-size is a second flight, and the box gives up its pin, follows the
    // head across it, and takes a fresh one when the world stops again.
    const fighting = this.runner !== null && this.battle !== null &&
      this.battle.isFramed() && this.battle.isSettled();
    // Whether the panel should be VISIBLE at all this frame.
    //
    // The rule lives in PanelVisibility, which has the whole story: the short
    // version is that hideBox() switches this panel off and the fight's menu
    // is drawn ON it, so for two days the menu was painted onto a surface that
    // was not on screen. The wearer saw the frame, the dialogue and the HUD --
    // every one of which is its own object -- and nothing to press.
    const panelWanted = panelShouldShow({
      gameBoy: this.isGameBoyMode(),
      boxOpen: this.panelBoxOpen,
      fightOn: this.runner !== null,
      menuOpen: this.menu !== null && this.menu.isOpen(),
      styleAsked: this.battleStyle !== null,
      // Every surface that takes the whole frame. The list is short and it is
      // exactly the set that calls setScreenEnabled(true) while a page could
      // be open behind it: the OPTION page, the naming screen and a Pokedex
      // entry. See PanelVisibility.frameTaken for why leaving one out is now
      // a visible bug where it used to be harmless.
      frameTaken: this.viewPage !== null || this.naming !== null ||
                  this.dexEntryScreen !== null || this.pictureScreen !== null ||
                  this.slots !== null,
    });
    // Guarded, not written every frame: setEnabled(false) drops the panel's
    // uploaded version to force a repaint, and doing that on every frame of a
    // fight would re-upload a whole canvas for nothing.
    if (this.messagePanel.isEnabled() !== panelWanted) {
      this.messagePanel.setEnabled(panelWanted);
    }
    if (fighting) {
      this.messagePanel.pinToDiorama(this.dioramaRoot, this.camera);
    } else if (this.messagePanel.pinned()) {
      this.messagePanel.unpin();
    }
    this.messagePanel.place(this.camera, Math.min(getDeltaTime(), 0.1));
    if(this.looseButtons) {
      const size=this.messagePanel.drawnSizeCm();
      this.looseButtons.avoidPanel(this.messagePanel.sceneObject(),size[0],size[1]);
    }
    // The frame goes with the pin. A box that follows the head does not need
    // an edge -- it is always square to you and always the same size in the
    // view -- but a box standing in the room does, because from an angle a
    // quad simply stops.
    if (!this.panelFrame) {
      this.panelFrame = new PanelFrame(this.messagePanel.sceneObject().getParent());
    }
    // The frame goes with what it frames. It is a separate object hanging
    // behind the panel, so it stayed standing in the room around nothing at
    // all for as long as the menu was invisible -- which is exactly the "heel
    // nice frame" the wearer could see and the menu he could not.
    const framed = fighting && this.messagePanel.pinned() && panelWanted;
    this.panelFrame.setEnabled(framed);
    if (framed) {
      const size = this.messagePanel.drawnSizeCm();
      this.panelFrame.follow(this.messagePanel.sceneObject(), size[0], size[1], 0.3);
    }
    if (this.menuHolder) {
      const at = this.messagePanel.sceneObject().getTransform();
      const holder = this.menuHolder.getTransform();
      const rotation = at.getWorldRotation();
      const world = at.getWorldPosition();
      holder.setWorldRotation(rotation);
      // The panel is eighteen columns wide and centres itself on all of them,
      // so four short rows land hard left. Slide the holder along its own
      // right by the unused half so what is DRAWN sits over the panel.
      let shift = 0;
      if (this.menuPanel) {
        const unused = this.menuPanel.panelColumns() - this.menuPanel.contentColumns();
        shift = (unused > 0 ? unused : 0) / 2 * PANEL_GLYPH_CM;
      }
      const right = rotation.multiplyVec3(new vec3(1, 0, 0));
      holder.setWorldPosition(new vec3(
        world.x + right.x * shift,
        world.y + right.y * shift + PANEL_MENU_LIFT_CM,
        world.z + right.z * shift
      ));
    }
    // The panel stays cropped to the message box. Both HUD blocks are painted
    // on rows 0..11 of the same canvas, but they are SHOWN by their own quads
    // out in the world beside the Pokemon -- see HudBlockView. The panel still
    // uploads the whole canvas, which is what feeds them.
    //
    // A fight keeps this running even with the box shut: hideBox() closes the
    // box between a menu and the next line, and a HUD frozen on the last thing
    // that happened is worse than no HUD, because it reads as current.
    const fightOn = this.runner !== null;
    if (!this.panelTextBox || !this.panelCanvas || !this.gbFont) {
      return;
    }
    if (!this.panelBoxOpen && !fightOn) {
      return;
    }
    // Cleared first: the panel may be showing more than the box, and a choice
    // box that has just closed must not leave its border standing there.
    // Cleared to NOTHING rather than to paper: this canvas is a panel in a
    // room, and everything it does not draw should be the room. The message
    // box paints its own white paper, so the box itself stays solid.
    this.panelCanvas.clear(SHADE_NONE);
    if (this.battleStyle !== null) {
      // The first fight's question takes the box. It is painted HERE rather
      // than where it is stepped because this is the one place the canvas is
      // cleared and uploaded, and a paint outside it is wiped before it is
      // ever seen -- which is exactly what happened the first time.
      paintBattleStyle(this.panelCanvas, this.gbFont, this.battleStyle.chosen());
    } else if (this.panelBoxOpen) {
      this.panelTextBox.step(this.speed() * 3);
      this.panelTextBox.paint(this.panelCanvas, this.gbFont);
      if (this.choiceBox) {
        this.choiceBox.paint(this.panelCanvas, this.gbFont);
      }
    }
    // The fight's menu goes on the SAME canvas, in a box, over the text it is
    // answering -- the cartridge's own layout, and the end of a month of bare
    // white letters lying across the grass. See BattleMenuBox.
    //
    // The crop grows to reach it and shrinks back when it closes; a menu that
    // needed row 11 and a panel still cropped to row 12 would show the box's
    // bottom edge and none of its rows.
    // The message box's own six rows unless something taller is showing. The
    // choice box asks for its own crop where it opens; this only has to make
    // room for the menu and put the box back when it closes.
    let cropTop = this.choiceBox ? CHOICE_TY : BOX_TY;
    if (fightOn && this.menu && this.menu.isOpen() && this.battleStyle === null) {
      const top = paintBattleMenu(this.panelCanvas, this.gbFont,
                                  this.menu.rows(), this.menu.cursorRow());
      if (top < cropTop) {
        cropTop = top;
      }
    }
    this.messagePanel.setCropRows(cropTop, SCREEN_ROWS - cropTop);
    this.paintBattleHud();
    this.messagePanel.upload(this.panelCanvas, DMG_GREYS);
  }

  /**
   * The two HUD blocks, on the panel the message box already uses.
   *
   * Repainted every frame rather than on a change, because it costs twenty-odd
   * tiles on a canvas that is being cleared and redrawn anyway, and because
   * "repaint when something changed" is how a bar ends up a turn behind the
   * fight. What it draws, and the coordinates it draws at, are measured --
   * see BattleHudScreen's header and tools/oracle/battlehud.py.
   */
  private paintBattleHud(): void {
    if (!this.runner || !this.panelCanvas || !this.gbFont) {
      return;
    }
    const sides = this.runner.hudSides();
    if (sides.length !== 2) {
      return;
    }
    // Both the bar and the number beside it draw the TRAVELLING hp, so a hit
    // drains instead of jumping and the two agree the whole way down.
    this.ensureHudTiles();
    paintPlayerHud(this.panelCanvas, this.gbFont, {
      name: sides[0].name, level: sides[0].level,
      hp: Math.round(this.battleAnim.shownHp(true)), maxHp: sides[0].maxHp,
    }, this.hudTiles);
    paintEnemyHud(this.panelCanvas, this.gbFont, {
      name: sides[1].name, level: sides[1].level,
      hp: this.battleAnim.shownHp(false), maxHp: sides[1].maxHp,
    }, this.hudTiles);
  }

  private updateGameBoyScreen(dt: number): void {
    if (!this.canRenderGameBoy() || this.naming || this.dexEntryScreen || this.pictureScreen || this.slots) {
      return;
    }
    this.gbAnimClock.tick(dt);
    if (this.gbTextBox) {
      this.gbTextBox.step(this.speed());
    }
    this.placeScreen(dt);
    if (this.runner !== null) {
      // The classic layout (play/screen/BattleScreen.ts): the fight never
      // touches the diorama in this mode, so nothing else draws it.
      this.paintGameBoyBattle(dt);
    } else {
      const view = buildGameBoyView(this.bundle, this.overworld, this.npcMotion,
                                    this.loop ? this.loop.reveals() : null,
                                    this.frameCount, this.gbAnimClock.phase());
      paintOverworld(this.canvas, this.bundle, view);
    }
    // START's list, the party, the bag, a battle's moves: on this screen, not
    // on the pad's panel out in the room. Before the message box, which wins
    // the rows they share.
    if (this.menu && this.menu.isOpen()) {
      if (this.runner !== null) {
        paintCanvasBattleMenu(this.canvas, this.gbFont, this.menu.rows(), this.menu.cursorRow());
      } else {
        paintCanvasMenu(this.canvas, this.gbFont, this.menu.rows(), this.menu.cursorRow());
      }
    }
    if (this.gbBoxOpen && this.gbTextBox) {
      this.gbTextBox.paint(this.canvas, this.gbFont);
    }
    // The YES/NO box goes on the flat screen the same way the message box does.
    if (this.choiceBox) {
      this.choiceBox.paint(this.canvas, this.gbFont);
    }
    this.screen.upload(this.canvas, () => DMG_GREYS);
  }

  /**
   * The fight on the flat screen.
   *
   * The pictures come from the same seam DIORAMA mode's actors read
   * (picturesOnField, the ghost's fallback, the SILPH SCOPE's unveil), and the
   * bars drain through the same animator: updateBattleActors never runs here
   * because there is no arena, so the animator is stepped in its place.
   */
  private paintGameBoyBattle(dt: number): void {
    if (!this.runner || !this.canvas || !this.gbFont) {
      return;
    }
    const sides = this.runner.hudSides();
    if (sides.length !== 2) {
      this.canvas.clear(0);
      return;
    }
    this.battleAnim.update(Math.min(dt, 0.1),
                           sides[0].hp, sides[0].maxHp, sides[1].hp, sides[1].maxHp);
    const onField = this.runner.picturesOnField();
    let theirs = onField.length === 2 ? onField[1] : "";
    if (theirs === GHOST_PICTURE && !(this.bundle.pictures && this.bundle.pictures.ghost)) {
      theirs = this.runner.onField()[1];
    }
    this.unveil.step(Math.min(dt, 0.1), theirs);
    theirs = this.unveil.picture();
    paintBattleScreen(this.canvas, this.gbFont, this.bundle, this.ensureHudTiles(),
                      { name: sides[0].name, level: sides[0].level,
                        hp: Math.round(this.battleAnim.shownHp(true)), maxHp: sides[0].maxHp },
                      { name: sides[1].name, level: sides[1].level,
                        hp: this.battleAnim.shownHp(false), maxHp: sides[1].maxHp },
                      onField.length === 2 ? onField[0] : "", theirs);
  }

  /** The HUD's own glyphs from the cartridge, built once and shared by both surfaces. */
  private ensureHudTiles(): BattleHudTiles {
    if (!this.hudTiles) {
      this.hudTiles = new BattleHudTiles(this.bundle);
      print("[PokemonAR] battle HUD tiles: " +
            (this.hudTiles.available() ? "from the cartridge" :
             "MISSING -- rebake the world, the HP bar will be the wrong glyphs"));
    }
    return this.hudTiles;
  }

  /**
   * showLines()'s GAME BOY branch: the same page presentPage() would have
   * put on the pad's DialogueBox, instead loaded into gbTextBox as a
   * one-page book (CanvasTextBox wants a whole text's pages up front, but
   * PlayHost hands this one page at a time -- see the header of
   * play/screen/CanvasTextBox.ts and PlayHost.pageThrough -- so each new
   * page here is its own fresh book; ready()/step() pace it exactly as
   * driveIntro() paces introBox, just never carrying a `cont` scroll's top
   * line across two books the way a single text's OWN pages would).
   */
  private presentGameBoyPage(lines: string[]): void {
    if (this.gbTextBox) {
      this.gbTextBox.show([lines]);
      this.gbBoxOpen = true;
    }
    this.pageWaiting = true;
    print("[PokemonAR] page: " + lines.join(" | "));
  }

  /**
   * Test seam: puts the player on a named map, the way a warp tile would.
   *
   * Some claims can only be measured somewhere with room -- a play area that
   * slides, terrain that is rebuilt -- and a new game starts in Red's bedroom,
   * which is sixteen tiles across against a window that asks for twenty. A LEAF
   * harness spent forty-seven seconds walking into that room's furniture before
   * this existed, and the honest reading is that a regression suite should not
   * have to solve a maze to reach the thing it measures. How the player GOT to
   * a route is not part of any claim about how a route is drawn.
   *
   * It is the same call a warp tile makes -- enterMapAt then rebuildDiorama --
   * so a scenario cannot reach a state the game itself could not.
   */
  testWarp(mapId: string, cellX: number, cellY: number): boolean {
    if (!this.overworld || !this.bundle || !this.bundle.maps[mapId]) {
      return false;
    }
    this.overworld.enterMapAt(mapId, cellX, cellY, "down");
    this.rebuildDiorama();
    return true;
  }

  /**
   * Test seam: reveals or hides a map object exactly as a script's show_object
   * would, and redraws the cast. Oak in his lab ships hidden and is revealed
   * by the escort; a scenario about Oak at his desk should not have to walk
   * the escort first.
   */
  testReveal(mapId: string, npc: string, visible: boolean): boolean {
    if (!this.loop) {
      return false;
    }
    this.loop.setRevealed(mapId, npc, visible);
    this.rebuildNpcs();
    return true;
  }

  /** Test seam: lets LEAF scenarios and the debug harness drive the player. */
  testInput(): ScriptedInputSource {
    return this.scripted;
  }

  /**
   * Test seam: everything a LEAF scenario needs to READ, in one plain object.
   *
   * One method rather than a dozen getters, and a plain object rather than live
   * references, so a scenario cannot reach into the lens and change it by
   * accident. Everything here is either already public elsewhere or a number.
   *
   * `playerOffCentre` is the distance in TILES between the player and the middle
   * of the play window. It is the number the fixed square play area is a claim
   * about, and it is not otherwise visible from outside: the window is a
   * rectangle of map tiles and the player is a cell, so nothing in the scene
   * graph states the relationship the wearer actually sees.
   */
  testState(): any {
    const w = this.terrain ? this.terrain.currentWindow() : null;
    const anchor = this.dioramaAnchor;
    const tileX = this.overworld ? this.overworld.cellX * 2 : -1;
    const tileZ = this.overworld ? this.overworld.cellY * 2 : -1;
    return {
      // Where the game is
      phase: this.runner !== null ? "battle"
           : this.overworld !== null ? "overworld"
           : this.bootPhase !== "" ? this.bootPhase
           : "wizard",
      bootPhase: this.bootPhase,
      wizard: this.wizard ? this.wizard.state() : "",
      worldLoaded: this.bundle !== null && this.bundle !== undefined,
      mapId: this.overworld ? this.overworld.mapId : "",
      // Which way the player is looking. A scenario cannot get at this any
      // other way, and more than one claim is about it: a trainer who spots
      // you does NOT turn you round, and a door is faced before it is walked
      // into rather than after.
      facing: this.overworld ? this.overworld.facing : "",
      cellX: this.overworld ? this.overworld.cellX : -1,
      cellY: this.overworld ? this.overworld.cellY : -1,
      partyCount: this.play && this.play.party ? this.play.party.length : 0,
      // GAME BOY mode draws a flat screen and builds no terrain at all, so a
      // window of -1 means this and not a slow frame. A harness that mashes
      // buttons through the boot menu can toggle it by accident, and did.
      playMode: this.play ? this.play.playMode : "",
      // What the boot menu currently has selected, readable BEFORE a game
      // starts. play.playMode only exists once there is a save to put it in, so
      // without this a harness cannot tell which mode it is about to start in
      // until it is already too late to choose.
      bootPlayMode: this.bootOptions ? this.bootOptions.playMode : "",
      // The play area
      windowMinTileX: w ? w.minTileX : -1,
      windowMaxTileX: w ? w.maxTileX : -1,
      windowMinTileZ: w ? w.minTileZ : -1,
      windowMaxTileZ: w ? w.maxTileZ : -1,
      windowTilesX: w ? w.maxTileX - w.minTileX + 1 : -1,
      windowTilesZ: w ? w.maxTileZ - w.minTileZ + 1 : -1,
      playerOffCentre: w ? Math.max(
        Math.abs(tileX - (w.minTileX + w.maxTileX) / 2),
        Math.abs(tileZ - (w.minTileZ + w.maxTileZ) / 2)) : -1,
      // Where the world and any fight are standing
      anchorX: anchor ? anchor.x : 0,
      anchorY: anchor ? anchor.y : 0,
      anchorZ: anchor ? anchor.z : 0,
      battleFramed: this.battle ? this.battle.isFramed() : false,
      battleSettled: this.battle ? this.battle.isSettled() : false,
      dioramaScale: this.dioramaScale,
      // What the terrain has had to build, so a stall is a number
      chunkBuilds: this.terrain ? this.terrain.buildCount() : -1,
      coverAcross: this.terrain ? this.terrain.coverChunksAcross() : 0,
      // What the ZOOM row is ASKING for, in tiles. The window is the answer, and
      // a scenario that assumed the default rung was really asserting which rung
      // the save happened to be on.
      zoomAsks: zoomTilesAcross(this.viewSettings().zoom),
      // The two pages a harness has to steer through, described rather than
      // counted. The START menu's rows change with the story -- the Pokedex and
      // the player's own name arrive later -- so a scenario that counted presses
      // would break on the day the player earns a row. It navigates by LABEL.
      // The cast. castHiddenInsideCover is the number that must be ZERO at
      // every poll of a walk: an NPC standing on ground the terrain has
      // promised (built or queued) and yet not drawn is the blink the
      // 11 September recordings show at each chunk boundary.
      castHidden: this.castHiddenCount,
      castCount: this.castReport().length,
      // Every drawn-or-hidden body: its cell, its height and whether it is on.
      cast: this.castReport(),
      castHiddenInsideCover: this.castHiddenInsideCover(),
      menuOpen: this.menu ? this.menu.isOpen() : false,
      menuRows: this.menu && this.menu.isOpen() ? this.menu.rows() : [],
      menuCursor: this.menu && this.menu.isOpen() ? this.menu.cursorRow() : -1,
      viewPageOpen: this.viewPage !== null,
      viewCursor: this.viewPage ? this.viewPage.cursorRow() : -1,
      // A page of text waiting to be read: what a pinch beside the world must
      // be able to close (pinch-walks-there).
      pageOpen: this.pageWaiting,
      // Whether a pinched route is walking. The scenario waits on the cell,
      // not on this; it is here so a failure says which half went wrong.
      routeActive: this.route ? this.route.isActive() : false,
    };
  }

  /**
   * Test seam: the world point over the middle of a cell of the current map,
   * a hand's height above it -- where a LEAF hand pinches to walk there. The
   * inverse of walkTo's cell mapping, through the same transform.
   */
  /** Test seam: the tap a released pinch produces, at a world point. */
  testPinchAt(at: vec3): void {
    this.pinchAt(at);
  }

  testCellWorldPosition(cx: number, cy: number): vec3 {
    if (!this.overworld || !this.dioramaRoot) {
      return null;
    }
    const map = this.overworld.map;
    const local = new vec3(2 * cx + 1 - map.widthTiles / 2, 1.5, 2 * cy + 1 - map.heightTiles / 2);
    return this.dioramaRoot.getTransform().getWorldTransform().multiplyPoint(local);
  }
}
