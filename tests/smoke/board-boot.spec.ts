import { test, expect } from "@playwright/test";

/**
 * Board boot — the minimum viable proof the product still starts.
 * `/try?replay=1` is a dev-only bypass (lib/replayLab.ts:isReplayLabEnabled)
 * that mounts <Board guest startFresh /> directly, skipping the mic
 * permission click — no microphone, no network speech provider involved.
 */
test("board boots, Excalidraw mounts, no fatal console error", async ({ page }) => {
  const fatalErrors: string[] = [];
  page.on("pageerror", (err) => fatalErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // React DevTools / dev-mode advisories and expected 401s from the
    // anonymous entitlement check are not what this test is guarding against.
    if (/React DevTools|Download the React/.test(text)) return;
    fatalErrors.push(`console.error: ${text}`);
  });

  await page.goto("/try?replay=1");
  await expect(page.locator(".excalidraw").first()).toBeVisible({ timeout: 45_000 });

  await page.waitForTimeout(1000);
  expect(fatalErrors, `Unexpected console/page errors:\n${fatalErrors.join("\n")}`).toEqual([]);
});
