// A picture in a box, with its caption under it: the museum's two fossils and
// the bird through the binoculars on Route 15.
//
// The cartridge has one routine for it, DisplayMonFrontSpriteInBox: a framed
// box on the map screen with a front picture in it, left up while the text
// box underneath is read, and taken down with it. The three places that call
// it outside a Pokedex are the AERODACTYL and KABUTOPS fossils in MUSEUM_1F
// (17:$5BAD, $5BC3) and the ARTICUNO the upstairs binoculars of the Route 15
// gate show (17:$5B8F). Until 20 September the lens said the words and showed
// nothing.
//
// Its lifecycle is the Pokedex page's (DexEntryScreen.ts): the script is
// suspended, A turns the caption's pages, the last A closes it. Pure: a
// GbCanvas is painted, and a node test reads the pixels.

import type { WorldBundle } from "../../world/WorldData";
import type { GbCanvas, GbFont, ShadeImage } from "./GbCanvas";
import { imageFromPacked } from "./GbCanvas";

const TILE: number = 8;
const SCREEN_TILES_X: number = 20;
/** The picture's frame: nine tiles square, a front picture's seven plus the border. */
export const PICTURE_BOX_TILES: number = 9;
export const PICTURE_BOX_TX: number = Math.floor((SCREEN_TILES_X - PICTURE_BOX_TILES) / 2);
export const PICTURE_BOX_TY: number = 1;
/** The caption's box: the message box's own six rows at the foot of the screen. */
const TEXT_BOX_TY: number = 12;
const TEXT_BOX_TH: number = 6;
const TEXT_INSET_X: number = TILE;

/** A species' front picture is asked for as "species:ARTICUNO"; anything else is a key of bundle.pictures. */
export const PICTURE_SPECIES_PREFIX: string = "species:";

/** The packed image behind a picture key, or null when this bundle has none. */
export function pictureFor(bundle: WorldBundle, key: string): any {
  if (!key) {
    return null;
  }
  if (key.indexOf(PICTURE_SPECIES_PREFIX) === 0) {
    const spec: any = bundle.species ? (bundle.species as any)[key.substring(PICTURE_SPECIES_PREFIX.length)] : null;
    return spec && spec.front ? spec.front : null;
  }
  const pictures: any = bundle.pictures ? bundle.pictures : null;
  return pictures && pictures[key] ? pictures[key] : null;
}

export class PictureController {
  private image: ShadeImage;
  private pages: string[][];
  private page: number = 0;
  private done: boolean = false;
  private version: number = 0;

  /** `pages` is the caption as the message box would page it: lines per page. */
  constructor(bundle: WorldBundle, key: string, pages: string[][]) {
    const packed = pictureFor(bundle, key);
    this.image = packed ? imageFromPacked(packed) : null;
    this.pages = pages ? pages : [];
    if (this.pages.length === 0) {
      this.pages = [[]];
    }
  }

  isOpen(): boolean {
    return !this.done;
  }

  stateVersion(): number {
    return this.version;
  }

  /** A turns the caption's page; the last one closes picture and caption together. */
  step(pressedA: boolean): void {
    if (this.done || !pressedA) {
      return;
    }
    if (this.page + 1 < this.pages.length) {
      this.page++;
    } else {
      this.done = true;
    }
    this.version++;
  }

  paint(canvas: GbCanvas, font: GbFont): void {
    canvas.clear(0);
    font.box(canvas, PICTURE_BOX_TX, PICTURE_BOX_TY, PICTURE_BOX_TILES, PICTURE_BOX_TILES);
    if (this.image) {
      // Centred in the frame, standing on its floor: a 40-pixel picture in a
      // 56-pixel space sits on the bottom edge the way a small Pokemon does.
      const inside = (PICTURE_BOX_TILES - 2) * TILE;
      const x = (PICTURE_BOX_TX + 1) * TILE + Math.floor((inside - this.image.width) / 2);
      const y = (PICTURE_BOX_TY + 1) * TILE + (inside - this.image.height);
      canvas.blit(this.image, x, y, true);
    }
    font.box(canvas, 0, TEXT_BOX_TY, SCREEN_TILES_X, TEXT_BOX_TH);
    const lines = this.pages[this.page];
    for (let i = 0; i < lines.length && i < 2; i++) {
      font.text(canvas, lines[i], TEXT_INSET_X, (TEXT_BOX_TY + 2 + i * 2) * TILE);
    }
  }
}
