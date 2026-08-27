/**
 * The transport, end to end: an MCP client on one side, a board on the other.
 *
 *   node --no-warnings scripts/express-mcp-test.mjs
 *
 * scripts/expression-test.mjs already proves the tool itself — what it cannot
 * prove is that a call typed by an outside process arrives at a board and
 * that the board's answer gets back. So this runs the real server
 * (scripts/express-mcp-server.mjs) as a child process, speaks real JSON-RPC
 * to its stdin, and stands in for the browser with plain fetch against the
 * bridge port — the same two requests lib/expression/agentBridge.ts makes.
 *
 * Nothing is stubbed except the board's tool handler, which is exactly the
 * part expression-test.mjs covers.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PORT = 3299;
const BRIDGE = `http://127.0.0.1:${PORT}`;

let pass = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const server = spawn(
  process.execPath,
  ["--no-warnings", "--import", "./scripts/ts-register.mjs", "scripts/express-mcp-server.mjs"],
  { cwd: root, env: { ...process.env, INPUBLIC_AGENT_BRIDGE_PORT: String(PORT) }, stdio: ["pipe", "pipe", "pipe"] },
);
server.stderr.on("data", (chunk) => {
  const line = String(chunk).trim();
  if (line && !line.startsWith("[express-mcp] bridge on")) console.error(line);
});

/** Responses, by request id. */
const answers = new Map();
const listeners = new Map();
createInterface({ input: server.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  answers.set(message.id, message);
  listeners.get(message.id)?.(message);
});

let nextId = 0;
function rpc(method, params) {
  const id = ++nextId;
  return new Promise((resolve) => {
    listeners.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stands in for the page: takes one call off the queue and answers it. */
async function board(handler) {
  const response = await fetch(`${BRIDGE}/pending`);
  const { call } = await response.json();
  if (!call) return null;
  const result = await handler(call.input);
  await fetch(`${BRIDGE}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callId: call.callId, result }),
  });
  return call;
}

// Wait for the bridge to be listening.
for (let i = 0; i < 60; i += 1) {
  try {
    await fetch(`${BRIDGE}/health`);
    break;
  } catch {
    await sleep(100);
  }
}

// ── the agent's side of the handshake

const initialized = await rpc("initialize", { protocolVersion: "2024-11-05", clientInfo: { name: "test", version: "0" } });
check("the server initializes", initialized.result?.serverInfo?.name === "inpublic-express", JSON.stringify(initialized.result));

const listed = await rpc("tools/list");
const tool = listed.result?.tools?.[0];
check("it publishes exactly one tool", listed.result?.tools?.length === 1, String(listed.result?.tools?.length));
check("named express_meaning", tool?.name === "express_meaning", tool?.name);
check("carrying the tool module's own schema, not a copy", tool?.inputSchema?.properties?.delta !== undefined);
check("and its own description", tool?.description?.includes("Submit MEANING, not shapes"));

// ── a call, carried into a board and answered

{
  let seen;
  const call = rpc("tools/call", { name: "express_meaning", arguments: { text: "Rising costs push teams to consolidate tools." } });
  await board((input) => {
    seen = input;
    return { ok: true, id: "agent-1", status: "updated", mode: "full", grammar: "cause_effect", objects: 2, connectors: 1 };
  });
  const answered = await call;

  check("the agent's arguments reach the board unchanged", seen?.text === "Rising costs push teams to consolidate tools.", JSON.stringify(seen));
  const payload = JSON.parse(answered.result.content[0].text);
  check("and the board's answer reaches the agent", payload.status === "updated" && payload.grammar === "cause_effect", answered.result.content[0].text);
  check("a successful call is not flagged as an error", answered.result.isError === false, String(answered.result.isError));
}

{
  // A rejection is a TOOL error, not a protocol error: the agent should read
  // why and submit different meaning, not conclude the tool is broken.
  const call = rpc("tools/call", { name: "express_meaning", arguments: { delta: { x: 10 } } });
  await board(() => ({ ok: false, id: "", status: "failed", error: "geometry rejected: \"x\" describes what to draw" }));
  const answered = await call;
  check("a rejected submission comes back as a tool error", answered.result.isError === true);
  check("with the reason intact", JSON.parse(answered.result.content[0].text).error.includes("geometry rejected"));
}

{
  // Queued while no board is polling: the call must wait for one to arrive,
  // not be dropped on the floor.
  const call = rpc("tools/call", { name: "express_meaning", arguments: { text: "Nobody is listening yet." } });
  await sleep(150);
  const health = await (await fetch(`${BRIDGE}/health`)).json();
  check("a call with no board attached is queued, not lost", health.queued === 1, JSON.stringify(health));
  await board(() => ({ ok: true, id: "agent-2", status: "noop", reason: "nothing new to draw" }));
  const answered = await call;
  check("and is delivered as soon as a board polls", JSON.parse(answered.result.content[0].text).status === "noop");
}

{
  const answered = await rpc("tools/call", { name: "draw_rectangle", arguments: {} });
  check("there is no second tool to call", answered.error?.code === -32602, JSON.stringify(answered.error));
}

server.stdin.end();
await sleep(100);
server.kill();

console.log(`\n${pass} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
process.exit(failures.length ? 1 : 0);
