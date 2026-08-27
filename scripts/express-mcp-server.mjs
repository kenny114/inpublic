/**
 * The transport: one MCP tool, `express_meaning`, over stdio — and the
 * loopback queue that carries each call into a real, open InPublic board.
 *
 *   node --import ./scripts/ts-register.mjs scripts/express-mcp-server.mjs
 *
 * Two faces, one process, because splitting them would only add a hop:
 *
 *   stdio   JSON-RPC 2.0, spoken to the agent (Claude Code, Codex, any MCP
 *           client). initialize / tools/list / tools/call, nothing else.
 *   :3212   the board's end (lib/expression/agentBridge.ts). The page holds
 *           GET /pending open until a call is queued, runs it through the
 *           tool, and POSTs the answer to /result. POST /call puts a call on
 *           that same queue from a caller holding HTTP rather than stdio —
 *           scripts/express-say.mjs, curl, a test.
 *
 * The tool's NAME, DESCRIPTION and INPUT SCHEMA are imported from
 * lib/expression/tool.ts rather than restated here — the agent must be
 * reading the same contract the handler enforces, and two copies of a schema
 * is exactly how that stops being true.
 *
 * What this process is NOT: an implementation of `express`. It validates
 * nothing, decides nothing and draws nothing. Every call is answered by the
 * board's own createExpressTool → entry.express → the same controller the
 * microphone drives. If no board is connected, the call TIMES OUT rather
 * than being handled here, which is the honest answer: there was nowhere to
 * draw it.
 *
 * Local development only. It listens on loopback, has no authentication, and
 * the board side is dev-gated behind ?agent=1 (lib/features.ts).
 */

import { createServer } from "node:http";
import { createInterface } from "node:readline";

import {
  EXPRESS_TOOL_DESCRIPTION,
  EXPRESS_TOOL_INPUT_SCHEMA,
  EXPRESS_TOOL_NAME,
} from "../lib/expression/tool.ts";

const PORT = Number(process.env.INPUBLIC_AGENT_BRIDGE_PORT ?? 3212);
/** How long an agent waits for a board to pick a call up and answer it. Model extraction plus the controller's debounce fits well inside this. */
const CALL_TIMEOUT_MS = 45_000;
/** How long the board's /pending request is parked before being answered with nothing. Keeps fetch/proxy timeouts out of the picture. */
const POLL_HOLD_MS = 20_000;

const log = (...args) => console.error("[express-mcp]", ...args);

// ───────────────────────────────────────────────────────── the queue

/** Calls waiting for a board to take them. */
const queue = [];
/** callId -> { resolve, timer } for calls a board has taken but not yet answered. */
const inFlight = new Map();
/** Parked GET /pending responses, waiting for a call to arrive. */
const waiters = [];

let nextCallId = 0;

function handOut(call) {
  const waiter = waiters.shift();
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  waiter.send(call);
  return true;
}

/** Queues one call and resolves with whatever the board says — or a timeout. */
function submit(input) {
  const callId = `call-${++nextCallId}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      inFlight.delete(callId);
      const index = queue.findIndex((c) => c.callId === callId);
      if (index >= 0) queue.splice(index, 1);
      resolve({
        ok: false,
        status: "failed",
        error:
          "no board answered. Open the InPublic board with ?agent=1 (and the Expression Engine enabled) so the bridge has somewhere to draw.",
      });
    }, CALL_TIMEOUT_MS);
    inFlight.set(callId, { resolve, timer });
    const call = { callId, input };
    if (!handOut(call)) queue.push(call);
  });
}

function settle(callId, result) {
  const pending = inFlight.get(callId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  inFlight.delete(callId);
  pending.resolve(result);
  return true;
}

// ───────────────────────────────────────────────────── the board side

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

const bridge = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  if (req.method === "GET" && url.pathname === "/pending") {
    const send = (call) => res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ call }));
    const call = queue.shift();
    if (call) return send(call);
    // Park it. A board that goes away mid-park just stops being a waiter.
    const waiter = { send, timer: null };
    waiter.timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      send(null);
    }, POLL_HOLD_MS);
    waiters.push(waiter);
    res.on("close", () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
      }
    });
    return undefined;
  }

  if (req.method === "POST" && url.pathname === "/call") {
    // The same queue, for a caller holding HTTP rather than stdio: curl, a
    // test, scripts/express-say.mjs, an agent that never learned MCP. It goes
    // through submit() like every other call, so there is no second path to
    // the board — only a second way to reach this queue.
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      return res.writeHead(400, cors).end("bad json");
    }
    const result = await submit(input);
    return res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify(result));
  }

  if (req.method === "POST" && url.pathname === "/result") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return res.writeHead(400, cors).end("bad json");
    }
    const settled = settle(body?.callId, body?.result);
    return res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ settled }));
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return res
      .writeHead(200, { ...cors, "content-type": "application/json" })
      .end(JSON.stringify({ boardsWaiting: waiters.length, queued: queue.length, inFlight: inFlight.size }));
  }

  return res.writeHead(404, cors).end("not found");
});

bridge.listen(PORT, "127.0.0.1", () => log(`bridge on http://127.0.0.1:${PORT} — open the board with ?agent=1`));

// ───────────────────────────────────────────────────── the agent side

const TOOL = {
  name: EXPRESS_TOOL_NAME,
  description: EXPRESS_TOOL_DESCRIPTION,
  inputSchema: EXPRESS_TOOL_INPUT_SCHEMA,
};

function send(message) {
  // stdout is the JSON-RPC channel and nothing else — every log in this file
  // goes to stderr for exactly this reason.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  // A notification (no id) is never answered — notifications/initialized and
  // notifications/cancelled both land here.
  if (id === undefined) return;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "inpublic-express", version: "0.1.0" },
      });

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, { tools: [TOOL] });

    case "tools/call": {
      if (params?.name !== EXPRESS_TOOL_NAME) {
        return replyError(id, -32602, `unknown tool: ${params?.name}`);
      }
      const result = await submit(params?.arguments ?? {});
      // A rejected submission is a tool ERROR, not a protocol error: the
      // agent should read why and try different meaning, not conclude the
      // tool is broken.
      return reply(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.ok === false,
      });
    }

    default:
      return replyError(id, -32601, `unknown method: ${method}`);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return log("unparseable line ignored");
  }
  handle(message).catch((err) => {
    log("handler failed", err);
    if (message?.id !== undefined) replyError(message.id, -32603, String(err));
  });
});

process.stdin.on("close", () => {
  bridge.close();
  process.exit(0);
});
