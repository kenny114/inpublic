import { expect, test } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

test("live canvas observation detects a user-style element move", async ({ page }) => {
  await page.goto("/try?replay=1");
  const editor = page.locator(".excalidraw").first();
  await editor.waitFor({ timeout: 45_000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(result?.status).toBe("updated");
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => window.inpublic.observe());
  expect(before).not.toBeNull();
  expect(before!.elements.length).toBeGreaterThan(0);

  // Focus the real interactive editor, select the scene, and nudge it with
  // keyboard input. No debug mutation API is involved.
  const interactiveCanvas = page.locator("canvas.interactive").first();
  await interactiveCanvas.click({ position: { x: 500, y: 400 } });
  await page.keyboard.press("Control+A");
  await page.waitForTimeout(100);
  const selected = await page.evaluate(() => window.inpublic.observe());
  expect(selected!.selection.elementIds.length).toBeGreaterThan(0);
  const target = before!.elements.find((element) => selected!.selection.elementIds.includes(element.id));
  expect(target).toBeDefined();

  for (let index = 0; index < 5; index += 1) await page.keyboard.press("ArrowRight");
  for (let index = 0; index < 3; index += 1) await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => window.inpublic.observe());
  expect(after).not.toBeNull();
  const moved = after!.elements.find((element) => element.id === target!.id);
  expect(moved, "the moved object must retain its canvas identity").toBeDefined();
  expect({ x: moved!.x, y: moved!.y }).not.toEqual({ x: target!.x, y: target!.y });
  expect(after!.revisions.scene).not.toBe(before!.revisions.scene);
  expect(after!.selection.elementIds).toContain(target!.id);
});
