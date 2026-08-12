/**
 * Start a metered listening session and its speech engine as one operation.
 *
 * The server lease is acquired first because provider routes require its ID.
 * If the engine cannot start after that, release the lease immediately so a
 * retry (or another tab) is not rejected as a concurrent session.
 */
export async function startListeningSession(
  startUsage: () => Promise<boolean>,
  startEngine: () => Promise<boolean>,
  stopUsage: (reason: string) => Promise<void>,
) {
  if (!(await startUsage())) return false;

  let engineStarted = false;
  try {
    engineStarted = await startEngine();
    return engineStarted;
  } finally {
    if (!engineStarted) await stopUsage("provider_aborted");
  }
}
