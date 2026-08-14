/**
 * Development-only capture of the speech pipeline's two invisible layers:
 * every raw Deepgram message, and the exact PCM that was transmitted.
 *
 * This exists to settle one question that no amount of reading the code can
 * answer: when a word comes out wrong, did Deepgram mishear good audio, or did
 * it hear bad audio? Recording the bytes we actually sent — not the microphone,
 * not a re-recording, the same buffers handed to the socket — is the only way
 * to tell, because it captures whatever the browser's echo cancellation, noise
 * suppression and gain control did on the way through.
 *
 * Everything here is inert unless BOTH conditions hold:
 *   - NODE_ENV === "development"
 *   - localStorage["inpublic:stt-debug"] === "1"
 *
 * In production the `enabled` getter is a constant false, every call site is
 * behind it, and nothing is allocated or retained. Transcripts are sensitive;
 * they are held in memory only, never uploaded, and cleared on reset.
 *
 * Usage, from the browser console in dev:
 *
 *   localStorage["inpublic:stt-debug"] = "1"   // then reload and record
 *   __inpublicSTT.summary()                    // what happened
 *   __inpublicSTT.saveJson()                   // every raw message
 *   __inpublicSTT.saveWav()                    // the audio Deepgram received
 *   __inpublicSTT.reset()
 */

const isDev = process.env.NODE_ENV === "development";

export interface RawMessage {
  /** ms since capture started. */
  atMs: number;
  isFinal: boolean;
  speechFinal: boolean;
  start?: number;
  duration?: number;
  transcript: string;
  confidence?: number;
  words: { word: string; punctuated?: string; start: number; end: number; confidence: number }[];
}

export interface LayerEntry {
  atMs: number;
  /** C = canonical transcript, D = text handed to the visual/reasoning layer. */
  layer: "C" | "D";
  text: string;
  note?: string;
}

class SttDebug {
  private on = false;
  private started = 0;
  private messages: RawMessage[] = [];
  private layers: LayerEntry[] = [];
  private audio: Int16Array[] = [];
  private audioFrames = 0;
  private rate = 0;
  /** Bounded so a long session can't exhaust memory: ~10 minutes at 48kHz. */
  private static MAX_FRAMES = 48000 * 600;
  private static MAX_MESSAGES = 20000;

  get enabled(): boolean {
    if (!isDev) return false;
    if (this.on) return true;
    try {
      this.on = window.localStorage.getItem("inpublic:stt-debug") === "1";
    } catch {
      this.on = false;
    }
    return this.on;
  }

  private clock(): number {
    if (!this.started) this.started = performance.now();
    return Math.round(performance.now() - this.started);
  }

  /** One Deepgram Results message, kept verbatim enough to re-derive anything. */
  recordMessage(data: any): void {
    if (this.messages.length >= SttDebug.MAX_MESSAGES) return;
    const alt = data?.channel?.alternatives?.[0];
    this.messages.push({
      atMs: this.clock(),
      isFinal: Boolean(data?.is_final),
      speechFinal: Boolean(data?.speech_final),
      start: data?.start,
      duration: data?.duration,
      transcript: alt?.transcript ?? "",
      confidence: alt?.confidence,
      words: (alt?.words ?? []).map((w: any) => ({
        word: w.word,
        punctuated: w.punctuated_word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      })),
    });
  }

  /** A chunk of PCM16, copied before it goes to the socket. */
  recordAudio(buffer: ArrayBuffer, sampleRate: number): void {
    if (this.audioFrames >= SttDebug.MAX_FRAMES) return;
    this.rate = sampleRate;
    const copy = new Int16Array(buffer.byteLength / 2);
    copy.set(new Int16Array(buffer));
    this.audio.push(copy);
    this.audioFrames += copy.length;
    this.clock();
  }

  /** What InPublic did with the text after Deepgram handed it over. */
  recordLayer(layer: "C" | "D", text: string, note?: string): void {
    if (this.layers.length >= SttDebug.MAX_MESSAGES) return;
    this.layers.push({ atMs: this.clock(), layer, text, note });
  }

  summary() {
    const finals = this.messages.filter((m) => m.isFinal);
    const words = finals.flatMap((m) => m.words);
    const confs = words.map((w) => w.confidence).filter((c) => Number.isFinite(c));
    confs.sort((a, b) => a - b);
    return {
      messages: this.messages.length,
      interims: this.messages.length - finals.length,
      finals: finals.length,
      speechFinals: finals.filter((m) => m.speechFinal).length,
      words: words.length,
      lowConfidenceWords: words.filter((w) => w.confidence < 0.8).map((w) => `${w.word} ${w.confidence.toFixed(2)}`),
      medianConfidence: confs.length ? confs[Math.floor(confs.length / 2)] : NaN,
      audioSeconds: this.rate ? +(this.audioFrames / this.rate).toFixed(1) : 0,
      sampleRate: this.rate,
      transcript: finals.map((m) => m.transcript).join(" "),
      layers: this.layers.length,
    };
  }

  /** Layers B, C and D side by side, newline-delimited. */
  compare(): string {
    const rows: string[] = [];
    for (const m of this.messages) {
      if (!m.isFinal) continue;
      rows.push(`[${m.atMs}ms] B(deepgram) ${m.transcript}`);
    }
    for (const l of this.layers) rows.push(`[${l.atMs}ms] ${l.layer}${l.note ? `(${l.note})` : ""} ${l.text}`);
    return rows.sort((a, b) => Number(a.match(/\[(\d+)ms\]/)?.[1]) - Number(b.match(/\[(\d+)ms\]/)?.[1])).join("\n");
  }

  private download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  saveJson(): void {
    this.download(
      new Blob([JSON.stringify({ messages: this.messages, layers: this.layers, sampleRate: this.rate }, null, 2)], {
        type: "application/json",
      }),
      `stt-${Date.now()}.json`,
    );
  }

  /** The transmitted audio, as a playable WAV. */
  saveWav(): void {
    const rate = this.rate || 48000;
    const pcm = new Int16Array(this.audioFrames);
    let off = 0;
    for (const c of this.audio) {
      pcm.set(c, off);
      off += c.length;
    }
    const bytes = pcm.length * 2;
    const buf = new ArrayBuffer(44 + bytes);
    const view = new DataView(buf);
    const ascii = (at: number, s: string) => {
      for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i));
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + bytes, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, bytes, true);
    new Int16Array(buf, 44).set(pcm);
    this.download(new Blob([buf], { type: "audio/wav" }), `stt-${Date.now()}.wav`);
  }

  reset(): void {
    this.started = 0;
    this.messages = [];
    this.layers = [];
    this.audio = [];
    this.audioFrames = 0;
  }
}

export const sttDebug = new SttDebug();

if (isDev && typeof window !== "undefined") {
  (window as any).__inpublicSTT = sttDebug;
}
