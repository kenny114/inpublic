/**
 * Streams a WAV file to Deepgram's live endpoint the same way the browser does
 * and records EVERY message verbatim.
 *
 * Deliberately mirrors hooks/useDeepgram.ts: linear16, mono, 80ms chunks paced
 * in real time, same event wiring. The only thing that differs is the source of
 * the PCM. That is what makes a result here evidence about production rather
 * than evidence about a benchmark.
 */
import fs from "node:fs";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

/** Minimal WAV reader — the corpus is 16-bit mono PCM, nothing exotic. */
export function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  let sampleRate = 16000;
  let channels = 1;
  let dataStart = 0;
  let dataLen = 0;
  while (off < buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10);
      sampleRate = buf.readUInt32LE(off + 12);
    }
    if (id === "data") {
      dataStart = off + 8;
      dataLen = Math.min(size, buf.length - dataStart);
      break;
    }
    off += 8 + size + (size % 2);
  }
  return { pcm: buf.subarray(dataStart, dataStart + dataLen), sampleRate, channels };
}

const CHUNK_MS = 80; // matches public/pcm-capture-worklet.js

/**
 * @param {string} file  WAV path
 * @param {object} opts  Deepgram live options, merged over the production set
 * @param {object} [cfg] { trailingSilenceMs, apiKey }
 */
export async function streamFile(file, opts = {}, cfg = {}) {
  const { pcm, sampleRate, channels } = readWav(file);
  const apiKey = cfg.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

  const deepgram = createClient(apiKey);
  const connection = deepgram.listen.live({
    model: "nova-3",
    interim_results: true,
    smart_format: true,
    endpointing: 150,
    utterance_end_ms: 1000,
    punctuate: true,
    vad_events: true,
    encoding: "linear16",
    sample_rate: sampleRate,
    channels,
    ...opts,
  });

  const messages = [];
  const t0 = Date.now();
  let opened = false;

  await new Promise((resolve, reject) => {
    const finish = () => resolve();
    const timeout = setTimeout(finish, 60000);

    connection.on(LiveTranscriptionEvents.Open, async () => {
      opened = true;
      const bytesPerChunk = Math.round((sampleRate * CHUNK_MS) / 1000) * 2 * channels;
      // Real-time pacing. Sending the file as fast as the socket accepts it
      // changes Deepgram's endpointing behaviour and would make every interim
      // measurement fiction.
      let sentAt = Date.now();
      for (let i = 0; i < pcm.length; i += bytesPerChunk) {
        try {
          connection.send(pcm.subarray(i, Math.min(pcm.length, i + bytesPerChunk)));
        } catch {
          break;
        }
        sentAt += CHUNK_MS;
        const drift = sentAt - Date.now();
        if (drift > 0) await new Promise((r) => setTimeout(r, drift));
      }
      // A microphone keeps producing room tone; a file just stops. Feed silence
      // so endpointing fires and the utterance actually finalises.
      const silence = Buffer.alloc(bytesPerChunk);
      const tail = Math.ceil((cfg.trailingSilenceMs ?? 1600) / CHUNK_MS);
      for (let i = 0; i < tail; i += 1) {
        try {
          connection.send(silence);
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, CHUNK_MS));
      }
      try {
        connection.requestClose();
      } catch {
        /* already closing */
      }
      setTimeout(finish, 1200);
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      messages.push({ at: Date.now() - t0, type: "transcript", data });
    });
    connection.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
      messages.push({ at: Date.now() - t0, type: "speech-started", data });
    });
    connection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      messages.push({ at: Date.now() - t0, type: "utterance-end", data });
    });
    connection.on(LiveTranscriptionEvents.Error, (err) => {
      messages.push({ at: Date.now() - t0, type: "error", data: String(err?.message ?? err) });
      clearTimeout(timeout);
      if (!opened) reject(new Error(String(err?.message ?? err)));
    });
    connection.on(LiveTranscriptionEvents.Close, () => {
      clearTimeout(timeout);
      setTimeout(finish, 300);
    });
  });

  return { messages, durationMs: (pcm.length / 2 / channels / sampleRate) * 1000, sampleRate };
}

/** The transcript InPublic would have ended up with: finals, in order, joined. */
export function finalTranscript(messages) {
  return messages
    .filter((m) => m.type === "transcript" && m.data?.is_final)
    .map((m) => m.data?.channel?.alternatives?.[0]?.transcript ?? "")
    .filter((t) => t.trim())
    .join(" ")
    .trim();
}

/** Every word Deepgram reported on a final, with its confidence. */
export function finalWords(messages) {
  const out = [];
  for (const m of messages) {
    if (m.type !== "transcript" || !m.data?.is_final) continue;
    for (const w of m.data?.channel?.alternatives?.[0]?.words ?? []) out.push(w);
  }
  return out;
}
