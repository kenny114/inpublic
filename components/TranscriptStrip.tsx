"use client";

export function TranscriptStrip({ text }: { text: string }) {
  const visibleText = text.trim() || "Start speaking and your words will appear here immediately.";
  return (
    <div data-recording-transcript={text} className="canvas-transcript" aria-live="polite">
      <span>{text.trim() ? "Hearing you" : "Live transcript"}</span>
      <p>{visibleText.slice(-150)}</p>
    </div>
  );
}
