/**
 * The wire between an external agent and THIS open board.
 *
 * The tool (lib/expression/tool.ts) is a function, and the session it drives
 * lives in a browser tab — the world, the debounce and the canvas are all in
 * the page, which is the point: an agent turn has to land in the same session
 * a person is speaking into, not in a headless copy of the engine that draws
 * nothing anyone can see. So an outside process cannot call the tool
 * directly; something has to carry the call into the tab.
 *
 * This is that something, and it is deliberately the dumbest possible
 * version: the page POLLS a loopback port for queued calls, runs each one
 * through the tool, and posts the answer back. No server pushes into the
 * page, no socket, no authentication story to get wrong, and nothing at all
 * happens unless a developer both starts the bridge process and opens the
 * board with `?agent=1` (lib/features.ts's isAgentBridgeEnabled).
 *
 * The queue on the other end is scripts/express-mcp-server.mjs, which is also
 * the MCP server the agent talks to. See AGENT.md.
 */

import type { ExpressTool, ExpressToolResult } from "./tool";

/** Where scripts/express-mcp-server.mjs listens. Loopback only, by construction. */
export const AGENT_BRIDGE_ENDPOINT = "http://127.0.0.1:3212";

/** One call, as it comes off the queue. `input` is untrusted JSON — the tool validates it. */
interface BridgeCall {
  callId: string;
  input: unknown;
}

export interface AgentBridgeOptions {
  endpoint?: string;
  /** How long to wait before polling again after an error, so a missing bridge is not a busy loop. */
  retryMs?: number;
  /** Called for every call the bridge ran, for the session log. */
  onCall?: (call: { callId: string; input: unknown; result: ExpressToolResult }) => void;
}

/**
 * Starts polling. Returns the stop function; call it on unmount.
 *
 * Errors are silent by design after the first one: the ordinary case for a
 * developer with `?agent=1` in the URL is that the bridge process is not
 * running, and a console full of connection failures would make the flag
 * unusable for the case where they start it later.
 */
export function startAgentBridge(tool: ExpressTool, options: AgentBridgeOptions = {}): () => void {
  const endpoint = options.endpoint ?? AGENT_BRIDGE_ENDPOINT;
  const retryMs = options.retryMs ?? 2000;
  let stopped = false;
  let warned = false;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loop() {
    while (!stopped) {
      let call: BridgeCall | null = null;
      try {
        // The bridge holds this request open until a call arrives or it times
        // out, so an idle board is one parked request rather than a poll
        // every N ms.
        const response = await fetch(`${endpoint}/pending`, { method: "GET", cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { call: BridgeCall | null };
        call = body.call;
      } catch {
        if (!warned) {
          console.info(`[expression] agent bridge not reachable at ${endpoint} — start scripts/express-mcp-server.mjs`);
          warned = true;
        }
        await sleep(retryMs);
        continue;
      }
      warned = false;
      if (!call) continue;

      // The tool never throws, so a call always gets an answer — a bridge
      // that could drop one would leave the agent waiting on nothing.
      const result = await tool.call(call.input);
      options.onCall?.({ callId: call.callId, input: call.input, result });
      try {
        await fetch(`${endpoint}/result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callId: call.callId, result }),
        });
      } catch {
        /* the agent's own timeout is the backstop; nothing useful to do here */
      }
    }
  }

  void loop();
  return () => {
    stopped = true;
  };
}
