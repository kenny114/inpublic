import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

/**
 * Save-half contract against real IndexedDB. The read-back half is exercised
 * separately by worldstate-restore.spec.ts through the development replay
 * route, avoiding real Supabase credentials and cloud writes.
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
  const session = saved as { elements?: unknown[]; savedAt?: number; expressionState?: { version?: number; world?: { entities?: unknown[] } } };
  expect(Array.isArray(session.elements)).toBe(true);
  expect((session.elements as unknown[]).length).toBeGreaterThan(0);
  expect(typeof session.savedAt).toBe("number");
  expect(session.expressionState?.version).toBe(1);
  expect(session.expressionState?.world?.entities?.length).toBe(2);
});
