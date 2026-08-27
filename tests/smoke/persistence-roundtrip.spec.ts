import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

/**
 * Persistence round-trip — the closest thing to "session restoration" this
 * suite can exercise without real Supabase credentials (see
 * STRIP_DOWN_REPORT.md, "Browser tests not written"). `/create`'s restore
 * path is gated by middleware.ts behind a real authenticated session; `/try`
 * always mounts with startFresh (Board.tsx:6986 `if (startFresh) return;`),
 * so there is no unauthenticated route that both persists AND restores
 * through the real product UI. Faking a Supabase session was judged out of
 * scope for a smoke test — it risks writing real rows if pointed at a live
 * project, and isn't something this pass should improvise.
 *
 * What this test verifies instead, for real, against real IndexedDB in a
 * real browser: a settled Expression Engine turn survives the debounced
 * autosave (lib/persist.ts:makeAutosave, 3s trailing debounce) as a
 * well-formed PersistedSession — the exact mechanism `/create`'s restore
 * reads from. If this breaks, restoration breaks; this just can't drive the
 * authenticated read-back half end-to-end.
 */
test("a settled turn survives the debounced autosave into IndexedDB", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(result?.status).toBe("updated");

  // makeAutosave's trailing debounce is 3000ms; give it real margin.
  await page.waitForTimeout(4500);

  const saved = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("inpublic");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("sessions", "readonly");
          const getReq = tx.objectStore("sessions").get("current");
          getReq.onsuccess = () => resolve(getReq.result ?? null);
          getReq.onerror = () => reject(getReq.error);
        };
      }),
  );

  expect(saved, "expected a PersistedSession under the 'current' IndexedDB key").not.toBeNull();
  const session = saved as { elements?: unknown[]; savedAt?: number };
  expect(Array.isArray(session.elements)).toBe(true);
  expect((session.elements as unknown[]).length).toBeGreaterThan(0);
  expect(typeof session.savedAt).toBe("number");
});
