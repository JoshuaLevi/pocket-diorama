// Run: node --experimental-strip-types --import ./test/register.mjs Assets/Tests/CodeKeyboard.test.mjs
import assert from "node:assert/strict";
import { CodeEntry, CODE_ALPHABET, CODE_DONE, CODE_STAY } from "../Scripts/play/screen/CodeEntry.ts";
import { SetupWizard, WIZ_FETCH_CODE } from "../Scripts/play/screen/SetupWizard.ts";
import { codeKeys, keyAtPixel, keyEnabled, CodeKeyGesture,
  KEYBOARD_CM_PER_PIXEL, paintCodeKeyboard } from "../Scripts/play/screen/CodeKeyboardLayout.ts";
import { GbCanvas } from "../Scripts/play/screen/GbCanvas.ts";

const keys = codeKeys();
assert.equal(keys.length, 34);
for (let i = 0; i < 32; i++) {
  const k = keys[i];
  assert.equal(k.label, CODE_ALPHABET[i]);
  assert.equal(keyAtPixel(keys, k.x + k.width / 2, k.y + k.height / 2), i);
  assert.ok(k.width * KEYBOARD_CM_PER_PIXEL >= 5.5);
  assert.ok(k.height * KEYBOARD_CM_PER_PIXEL >= 5.5);
  assert.equal(keyAtPixel(keys, k.x + k.width + 1, k.y + k.height / 2), -1);
  const entry = new CodeEntry(false);
  entry.selectCell(k.row, k.column);
  assert.equal(entry.code(), k.label);
}
assert.equal(keyAtPixel(keys, 60, 126), -1); // gap between DELETE and LOAD
assert.equal(keyAtPixel(keys, 80, 30), -1); // code display is not a key
assert.equal(keyEnabled(keys[32], ""), false);
assert.equal(keyEnabled(keys[33], "ABCDE"), false);
assert.equal(keyEnabled(keys[33], "ABC234"), true);
assert.equal(keyEnabled(keys[33], "ABC23O"), false);
assert.equal(keyEnabled(keys[0], "ABC234"), false);

const gesture = new CodeKeyGesture();
assert.equal(gesture.end(0), -1); // release with no targeted start
gesture.begin(0);
gesture.begin(1); // a held pinch cannot migrate to another letter
assert.equal(gesture.end(1), -1);
gesture.begin(2);
gesture.cancel();
assert.equal(gesture.end(2), -1);
gesture.begin(3);
assert.equal(gesture.end(3), 3);
assert.equal(gesture.end(3), -1); // duplicate release never repeats

const entry = new CodeEntry(false);
for (const [r, c] of [[-1, 0], [0, 8], [4, 2], [NaN, 0], [0.5, 0]]) entry.selectCell(r, c);
assert.equal(entry.code(), "");
for (const ch of "ABC234") {
  const i = CODE_ALPHABET.indexOf(ch);
  assert.equal(entry.selectCell(Math.floor(i / 8), i % 8), CODE_STAY);
}
assert.equal(entry.code(), "ABC234");
entry.selectCell(0, 7);
assert.equal(entry.code(), "ABC234"); // full field does not overflow
assert.equal(entry.selectCell(4, 1), CODE_DONE); // explicit LOAD only
entry.selectCell(4, 0);
assert.equal(entry.code(), "ABC23");
assert.equal(entry.selectCell(4, 1), CODE_STAY);

// Draw every hover/press state with clipping rejected, including disabled keys.
const canvas = new GbCanvas();
const fill = canvas.fillRect.bind(canvas);
canvas.fillRect = (x, y, w, h, shade) => {
  assert.ok(x >= 0 && y >= 0 && x + w <= 160 && y + h <= 144,
    `outside canvas: ${x},${y},${w},${h}`);
  fill(x, y, w, h, shade);
};
for (const code of ["", "ABC", "ABC234"]) {
  for (let i = -1; i < keys.length; i++) paintCodeKeyboard(canvas, keys, code, i, i, [0, 0]);
}

// Wizard integration: targeted events cannot double-type via an accompanying A,
// submit an incomplete code, or leak into another page.
const wizard = new SetupWizard(false, "", "kanto", false, true, "https://example.test", false);
wizard.needCode();
wizard.step(1, false, false, false);
assert.ok(wizard.onGridPage());
wizard.queueCodeCell(4, 1);
assert.notEqual(wizard.step(0.01, false, false, false), WIZ_FETCH_CODE);
for (const ch of "ABC234") {
  const i = CODE_ALPHABET.indexOf(ch);
  wizard.queueCodeCell(Math.floor(i / 8), i % 8);
  wizard.queueCodeCell(0, 7); // a second event in the frame is discarded
  assert.notEqual(wizard.step(0.01, true, false, false), WIZ_FETCH_CODE);
}
assert.equal(wizard.typedCode(), "ABC234");
wizard.queueCodeCell(4, 1);
assert.equal(wizard.step(0.01, false, false, false), WIZ_FETCH_CODE);
assert.equal(wizard.enteredCode(), "ABC234");
wizard.queueCodeCell(0, 7);
assert.notEqual(wizard.step(0.01, true, false, false), WIZ_FETCH_CODE);
assert.equal(wizard.enteredCode(), "ABC234");
console.log("CODE KEYBOARD: layout, 32 direct keys, gesture cancellation, drawing and wizard flow PASS");

// Exercise the actual view's SIK callback wiring with lightweight engine stand-ins.
// This catches gesture ownership bugs which the pure state machine cannot see.
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { Object.assign(this, {x, y, z}); } };
globalThis.TextureFormat = {RGBA8Unorm: 0};
globalThis.MeshTopology = {Triangles: 0};
globalThis.MeshIndexType = {UInt16: 0};
globalThis.MeshBuilder = class {
  appendVerticesInterleaved() {} appendIndices() {} updateMesh() {} getMesh() { return {}; }
};
globalThis.ProceduralTextureProvider = {createWithFormat: () => ({control: {setPixels() {}}})};
globalThis.deviceInfoSystem = {isEditor: () => false};
let time = 1;
globalThis.getTime = () => time;
globalThis.Shape = {createBoxShape: () => ({})};
const controls = [];
const signal = () => ({callbacks: [], add(fn) { this.callbacks.push(fn); },
  fire(args) { for (const fn of this.callbacks) fn(args); }});
const object = () => ({
  enabled: true, setParent() {}, getTransform: () => ({setLocalPosition() {}}),
  createComponent(type) {
    if (type !== "TestInteractable") return {};
    const c = {};
    for (const name of ["onHoverEnter", "onHoverExit", "onInteractorTriggerStart",
      "onInteractorTriggerEnd", "onInteractorTriggerEndOutside", "onTriggerCanceled"]) c[name] = signal();
    controls.push(c);
    return c;
  },
});
globalThis.scene = {createSceneObject: object};
globalThis.require = () => ({Interactable: {getTypeName: () => "TestInteractable"}, InteractorInputType: {Mouse: 32}});
const { FloatingCodeKeyboard } = await import("../Scripts/play/screen/FloatingCodeKeyboard.ts");
const picks = [];
const view = new FloatingCodeKeyboard({getSceneObject: object}, null, () => ({}), (r, c) => picks.push([r, c]));
assert.equal(controls.length, 34);
const right = {interactor: {hand: "right"}};
const left = {interactor: {hand: "left"}};
view.setEnabled(true);
view.update(null, 0, "", [0, 0]);
controls[0].onHoverEnter.fire(right);
controls[0].onInteractorTriggerStart.fire(right);
assert.equal(picks.length, 0); // no type on pinch-down
controls[0].onInteractorTriggerStart.fire(left);
controls[0].onInteractorTriggerEnd.fire(left);
assert.equal(picks.length, 0); // the other hand cannot finish this pinch
controls[0].onInteractorTriggerEnd.fire(right);
controls[0].onInteractorTriggerEnd.fire(right);
assert.deepEqual(picks, [[0, 0]]);
time++;
controls[1].onInteractorTriggerStart.fire(right);
controls[1].onInteractorTriggerEndOutside.fire(right);
controls[1].onInteractorTriggerEnd.fire(right);
assert.equal(picks.length, 1);
time++;
controls[1].onHoverEnter.fire(right);
controls[1].onInteractorTriggerStart.fire(right);
controls[1].onHoverExit.fire(right);
controls[1].onInteractorTriggerEnd.fire(right);
assert.equal(picks.length, 1);
view.update(null, 0, "ABCDE", [0, 0]);
controls[33].onInteractorTriggerStart.fire(right);
controls[33].onInteractorTriggerEnd.fire(right);
assert.equal(picks.length, 1); // LOAD is disabled until valid and complete
view.update(null, 0, "ABC234", [4, 1]);
controls[33].onInteractorTriggerStart.fire(right);
controls[33].onInteractorTriggerEnd.fire(right);
assert.deepEqual(picks.at(-1), [4, 1]);
assert.equal(picks.length, 2);
time++;
view.update(null, 0, "ABC", [0, 0]);
controls[2].onInteractorTriggerStart.fire(right);
view.setEnabled(false);
controls[2].onInteractorTriggerEnd.fire(right);
assert.equal(picks.length, 2); // closed keyboard cannot accept a late release
console.log("CODE KEYBOARD: SIK callbacks, two hands, release-outside, disabled LOAD and teardown PASS");
