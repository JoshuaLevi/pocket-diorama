// The Poke Mart, played headlessly: buy, be refused, sell, leave -- and the
// clerk's script waiting for it.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/shop.test.mjs Assets/Generated/kanto.json [--selftest]
//
// open_mart used to print the stock and carry on; every gate was green and no
// Poke Ball could be bought. This drives the ShopController the way a player
// does -- d-pad, A, B -- against the real item table and the real mart lines,
// and drives a real clerk script through PlayHost to prove the VM stays
// suspended until the shop closes.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { makeServices } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: shop.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const S = await import(P + "ShopController.ts");
const PlayState = await import(P + "PlayState.ts");
const { ScriptVM, DONE } = await import(P + "script/ScriptVM.ts");
const { PlayHost } = await import(P + "script/Host.ts");
const { emptyDPad } = await import(P + "InputSource.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "SHOP", "Red's mart stock");

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

const NONE = emptyDPad();
const DT = 0.016;
function pad(dir) {
  const p = emptyDPad();
  p[dir] = true;
  return p;
}

/** A driver that presses like a person: one edge per call, idle frames between. */
function player(shop) {
  const step = (p, a, b) => shop.step(p || NONE, !!a, !!b, DT);
  const seen = [];
  return {
    /** Every message line read so far, for assertions that span pages. */
    seen,
    a: () => step(NONE, true, false),
    b: () => step(NONE, false, true),
    // A tap: press, then release long enough for DPadEdge to re-arm.
    tap: (dir) => { const r = step(pad(dir), false, false); for (let i = 0; i < 40; i++) { step(NONE, false, false); } return r; },
    idle: (n) => { for (let i = 0; i < (n || 1); i++) { step(NONE, false, false); } },
    /** Press A through every page of a message until it is gone. */
    read: () => {
      let n = 0;
      while (shop.lines() !== null && !shop.asking() && n < 20) {
        seen.push(shop.lines().join(" "));
        step(NONE, true, false);
        n++;
      }
      if (shop.lines() !== null) { seen.push(shop.lines().join(" ")); }
    },
  };
}

function count(s, id) {
  for (let i = 0; i < s.bag.length; i++) { if (s.bag[i].id === id) { return s.bag[i].count; } }
  return 0;
}

const STOCK = ["POKE_BALL", "ANTIDOTE", "PARLYZ_HEAL", "BURN_HEAL"]; // Viridian's
const price = (id) => bundle.items[id].price;

// ---------------------------------------------------------------------------
console.log("\n== Buying ==");
function testBuy(make) {
  const state = PlayState.newPlayState("t");
  const shop = make(state);
  const me = player(shop);
  check("the clerk greets first", shop.lines() !== null && shop.rows().length === 0, JSON.stringify(shop.lines()));
  me.read();
  check("then BUY / SELL / QUIT", shop.rows().join(",") === "BUY,SELL,QUIT", shop.rows().join(","));
  me.a();                                // BUY
  check("Take your time.", shop.lines() !== null, JSON.stringify(shop.lines()));
  me.read();
  check("the list carries the stock with prices",
        shop.rows().length === STOCK.length + 1 && shop.rows()[0].indexOf("¥" + price("POKE_BALL")) >= 0 &&
        shop.rows()[STOCK.length] === "CANCEL", JSON.stringify(shop.rows()));
  me.a();                                // POKE BALL -> quantity
  me.tap("up"); me.tap("up");            // x3
  check("the quantity row shows the total", shop.rows()[0].indexOf("x 3") >= 0 &&
        shop.rows()[0].indexOf("¥" + 3 * price("POKE_BALL")) >= 0, JSON.stringify(shop.rows()));
  me.a();                                // ask
  me.read();
  const question = me.seen.slice(-2).join(" ");
  check("the price question names the item and the sum, with YES / NO",
        shop.asking() && shop.rows().join(",") === "YES,NO" &&
        question.indexOf("POK") >= 0 && question.indexOf("" + 3 * price("POKE_BALL")) >= 0,
        question);
  const before = state.money;
  me.a();                                // YES
  check("three Poke Balls land", count(state, "POKE_BALL") === 3, JSON.stringify(state.bag));
  check("and the money went down by exactly the price", state.money === before - 3 * price("POKE_BALL"),
        "money=" + state.money);
  check("Here you are! Thank you!", shop.lines() !== null, JSON.stringify(shop.lines()));
  me.read();
  check("back on the list", shop.rows()[STOCK.length] === "CANCEL", JSON.stringify(shop.rows()));

  // Not enough money: 99 Burn Heals.
  me.tap("down"); me.tap("down"); me.tap("down"); // BURN HEAL
  me.a(); me.tap("down");                        // x99 (down from 1 wraps to the max)
  me.a(); me.read();
  const money = state.money;
  me.a();                                        // YES
  check("a sum the player cannot pay is refused", count(state, "BURN_HEAL") === 0 && state.money === money,
        "money=" + state.money + " bag=" + JSON.stringify(state.bag));
  check("with the not-enough-money line", shop.lines() !== null, JSON.stringify(shop.lines()));
  me.read();

  // NO keeps everything.
  me.tap("up"); me.tap("up"); me.tap("up");      // POKE BALL again
  me.a(); me.a(); me.read();
  me.tap("down");                                // cursor to NO
  me.a();
  check("NO buys nothing", count(state, "POKE_BALL") === 3 && state.money === money);

  // Leaving the list asks if there is anything else, then back to the root.
  me.b();
  check("B on the list: anything else?", shop.lines() !== null, JSON.stringify(shop.lines()));
  me.read();
  check("and the root menu is back", shop.rows().join(",") === "BUY,SELL,QUIT", shop.rows().join(","));
  me.tap("down"); me.tap("down"); me.a();        // QUIT
  me.read();
  check("QUIT says thank you and closes", !shop.isOpen());
  check("a closed shop reports SHOP_CLOSED", shop.step(NONE, false, false, DT) === S.SHOP_CLOSED);
}
testBuy((state) => new S.ShopController(bundle, state, STOCK));

console.log("\n== A full bag ==");
{
  const state = PlayState.newPlayState("t");
  const ids = Object.keys(bundle.items).filter((id) => id !== "POKE_BALL" && id.indexOf("BADGE") < 0);
  state.bag = ids.slice(0, 20).map((id) => ({ id: id, count: 1 }));
  const shop = new S.ShopController(bundle, state, STOCK);
  const me = player(shop);
  me.read(); me.a(); me.read(); me.a(); me.a(); me.read(); me.a();
  check("a twenty-first kind is refused and nothing is charged",
        count(state, "POKE_BALL") === 0 && state.money === 3000 && shop.lines() !== null,
        JSON.stringify({ money: state.money, lines: shop.lines() }));
  const stacked = PlayState.newPlayState("t");
  stacked.bag = [{ id: "POKE_BALL", count: 98 }];
  const shop2 = new S.ShopController(bundle, stacked, STOCK);
  const me2 = player(shop2);
  me2.read(); me2.a(); me2.read(); me2.a(); me2.tap("up"); me2.a(); me2.read(); me2.a();
  check("a stack may not pass 99", count(stacked, "POKE_BALL") === 98 && stacked.money === 3000,
        JSON.stringify(stacked.bag));
}

console.log("\n== Selling ==");
function testSell(make) {
  const state = PlayState.newPlayState("t");
  state.bag = [{ id: "NUGGET", count: 1 }, { id: "POTION", count: 5 }, { id: "TOWN_MAP", count: 1 }];
  const shop = make(state);
  const me = player(shop);
  me.read(); me.tap("down"); me.a();             // SELL
  check("the sell list is the bag", shop.rows().length === 4 && shop.rows()[3] === "CANCEL", JSON.stringify(shop.rows()));
  me.a();                                        // NUGGET x1
  me.a(); me.read();
  check("the clerk offers half price", shop.asking() && shop.lines().join(" ").indexOf("" + Math.floor(price("NUGGET") / 2)) >= 0,
        JSON.stringify(shop.lines()));
  me.a();                                        // YES
  check("the Nugget is gone and the money is in", count(state, "NUGGET") === 0 &&
        state.money === 3000 + Math.floor(price("NUGGET") / 2), "money=" + state.money);
  check("the list shrank with it", shop.rows().length === 3, JSON.stringify(shop.rows()));
  me.a(); me.tap("up");                          // POTION, x2 (up from 1)
  me.a(); me.read(); me.a();
  check("two of five Potions sell for two half-prices",
        count(state, "POTION") === 3 && state.money === 3000 + Math.floor(price("NUGGET") / 2) + 2 * Math.floor(price("POTION") / 2),
        "money=" + state.money);
  me.tap("down"); me.a();                        // TOWN MAP
  check("a key item cannot be priced", shop.lines() !== null && count(state, "TOWN_MAP") === 1, JSON.stringify(shop.lines()));
  me.read();
  const empty = PlayState.newPlayState("t");
  const shop2 = make(empty);
  const me2 = player(shop2);
  me2.read(); me2.tap("down"); me2.a();
  check("nothing to sell says so and stays on the root", shop2.lines() !== null, JSON.stringify(shop2.lines()));
  me2.read();
  check("root again", shop2.rows().join(",") === "BUY,SELL,QUIT");
}
testSell((state) => new S.ShopController(bundle, state, STOCK));

console.log("\n== The clerk's script waits for the shop ==");
{
  const state = PlayState.newPlayState("t");
  const services = makeServices(bundle, "VIRIDIAN_MART", { shopOpenFrames: 5 });
  const host = new PlayHost(bundle, state, services);
  const vm = new ScriptVM(host, state.flags);
  vm.start([{ op: "open_mart", textId: "TEXT_VIRIDIANMART_CLERK" }, { op: "show_text", textId: "AFTER" }]);
  let frames = 0;
  let firstAfter = -1;
  while (vm.isRunning() && frames < 60) {
    vm.update();
    frames++;
    if (firstAfter < 0 && services.log.some((l) => l.indexOf("text:AFTER") === 0)) { firstAfter = frames; }
  }
  const opened = services.log.find((l) => l.indexOf("shop:") === 0);
  check("open_mart hands the clerk's stock to the shop", opened === "shop:" + STOCK.join(","), opened);
  check("the script stays suspended while the shop is open, and continues after",
        firstAfter > 5 && !vm.isRunning(), "after at frame " + firstAfter + ", running=" + vm.isRunning());
}

if (selftest) {
  console.log("\n-- selftest --");
  const failsWith = (fn) => { quiet = true; quietFails = 0; fn(); quiet = false; return quietFails; };
  // A clerk who never charges.
  check("[selftest] a shop that gives things away is caught",
        failsWith(() => testBuy((state) => { const s = new S.ShopController(bundle, state, STOCK); s.priceOf = () => 0; return s; })) > 0);
  // A clerk who pays full price.
  check("[selftest] a shop that pays full price is caught",
        failsWith(() => testSell((state) => { const s = new S.ShopController(bundle, state, STOCK); s.sellPriceOf = (id) => price(id); return s; })) > 0);
  // The unmutated shop passes the quiet run.
  check("[selftest] the real shop passes the quiet run",
        failsWith(() => testBuy((state) => new S.ShopController(bundle, state, STOCK))) +
        failsWith(() => testSell((state) => new S.ShopController(bundle, state, STOCK))) === 0);
  // An idle player never buys anything.
  const idleState = PlayState.newPlayState("t");
  const idle = new S.ShopController(bundle, idleState, STOCK);
  for (let i = 0; i < 400; i++) { idle.step(NONE, false, false, DT); }
  check("[selftest] an idle player buys nothing", idleState.money === 3000 && idleState.bag.length === 0 && idle.isOpen());
}

console.log(`\n${fail === 0 ? "SHOP OK" : "SHOP FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
