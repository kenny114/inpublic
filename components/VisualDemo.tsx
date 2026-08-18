"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { tabbedDemos, visualDemo, type VisualDemoSource } from "@/lib/demos";

/**
 * A recorded InPublic canvas, embedded as a miniature of the real thing.
 *
 * Deliberately not a video player: no scrubber, no volume, no chrome. It
 * autoplays muted when it scrolls into view, loops, and stops the moment it
 * leaves — a page with three of these should cost about as much as one.
 * Nothing loads until the demo is near the viewport.
 */
export function VisualDemo({
  id,
  caption,
  priority = false,
  className = "",
}: {
  id: VisualDemoSource["id"];
  /** Overrides the catalogue caption. Pass null for a bare canvas. */
  caption?: string | null;
  /** Skips the lazy gate for the one demo above the fold. */
  priority?: boolean;
  className?: string;
}) {
  const demo = visualDemo(id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(priority);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  // The captures are VP9 WebM. Where that will not play, the poster is still
  // the real final canvas from the same run, so the page keeps its proof and
  // simply loses the motion — it must not show a dead player instead.
  const [unplayable, setUnplayable] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Two thresholds from one observer: a generous margin decides when the file
  // is allowed to load at all, and actual visibility decides playback.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
        const video = videoRef.current;
        if (!video) return;
        if (entry.intersectionRatio >= 0.35 && !reduced) void video.play().catch(() => undefined);
        else if (entry.intersectionRatio < 0.1) video.pause();
      },
      { rootMargin: "300px 0px", threshold: [0, 0.1, 0.35] },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [reduced]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setNear(true);
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const restart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
  }, []);

  const text = caption === undefined ? demo.caption : caption;

  return (
    <figure className={`visual-demo ${className}`.trim()} ref={frameRef}>
      <div className="visual-demo-frame">
        <div className="visual-demo-bar">
          <span><i />InPublic · Standard Mode</span>
          <span>Recorded live session</span>
        </div>
        <video
          ref={videoRef}
          className="visual-demo-video"
          poster={demo.poster}
          {...(near ? { src: demo.video } : {})}
          preload={priority ? "auto" : "none"}
          muted
          loop
          playsInline
          disablePictureInPicture
          aria-label={`A recorded InPublic session: ${demo.title}`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setUnplayable(true)}
        />
        <div className="visual-demo-controls" hidden={unplayable}>
          <button type="button" onClick={toggle} aria-label={playing ? "Pause the demo" : "Play the demo"}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button type="button" onClick={restart} aria-label="Replay the demo from the start">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      {text ? <figcaption>{text}</figcaption> : null}
    </figure>
  );
}

/**
 * The three demos behind one selector, so the page shows a single large canvas
 * instead of a stack of videos. Only the selected demo is mounted; switching
 * tabs swaps which real recording plays.
 */
export function VisualDemoTabs({ heading }: { heading?: string }) {
  const demos = tabbedDemos();
  const [active, setActive] = useState<VisualDemoSource["id"]>(demos[0].id);
  const current = visualDemo(active);

  return (
    <div className="visual-demo-tabs">
      {heading ? <p className="cohesive-eyebrow">{heading}</p> : null}
      <div className="visual-demo-switch" role="tablist" aria-label="Choose a demonstration">
        {demos.map((demo) => (
          <button
            key={demo.id}
            type="button"
            role="tab"
            id={`demo-tab-${demo.id}`}
            aria-selected={demo.id === active}
            aria-controls={`demo-panel-${demo.id}`}
            onClick={() => setActive(demo.id)}
          >
            {demo.tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`demo-panel-${current.id}`} aria-labelledby={`demo-tab-${current.id}`}>
        {/* Keyed so switching tabs remounts the player rather than swapping a
            source underneath a video that is mid-play. */}
        <VisualDemo key={current.id} id={current.id} caption={null} priority />
        <div className="visual-demo-legend">
          <strong>{current.title}</strong>
          <p>{current.caption}</p>
        </div>
      </div>
    </div>
  );
}
