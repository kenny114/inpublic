"use client";

import { useEffect, useState } from "react";
import type { CanvasPresenceController, CanvasPresenceSnapshot } from "./types";

export function AgentPresenceOverlay({ controller }: { controller: CanvasPresenceController }) {
  const [snapshot, setSnapshot] = useState<CanvasPresenceSnapshot>(() => controller.getSnapshot());

  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => controller.setReducedMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [controller]);
  useEffect(() => {
    if (!snapshot.visible) return;
    let frame = 0;
    const animate = (time: number) => {
      controller.tick(time);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [controller, snapshot.visible]);

  if (!snapshot.visible) return null;
  const target = snapshot.target;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[70] overflow-hidden"
      data-agent-presence="true"
      data-agent-presence-status={snapshot.status}
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-violet-200 bg-white/95 px-3 py-1 text-[11px] font-medium capitalize tracking-wide text-violet-700 shadow-sm">
        Agent {snapshot.status}
      </div>
      {target && snapshot.gesture !== "none" ? (
        <>
          <div
            data-agent-presence-pointer="true"
            data-agent-presence-entity={target.entityId}
            className="absolute h-3 w-3 rounded-full border-2 border-white bg-violet-600 shadow-[0_0_0_3px_rgba(124,58,237,0.2)]"
            style={{ left: target.point.x, top: target.point.y, transform: "translate(-50%, -50%)" }}
          />
          {snapshot.gesture === "highlight" ? (
            <div
              data-agent-presence-highlight="true"
              data-agent-presence-entity={target.entityId}
              className="absolute rounded-xl border-2 border-violet-500/70 bg-violet-400/10 shadow-[0_0_0_4px_rgba(139,92,246,0.12)]"
              style={{
                left: target.bounds.x - 6,
                top: target.bounds.y - 6,
                width: target.bounds.width + 12,
                height: target.bounds.height + 12,
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
