import { test, expect } from "@playwright/test";
import { trackGetUserMedia } from "./helpers";

test.use({ permissions: ["camera"] });

test("mode chooser does not open the camera by itself", async ({ page }) => {
  await trackGetUserMedia(page);
  await page.goto("/camera");
  await expect(page.getByText("AUTO MODE")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls)).toBe(0);
});

test("auto mode: preview, capture, review, edit", async ({ page }) => {
  await page.goto("/camera/auto");
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: /capture|take photo|shutter/i })
    .first()
    .click();
  await expect(page.getByText(/\d+ × \d+ — [\d.]+ MP/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /edit photo/i }).click();
  await page.waitForURL(/\/editor\?project=/);
  await expect(page.getByTestId("preview-canvas")).toBeVisible();
});

test("manual mode never offers a fake aperture control", async ({ page }) => {
  await page.goto("/camera/manual");
  await expect(page.locator("video")).toBeVisible();
  await expect(page.getByText(/aperture/i).first())
    .toBeVisible({ timeout: 15_000 })
    .catch(() => undefined);
  const apertureSliders = page.getByRole("slider", { name: /aperture/i });
  await expect(apertureSliders).toHaveCount(0);
});
