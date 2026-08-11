/**
 * Runs one Standard Mode demo inside a real InPublic canvas session and
 * records the canvas while it happens.
 *
 * Loaded into a signed-in /create page by scripts/demo-capture-server.mjs.
 *
 * What is real: the microphone stream is the only synthetic part. It carries
 * actual speech audio (scripts/demo-speech.ps1) into the app's own
 * getUserMedia call, so Deepgram transcribes it, the beat decides on it, the
 * Artist plans from it, and the organizer draws it — every layer that makes
 * the visuals runs exactly as it does for a person talking into a headset.
 *
 * What is recorded: the Excalidraw canvases only. No DOM chrome, no toolbar,
 * no cursor. What comes out is what the product drew.
 */
(() => {
  const CAPTURE = "http://localhost:3211";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function preferredMimeType() {
    return [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  /** Composite every Excalidraw canvas into one recordable surface. */
  function startCanvasRecorder(fps = 30) {
    const host = document.querySelector(".excalidraw") || document.body;
    const rect = host.getBoundingClientRect();
    const scale = Math.min(1, 720 / Math.max(1, rect.height));
    const out = document.createElement("canvas");
    out.width = Math.round((rect.width * scale) / 2) * 2;
    out.height = Math.round((rect.height * scale) / 2) * 2;
    const ctx = out.getContext("2d");

    let raf = 0;
    const draw = () => {
      const bounds = host.getBoundingClientRect();
      const sx = out.width / Math.max(1, bounds.width);
      const sy = out.height / Math.max(1, bounds.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      for (const canvas of host.querySelectorAll("canvas")) {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        try {
          ctx.drawImage(canvas, (r.left - bounds.left) * sx, (r.top - bounds.top) * sy, r.width * sx, r.height * sy);
        } catch { /* canvas swapped mid-paint */ }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const stream = out.captureStream(fps);
    const mimeType = preferredMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_200_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start(1000);

    return {
      size: [out.width, out.height],
      /** The last composited frame, used as the poster so the still and the
       *  video are the same canvas rather than two different pictures. */
      poster: () => new Promise((resolve) => out.toBlob(resolve, "image/png")),
      stop: () =>
        new Promise((resolve) => {
          recorder.onstop = () => {
            cancelAnimationFrame(raf);
            stream.getTracks().forEach((t) => t.stop());
            resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
          };
          recorder.stop();
        }),
    };
  }

  function buttonByText(text) {
    return [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim().toLowerCase() === text.toLowerCase(),
    );
  }

  /** Everything the run did, read back off the live board. */
  function readScene() {
    const notes = [];
    for (const canvas of document.querySelectorAll(".excalidraw canvas")) {
      notes.push(`${canvas.className || "canvas"} ${canvas.width}x${canvas.height}`);
    }
    return notes;
  }

  // The last thought is still in flight when the audio ends — the beat waits
  // for silence, then the Artist and the organizer still have to run. Stopping
  // the microphone before that lands both truncates the recording and kills
  // the request mid-flight (the first capture ended with two 429s).
  async function run(id, { settleMs = 14000 } = {}) {
    const started = Date.now();
    const errors = [];
    const network = [];

    // Watch the real decision layers go by, so the run can be judged on what
    // the product actually decided rather than on the picture alone.
    const realFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url ?? "";
      const response = await realFetch.apply(this, arguments);
      if (/\/api\/(beat|artist|scribe)/.test(url)) {
        const clone = response.clone();
        clone.json().then(
          (payload) => network.push({ at: Date.now() - started, url: url.replace(location.origin, ""), status: response.status, payload }),
          () => undefined,
        );
      }
      return response;
    };
    const onError = (e) => errors.push(String(e.message || e.reason || e));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);

    // Any lease left over from an earlier run blocks the next one.
    await realFetch("/api/usage/session", { method: "DELETE" }).catch(() => undefined);

    // The spoken audio, played into the app's own microphone request.
    const audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (audioCtx.state !== "running") throw new Error(`audio context ${audioCtx.state} — click the page first`);
    const wav = await realFetch(`/_demo-src/${id}.wav`).then((r) => r.arrayBuffer());
    const buffer = await audioCtx.decodeAudioData(wav);
    const destination = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);

    const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let micRequested = null;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) return realGetUserMedia(constraints);
      micRequested = Date.now();
      return destination.stream;
    };

    const start = buttonByText("Start speaking");
    if (!start) throw new Error("no Start speaking button — is this /create?");
    start.click();

    // Wait for the socket, not a fixed delay: speaking into a socket that is
    // still opening loses the opening words.
    const deadline = Date.now() + 20000;
    while (!buttonByText("Pause") && Date.now() < deadline) await sleep(150);
    if (!buttonByText("Pause")) throw new Error("microphone never went live");
    const liveAt = Date.now();

    const recorder = startCanvasRecorder();
    source.start();

    await sleep(buffer.duration * 1000 + settleMs);

    buttonByText("Pause")?.click();
    await sleep(600);
    const poster = await recorder.poster();
    const blob = await recorder.stop();

    navigator.mediaDevices.getUserMedia = realGetUserMedia;
    window.fetch = realFetch;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onError);
    await audioCtx.close();

    await realFetch(`${CAPTURE}/upload?name=${id}.webm`, { method: "POST", body: blob });
    if (poster) await realFetch(`${CAPTURE}/upload?name=${id}.png`, { method: "POST", body: poster });

    const report = {
      id,
      audioSeconds: Number(buffer.duration.toFixed(1)),
      micToLiveMs: liveAt - micRequested,
      videoBytes: blob.size,
      videoType: blob.type,
      frame: recorder.size,
      canvases: readScene(),
      errors,
      network,
    };
    await realFetch(`${CAPTURE}/report?name=${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report, null, 2),
    });
    return { id, audioSeconds: report.audioSeconds, videoKB: Math.round(blob.size / 1024), videoType: blob.type, beats: network.filter((n) => n.url.includes("beat")).length, artist: network.filter((n) => n.url.includes("artist")).length, errors };
  }

  window.__inpublicDemo = { run };
  return "ready";
})();
