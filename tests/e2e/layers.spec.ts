import { test, expect, type Page } from "@playwright/test";
import { disableSavePicker, exportImageFile, importImage, inspectImage, makeFlatJpeg, makeFlatPng } from "./helpers";

const W = 3000;
const H = 2000;
const centre = { x: W / 2 - 20, y: H / 2 - 20, w: 40, h: 40 };
const corner = { x: 20, y: 20, w: 40, h: 40 };

async function openLayers(page: Page) {
  await page.getByTestId("panel-layers").click();
  await expect(page.getByTestId("layer-list")).toBeVisible();
}

async function addLayer(page: Page, item: RegExp) {
  await page.getByTestId("add-layer").click();
  await page.getByRole("menuitem", { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await openLayers(page);
});

test("shape layer composites at full resolution with blend modes and opacity", async ({ page }) => {
  await addLayer(page, /Rectangle/);
  await expect(page.getByTestId("layer-row")).toHaveCount(2);

  let png = await exportImageFile(page);
  let c = await inspectImage(page, png, centre);
  const k = await inspectImage(page, png, corner);
  expect([c.width, c.height]).toEqual([W, H]);
  expect(c.mean[0]).toBeGreaterThan(250); // white rectangle over the centre
  expect(Math.abs(k.mean[0] - 128)).toBeLessThan(4); // corner untouched

  // Multiply by white leaves the backdrop unchanged.
  await page.getByTestId("blend-mode").click();
  await page.getByRole("option", { name: "Multiply" }).click();
  png = await exportImageFile(page);
  c = await inspectImage(page, png, centre);
  expect(Math.abs(c.mean[0] - 128)).toBeLessThan(4);

  // Screen with white gives white; then 50% opacity normal gives the midpoint.
  await page.getByTestId("blend-mode").click();
  await page.getByRole("option", { name: "Normal" }).click();
  const opacity = page.getByTestId("layer-opacity").getByRole("slider");
  await opacity.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft"); // 5 × 10 = 50%
  await expect(page.getByTestId("layer-opacity")).toContainText("50%");
  png = await exportImageFile(page);
  c = await inspectImage(page, png, centre);
  expect(c.mean[0]).toBeGreaterThan(185);
  expect(c.mean[0]).toBeLessThan(198);
});

test("hiding a layer removes it from the export; undo removes the layer", async ({ page }) => {
  await addLayer(page, /Rectangle/);
  await page.getByRole("button", { name: /^Hide Rectangle/ }).click();
  let c = await inspectImage(page, await exportImageFile(page), centre);
  expect(Math.abs(c.mean[0] - 128)).toBeLessThan(4);
  await page.getByTestId("undo").click(); // un-hide
  await page.getByTestId("undo").click(); // remove layer
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
  c = await inspectImage(page, await exportImageFile(page), centre);
  expect(Math.abs(c.mean[0] - 128)).toBeLessThan(4);
});

test("adjustment layer brightens everything beneath it", async ({ page }) => {
  await addLayer(page, /Adjustment layer/);
  const slider = page.getByRole("slider", { name: "Exposure" }).last();
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight"); // 10 × large step (0.10) = +1.00 EV
  await expect(page.getByText("+1.00 EV").last()).toBeVisible();
  const c = await inspectImage(page, await exportImageFile(page), corner);
  expect(c.mean[0]).toBeGreaterThan(165);
  expect(c.mean[0]).toBeLessThan(185);
});

test("image layer from file, reorder, and persistence across reload", async ({ page }) => {
  await page.getByTestId("add-layer").click();
  await page.getByRole("menuitem", { name: /Image from file/ }).click();
  await page
    .getByTestId("layer-image-input")
    .setInputFiles({ name: "red.png", mimeType: "image/png", buffer: await makeFlatPng(page, 600, 400, "#ff0000") });
  await expect(page.getByTestId("layer-row").filter({ hasText: "red" })).toBeVisible();
  await addLayer(page, /Ellipse/);
  // Stack (top first): Ellipse, red, Background → move Ellipse below red.
  await expect(page.getByTestId("layer-row").first()).toHaveAttribute("data-layer-name", "Ellipse");
  await page.getByRole("button", { name: "Move layer down" }).click();
  await expect(page.getByTestId("layer-row").first()).toHaveAttribute("data-layer-name", "red");
  // Drag-and-drop it back on top.
  await page
    .getByTestId("layer-row")
    .nth(1)
    .dragTo(page.getByTestId("layer-row").first(), { targetPosition: { x: 40, y: 2 } });
  await expect(page.getByTestId("layer-row").first()).toHaveAttribute("data-layer-name", "Ellipse");
  await page.getByRole("button", { name: /^Hide Ellipse/ }).click();

  const c = await inspectImage(page, await exportImageFile(page), centre);
  expect(c.mean[0]).toBeGreaterThan(240);
  expect(c.mean[1]).toBeLessThan(15);

  // Persists after save + reload.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Project saved locally")).toBeVisible();
  await page.reload();
  await openLayers(page);
  await expect(page.getByTestId("layer-row")).toHaveCount(3);
  await expect(page.getByTestId("layer-row").filter({ hasText: "red" })).toBeVisible();
});

test(".prostudio export/import keeps layers and their assets", async ({ page }) => {
  await page.getByTestId("add-layer").click();
  await page.getByRole("menuitem", { name: /Image from file/ }).click();
  await page
    .getByTestId("layer-image-input")
    .setInputFiles({ name: "blue.png", mimeType: "image/png", buffer: await makeFlatPng(page, 300, 300, "#0000ff") });
  await addLayer(page, /Text/);
  await page.getByRole("button", { name: "File" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export project file/ }).click();
  const path = (await (await download).path())!;
  await page.goto("/");
  await page.getByTestId("open-project-input").setInputFiles(path);
  await page.waitForURL(/\/editor\?project=/);
  await openLayers(page);
  await expect(page.getByTestId("layer-row")).toHaveCount(3);
  const c = await inspectImage(page, await exportImageFile(page), { x: W / 2 - 60, y: H / 2 + 120, w: 20, h: 20 });
  expect(c.mean[2]).toBeGreaterThan(240); // blue image layer survived the round trip
});
