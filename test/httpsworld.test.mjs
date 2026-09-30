// The published lens's way in: a bundle over https, by code.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/httpsworld.test.mjs --selftest
//
// InternetModule is faked here with the four things a fetch can do: answer,
// answer badly, throw, and never come back. What is asserted is that every
// one of those reaches the wizard as a message, that a missing code is told
// apart from a missing network, and that a late answer after close() lands in
// nothing.

globalThis.print = () => {};

const W = await import("../Assets/Scripts/world/WorldSource.ts");
const { HttpsWorldSource } = W;

let pass = 0;
let fail = 0;
function check(label, ok, saw) {
  if (ok) { pass++; } else { fail++; console.log("  FAIL " + label + (saw === undefined ? "" : "  saw " + saw)); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function response(status, text, headers) {
  return {
    status: status,
    headers: { get: (name) => (headers && headers[name.toLowerCase()] !== undefined ? headers[name.toLowerCase()] : null) },
    text: () => Promise.resolve(text),
  };
}
function moduleAnswering(response) {
  const calls = [];
  return {
    calls,
    fetch: (url, options) => { calls.push({ url, options }); return Promise.resolve(response); },
  };
}
function record() {
  const log = { progress: [], ready: null, error: null, notFound: null };
  const callbacks = {
    onProgress: (f, m) => log.progress.push([f, m]),
    onReady: (t) => { log.ready = t; },
    onError: (m) => { log.error = m; },
    onNotFound: (m) => { log.notFound = m; },
  };
  return { log, callbacks };
}

console.log("=== the url ===");
{
  check("site plus code", HttpsWorldSource.bundleUrl("https://pocket-diorama.vercel.app", "ABC234") ===
        "https://pocket-diorama.vercel.app/api/bundle/ABC234");
  check("a trailing slash is not doubled", HttpsWorldSource.bundleUrl("https://x.y/", "ABC234") === "https://x.y/api/bundle/ABC234");
  check("the code is escaped", HttpsWorldSource.bundleUrl("https://x.y", "A/B") === "https://x.y/api/bundle/A%2FB");
  check("the host is the host", HttpsWorldSource.hostOf("https://pocket-diorama.vercel.app/api/x") === "pocket-diorama.vercel.app");
  check("even without a scheme", HttpsWorldSource.hostOf("pocket-diorama.vercel.app") === "pocket-diorama.vercel.app");
}

console.log("=== a world arrives ===");
{
  const text = JSON.stringify({ format: 2, maps: {}, tilesets: {} });
  const m = moduleAnswering(response(200, text, { "x-bundle-length": "" + text.length }));
  const { log, callbacks } = record();
  const s = new HttpsWorldSource(m, "https://x.y/api/bundle/ABC234");
  s.connect(callbacks);
  check("the fetch is a GET of the url", m.calls.length === 1 && m.calls[0].url === "https://x.y/api/bundle/ABC234" &&
        m.calls[0].options.method === "GET", JSON.stringify(m.calls));
  check("it asks for json", m.calls[0].options.headers.Accept === "application/json");
  await tick(); await tick(); await tick();
  check("the text reaches onReady", log.ready === text);
  check("no error", log.error === null && log.notFound === null, log.error);
  check("progress moved through asked, received, unpacked",
        log.progress.length === 3 && log.progress[0][0] < log.progress[1][0] && log.progress[1][0] < log.progress[2][0],
        JSON.stringify(log.progress));
  check("and the last step is under one", log.progress[2][0] < 1);
  s.tick(1000);
  check("a tick after arrival does nothing", log.error === null);
}

console.log("=== the site has no such code ===");
{
  const m = moduleAnswering(response(404, "not found", {}));
  const { log, callbacks } = record();
  new HttpsWorldSource(m, "https://x.y/api/bundle/ZZZZZZ").connect(callbacks);
  await tick(); await tick();
  check("it is told apart from a network failure", log.notFound !== null && log.error === null, log.error);
  check("and says the code may have expired", log.notFound.indexOf("expired") >= 0, log.notFound);
  check("nothing is ready", log.ready === null);
  // Without an onNotFound it lands in onError, so no caller can miss it.
  const plain = { progress: [], error: null };
  new HttpsWorldSource(moduleAnswering(response(410, "", {})), "https://x.y/api/bundle/Z").connect({
    onProgress: () => {}, onReady: () => {}, onError: (msg) => { plain.error = msg; },
  });
  await tick(); await tick();
  check("a gone code without onNotFound is still an error", plain.error !== null && plain.error.indexOf("expired") >= 0, plain.error);
}

console.log("=== the site is unwell ===");
{
  const m = moduleAnswering(response(500, "boom", {}));
  const { log, callbacks } = record();
  new HttpsWorldSource(m, "https://x.y/api/bundle/ABC234").connect(callbacks);
  await tick(); await tick();
  check("a 500 is an error naming the status", log.error !== null && log.error.indexOf("500") >= 0, log.error);
  check("and not a missing code", log.notFound === null);

  const short = "0123456789";
  const cut = moduleAnswering(response(200, short, { "x-bundle-length": "20" }));
  const r2 = record();
  new HttpsWorldSource(cut, "https://x.y/api/bundle/ABC234").connect(r2.callbacks);
  await tick(); await tick(); await tick();
  check("a body shorter than declared is an error", r2.log.error !== null && r2.log.error.indexOf("cut short") >= 0, r2.log.error);
  check("and never ready", r2.log.ready === null);

  const empty = moduleAnswering(response(200, "", {}));
  const r3 = record();
  new HttpsWorldSource(empty, "https://x.y/api/bundle/ABC234").connect(r3.callbacks);
  await tick(); await tick(); await tick();
  check("an empty body is an error", r3.log.error !== null && r3.log.error.indexOf("empty") >= 0, r3.log.error);

  const thrower = { fetch: () => { throw new Error("no InternetModule here"); } };
  const r4 = record();
  new HttpsWorldSource(thrower, "https://x.y/api/bundle/ABC234").connect(r4.callbacks);
  check("a fetch that throws is an error at once", r4.log.error !== null && r4.log.error.indexOf("cannot ask x.y") >= 0, r4.log.error);

  const rejecter = { fetch: () => Promise.reject(new Error("dns")) };
  const r5 = record();
  new HttpsWorldSource(rejecter, "https://x.y/api/bundle/ABC234").connect(r5.callbacks);
  await tick(); await tick();
  check("a rejected fetch is an error naming the host", r5.log.error !== null && r5.log.error.indexOf("could not reach x.y") >= 0, r5.log.error);
}

console.log("=== silence ===");
{
  const never = { fetch: () => new Promise(() => {}) };
  const { log, callbacks } = record();
  const s = new HttpsWorldSource(never, "https://x.y/api/bundle/ABC234");
  s.connect(callbacks);
  s.tick(HttpsWorldSource.TIMEOUT_SECONDS - 1);
  check("under the deadline nothing is said", log.error === null);
  s.tick(2);
  check("past it, the wizard hears about it", log.error !== null && log.error.indexOf("Wi-Fi") >= 0, log.error);
  s.tick(100);
  check("and only once", log.progress.length === 1);
  check("the deadline is long enough for a slow connection and short enough to notice",
        HttpsWorldSource.TIMEOUT_SECONDS >= 30 && HttpsWorldSource.TIMEOUT_SECONDS <= 90, HttpsWorldSource.TIMEOUT_SECONDS);
}

console.log("=== a late answer after close lands in nothing ===");
{
  let resolve = null;
  const late = { fetch: () => new Promise((r) => { resolve = r; }) };
  const { log, callbacks } = record();
  const s = new HttpsWorldSource(late, "https://x.y/api/bundle/ABC234");
  s.connect(callbacks);
  s.close();
  resolve(response(200, "{}", {}));
  await tick(); await tick(); await tick();
  check("nothing arrives after close", log.ready === null && log.error === null, log.error);
  s.tick(1000);
  check("and the watchdog is off", log.error === null);
}

console.log("HTTPSWORLD  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
