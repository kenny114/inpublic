/**
 * Drives a real, visible Chrome window through the three demo captures.
 *
 *   node scripts/demo-capture-run.mjs demo-a demo-b demo-c
 *
 * Why a separate browser at all: the capture composites the live Excalidraw
 * canvases, and a window that isn't on screen doesn't paint —
 * requestAnimationFrame stops firing and the recording comes out blank. So
 * this launches Chrome visibly, on its own throwaway profile, and talks to it
 * over the DevTools protocol. No clicks are synthesized; the page is driven by
 * evaluating scripts/demo-driver.js inside it, exactly as a devtools console
 * would.
 *
 * Requires scripts/demo-capture-server.mjs to be running, and the session
 * cookie to have been handed over (see its /session endpoint).
 */

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP ?? "http://localhost:3210";
const PORT = 9222;
const PROFILE = process.env.DEMO_PROFILE_DIR ?? resolve(here, "../.demo-chrome-profile");
const SESSION_FILE = process.env.DEMO_SESSION_FILE;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((path) => existsSync(path));
if (!CHROME) throw new Error("Chrome not found");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the smallest possible CDP client -------------------------------------

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    socket.addEventListener("open", ok, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

/** Evaluate in the page and unwrap a real error rather than a silent null. */
async function evaluate(page, expression, { awaitPromise = false, timeout = 0 } = {}) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true,
    ...(timeout ? { timeout } : {}),
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

// --- launch ---------------------------------------------------------------

await rm(PROFILE, { recursive: true, force: true }).catch(() => undefined);

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-session-crashed-bubble",
  // The demo audio has to start without a click, and the driver's
  // AudioContext would otherwise be born suspended.
  "--autoplay-policy=no-user-gesture-required",
  "--window-size=1320,900",
  "--window-position=40,40",
  "about:blank",
], { detached: false, stdio: "ignore" });

process.on("exit", () => chrome.kill());

let version = null;
for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
  version = await fetch(`http://localhost:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
  if (!version) await sleep(500);
}
if (!version) throw new Error("Chrome never exposed its debugging port");
console.log(`launched ${version.Browser}`);

const target = await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(`${APP}/`)}`, { method: "PUT" })
  .then((r) => r.json());
const page = await connect(target.webSocketDebuggerUrl);
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Network.enable");

// --- carry the signed-in session across -----------------------------------

if (!SESSION_FILE) throw new Error("DEMO_SESSION_FILE is not set");
const cookieHeader = (await readFile(SESSION_FILE, "utf8")).trim();
const cookies = cookieHeader.split("; ").filter(Boolean).map((pair) => {
  const index = pair.indexOf("=");
  return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: "localhost", path: "/" };
});
await page.send("Network.setCookies", { cookies });
console.log(`restored ${cookies.length} cookies`);

const driverSource = await readFile(resolve(here, "demo-driver.js"), "utf8");
const demos = process.argv.slice(2).filter((arg) => /^demo-[abc]$/.test(arg));
if (demos.length === 0) throw new Error("name at least one demo, e.g. demo-a");

const results = [];
for (const id of demos) {
  console.log(`\n--- ${id}`);
  // A fresh canvas per demo, so each recording starts from an empty board.
  await page.send("Page.navigate", { url: `${APP}/create?new=1` });
  // Non-negotiable. An occluded or backgrounded window throttles timers and
  // stops painting: the first run produced a 1 KB video, a 15-second mic
  // handshake, and one beat where there should have been three.
  await page.send("Page.bringToFront");
  await sleep(1500);

  // Wait for the board, not a guess: Excalidraw mounts asynchronously.
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    ready = await evaluate(page, `Boolean(document.querySelector('.excalidraw canvas')) && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Start speaking')`).catch(() => false);
    if (!ready) await sleep(500);
  }
  if (!ready) throw new Error(`${id}: the canvas never mounted — is the session still signed in?`);

  await evaluate(page, driverSource);
  await page.send("Page.bringToFront");
  const report = await evaluate(page, `window.__inpublicDemo.run(${JSON.stringify(id)})`, {
    awaitPromise: true,
    timeout: 180_000,
  });
  console.log(JSON.stringify(report));
  results.push(report);

  // Let the usage lease settle before the next run claims one.
  await sleep(4000);
}

console.log(`\n${"─".repeat(60)}`);
for (const result of results) {
  console.log(`${result.id}  ${result.audioSeconds}s audio  ${result.videoKB} KB ${result.videoType}  ${result.beats} beats  ${result.artist} artist calls  ${result.errors.length} errors`);
}

chrome.kill();
await rm(PROFILE, { recursive: true, force: true }).catch(() => undefined);
