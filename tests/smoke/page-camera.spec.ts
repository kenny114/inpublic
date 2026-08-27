import { test, expect } from "@playwright/test";
import { SMOKE_DELTA_A, SMOKE_DELTA_B } from "./fixtures";

/**
 * Page/camera path — the invariant the corpus tests call "the board is
 * never wiped" (scripts/expression-test.mjs). A second, unrelated turn must
 * extend the board, never erase what an earlier turn already drew.
 */
test("a second turn does not erase the first turn's elements", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(500);

  const firstResult = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A);
  expect(firstResult?.status).toBe("updated");
  await page.waitForTimeout(300);

  const firstIds = await page.evaluate(() =>
    window.inpublic.elements().filter((e) => !e.isDeleted).map((e) => e.id),
  );
  expect(firstIds.length).toBeGreaterThan(0);

  const secondResult = await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_B);
  expect(secondResult?.status).toBe("updated");
  await page.waitForTimeout(300);

  const idsAfterSecondTurn = new Set(
    await page.evaluate(() => window.inpublic.elements().filter((e) => !e.isDeleted).map((e) => e.id)),
  );

  const survivingFirstTurnIds = firstIds.filter((id) => idsAfterSecondTurn.has(id));
  expect(
    survivingFirstTurnIds.length,
    "every element from the first turn should still be present after an unrelated second turn",
  ).toBe(firstIds.length);
});
