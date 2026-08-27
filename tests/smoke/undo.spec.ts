import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

/**
 * Undo — verified against the real Expression Engine, not legacy Artist
 * actions. `render/excalidrawSync.ts`'s canvas sync records every Expression
 * Engine run as one undoable operation (Board.tsx: recordOperation
 * ("expression_engine", ...)), so this exercises the actual current path,
 * not a mechanism about to be deleted.
 */
test("undo reverts an Expression Engine turn", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => window.inpublic.elements().filter((e) => !e.isDeleted).length);
  expect(before).toBe(0);

  const result = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(result?.status).toBe("updated");

  await page.waitForTimeout(300);
  const afterExpress = await page.evaluate(() => window.inpublic.elements().filter((e) => !e.isDeleted).length);
  expect(afterExpress).toBeGreaterThan(before);

  await page.evaluate(() => window.inpublic.undo());
  await page.waitForTimeout(300);

  const afterUndo = await page.evaluate(() => window.inpublic.elements().filter((e) => !e.isDeleted).length);
  expect(afterUndo).toBeLessThan(afterExpress);
});
