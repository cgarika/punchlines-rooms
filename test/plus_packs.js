/* Punchlines: GameNest Plus's prompt packs over real sockets (2026-10-17): node test/plus_packs.js (starts its own
   server on TEST_PORT, default 3297). */
const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const { io } = require("socket.io-client");
const Packs = require("../packs");

const PORT = Number(process.env.TEST_PORT || 3297);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = (fn, ms = 6000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const tick = () => { const v = fn(); if (v) return res(v); if (Date.now() - t0 > ms) return rej(new Error("timeout")); setTimeout(tick, 15); };
  tick();
});

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT }, stdio: "ignore" });
  await sleep(700);
  const socks = [];
  let passed = 0;
  const ok = (m) => { passed++; console.log("  ok " + m); };
  const mk = () => {
    const s = io(`http://127.0.0.1:${PORT}`, { transports: ["websocket"], forceNew: true });
    socks.push(s);
    s.st = null; s.refused = null;
    s.on("state", (m) => { s.st = m.room || m; });
    s.on("refusal", (m) => { s.refused = m; });
    return s;
  };
  try {
    const plain = mk();
    plain.emit("create", { name: "Host", playerId: "h" + Math.random() });
    await wait(() => plain.st && plain.st.code);
    assert.strictEqual(plain.st.pack, "classic");
    plain.emit("settings", { pack: "movies" });
    await wait(() => plain.refused);
    assert.strictEqual(plain.refused.code, "plus");
    assert.strictEqual(plain.st.pack, "classic");
    ok("an ordinary room: the classic prompts, a pack refused (code plus)");

    const host = mk();
    host.emit("create", { name: "Ann", playerId: "a" + Math.random(), plus: true });
    await wait(() => host.st && host.st.code);
    host.emit("settings", { pack: "office" });
    await wait(() => host.st.pack === "office");
    ok("a Plus room: the host picks Office Life");
    for (const n of ["Bo", "Cy"]) {
      const g = mk();
      g.emit("join", { code: host.st.code, name: n, playerId: n + Math.random() });
      await wait(() => g.st && g.st.code);
    }
    await wait(() => host.st.players.length === 3);
    host.emit("start");
    await wait(() => host.st.yourPrompts && host.st.yourPrompts.length === 2);
    const office = new Set(Packs.PACKS.office.prompts);
    assert.ok(host.st.yourPrompts.every((p) => office.has(p.prompt)), "the dealt prompts are the pack's: " + JSON.stringify(host.st.yourPrompts.map((p) => p.prompt)));
    ok("the game deals the pack's prompts");
  } finally {
    socks.forEach((s) => s.close());
    srv.kill();
  }
  console.log(`plus packs: all ${passed} passed`);
}
main().catch((e) => { console.error("FAIL " + e.message); process.exit(1); });
