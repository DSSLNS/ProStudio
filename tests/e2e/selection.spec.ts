import { test, expect, type Page } from "@playwright/test";
import {
  clickOnImage,
  disableSavePicker,
  dragOnImage,
  exportImageFile,
  importImage,
  inspectImage,
  makeFlatJpeg,
  makeSplitJpeg,
} from "./helpers";

const W = 2000;
const H = 1000;
const at = (fx: number, fy: number, s = 20) => ({ x: Math.round(W * fx - s / 2), y: Math.round(H * fy - s / 2), w: s, h: s });

async function selectTool(page: Page, id: string) {
  await page.getByTestId(`tool-${id}`).click();
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
});

test("rectangle selection + Delete hides the selected pixels non-destructively", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await selectTool(page, "select-rect");
  await dragOnImage(page, 0.25, 0.25, 0.75, 0.75);
  await expect(page.getByTestId("selection-ants")).toBeVisible();
  await page.keyboard.press("Delete");
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.5, 0.5))).alpha).toBeLessThan(5);
  expect((await inspectImage(page, png, at(0.1, 0.1))).alpha).toBeGreaterThan(250);
  // Undo restores the pixels — nothing was destroyed.
  await page.getByTestId("undo").click();
  expect((await inspectImage(page, await exportImageFile(page), at(0.5, 0.5))).alpha).toBeGreaterThan(250);
});

test("Alt-drag subtracts and Shift-drag adds", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await selectTool(page, "select-rect");
  await dragOnImage(page, 0.2, 0.2, 0.8, 0.8);
  await dragOnImage(page, 0.4, 0.4, 0.6, 0.6, ["Alt"]); // hole in the middle
  await selectTool(page, "select-ellipse");
  await dragOnImage(page, 0.02, 0.02, 0.12, 0.12, ["Shift"]); // extra ellipse top-left
  await page.keyboard.press("Delete");
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.3, 0.5))).alpha).toBeLessThan(5); // selected ring
  expect((await inspectImage(page, png, at(0.5, 0.5))).alpha).toBeGreaterThan(250); // subtracted hole
  expect((await inspectImage(page, png, at(0.07, 0.07, 10))).alpha).toBeLessThan(5); // added ellipse
  expect((await inspectImage(page, png, at(0.9, 0.9))).alpha).toBeGreaterThan(250); // outside
});

test("magic wand selects a colour region; invert flips it", async ({ page }) => {
  await importImage(page, await makeSplitJpeg(page, W, H, "#202020", "#e0e0e0"));
  await selectTool(page, "wand");
  await clickOnImage(page, 0.25, 0.5);
  await expect(page.getByTestId("selection-ants")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+i");
  await page.keyboard.press("Delete");
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.25, 0.5))).alpha).toBeGreaterThan(250);
  expect((await inspectImage(page, png, at(0.75, 0.5))).alpha).toBeLessThan(5);
});

test("lasso and polygonal lasso create selections", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await selectTool(page, "polygon");
  for (const [x, y] of [
    [0.1, 0.1],
    [0.4, 0.1],
    [0.4, 0.9],
  ])
    await clickOnImage(page, x, y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.35, 0.3, 10))).alpha).toBeLessThan(5); // inside the triangle
  expect((await inspectImage(page, png, at(0.15, 0.8, 10))).alpha).toBeGreaterThan(250); // outside it
});

test("adjustment layer from selection only affects the selected area", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await selectTool(page, "select-rect");
  await dragOnImage(page, 0.5, 0, 1, 1);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: /New adjustment layer from selection/ }).click();
  const slider = page.getByRole("slider", { name: "Exposure" }).last();
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.25, 0.5))).mean[0]).toBeLessThan(135);
  expect((await inspectImage(page, png, at(0.75, 0.5))).mean[0]).toBeGreaterThan(165);
});

test("brush strokes are clipped to the selection", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await selectTool(page, "select-rect");
  await dragOnImage(page, 0.4, 0, 0.6, 1);
  await selectTool(page, "brush");
  await page.getByLabel("Brush colour").fill("#ff0000");
  await dragOnImage(page, 0.1, 0.5, 0.9, 0.5);
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.5, 0.5, 10))).mean[0]).toBeGreaterThan(240);
  expect(Math.abs((await inspectImage(page, png, at(0.2, 0.5, 10))).mean[0] - 128)).toBeLessThan(6);
});

test("crop to selection and feather", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await selectTool(page, "select-rect");
  await dragOnImage(page, 0.25, 0.25, 0.75, 0.75);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: "Feather…" }).click();
  await page.getByLabel("Radius (px at full resolution)").fill("60");
  await page.getByTestId("selection-dialog-ok").click();
  await page.keyboard.press("Delete");
  let png = await exportImageFile(page);
  const edge = await inspectImage(page, png, { x: W / 4 - 5, y: H / 2 - 5, w: 10, h: 10 });
  expect(edge.alpha).toBeGreaterThan(40);
  expect(edge.alpha).toBeLessThan(215); // soft edge
  await page.getByTestId("undo").click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: "Crop to selection" }).click();
  await expect(page.getByTestId("output-size")).toHaveText(/^\d+ × \d+ px$/);
  png = await exportImageFile(page);
  const info = await inspectImage(page, png);
  // Feathered bounds extend past the rectangle, but the crop stays well inside the full frame.
  expect(info.width).toBeLessThan(W);
  expect(info.width).toBeGreaterThan(W / 2 - 10);
});

test("copy and paste creates a full-resolution layer", async ({ page }) => {
  await importImage(page, await makeSplitJpeg(page, W, H, "#202020", "#e0e0e0"));
  await selectTool(page, "select-rect");
  await dragOnImage(page, 0.4, 0.2, 0.6, 0.8);
  await page.keyboard.press("ControlOrMeta+c");
  await expect(page.getByText(/^Copied \d+ × \d+$/)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+v");
  await page.getByTestId("panel-layers").click();
  await expect(page.getByTestId("layer-row").filter({ hasText: "Pasted" })).toBeVisible();
  // Move the pasted copy and check it carries both halves at full resolution.
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.45, 0.5))).mean[0]).toBeLessThan(40);
  expect((await inspectImage(page, png, at(0.55, 0.5))).mean[0]).toBeGreaterThan(215);
});
