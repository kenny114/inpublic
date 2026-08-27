import { expect, test } from "@playwright/test";
import { SMOKE_DELTA_A } from "./fixtures";

test("visual agent presence is visible, semantic, ephemeral, and non-interfering", async ({ page }) => {
  await page.goto("/try?replay=1");
  await page.locator(".excalidraw").first().waitFor({ timeout: 45_000 });
  expect((await page.evaluate((delta) => window.inpublic.express({ delta }), SMOKE_DELTA_A))?.status).toBe("updated");

  const entityId = await page.evaluate(() =>
    window.inpublic.expressionState()?.world.entities.find((entity) => entity.label === "Coffee")?.id ?? null,
  );
  expect(entityId).toBeTruthy();
  const sceneBefore = await page.evaluate(() => window.inpublic.observe()?.revisions.scene ?? null);

  await page.evaluate(({ targetId }) => {
    window.__agentPresenceRun = window.inpublic.runVisualAgent("Mark Coffee as the lead topic", {
      maxSteps: 1,
      decisionDelayMs: 700,
      decisions: [
        {
          type: "act",
          action: { type: "update_entity", entityId: targetId, changes: { description: "Lead topic" } },
        },
        { type: "done" },
      ],
    });
  }, { targetId: entityId! });

  const overlay = page.locator("[data-agent-presence='true']");
  await expect(overlay).toHaveAttribute("data-agent-presence-status", "thinking");
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.inpublic.observe()?.revisions.scene ?? null)).toBe(sceneBefore);

  await expect(overlay).toHaveAttribute("data-agent-presence-status", "acting");
  await expect(page.locator(`[data-agent-presence-pointer][data-agent-presence-entity='${entityId}']`)).toBeVisible();
  await expect(page.locator(`[data-agent-presence-highlight][data-agent-presence-entity='${entityId}']`)).toBeVisible();
  const visiblePresence = await page.evaluate(() => window.inpublic.agentPresence());
  expect(visiblePresence.target?.entityId).toBe(entityId);

  await page.locator(".canvas-shell").dispatchEvent("pointerdown", { pointerType: "mouse" });
  await expect(page.locator("[data-agent-presence-pointer]")).toHaveCount(0);
  expect((await page.evaluate(() => window.inpublic.agentPresence())).suppressed).toBe(true);

  const run = await page.evaluate(() => window.__agentPresenceRun!);
  expect(run.status).toBe("completed");
  expect(run.trace.presence.map((event) => event.state.status)).toEqual(expect.arrayContaining([
    "observing", "thinking", "acting", "idle",
  ]));
  await expect(overlay).toHaveCount(0);
  expect((await page.evaluate(() => window.inpublic.agentPresence())).status).toBe("idle");
  expect(await page.evaluate(() => window.inpublic.observe()?.revisions.scene ?? null)).toBe(sceneBefore);
  expect(await page.evaluate(({ targetId }) =>
    window.inpublic.expressionState()?.world.entities.find((entity) => entity.id === targetId)?.description,
  { targetId: entityId! })).toBe("Lead topic");
});
