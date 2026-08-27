"""Local Moonshine speech bridge for InPublic.

Owns the microphone directly (unlike Deepgram, audio never crosses into the
browser) and speaks a tiny JSON protocol over a WebSocket to
hooks/useMoonshine.ts / lib/moonshineBridge.ts:

  client -> server: {"type": "start"}   begin a take
  client -> server: {"type": "stop"}    end the take
  server -> client: {"type": "line_started"|"line_changed"|"line_completed",
                      "lineId": "...", "text": "...", "atMs": <int>}

Moonshine's public API (see `moonshine.transcribe`) is whole-segment, not a
token-streaming API: there is no partial-decode callback to hook into. This
bridge approximates streaming the same way Useful Sensors' own
`live_captions` demo does — a small RMS-energy voice activity detector opens
a "line" on speech, periodically re-runs `transcribe` on the growing buffer
for that line (emitted as "line_changed"), and closes the line with
"line_completed" once silence has held long enough. That is real, honest
behavior for what the library provides; it is not word-by-word streaming.

Run:
    python server.py                              # live microphone
    python server.py --test-file sample.wav        # one file, no mic, no server loop
    python server.py --model moonshine/tiny --port 8765
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
import wave
from pathlib import Path

os.environ.setdefault("KERAS_BACKEND", "torch")

import numpy as np  # noqa: E402

SAMPLE_RATE = 16_000
DEFAULT_MODEL = "moonshine/base"
DEFAULT_PORT = 8765

# Voice activity detection tuning. These are frame-level RMS thresholds over
# 16kHz PCM, not calibrated per-microphone — good enough for local dev, not a
# production VAD.
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
SILENCE_RMS = 0.01
SILENCE_HANGOVER_MS = 700
MIN_LINE_MS = 200
PARTIAL_INTERVAL_MS = 600
MAX_LINE_SECONDS = 20  # stay well under Moonshine's 64s-per-call ceiling


def log(*args) -> None:
    print(*args, file=sys.stderr, flush=True)


class MoonshineTranscriber:
    """Loads the model once; `transcribe` reuses it across calls."""

    def __init__(self, model_name: str):
        import moonshine

        log(f"[moonshine-bridge] loading {model_name} ...")
        self._moonshine = moonshine
        self._model = moonshine.load_model(model_name)
        log("[moonshine-bridge] model ready")

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size < int(0.1 * SAMPLE_RATE):
            return ""
        batch = audio.astype(np.float32)[None, :]
        result = self._moonshine.transcribe(batch, self._model)
        return (result[0] if result else "").strip()


class LineSegmenter:
    """RMS-energy VAD that turns a raw PCM stream into started/changed/completed line events."""

    def __init__(self, transcriber: MoonshineTranscriber, emit, clock):
        self._transcriber = transcriber
        self._emit = emit  # async fn(event: dict) -> None
        self._clock = clock  # fn() -> ms since take started
        self._buffer = np.zeros(0, dtype=np.float32)
        self._line_id: str | None = None
        self._line_started_at = 0.0
        self._last_partial_at = 0.0
        self._silence_ms = 0.0

    async def feed(self, frame: np.ndarray) -> None:
        rms = float(np.sqrt(np.mean(np.square(frame)))) if frame.size else 0.0
        speaking = rms >= SILENCE_RMS

        if speaking:
            self._silence_ms = 0.0
            if self._line_id is None:
                self._line_id = uuid.uuid4().hex[:12]
                self._line_started_at = self._clock()
                self._buffer = frame.copy()
                await self._emit({"type": "line_started", "lineId": self._line_id, "text": "", "atMs": int(self._clock())})
                self._last_partial_at = self._clock()
                return
            self._buffer = np.concatenate([self._buffer, frame])
        else:
            if self._line_id is not None:
                self._buffer = np.concatenate([self._buffer, frame])
                self._silence_ms += FRAME_MS

        if self._line_id is None:
            return

        now = self._clock()
        line_duration_ms = now - self._line_started_at
        should_finalize = (
            self._silence_ms >= SILENCE_HANGOVER_MS and line_duration_ms >= MIN_LINE_MS
        ) or (self._buffer.size / SAMPLE_RATE) >= MAX_LINE_SECONDS

        if should_finalize:
            text = self._transcriber.transcribe(self._buffer)
            await self._emit({"type": "line_completed", "lineId": self._line_id, "text": text, "atMs": int(now)})
            self._line_id = None
            self._buffer = np.zeros(0, dtype=np.float32)
            self._silence_ms = 0.0
            return

        if now - self._last_partial_at >= PARTIAL_INTERVAL_MS:
            self._last_partial_at = now
            text = self._transcriber.transcribe(self._buffer)
            await self._emit({"type": "line_changed", "lineId": self._line_id, "text": text, "atMs": int(now)})

    async def flush(self) -> None:
        """Force-finalize an open line — used on stop/disconnect."""
        if self._line_id is None:
            return
        text = self._transcriber.transcribe(self._buffer)
        await self._emit({"type": "line_completed", "lineId": self._line_id, "text": text, "atMs": int(self._clock())})
        self._line_id = None
        self._buffer = np.zeros(0, dtype=np.float32)
        self._silence_ms = 0.0


def read_wav_mono16k(path: str) -> np.ndarray:
    """Reads a PCM16 WAV file, resampling to 16kHz mono if needed (linear, test-fixture quality)."""
    with wave.open(path, "rb") as wav:
        channels = wav.getnchannels()
        rate = wav.getframerate()
        width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit PCM WAV, got {width * 8}-bit")
    data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE:
        duration = data.shape[0] / rate
        target_len = int(round(duration * SAMPLE_RATE))
        data = np.interp(
            np.linspace(0, data.shape[0], target_len, endpoint=False),
            np.arange(data.shape[0]),
            data,
        ).astype(np.float32)
    return data


async def run_test_file(path: str, model_name: str) -> None:
    """Feeds a WAV file through the same segmenter as a live take, printing events to stdout as JSON lines."""
    transcriber = MoonshineTranscriber(model_name)
    audio = read_wav_mono16k(path)
    started_at = time.monotonic()

    def clock() -> float:
        return (time.monotonic() - started_at) * 1000

    async def emit(event: dict) -> None:
        print(json.dumps(event), flush=True)

    segmenter = LineSegmenter(transcriber, emit, clock)
    for offset in range(0, audio.shape[0], FRAME_SAMPLES):
        frame = audio[offset : offset + FRAME_SAMPLES]
        await segmenter.feed(frame)
    await segmenter.flush()


async def run_server(host: str, port: int, model_name: str) -> None:
    import websockets

    transcriber = MoonshineTranscriber(model_name)

    async def handle(websocket) -> None:
        log("[moonshine-bridge] client connected")
        take_started_at: float | None = None
        segmenter: LineSegmenter | None = None
        stream: "object | None" = None

        def clock() -> float:
            return (time.monotonic() - (take_started_at or time.monotonic())) * 1000

        async def emit(event: dict) -> None:
            await websocket.send(json.dumps(event))

        async def start_take() -> None:
            nonlocal take_started_at, segmenter, stream
            import sounddevice as sd

            take_started_at = time.monotonic()
            segmenter = LineSegmenter(transcriber, emit, clock)
            loop = asyncio.get_event_loop()

            def on_audio(indata, frames, time_info, status) -> None:  # noqa: ANN001
                if status:
                    log(f"[moonshine-bridge] audio status: {status}")
                mono = indata[:, 0].astype(np.float32)
                asyncio.run_coroutine_threadsafe(segmenter.feed(mono), loop)

            stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                blocksize=FRAME_SAMPLES,
                dtype="float32",
                callback=on_audio,
            )
            stream.start()
            log("[moonshine-bridge] mic capture started")

        async def stop_take() -> None:
            nonlocal stream, segmenter
            if stream is not None:
                stream.stop()
                stream.close()
                stream = None
            if segmenter is not None:
                await segmenter.flush()
                segmenter = None
            log("[moonshine-bridge] mic capture stopped")

        try:
            async for raw in websocket:
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if message.get("type") == "start" and segmenter is None:
                    await start_take()
                elif message.get("type") == "stop":
                    await stop_take()
        finally:
            await stop_take()
            log("[moonshine-bridge] client disconnected")

    log(f"[moonshine-bridge] listening on ws://{host}:{port}")
    async with websockets.serve(handle, host, port):
        await asyncio.Future()  # run forever


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="moonshine/base or moonshine/tiny")
    parser.add_argument("--test-file", help="Run once over a 16-bit PCM WAV file and print events to stdout, no server/mic")
    args = parser.parse_args()

    if args.test_file:
        asyncio.run(run_test_file(args.test_file, args.model))
        return

    asyncio.run(run_server(args.host, args.port, args.model))


if __name__ == "__main__":
    main()
