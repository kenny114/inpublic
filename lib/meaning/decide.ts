import "server-only";

/**
 * The Meaning Engine's one LLM call: given what InPublic currently believes
 * the speaker means, recent conversational context, and a chunk of
 * newly-settled speech, decide the updated SemanticState.
 *
 * Server-only, same convention as lib/visualReentry/decide.ts — called from
 * app/api/meaning/route.ts, never imported by a "use client" component.
 * lib/meaning/client.ts is the client-safe counterpart Board.tsx calls.
 *
 * The actual prompt/parsing logic lives in lib/meaning/decideCore.ts, which
 * has no `server-only` import so it can also be loaded directly by
 * scripts/meaning-replay.mjs (a plain Node script, outside Next's webpack
 * build, where `server-only` doesn't resolve at all). This file is the only
 * one app code should ever import — it exists to keep that guard in place
 * for every real request path.
 *
 * IMPORTANT — this module has no concept of "visualizable." It never asks
 * "does this sentence match a diagram shape," never requires two named
 * things and an explicit edge, and never rejects a thought for being
 * reflective, conversational, or pronoun-heavy. That gate belongs to a
 * different, now-disabled system (lib/visualReentry/decide.ts,
 * features.visualReentryV1) which predates this rebuild and was mistakenly
 * read as this module's behavior during an early test — see the
 * conversation history around 2026-08-19 for the audit that found this.
 * The only question this prompt asks is: given everything the speaker has
 * said so far, what do I now understand them to mean?
 */

export { MEANING_ENGINE_MODEL, decideMeaningCore as decideMeaning } from "./decideCore";
