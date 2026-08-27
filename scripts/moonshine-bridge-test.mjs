/**
 * Moonshine bridge wire-event normalization and connection lifecycle —
 * deterministic, a fake in-process socket, no real network or process.
 *
 *   node --import ./scripts/ts-register.mjs scripts/moonshine-bridge-test.mjs
 */

import { MoonshineBridgeClient, normalizeMoonshineEvent } from "../lib/moonshineBridge.ts";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ------------------------------------------------------ normalizeMoonshineEvent

section("event normalization");

check(
  "line_started maps to interim",
  JSON.stringify(normalizeMoonshineEvent({ type: "line_started", lineId: "a", text: "", atMs: 10 })) ===
    JSON.stringify({ kind: "interim", lineId: "a", text: "", atMs: 10 }),
);
check(
  "line_changed maps to interim",
  JSON.stringify(normalizeMoonshineEvent({ type: "line_changed", lineId: "a", text: "hel", atMs: 20 })) ===
    JSON.stringify({ kind: "interim", lineId: "a", text: "hel", atMs: 20 }),
);
check(
  "line_completed maps to final",
  JSON.stringify(normalizeMoonshineEvent({ type: "line_completed", lineId: "a", text: "hello", atMs: 30 })) ===
    JSON.stringify({ kind: "final", lineId: "a", text: "hello", atMs: 30 }),
);
check("an unknown type is dropped", normalizeMoonshineEvent({ type: "something_else", lineId: "a" }) === null);
check("a missing lineId is dropped", normalizeMoonshineEvent({ type: "line_started", text: "x" }) === null);
check("a non-object is dropped", normalizeMoonshineEvent("not an object") === null);

// ------------------------------------------------------------------ fake socket

class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.readyState = 0;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(event) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  simulateClose() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function harness() {
  const sockets = [];
  const events = { finals: [], interims: [], statuses: [], sessionStarts: 0, errors: [] };
  const client = new MoonshineBridgeClient(
    "ws://fake",
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    {
      onFinal: (text, tStart, tEnd, audioEndMs, streamEpoch) => events.finals.push({ text, tStart, tEnd, audioEndMs, streamEpoch }),
      onInterim: (text, audioEndMs, streamEpoch) => events.interims.push({ text, audioEndMs, streamEpoch }),
      onSessionStart: () => {
        events.sessionStarts += 1;
      },
      onStatus: (status) => events.statuses.push(status),
      onError: (message) => events.errors.push(message),
    },
  );
  return { client, sockets, events };
}

// ---------------------------------------------------------------- sequencing

section("interim -> final sequencing over a fake socket");

{
  const { client, sockets, events } = harness();
  client.start();
  check("connecting status fires on start", events.statuses.at(0) === "connecting");
  sockets[0].open();
  check("sends {type:start} once the socket opens", sockets[0].sent[0]?.type === "start");
  check("onSessionStart fires once on open", events.sessionStarts === 1);
  check("status goes live on open", events.statuses.at(-1) === "live");

  sockets[0].message({ type: "line_started", lineId: "L1", text: "", atMs: 100 });
  sockets[0].message({ type: "line_changed", lineId: "L1", text: "hel", atMs: 300 });
  sockets[0].message({ type: "line_completed", lineId: "L1", text: "hello world", atMs: 500 });

  check(
    "line_started and line_changed both surface as interims before the final",
    events.interims.length === 3 && events.interims[0].text === "" && events.interims[1].text === "hel",
    JSON.stringify(events.interims),
  );
  check(
    "the final carries the line's own start/end timestamps",
    events.finals.length === 1 && events.finals[0].text === "hello world" && events.finals[0].tStart === 100 && events.finals[0].tEnd === 500,
    JSON.stringify(events.finals),
  );
  check(
    "an empty interim clears the line after the final, same as Deepgram",
    events.interims.at(-1).text === "" && events.interims.at(-1).audioEndMs === 500,
  );
}

// ------------------------------------------------------------ disconnect/reconnect

section("bridge disconnect");

{
  const { client, sockets, events } = harness();
  client.start();
  sockets[0].open();
  events.statuses.length = 0;

  sockets[0].simulateClose();
  check("a mid-take disconnect moves to reconnecting, not idle or error", events.statuses.includes("reconnecting"));
  check("a second socket is not opened synchronously (backoff delay applies)", sockets.length === 1);
}

// ---------------------------------------------------------------------- stop

section("stop");

{
  const { client, sockets, events } = harness();
  client.start();
  sockets[0].open();
  client.stop();
  check("stop sends {type:stop} before closing", sockets[0].sent.at(-1)?.type === "stop");
  check("stop closes the socket", sockets[0].closed === true);
  check("stop sets status to idle", events.statuses.at(-1) === "idle");
}

// ------------------------------------------------------------------ results

console.log(`\n${"─".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ${pass} checks passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
