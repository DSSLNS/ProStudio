import { test, expect, type Page } from "@playwright/test";
import { disableSavePicker, exportImageFile, importImage, inspectImage, makeFlatJpeg } from "./helpers";

const W = 3000;
const H = 2000;
const centre = { x: W / 2 - 20, y: H / 2 - 20, w: 40, h: 40 };

async function addRectangle(page: Page) {
  await page.getByTestId("panel-layers").click();
  await page.getByTestId("add-layer").click();
  await page.getByRole("menuitem", { name: /Rectangle/ }).click();
}

/** Drag horizontally across the middle of the displayed image. */
async function strokeAcrossCentre(page: Page, fromFrac = 0.35, toFrac = 0.65) {
  const box = (await page.getByTestId("preview-canvas").boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * fromFrac, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (fromFrac + ((toFrac - fromFrac) * i) / 20), y);
  await page.mouse.up();
}

async function biggerBrush(page: Page, presses = 6) {
  await page.getByTestId("editor-canvas").hover();
  for (let i = 0; i < presses; i++) await page.keyboard.press("]");
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
});

test("hide-all mask hides the layer; invert reveals it; original layer unchanged", async ({ page }) => {
  await addRectangle(page);
  await page.getByTestId("add-mask-black").click();
  let c = await inspectImage(page, await exportImageFile(page), centre);
  expect(Math.abs(c.mean[0] - 128)).toBeLessThan(4);
  await page.getByTestId("invert-mask").click();
  c = await inspectImage(page, await exportImageFile(page), centre);
  expect(c.mean[0]).toBeGreaterThan(250);
  // Disabling the mask shows the untouched layer.
  await page.getByTestId("invert-mask").click();
  await page.getByRole("switch", { name: "Mask enabled" }).click();
  c = await inspectImage(page, await exportImageFile(page), centre);
  expect(c.mean[0]).toBeGreaterThan(250);
});

test("painting a mask hides pixels under the stroke only", async ({ page }) => {
  await addRectangle(page);
  await page.getByTestId("add-mask-white").click();
  // Adding a mask targets it for painting; the button switches to the brush.
  await page.getByTestId("edit-mask").click();
  await expect(page.getByTestId("edit-mask")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mask-paint-mode")).toContainText("Hide");
  await biggerBrush(page);
  await strokeAcrossCentre(page, 0.45, 0.55);
  const png = await exportImageFile(page);
  const c = await inspectImage(page, png, centre);
  expect(Math.abs(c.mean[0] - 128)).toBeLessThan(8); // hidden under the stroke
  const edge = await inspectImage(page, png, { x: W / 2 - 20, y: H / 2 - 260, w: 40, h: 20 });
  expect(edge.mean[0]).toBeGreaterThan(245); // rectangle still visible away from the stroke
  await page.getByTestId("preview-mask").click();
  await expect(page.getByTestId("preview-mask")).toHaveAttribute("aria-pressed", "true");
});

test("eraser on a normal layer is non-destructive (adds a mask)", async ({ page }) => {
  await addRectangle(page);
  await page.getByTestId("tool-eraser").click();
  await biggerBrush(page);
  await strokeAcrossCentre(page, 0.45, 0.55);
  await expect(page.getByTestId("mask-thumb")).toBeVisible();
  let c = await inspectImage(page, await exportImageFile(page), centre);
  expect(Math.abs(c.mean[0] - 128)).toBeLessThan(8);
  await page.getByTestId("delete-mask").click();
  c = await inspectImage(page, await exportImageFile(page), centre);
  expect(c.mean[0]).toBeGreaterThan(250);
});

test("gradient mask fades the layer across the drag", async ({ page }) => {
  await addRectangle(page);
  await page.getByTestId("tool-gradient").click();
  await strokeAcrossCentre(page, 0.4, 0.6);
  const png = await exportImageFile(page);
  const left = await inspectImage(page, png, { x: W / 2 - 280, y: H / 2 - 10, w: 20, h: 20 });
  const mid = await inspectImage(page, png, { x: W / 2 - 10, y: H / 2 - 10, w: 20, h: 20 });
  const right = await inspectImage(page, png, { x: W / 2 + 260, y: H / 2 - 10, w: 20, h: 20 });
  expect(left.mean[0]).toBeGreaterThan(right.mean[0] + 60);
  expect(mid.mean[0]).toBeGreaterThan(right.mean[0] + 10);
  expect(mid.mean[0]).toBeLessThan(left.mean[0] - 10);
});

test("brush creates a paint layer; undo removes the stroke", async ({ page }) => {
  await page.getByTestId("panel-layers").click();
  await page.getByTestId("tool-brush").click();
  await page.getByLabel("Brush colour").fill("#ff0000");
  await biggerBrush(page);
  await strokeAcrossCentre(page);
  await expect(page.getByTestId("layer-row").filter({ hasText: "Paint" })).toBeVisible();
  const c = await inspectImage(page, await exportImageFile(page), centre);
  expect(c.mean[0]).toBeGreaterThan(240);
  expect(c.mean[1]).toBeLessThan(20);
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("layer-row")).toHaveCount(1);
});
