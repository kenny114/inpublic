"use client";

/**
 * The Expression Engine's development surface: text in, visual out, and
 * every intermediate stage inspectable.
 *
 * This exists because of one recurring problem with the old pipeline: when
 * a visual was bad, there was no way to tell WHICH intelligence layer
 * failed. Did the system misunderstand the sentence, misjudge what the
 * speaker was doing, choose the wrong visual grammar, or lay out the right
 * grammar badly? Those are four different bugs with four different fixes,
 * and the canvas looks identical for all of them. So every stage's output
 * is rendered here, side by side with the picture it produced.
 *
 * Deliberately has no microphone, no streaming, no camera and no Excalidraw
 * editor. Latency and transcription are separate problems; the only
 * question this page asks is whether InPublic can understand arbitrary
 * meaning and express it visually. Speech reconnects once the answer is
 * yes.
 *
 * Input is processed one sentence at a time, sequentially, because that is
 * how speech arrives — so the incremental behaviour (does sentence four
 * modify the world sentence one built, or start over?) is exercised by
 * default rather than being a separate mode nobody runs.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { ExpressionSession, segmentText, type ExpressionTrace } from "@/lib/expression/pipeline";
import { describePatch } from "@/lib/expression/render/core";
import { SvgRenderer } from "@/lib/expression/render/svg";

const SAMPLE = `My name is Kenny Farmer.
I'm from Trinidad and Tobago.
I have a family of five.
My mother's name is Mariam.`;

const STAGES = ["input", "meaning", "world", "intent", "expression", "scene", "render", "evaluation"] as const;
type Stage = (typeof STAGES)[number];

const renderer = new SvgRenderer({ markNew: true });

export function ExpressionLab() {
  const [text, setText] = useState(SAMPLE);
  const [traces, setTraces] = useState<ExpressionTrace[]>([]);
  const [selected, setSelected] = useState(0);
  const [stage, setStage] = useState<Stage>("world");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ExpressionSession | null>(null);

  const visualize = useCallback(async () => {
    setBusy(true);
    setError(null);
    // A fresh session per run: the world is supposed to accumulate WITHIN a
    // run, not across unrelated experiments.
    const session = new ExpressionSession();
    sessionRef.current = session;
    const collected: ExpressionTrace[] = [];
    try {
      for (const segment of segmentText(text)) {
        const trace = await session.ingest(segment);
        collected.push(trace);
        // Show each sentence's result as it lands rather than at the end —
        // this is the incremental behaviour, so it should be watchable.
        setTraces([...collected]);
        setSelected(collected.length - 1);
      }
      if (!collected.length) setError("Nothing to visualize.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [text]);

  const trace = traces[selected];
  const svg = useMemo(() => (trace ? renderer.render(trace.scene, trace.patch) : null), [trace]);

  return (
    <div className="xlab">
      <header className="xlab-head">
        <h1>Expression Engine</h1>
        <p>Meaning → visual expression. Each sentence updates the world; the picture follows from the world, not from the words.</p>
      </header>

      <section className="xlab-input">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} aria-label="Text to visualize" />
        <div className="xlab-actions">
          <button type="button" onClick={visualize} disabled={busy || !text.trim()}>
            {busy ? "Understanding…" : "Visualize"}
          </button>
          {error ? <span className="xlab-error">{error}</span> : null}
        </div>
      </section>

      {traces.length > 0 ? (
        <nav className="xlab-steps" aria-label="Sentences">
          {traces.map((t, index) => (
            <button
              key={t.input.id}
              type="button"
              className={index === selected ? "on" : ""}
              onClick={() => setSelected(index)}
              title={t.input.text}
            >
              <span className="n">{index + 1}</span>
              <span className="t">{t.input.text}</span>
              {!t.changed ? <span className="quiet">no change</span> : null}
            </button>
          ))}
        </nav>
      ) : null}

      <section className="xlab-canvas" aria-label="Visual canvas">
        {svg ? <div className="xlab-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="xlab-empty">The canvas is empty until there is something worth showing.</p>}
      </section>

      {trace ? (
        <section className="xlab-debug">
          <nav className="xlab-tabs">
            {STAGES.map((s) => (
              <button key={s} type="button" className={s === stage ? "on" : ""} onClick={() => setStage(s)}>
                {s}
              </button>
            ))}
          </nav>
          <div className="xlab-stage">{renderStage(stage, trace)}</div>
        </section>
      ) : null}
    </div>
  );
}

function renderStage(stage: Stage, trace: ExpressionTrace) {
  switch (stage) {
    case "input":
      return (
        <Lines
          rows={[
            `source     ${trace.input.source}`,
            `seq        ${trace.input.seq}`,
            `text       ${trace.input.text}`,
          ]}
        />
      );

    case "meaning":
      return (
        <>
          <Note>What this sentence alone means, extracted before the world was consulted. Local ids only — nothing here is persisted.</Note>
          <Lines
            rows={[
              ...trace.delta.entities.map((e) => `${e.type.padEnd(8)} ${e.label}${e.quantity ? `  ×${e.quantity.value}${e.quantity.unit ?? ""}` : ""}${e.description ? `  — ${e.description}` : ""}`),
              ...trace.delta.relations.map((r) => `rel      ${r.source} —${r.type}${r.role ? `:${r.role}` : ""}${r.spatial ? `:${r.spatial}` : ""}→ ${r.target}`),
              ...trace.delta.claims.map((c) => `claim    ${c.text}${c.uncertain ? "  (hedged)" : ""}`),
              ...(trace.delta.supersededMentions ?? []).map((m) => `retract  ${m}`),
              trace.delta.interpretation ? `≡        ${trace.delta.interpretation}` : "",
            ].filter(Boolean)}
          />
        </>
      );

    case "world":
      return (
        <>
          <Note>Everything believed so far. Ids are stable: a later sentence updates an entity, it does not add a second one.</Note>
          <Lines
            rows={[
              ...trace.world.entities.map(
                (e) =>
                  `${e.status === "superseded" ? "×" : " "} ${e.importance.padEnd(10)} ${e.type.padEnd(8)} ${e.id.padEnd(20)} ${e.label}${e.quantity ? `  ×${e.quantity.value}` : ""}`,
              ),
              ...trace.world.relations.map((r) => `  relation             ${r.source} —${r.type}${r.role ? `:${r.role}` : ""}→ ${r.target}`),
              ...trace.world.claims.map((c) => `  claim                ${c.text}`),
              `  salience             ${trace.world.salience.join(" › ")}`,
              "",
              "changed this round:",
              ...(trace.opsDescribed.length ? trace.opsDescribed.map((op) => `  ${op}`) : ["  (nothing)"]),
            ]}
          />
        </>
      );

    case "intent":
      return (
        <>
          <Note>What the speaker is doing — read from the structure of the world, never from words like &ldquo;because&rdquo; or &ldquo;so&rdquo;.</Note>
          <Lines
            rows={[
              `primary    ${trace.intent.primary}`,
              `secondary  ${trace.intent.secondary.join(", ") || "—"}`,
              `focus      ${trace.intent.focusEntityId ?? "—"}`,
              `strength   ${trace.intent.strength.toFixed(2)}`,
              `why        ${trace.intent.reason}`,
            ]}
          />
        </>
      );

    case "expression":
      return (
        <>
          <Note>What should exist visually and what connects to what. Still no coordinates anywhere.</Note>
          <Lines
            rows={[
              `grammar    ${trace.plan.grammar}`,
              `why        ${trace.plan.reason}`,
              "",
              ...trace.plan.regions.map((r) => `region     ${r.role.padEnd(16)} ${r.entityId ?? r.claimId ?? ""}${r.childRegionIds?.length ? `  contains ${r.childRegionIds.length}` : ""}`),
              ...trace.plan.connections.map((c) => `connect    ${c.kind.padEnd(16)} ${c.fromRegionId} → ${c.toRegionId}${c.label ? `  "${c.label}"` : ""}`),
              ...trace.plan.emphasis.map((e) => `emphasis   ${String(e.weight).padEnd(16)} ${e.regionId}  — ${e.reason}`),
            ]}
          />
        </>
      );

    case "scene":
      return (
        <>
          <Note>The first layer with geometry, computed deterministically. No model has any say from here down.</Note>
          <Lines
            rows={[
              `canvas     ${trace.scene.width} × ${trace.scene.height}`,
              "",
              ...trace.scene.objects.map(
                (o) =>
                  `${o.primitive.padEnd(14)} w${o.weight}  ${String(Math.round(o.x)).padStart(5)},${String(Math.round(o.y)).padStart(5)}  ${Math.round(o.w)}×${Math.round(o.h)}  ${o.label ?? ""}${o.count ? `  ×${o.count}` : ""}`,
              ),
              ...trace.scene.connectors.map((c) => `connector      ${c.style.padEnd(8)} ${c.fromObjectId} → ${c.toObjectId}${c.label ? `  "${c.label}"` : ""}`),
            ]}
          />
        </>
      );

    case "render":
      return (
        <>
          <Note>What changed on the canvas. The board is patched, never wiped — an existing object moves, it is not re-created.</Note>
          <Lines rows={describePatch(trace.patch).length ? describePatch(trace.patch) : ["(nothing changed)"]} />
        </>
      );

    case "evaluation":
      return (
        <>
          <Note>
            The picture read back as if the transcript did not exist: which relations could a stranger reconstruct, and did the arrangement imply any nobody claimed?
          </Note>
          <Lines
            rows={[
              `preservation  ${trace.evaluation.semanticPreservation}`,
              `recovered     ${trace.evaluation.recoveredRelationIds.join(", ") || "—"}`,
              `invented      ${trace.evaluation.inventedRelations.join("; ") || "none"}`,
              "",
              ...(trace.evaluation.problems.length
                ? trace.evaluation.problems.map((p) => `${String(p.severity.toFixed(2)).padStart(5)}  ${p.type.padEnd(22)} ${p.detail}`)
                : ["no problems"]),
              "",
              ...(trace.repair.steps.length
                ? [
                    `repair (${trace.repairOutcome?.kept ? "kept" : "discarded"}, ${trace.repairOutcome?.before} → ${trace.repairOutcome?.after})`,
                    ...trace.repair.steps.map((s) => `  ${s.action.padEnd(22)} ${s.reason}`),
                  ]
                : ["no repair needed"]),
            ]}
          />
        </>
      );
  }
}

function Lines({ rows }: { rows: string[] }) {
  return <pre className="xlab-lines">{rows.join("\n")}</pre>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="xlab-note">{children}</p>;
}
