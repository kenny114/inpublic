# Moonshine bridge

A small local companion process for InPublic's local-first development stack:
mic -> Moonshine (this process) -> normalized transcript events -> InPublic
(`hooks/useMoonshine.ts`), with no audio ever leaving the machine and no
audio crossing into the browser.

Moonshine's public API (`moonshine.transcribe`) is whole-segment, not
token-streaming — there is no partial-decode hook to attach to. This bridge
approximates streaming the same way Useful Sensors' own `live_captions` demo
does: a small RMS-energy voice activity detector opens a "line" on speech,
periodically re-transcribes the growing buffer for that line, and finalizes
it once silence has held long enough. See `server.py`'s module docstring for
the exact protocol.

## Setup

```bash
cd local/moonshine-bridge
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # Windows
# .venv/bin/pip install -r requirements.txt        # macOS/Linux
```

The first run downloads the Moonshine model weights from Hugging Face
(`moonshine/base` by default, ~190MB; `moonshine/tiny` is much smaller and
faster, at some accuracy cost) — cached under `~/.cache/huggingface` after
that. No InPublic code or credentials are involved in this step.

## Run

```bash
./.venv/Scripts/python server.py                       # live microphone, ws://127.0.0.1:8765
./.venv/Scripts/python server.py --model moonshine/tiny --port 8765
./.venv/Scripts/python server.py --test-file sample.wav # one file, prints JSON events to stdout, no server/mic
```

Then in InPublic: `NEXT_PUBLIC_ENGINE=moonshine` (and optionally
`NEXT_PUBLIC_MOONSHINE_BRIDGE_URL` if not the default
`ws://127.0.0.1:8765`).

## Protocol

```
client -> server: {"type": "start"}
client -> server: {"type": "stop"}
server -> client: {"type": "line_started"|"line_changed"|"line_completed",
                    "lineId": "...", "text": "...", "atMs": <int>}
```

`line_started`/`line_changed` map to InPublic's "interim" transcript events;
`line_completed` maps to "final" — see `lib/moonshineBridge.ts`'s
`normalizeMoonshineEvent`.

## Known limitations

- VAD thresholds (`SILENCE_RMS`, `SILENCE_HANGOVER_MS` in `server.py`) are
  untuned defaults, not calibrated per-microphone or per-room.
- This is not real streaming ASR — each "line_changed" is a fresh
  whole-buffer re-transcription, so latency grows slightly with line length
  (bounded by `MAX_LINE_SECONDS`, which forces a finalize).
- No accent-specific evaluation has been done here; see
  `evaluation/reports/LOCAL-INTELLIGENCE-V0.md` for what's measured vs. not.
