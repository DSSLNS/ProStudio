import { test, expect } from "@playwright/test";
import { importImage, makeTestJpeg } from "./helpers";

test("mobile editor uses touch tool strip and bottom panel", async ({ page }) => {
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 1200, 900));
  const tools = page.getByRole("navigation", { name: "Editing tools" });
  await expect(tools).toBeVisible();
  await tools.getByRole("button", { name: "Light" }).click();
  await expect(page.getByRole("region", { name: "Light panel" })).toBeVisible();
  const exposure = page.getByRole("textbox", { name: "Exposure value" });
  await exposure.fill("0.7");
  await exposure.press("Enter");
  await expect(exposure).toHaveValue("+0.70 EV");
  await page.getByRole("button", { name: "Next panel" }).click();
  await expect(page.getByRole("region", { name: "Color panel" })).toBeVisible();
});
