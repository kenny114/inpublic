/**
 * Say something to an open board, from a terminal.
 *
 *   node scripts/express-say.mjs "Rising costs push teams to consolidate tools."
 *   node scripts/express-say.mjs --delta ./meaning.json
 *   node scripts/express-say.mjs --speaker codex "AI is making apps easy to build."
 *
 * The manual version of what an MCP client does: one `express_meaning` call,
 * onto the queue in scripts/express-mcp-server.mjs, out to whichever board is
 * polling it. Exists because testing this should not require an MCP client —
 * the bridge has to be running and a board has to be open with ?agent=1, and
 * those are the two things actually worth checking.
 */

const args = process.argv.slice(2);
const endpoint = process.env.INPUBLIC_AGENT_BRIDGE ?? `http://127.0.0.1:${process.env.INPUBLIC_AGENT_BRIDGE_PORT ?? 3212}`;

let speakerId;
let deltaPath;
const words = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--speaker") speakerId = args[++i];
  else if (args[i] === "--delta") deltaPath = args[++i];
  else words.push(args[i]);
}

const text = words.join(" ").trim();
if (!text && !deltaPath) {
  console.error('usage: node scripts/express-say.mjs "what you mean"  [--delta file.json] [--speaker name]');
  process.exit(2);
}

const input = { ...(text ? { text } : {}), ...(speakerId ? { speakerId } : {}) };
if (deltaPath) {
  const { readFile } = await import("node:fs/promises");
  input.delta = JSON.parse(await readFile(deltaPath, "utf8"));
}

let response;
try {
  response = await fetch(`${endpoint}/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
} catch {
  console.error(`no bridge at ${endpoint} — start it with:\n  node --import ./scripts/ts-register.mjs scripts/express-mcp-server.mjs`);
  process.exit(1);
}

const result = await response.json();
console.log(JSON.stringify(result, null, 2));
// A rejected or failed submission is a non-zero exit, so this composes in a
// shell the way any other command does.
process.exit(result.ok ? 0 : 1);
