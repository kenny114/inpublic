export type VisualCommitMode = "blocked" | "quiet" | "normal";

/**
 * Speech owns attention (camera), not every settled placement boundary.
 * Mutable interim geometry remains an absolute block; a camera-held boundary
 * admits only work launched before the latest live update.
 */
export function chooseVisualCommitMode(input: {
  hasMutableLiveLine: boolean;
  cameraHold: boolean;
  launchLiveSeq: number;
  currentLiveSeq: number;
  /** The visual can take the just-settled line's slot this turn. */
  sameTurnFold?: boolean;
}): VisualCommitMode {
  if (input.hasMutableLiveLine) return "blocked";
  if (input.sameTurnFold) return "normal";
  if (!input.cameraHold) return "normal";
  return input.launchLiveSeq < input.currentLiveSeq ? "quiet" : "blocked";
}
