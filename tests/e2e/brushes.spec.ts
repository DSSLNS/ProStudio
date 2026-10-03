import { test, expect } from "@playwright/test";
import { disableSavePicker, dragOnImage, exportImageFile, importImage, inspectImage, makeFlatJpeg, makeSplitJpeg } from "./helpers";

const W = 2000;
const H = 1000;
const at = (fx: number, fy: number, s = 10) => ({ x: Math.round(W * fx - s / 2), y: Math.round(H * fy - s / 2), w: s, h: s });

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
});

test("background eraser removes only the sampled colour", async ({ page }) => {
  await importImage(page, await makeSplitJpeg(page, W, H, "#202020", "#e0e0e0"));
  await page.getByTestId("tool-bg-eraser").click();
  await page.getByTestId("editor-canvas").hover();
  for (let i = 0; i < 6; i++) await page.keyboard.press("]");
  await dragOnImage(page, 0.44, 0.5, 0.56, 0.5); // starts on the dark half, crosses into the bright half
  const png = await exportImageFile(page);
  expect((await inspectImage(page, png, at(0.47, 0.5))).alpha).toBeLessThan(40);
  expect((await inspectImage(page, png, at(0.53, 0.5))).alpha).toBeGreaterThan(245);
  expect((await inspectImage(page, png, at(0.2, 0.2))).alpha).toBeGreaterThan(245);
});

test("pencil paints a hard-edged stroke on a new paint layer", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await page.getByTestId("tool-pencil").click();
  await page.getByLabel("Brush colour").fill("#00ff00");
  await dragOnImage(page, 0.3, 0.5, 0.7, 0.5);
  const png = await exportImageFile(page);
  const c = await inspectImage(page, png, at(0.5, 0.5, 4));
  expect(c.mean[1]).toBeGreaterThan(245);
  expect(c.mean[0]).toBeLessThan(10);
});

test("stylus input: pressure changes stroke width", async ({ page }) => {
  await importImage(page, await makeFlatJpeg(page, W, H, "#808080"));
  await page.getByTestId("tool-brush").click();
  await page.getByRole("button", { name: "Hard" }).click();
  const overlay = page.getByTestId("paint-overlay");
  const box = (await page.getByTestId("preview-canvas").boundingBox())!;
  const pen = async (y: number, pressure: number) => {
    const opts = (x: number) => ({ pointerId: 7, pointerType: "pen", pressure, clientX: box.x + box.width * x, clientY: box.y + box.height * y, button: 0, buttons: 1, bubbles: true });
    await overlay.dispatchEvent("pointerdown", opts(0.3));
    for (let i = 1; i <= 10; i++) await overlay.dispatchEvent("pointermove", opts(0.3 + i * 0.04));
    await overlay.dispatchEvent("pointerup", { ...opts(0.7), buttons: 0 });
  };
  await pen(0.3, 1);
  await pen(0.7, 0.1);
  const png = await exportImageFile(page);
  // Brush is 80 px; at full pressure ±30 px from the line is painted, at 10% pressure it isn't.
  expect((await inspectImage(page, png, { x: W / 2 - 2, y: H * 0.3 + 28, w: 4, h: 4 })).mean[0]).toBeGreaterThan(240);
  expect(Math.abs((await inspectImage(page, png, { x: W / 2 - 2, y: H * 0.7 + 28, w: 4, h: 4 })).mean[0] - 128)).toBeLessThan(6);
  expect((await inspectImage(page, png, { x: W / 2 - 2, y: H * 0.7 - 2, w: 4, h: 4 })).mean[0]).toBeGreaterThan(240);
});
