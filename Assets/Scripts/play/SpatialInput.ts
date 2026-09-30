// Gesture ownership is chosen on pinch-down and kept until release.
// Tracking loss cancels; a reacquired closed hand must open before starting again.
export interface HandSample {
  id: number; // SIK LeftHand=1, RightHand=2
  tracked: boolean;
  pinching: boolean;
  x: number; y: number; z: number;
}
export type SpatialTarget = "world" | "controls" | "menu" | "recall" | "";
export interface SpatialCallbacks {
  target: (hand: HandSample) => SpatialTarget;
  overWorld?: (hand: HandSample) => boolean;
  blocked: boolean;
  walking: boolean;
  onStick: (dx: number, dz: number, dt: number) => void;
  onStickStart: () => void;
  onStop: () => void;
  onMove: (target: SpatialTarget, dx: number, dy: number, dz: number) => void;
  onSpan: (factor: number, radians: number) => void;
  onTap: () => void;
  onRecall: () => void;
}
interface Gesture {
  down: boolean; armed: boolean; mode: string;
  origin: HandSample; last: HandSample; seconds: number; moved: boolean;
}
const fresh = (): Gesture => ({down: false, armed: true, mode: "", origin: null, last: null, seconds: 0, moved: false});
const distance = (a: HandSample, b: HandSample): number =>
  Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
export class SpatialInput {
  private gestures: Gesture[] = [fresh(), fresh()];
  private spanning: boolean = false;
  private span: number = 0;
  private bearing: number = 0;

  reset(): void {
    // Called while another screen owns input: closed hands cannot leak across it.
    this.gestures = [fresh(), fresh()];
    this.gestures[0].armed = this.gestures[1].armed = false;
    this.spanning = false;
  }

  update(hands: HandSample[], dt: number, cb: SpatialCallbacks): void {
    const samples = [hands.find(h => h.id === 1), hands.find(h => h.id === 2)];
    for (let i = 0; i < 2; i++) {
      const h = samples[i]; const g = this.gestures[i];
      if (!h || !h.tracked || !h.pinching) {
        if (h && h.tracked && !h.pinching && g.down &&
            (g.mode === "tap" || (g.mode === "stick" && cb.walking)) &&
            !g.moved && !cb.blocked && g.seconds < 0.45 && distance(h, g.origin) < 1.5) cb.onTap();
        g.down = false; g.mode = ""; g.armed = !!(h && h.tracked && !h.pinching);
        continue;
      }
      if (!g.down) {
        g.down = true; g.origin = {...h}; g.last = {...h}; g.seconds = 0; g.moved = false;
        const other = this.gestures[1-i];
        const target = cb.target(h);
        g.mode = !g.armed || cb.blocked ? "blocked" :
          target ? target : other.down && other.mode !== "blocked" ? "blocked" : cb.walking ? "stick" : "tap";
        // A grip cannot steal an ongoing joystick or a different panel's drag.
        if (other.down && (other.mode === "stick" || other.mode === "controls" || other.mode === "menu" ||
            (other.mode === "world" && g.mode !== "world"))) g.mode = "blocked";
        // Two deliberate pinches over the plate restore scale/turn anywhere
        // on its surface. A button-owned or tracking-cancelled hand cannot join.
        const second = samples[1-i];
        if (g.armed && !cb.blocked && (cb.walking || other.mode === "world") && (!target || target === "world") &&
            other.down && (other.mode === "stick" || other.mode === "world") &&
            second && second.tracked && second.pinching && cb.overWorld &&
            cb.overWorld(h) && cb.overWorld(second)) {
          g.mode = other.mode = "world";
        }
        if (g.mode === "tap") { cb.onTap(); g.mode = "confirmed"; }
        if (g.mode === "recall") cb.onRecall();
        if (g.mode === "stick") cb.onStickStart();
      }
      g.seconds += dt;
      if (distance(h, g.origin) >= 1.5) g.moved = true;
      if (cb.blocked || (g.mode === "stick" && !cb.walking)) g.mode = "blocked";
      if (g.mode === "tap" && distance(h, g.origin) >= 2) g.mode = "blocked";
    }
    const pair = this.gestures.every(g => g.down && g.mode === "world");
    if (this.spanning && !pair) {
      // Releasing either hand ends the span. The remaining hand does not become a drag.
      for (const g of this.gestures) if (g.down) g.mode = "blocked";
      this.spanning = false;
    }
    if (!this.gestures.some(g => g.down && g.mode === "stick")) cb.onStop();
    if (pair) {
      const a = samples[0], b = samples[1];
      const span = distance(a, b);
      const bearing = Math.atan2(b.x-a.x, b.z-a.z);
      if (this.spanning && span >= 6 && this.span >= 6) {
        let turn = bearing-this.bearing;
        while (turn > Math.PI) turn -= 2*Math.PI;
        while (turn < -Math.PI) turn += 2*Math.PI;
        // Ignore discontinuities from tracking jumps instead of magnifying them.
        const factor = span/this.span;
        if (factor > 0.8 && factor < 1.25 && Math.abs(turn) < Math.PI/6) cb.onSpan(factor, turn);
      }
      this.spanning = true; this.span = span; this.bearing = bearing;
    } else {
      for (let i = 0; i < 2; i++) {
        const h = samples[i], g = this.gestures[i];
        if (!h || !g.down) continue;
        if (distance(h, g.last) > 20) {
          if (g.mode === "stick") cb.onStop();
          g.mode = "blocked";
          continue;
        }
        if (g.mode === "stick") cb.onStick(h.x-g.origin.x, h.z-g.origin.z, dt);
        if (g.mode === "world" || g.mode === "controls" || g.mode === "menu")
          cb.onMove(g.mode as SpatialTarget, h.x-g.last.x, h.y-g.last.y, h.z-g.last.z);
      }
    }
    for (let i = 0; i < 2; i++) if (samples[i] && this.gestures[i].down) this.gestures[i].last = {...samples[i]};
  }

  holding(target: SpatialTarget): boolean { return this.gestures.some(g => g.down && g.mode === target); }
}

/** Centimetres from pinch origin; hysteresis prevents diagonal tracking noise flipping axes. */
export class PinchJoystick {
  private x: number = 0;
  private z: number = 0;
  private direction: string = "";
  reset(): void { this.x = this.z = 0; this.direction = ""; }
  aim(x: number, z: number, dt: number): string {
    const k = 1-Math.exp(-Math.max(0, dt)/0.035);
    this.x += (x-this.x)*k; this.z += (z-this.z)*k;
    const ax = Math.abs(this.x), az = Math.abs(this.z);
    if (Math.max(ax,az) < (this.direction ? 1.0 : 1.5)) return this.direction = "";
    const horizontal = this.direction === "left" || this.direction === "right";
    let useX = ax >= az;
    if (this.direction) useX = horizontal ? az <= ax*1.3 : ax > az*1.3;
    return this.direction = useX ? (this.x > 0 ? "right" : "left") : (this.z > 0 ? "down" : "up");
  }
}
