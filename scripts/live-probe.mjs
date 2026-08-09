// End-to-end probe of the Gemini Live engine: real speech in, draw() calls out.
// Uses the same token route, model, prompt, tool schema and audio format the
// browser hook uses — just without a microphone.
import fs from "node:fs";
import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  Modality,
  Type,
} from "@google/genai";
import { LIVE_SCRIBE_SYSTEM } from "./lib/prompts.ts";
import { isFragment } from "./lib/ops.ts";

const APP = process.argv[2];
const WAV = process.argv[3];
const RATE = 16000;

// --- decode the wav and downsample to 16k mono PCM16 ---
const buf = fs.readFileSync(WAV);
let off = 12, rate = 44100, dataStart = 0, dataLen = 0;
while (off < buf.length - 8) {
  const id = buf.toString("ascii", off, off + 4);
  const sz = buf.readUInt32LE(off + 4);
  if (id === "fmt ") rate = buf.readUInt32LE(off + 12);
  if (id === "data") { dataStart = off + 8; dataLen = sz; break; }
  off += 8 + sz + (sz % 2);
}
const ratio = rate / RATE;
const outCount = Math.floor(dataLen / 2 / ratio);
const pcm = Buffer.alloc(outCount * 2);
for (let i = 0; i < outCount; i++) {
  pcm.writeInt16LE(buf.readInt16LE(dataStart + Math.floor(i * ratio) * 2), i * 2);
}
console.log(`audio: ${rate}Hz -> ${RATE}Hz, ${(outCount / RATE).toFixed(1)}s`);

const res = await fetch(`${APP}/api/gemini/token`);
if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
const { token, model } = await res.json();
console.log(`token: ${token.slice(0, 20)}...  model: ${model}`);

const drawTool = {
  functionDeclarations: [{
    name: "draw",
    description: "Add marks to the sketchnote page the audience is watching.",
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        marks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              op: { type: Type.STRING, enum: ["title","heading","word","note","bullet","box","icon","underline"] },
              text: { type: Type.STRING },
              icon: { type: Type.STRING },
            },
            required: ["op"],
          },
        },
      },
      required: ["marks"],
    },
  }],
};

const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
const marks = [], heard = [];
let firstMs = null, spoke = false;
const t0 = Date.now();
let session;

await new Promise(async (resolve) => {
  let idle, sending = true;
  const bump = () => { clearTimeout(idle); if (!sending) idle = setTimeout(resolve, 12000); };
  try {
    session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: LIVE_SCRIBE_SYSTEM,
        temperature: 0.4,
        tools: [drawTool],
        inputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 400 } },
        sessionResumption: {},
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onopen: () => console.log("socket open"),
        onmessage: (m) => {
          bump();
          const t = m?.serverContent?.inputTranscription?.text;
          if (t) heard.push(t);
          // Did it try to talk to us instead of drawing?
          for (const p of m?.serverContent?.modelTurn?.parts ?? []) {
            if (p?.inlineData?.mimeType?.startsWith("audio/")) spoke = true;
          }
          const calls = m?.toolCall?.functionCalls;
          if (calls?.length) {
            if (firstMs === null) firstMs = Date.now() - t0;
            console.log(`  [${((Date.now()-t0)/1000).toFixed(1)}s] draw x${calls.reduce((n,c)=>n+(c.args?.marks?.length??0),0)}`);
            for (const c of calls) for (const mk of c.args?.marks ?? []) marks.push(mk);
            session.sendToolResponse({
              functionResponses: calls.map((c) => ({
                id: c.id, name: c.name,
                response: { output: "drawn" },
                scheduling: FunctionResponseScheduling.SILENT,
              })),
            });
          }
        },
        onerror: (e) => { console.error("ERR", e?.message ?? e); resolve(); },
        onclose: (e) => { console.log("closed:", (e?.reason ?? "").slice(0, 100)); resolve(); },
      },
    });

    const CHUNK = RATE / 10;
    const silence = Buffer.alloc(CHUNK * 2).toString("base64");
    let sinceGap = 0;
    for (let i = 0; i < outCount; i += CHUNK) {
      session.sendRealtimeInput({
        audio: {
          data: pcm.subarray(i * 2, Math.min(outCount, i + CHUNK) * 2).toString("base64"),
          mimeType: `audio/pcm;rate=${RATE}`,
        },
      });
      await new Promise((r) => setTimeout(r, 100));
      sinceGap += 100;
      // A speaker breathes between sentences. Reproduce that, or VAD never
      // ends a turn and the model has no moment at which to act.
      if (sinceGap >= 7000) {
        sinceGap = 0;
        for (let g = 0; g < 7; g++) {
          session.sendRealtimeInput({ audio: { data: silence, mimeType: `audio/pcm;rate=${RATE}` } });
          await new Promise((r) => setTimeout(r, 100));
        }
        console.log(`  [${((Date.now()-t0)/1000).toFixed(1)}s] ...pause...`);
      }
    }
    // A live mic keeps producing silence; a file just stops. Signal the end so
    // voice-activity detection closes the final turn.
    session.sendRealtimeInput({ audioStreamEnd: true });
    console.log("audio sent, waiting...");
    sending = false;
    bump();
  } catch (e) {
    console.error("connect failed:", e?.message ?? e);
    resolve();
  }
});

try { session?.close(); } catch {}

const kept = marks.filter((m) => m.op === "icon" || !isFragment(m.text ?? ""));
console.log(`\nheard: ${heard.join("").slice(0, 200)}`);
console.log(`spoke audio at us: ${spoke ? "YES (bad)" : "no"}`);
console.log(`first draw call after: ${firstMs ?? "never"}ms`);
console.log(`marks requested: ${marks.length}, surviving the fragment filter: ${kept.length}`);
for (const m of marks) {
  const drop = m.op !== "icon" && isFragment(m.text ?? "");
  console.log(`  ${drop ? "✗" : "✓"} ${m.op.padEnd(9)} ${m.text ?? m.icon ?? ""}`);
}
process.exit(0);
