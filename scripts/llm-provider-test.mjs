/**
 * Provider selection, Ollama request shape, structured-output round trip, and
 * the no-silent-fallback rule — deterministic, no real Ollama/Anthropic call.
 *
 *   node --import ./scripts/ts-register.mjs scripts/llm-provider-test.mjs
 */

import { z } from "zod";
import {
  providerFor,
  complete,
  toOllamaFormat,
  LocalProviderUnavailableError,
} from "../lib/llm.ts";

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

const originalEnv = { ...process.env };
function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

// ------------------------------------------------------------- providerFor

section("provider selection");

resetEnv();
delete process.env.LLM_PROVIDER;
check("gemini-prefixed model routes to google by default", providerFor("gemini-3.1-pro") === "google");
check("non-gemini model routes to anthropic by default", providerFor("claude-haiku-4-5") === "anthropic");

process.env.LLM_PROVIDER = "ollama";
check("LLM_PROVIDER=ollama overrides a gemini-prefixed model", providerFor("gemini-3.1-pro") === "ollama");
check("LLM_PROVIDER=ollama overrides an anthropic model", providerFor("claude-haiku-4-5") === "ollama");
resetEnv();

// -------------------------------------------------------- request shape

section("Ollama request shape");

{
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({ message: { content: '{"ok":true}' }, prompt_eval_count: 12, eval_count: 3, load_duration: 1e6, prompt_eval_duration: 2e6, eval_duration: 3e6, total_duration: 6e6 }),
      { status: 200 },
    );
  };

  process.env.LLM_PROVIDER = "ollama";
  let usage = null;
  const schema = z.object({ ok: z.boolean() });
  const result = await complete({
    model: "claude-haiku-4-5",
    system: "be terse",
    user: "hello",
    maxTokens: 100,
    temperature: 0,
    fetchImpl,
    jsonSchema: toOllamaFormat(schema),
    onUsage: (u) => {
      usage = u;
    },
  });
  resetEnv();

  check("hits the configured Ollama chat endpoint", captured?.url === "http://127.0.0.1:11434/api/chat", captured?.url);
  check("uses OLLAMA_MODEL, not the caller's model id", captured?.body?.model === "qwen3:4b", captured?.body?.model);
  check(
    "sends system + user as chat messages",
    captured?.body?.messages?.[0]?.role === "system" &&
      captured?.body?.messages?.[0]?.content === "be terse" &&
      captured?.body?.messages?.[1]?.role === "user" &&
      captured?.body?.messages?.[1]?.content === "hello",
  );
  check("passes the zod-derived schema as `format`", captured?.body?.format?.type === "object", JSON.stringify(captured?.body?.format));
  check("sends think:false by default (allowThinking not set)", captured?.body?.think === false);
  check("returns the model's message content", result === '{"ok":true}', result);
  check(
    "surfaces Ollama's own timing fields on usage, converted to ms",
    usage?.inputTokens === 12 && usage?.outputTokens === 3 && usage?.loadDurationMs === 1 && usage?.totalDurationMs === 6,
    JSON.stringify(usage),
  );
}

section("<think> block stripping");

{
  // Observed behavior on at least one Ollama/qwen3 build: reasoning models
  // inline their chain-of-thought as a literal <think>...</think> prefix in
  // message.content even with think:false sent — there is no separate
  // `message.thinking` field to prefer instead, so lib/llm.ts strips it.
  const fetchImpl = async () =>
    new Response(JSON.stringify({ message: { content: "<think>\nlet me reason about this\n</think>\n\n{\"ok\":true}" } }), { status: 200 });

  process.env.LLM_PROVIDER = "ollama";
  const result = await complete({ model: "x", system: "s", user: "u", maxTokens: 100, temperature: 0, fetchImpl });
  resetEnv();
  check("strips a leading <think>...</think> block from the returned content", result === '{"ok":true}', result);
}

// ------------------------------------------------- structured-output round trip

section("structured-output round trip");

{
  const AgentLikeSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("done") }),
    z.object({ type: z.literal("act"), action: z.object({ kind: z.string() }) }),
  ]);
  const jsonSchema = toOllamaFormat(AgentLikeSchema);
  check("converts a discriminated union to a JSON schema", typeof jsonSchema === "object" && jsonSchema !== null);
  check(
    "the converted schema does not replace zod validation — a malformed value still fails safeParse",
    AgentLikeSchema.safeParse({ type: "nonsense" }).success === false,
  );
  check(
    "a well-formed value still passes the real zod schema",
    AgentLikeSchema.safeParse({ type: "done" }).success === true,
  );
}

// --------------------------------------------------------- unavailable / fallback

section("Ollama unavailable, no silent fallback");

{
  const refusing = async () => {
    throw new Error("ECONNREFUSED");
  };

  process.env.LLM_PROVIDER = "ollama";
  delete process.env.OLLAMA_ALLOW_FALLBACK;
  let threw = null;
  try {
    await complete({
      model: "claude-haiku-4-5",
      system: "s",
      user: "u",
      maxTokens: 10,
      temperature: 0,
      fetchImpl: refusing,
    });
  } catch (err) {
    threw = err;
  }
  resetEnv();
  check(
    "a connection failure throws LocalProviderUnavailableError",
    threw instanceof LocalProviderUnavailableError,
    String(threw),
  );
}

{
  // If a fallback were (wrongly) attempted here, completeAnthropic would run
  // next and throw its own "ANTHROPIC_API_KEY is not set" error instead —
  // so seeing LocalProviderUnavailableError survive unchanged is proof the
  // Anthropic path was never reached, with no key set to fall back with.
  const refusing = async () => {
    throw new Error("ECONNREFUSED");
  };

  process.env.LLM_PROVIDER = "ollama";
  delete process.env.OLLAMA_ALLOW_FALLBACK;
  delete process.env.ANTHROPIC_API_KEY;
  let threw = null;
  try {
    await complete({ model: "claude-haiku-4-5", system: "s", user: "u", maxTokens: 10, temperature: 0, fetchImpl: refusing });
  } catch (err) {
    threw = err;
  }
  resetEnv();
  check(
    "without OLLAMA_ALLOW_FALLBACK, the Anthropic path is never reached",
    threw instanceof LocalProviderUnavailableError,
    String(threw),
  );
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
