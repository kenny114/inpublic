# Agents on the board

InPublic is the interface for visual expression. An agent submits **meaning**; the
engine chooses the form and draws it.

There is exactly one tool.

## `express_meaning`

```jsonc
{ "text": "Rising costs push teams to consolidate tools, which slows their releases." }
```

```jsonc
{
  "delta": {
    "entities": [
      { "id": "costs",  "type": "concept", "label": "rising costs" },
      { "id": "consol", "type": "action",  "label": "tool consolidation" },
      { "id": "slow",   "type": "state",   "label": "slower releases" }
    ],
    "relations": [
      { "id": "r1", "source": "costs",  "type": "causes", "target": "consol" },
      { "id": "r2", "source": "consol", "type": "causes", "target": "slow" }
    ],
    "claims": [],
    "interpretation": "Rising costs drive consolidation, which slows releases."
  },
  "speakerId": "claude-code"
}
```

Both draw a three-node `cause_effect` chain. `{ text }` is extracted for you;
`{ delta }` skips extraction and goes straight into the world.

### Submit meaning, not shapes

There is no field for a coordinate, an element, a colour, a layout or a diagram
type, and a submission carrying one is **rejected**, not stripped:

```
geometry rejected: "x" describes what to draw, not what you mean.
Submit entities, relations and claims; the engine chooses the form.
```

Say what is true and how things relate. What that looks like is the engine's
decision — the same decision it makes for a person speaking.

### The board is one continuing world

A second call **extends** what the first drew (`"mode": "patch"`) instead of
starting a new picture, and an agent's turn interleaves with a person speaking
into the same session. Refer to something you established earlier by saying it
again in words; the world resolves identity itself. Never re-send the whole
graph to "update" it.

### Reading the answer

```jsonc
{ "ok": true, "id": "agent-...", "status": "updated", "mode": "patch",
  "intent": "explain_causality", "grammar": "cause_effect", "objects": 4, "connectors": 3 }
```

| `status`  | what happened | what to do |
| --------- | ------------- | ---------- |
| `updated` | the board changed | continue |
| `noop`    | understood, nothing to draw (`reason` says why) | say something with more structure — don't resend |
| `failed`  | rejected, or the run threw (`error` says which) | fix what `error` names |

## Connecting

The tool drives a **live board in a browser tab** — that is where the world, the
canvas and the audience are. Local development only:

1. Start the bridge, which is also the MCP server:

```bash
node --import ./scripts/ts-register.mjs scripts/express-mcp-server.mjs
```

2. Open the board with `?agent=1` (Expression Engine on). The page polls the
   bridge on `127.0.0.1:3212` and answers every call with its own tool.

3. Point the agent at the same command. For Claude Code:

```json
{ "mcpServers": { "inpublic": { "command": "node", "args": ["--import", "./scripts/ts-register.mjs", "scripts/express-mcp-server.mjs"] } } }
```

With no board attached, a call is queued and then times out saying so — the
honest answer, since there was nowhere to draw it.

To check the wire without an MCP client, say something from a terminal:

```bash
node scripts/express-say.mjs --speaker codex "Rising costs push teams to consolidate tools."
```

## Where this lives

| | |
| --- | --- |
| `lib/expression/tool.ts` | the tool: name, description, input schema, handler |
| `lib/expression/entry.ts` | `entry.express` — what the handler calls |
| `lib/expression/agentBridge.ts` | the board's end of the wire |
| `scripts/express-mcp-server.mjs` | MCP over stdio + the loopback queue |
| `scripts/express-say.mjs` | one call from a terminal, for testing |
| `scripts/expression-test.mjs` | the tool's tests (`agent tool:` section) |
| `scripts/express-mcp-test.mjs` | the transport's tests |

In the browser console on any dev board: `inpublic.tool({ text: "..." })` runs
the identical handler, and `inpublic.toolSchema()` prints what an agent is given.
