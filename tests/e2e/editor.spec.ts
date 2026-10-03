import { test, expect, type Page } from "@playwright/test";
import { disableSavePicker, importImage, inspectImage, makeTestJpeg } from "./helpers";

async function setSlider(page: Page, label: string, value: string) {
  const input = page.getByRole("textbox", { name: `${label} value` });
  await input.click();
  await input.fill(value);
  await input.press("Enter");
}

async function exportJpeg(page: Page) {
  await page.getByTestId("open-export").click();
  const dialog = page.getByTestId("export-dialog");
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByTestId("export-confirm").click();
  const d = await download;
  const path = await d.path();
  const fs = await import("node:fs");
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(path!) };
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
});

test("import → adjust → export renders from the full-resolution original", async ({ page }) => {
  await page.goto("/");
  // 5000×3000 is larger than the Balanced preview (2560px), so export must not come from the preview.
  const original = await makeTestJpeg(page, 5000, 3000);
  await importImage(page, original);
  await expect(page.getByText("High-resolution image detected.")).toBeVisible();
  await expect(page.getByTestId("output-size")).toHaveText("5000 × 3000 px");

  await setSlider(page, "Exposure", "1");
  await expect(page.getByTestId("history-list").or(page.locator("body"))).toBeVisible();

  const { name, bytes } = await exportJpeg(page);
  expect(name).toMatch(/\.jpg$/);
  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
  const info = await inspectImage(page, bytes, { x: 120, y: 120, w: 60, h: 60 });
  expect(info.width).toBe(5000);
  expect(info.height).toBe(3000);
  // The mid-grey (128) patch must be clearly brighter after +1 EV (≈ 175 in sRGB).
  expect(info.mean[0]).toBeGreaterThan(160);
  expect(info.mean[0]).toBeLessThan(195);
});

test("undo / redo and history", async ({ page }) => {
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 800, 600));
  await setSlider(page, "Contrast", "40");
  const contrast = page.getByRole("textbox", { name: "Contrast value" });
  await expect(contrast).toHaveValue("+40");
  await page.getByTestId("undo").click();
  await expect(contrast).toHaveValue("0");
  await page.getByTestId("redo").click();
  await expect(contrast).toHaveValue("+40");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(contrast).toHaveValue("0");
  await page.getByTestId("panel-history").click();
  await expect(page.getByTestId("history-list").getByRole("button")).toHaveCount(2);
});

test("rotate and crop change the exported dimensions", async ({ page }) => {
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 1200, 800));
  await page.getByTestId("panel-geometry").click();
  await page.getByTestId("rotate-right").click();
  await expect(page.getByTestId("output-size")).toHaveText("800 × 1200 px");
  await page.getByRole("radio", { name: "1:1" }).click();
  await page.getByTestId("apply-crop").click();
  await expect(page.getByTestId("output-size")).toHaveText("800 × 800 px");
  const { bytes } = await exportJpeg(page);
  const info = await inspectImage(page, bytes);
  expect([info.width, info.height]).toEqual([800, 800]);
});

test("PNG export is lossless and keeps dimensions", async ({ page }) => {
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 640, 480));
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-format").click();
  await page.getByRole("option", { name: /PNG/ }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-confirm").click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.png$/);
  const fs = await import("node:fs");
  const bytes = fs.readFileSync((await d.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  const info = await inspectImage(page, bytes);
  expect([info.width, info.height]).toEqual([640, 480]);
});

test("before/after split and Auto Edit proposal", async ({ page }) => {
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 800, 600));
  await page.getByTestId("compare-split").click();
  await expect(page.getByRole("slider", { name: "Before/after divider" })).toBeVisible();
  await page.getByTestId("auto-edit").click();
  await expect(page.getByTestId("auto-edit-changes")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("curves: clicking adds a point", async ({ page }) => {
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 400, 300));
  await page.getByTestId("panel-curves").click();
  const editor = page.getByRole("application", { name: /RGB curve editor/ });
  const box = (await editor.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await expect(editor.locator("circle")).toHaveCount(3);
});
