"use client";

/** Debug affordance while recording. `T` toggles it off. */
export function TranscriptStrip({ text }: { text: string }) {
  const visibleText = text.trim() || "Transcript is on — start speaking";
  return (
    <div data-recording-transcript={text} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-1.5 text-center">
      <span
        className="text-neutral-800 opacity-50"
        style={{ fontSize: 14, lineHeight: "20px" }}
      >
        {visibleText.slice(-120)}
      </span>
    </div>
  );
}
