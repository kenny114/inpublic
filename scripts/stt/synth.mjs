/**
 * Renders the corpus to 16kHz mono PCM16 WAV files using Windows System.Speech.
 *
 * Synthetic speech is a WEAK proxy for real users — it has no accent, no room,
 * no mic. It exists so the controlled experiments (keyterm on/off, smart_format
 * on/off) run on byte-identical audio, which is the one thing human recordings
 * cannot give you. Drop real recordings into the same directory named <id>.wav
 * and every downstream script will prefer them.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CORPUS } from "./corpus.mjs";

const OUT = process.argv[2] ?? path.join(process.cwd(), "scripts", "stt", "audio");
fs.mkdirSync(OUT, { recursive: true });

const ps = [
  "Add-Type -AssemblyName System.Speech",
  "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)",
];

let made = 0;
for (const entry of CORPUS) {
  const file = path.join(OUT, `${entry.id}.wav`);
  if (fs.existsSync(file) && !process.argv.includes("--force")) continue;
  const text = entry.text.replace(/'/g, "''");
  ps.push(
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$s.SelectVoice('${entry.voice ?? "Microsoft Zira Desktop"}')`,
    `$s.Rate = ${entry.rate ?? 0}`,
    `$s.SetOutputToWaveFile('${file}', $fmt)`,
    `$s.Speak('${text}')`,
    "$s.Dispose()",
  );
  made += 1;
}

if (made) {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps.join("; ")], {
    stdio: "inherit",
  });
}
console.log(`${made} synthesised, ${CORPUS.length} total in ${OUT}`);
