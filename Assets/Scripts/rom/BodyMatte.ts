// The body of a back picture, for a sprite the cartridge only ever drew on white.
//
// Gen 1's back pictures are line sketches: Pikachu, Dewgong, Jigglypuff,
// Nidorino and a dozen others have outlines that simply stop, because on the
// Game Boy the whole screen behind them is white and an open contour costs
// nothing. The extractor's matte (datasets/pokemon.ts, matteColor0) floods the
// white in from the border, which is right for a closed outline and wrong for a
// sketch: the flood pours through the gaps and the body comes out as lace, a
// few dashes hanging over the diorama floor -- the 19 September screenshot.
//
// This puts the body back the way the eye does on white: the outline is
// thickened by BODY_GAP pixels so its gaps close, the outside is flooded in
// from the border around that thickened line, and then the outside is grown
// back the same distance -- but only through white, never across ink, so it
// cannot creep back in through the line it was kept out by. Whatever the
// outside does not reach is body. A concavity wider than twice the gap (the
// air between two ears) stays open; a slit narrower than that is filled, which
// on a sketch is the right mistake. Pure: it returns a new mask.

/** Half the widest gap in an outline that still counts as closed, in pixels. */
export const BODY_GAP: number = 3;

const STEPS: number[][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * A copy of `alpha` (one 0/1 byte per pixel, row-major) with the body behind
 * an open outline made opaque.
 */
export function fillBody(alpha: Uint8Array, width: number, height: number, gap: number = BODY_GAP): Uint8Array {
  // Work on a frame `gap + 1` wider all round, so the outside has somewhere to
  // start from even when ink touches the picture's edge.
  const pad = gap + 1;
  const w = width + pad * 2;
  const h = height + pad * 2;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] !== 0) {
        ink[(y + pad) * w + x + pad] = 1;
      }
    }
  }
  // 1. The outline, thickened: every pixel within `gap` steps of ink.
  const thick = grow(ink, w, h, gap, null);
  // 2. The outside: flooded from the frame's corner, kept out by the thick line.
  const outside = new Uint8Array(w * h);
  const queue: number[] = [0];
  outside[0] = 1;
  let head = 0;
  while (head < queue.length) {
    const at = queue[head++];
    const x = at % w;
    const y = (at - x) / w;
    for (let i = 0; i < STEPS.length; i++) {
      const nx = x + STEPS[i][0];
      const ny = y + STEPS[i][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        continue;
      }
      const n = ny * w + nx;
      if (outside[n] === 0 && thick[n] === 0) {
        outside[n] = 1;
        queue.push(n);
      }
    }
  }
  // 3. The outside grown back the same distance, through white only.
  const reached = grow(outside, w, h, gap, ink);
  const out = new Uint8Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = (y + pad) * w + x + pad;
      out[y * width + x] = ink[n] === 1 || reached[n] === 0 ? 1 : 0;
    }
  }
  return out;
}

/**
 * `seed` grown by `steps` four-neighbour steps; never into a `wall` pixel when
 * a wall is given. Breadth first, so a step is a step.
 */
function grow(seed: Uint8Array, w: number, h: number, steps: number, wall: Uint8Array): Uint8Array {
  const out = new Uint8Array(seed.length);
  let frontier: number[] = [];
  for (let i = 0; i < seed.length; i++) {
    if (seed[i] !== 0) {
      out[i] = 1;
      frontier.push(i);
    }
  }
  for (let step = 0; step < steps; step++) {
    const next: number[] = [];
    for (let f = 0; f < frontier.length; f++) {
      const at = frontier[f];
      const x = at % w;
      const y = (at - x) / w;
      for (let i = 0; i < STEPS.length; i++) {
        const nx = x + STEPS[i][0];
        const ny = y + STEPS[i][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          continue;
        }
        const n = ny * w + nx;
        if (out[n] === 0 && (wall === null || wall[n] === 0)) {
          out[n] = 1;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The same, over RGBA pixels: a new buffer whose alpha channel has the body
 * filled in. The colour of a filled pixel is left as decoded, which for these
 * pictures is the white the cartridge drew it in.
 */
export function fillBodyRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height;
  const alpha = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    alpha[i] = rgba[i * 4 + 3] === 0 ? 0 : 1;
  }
  const filled = fillBody(alpha, width, height);
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i++) {
    out[i] = rgba[i];
  }
  for (let i = 0; i < count; i++) {
    if (filled[i] === 1 && alpha[i] === 0) {
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}
