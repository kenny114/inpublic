import { expect, test } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

test("settled live interaction routes new meaning directly and existing-world changes through the visible agent", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });

  const expressed = await page.evaluate((meaning) =>
    window.inpublic.interact("Coffee prevents sleep.", { meaning }), SMOKE_DELTA_A);
  expect(expressed.status).toBe("completed");
  expect(expressed.intent).toBe("express");
  expect(expressed.trace.metrics.routingModelCalls).toBe(0);
  expect(expressed.trace.metrics.modelCalls).toBe(0);
  await expect.poll(() => page.evaluate(() =>
    window.inpublic.interactionLast()?.metrics.speechFinalToFirstVisualChangeMs ?? null,
  )).not.toBeNull();
  expect((await page.evaluate(() => window.inpublic.agentPresence())).status).toBe("idle");

  const before = await page.evaluate(() => {
    const world = window.inpublic.expressionState()!.world;
    const coffee = world.entities.find((entity) => entity.label === "Coffee")!;
    return {
      coffeeId: coffee.id,
      viewport: window.inpublic.observe()!.revisions.viewport,
    };
  });

  const manipulation = page.evaluate(({ coffeeId }) =>
    window.inpublic.interact("Change Coffee to Espresso.", {
      maxSteps: 2,
      decisionDelayMs: 500,
      decisions: [
        { type: "act", action: { type: "update_entity", entityId: coffeeId, changes: { label: "Espresso" } } },
        { type: "done" },
      ],
    }), before);

  const overlay = page.locator("[data-agent-presence='true']");
  await expect(overlay).toHaveAttribute("data-agent-presence-status", "thinking");
  await expect(overlay).toHaveAttribute("data-agent-presence-status", "acting");
  await expect(page.locator(`[data-agent-presence-pointer][data-agent-presence-entity='${before.coffeeId}']`)).toBeVisible();

  const result = await manipulation;
  expect(result.status).toBe("completed");
  expect(result.intent).toBe("manipulate");
  expect(result.trace.metrics.routingModelCalls).toBe(0);
  expect(result.trace.metrics.modelCalls).toBe(2);
  expect(result.trace.metrics.agentSteps).toBe(1);
  expect(result.trace.metrics.speechFinalToFirstVisualChangeMs).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(({ coffeeId }) =>
    window.inpublic.expressionState()?.world.entities.find((entity) => entity.id === coffeeId)?.label,
  before)).toBe("Espresso");
  expect(await page.evaluate(() => window.inpublic.observe()!.revisions.viewport)).toBe(before.viewport);
  await expect(overlay).toHaveCount(0);
  expect((await page.evaluate(() => window.inpublic.agentPresence())).status).toBe("idle");
});
