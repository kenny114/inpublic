/**
 * Start a metered listening session and its speech engine as one operation.
 *
 * The ordering constraint that actually exists is narrow: **no audio may reach
 * a provider before a valid usage lease exists**, because the lease is what
 * authorises the spend and carries the session id every provider route
 * requires. Everything else in startup was serialised behind the lease only
 * because it happened to be written that way.
 *
 * So the shape is: do the local, free, provider-free work concurrently with
 * the lease, then gate the socket on the lease having succeeded.
 *
 *     press
 *       ├── prewarm()      getUserMedia · AudioWorklet · Deepgram SDK chunk
 *       └── startUsage()   entitlement check · POST /api/usage/session
 *              ↓ both settled, lease granted
 *           startEngine()  mint token (needs the lease) → open socket
 *              ↓
 *           listening
 *
 * `prewarm` opening the microphone before the lease resolves is safe and is
 * the point of the change: the browser's own capture graph is local, costs
 * nothing, contacts nobody, and `useDeepgram` will not transmit a byte until
 * its socket is open — which cannot happen until `startEngine` runs. If the
 * lease is refused, the microphone is released by the caller's stop path and
 * the user has spent nothing but a permission prompt they had already granted.
 */
/**
 * How long prewarm may hold up startEngine before the lease taken at press
 * time is treated as worth refreshing. Comfortably under the shortest lease
 * the server issues (USAGE_LEASE_SECONDS, 30s by default, floored at 5s in
 * the RPCs) and comfortably above a normal prewarm, which is a few hundred
 * milliseconds once microphone permission has already been granted.
 */
const STALE_LEASE_AFTER_MS = 5000;

export async function startListeningSession(
  startUsage: () => Promise<boolean>,
  startEngine: () => Promise<boolean>,
  // Return value intentionally ignored here — this only ever awaits
  // completion. `unknown` rather than `void` so callers whose stop resolves
  // with something useful (e.g. the stopped session's id) don't need a
  // wrapper just to satisfy this signature.
  stopUsage: (reason: string) => Promise<unknown>,
  /**
   * Local capture setup that is safe to run before authorisation. Optional so
   * existing callers and tests keep working unchanged; when absent this
   * behaves exactly as it did before.
   */
  prewarmEngine?: () => Promise<void>,
  /**
   * Renews the lease granted by startUsage — the same PATCH the periodic
   * heartbeat already uses — but only when prewarm actually ran long enough
   * to threaten it (see STALE_LEASE_AFTER_MS).
   *
   * The case this defends is narrow and real: a first-time user tapping
   * "start" gets an OS microphone prompt, and prewarm does not resolve until
   * they answer it. Someone who hesitates longer than the lease window comes
   * back to a lease that expired while the dialog was open, and startEngine —
   * which mints a provider credential the server checks that lease against —
   * fails for a session that was never idle.
   *
   * It is deliberately NOT called on every start: a round trip here sits
   * squarely on the press-to-listening path, and the common case (permission
   * already granted, prewarm in a few hundred ms) has nothing to renew.
   */
  renewUsage?: () => Promise<boolean>,
) {
  // Start both immediately. The rejection handler is attached here, on the
  // same tick the promise is created, so a prewarm that fails while the lease
  // request is still in flight cannot surface as an unhandled rejection.
  let prewarmFailure: unknown = null;
  const prewarmed = prewarmEngine
    ? prewarmEngine().catch((error: unknown) => {
        prewarmFailure = error;
      })
    : Promise.resolve();

  const leased = await startUsage();
  // From here, not from the press: the lease only starts ticking once it is
  // granted, so waiting on prewarm before that costs it nothing.
  const leasedAt = Date.now();
  await prewarmed;

  if (!leased) {
    // The lease is the authority. A successful prewarm without one is just an
    // open microphone we must not use, and the caller's stop path releases it.
    return false;
  }

  if (prewarmFailure) {
    // Nothing was transmitted, but a lease is now held for a session that
    // cannot start. Release it rather than leaving it to expire, so an
    // immediate retry is not rejected as a concurrent session.
    await stopUsage("provider_aborted");
    return false;
  }

  if (renewUsage && Date.now() - leasedAt > STALE_LEASE_AFTER_MS && !(await renewUsage())) {
    // renewUsage's own failure path (lease_rejected / quota_exhausted) already
    // calls the caller's onForcedStop/onWarning and clears its session state,
    // so there is nothing left to release here — just stop.
    return false;
  }

  let engineStarted = false;
  try {
    engineStarted = await startEngine();
    return engineStarted;
  } finally {
    if (!engineStarted) await stopUsage("provider_aborted");
  }
}
