import { test, expect, type Page } from "@playwright/test";
import { clickOnImage, disableSavePicker, dragOnImage, exportImageFile, importImage, makeScene, regionStats } from "./helpers";

const W = 1600;
const H = 800;
const box = (fx: number, fy: number, s = 30) => ({ x: Math.round(W * fx - s / 2), y: Math.round(H * fy - s / 2), w: s, h: s });

async function tool(page: Page, id: string) {
  await page.getByTestId(`tool-${id}`).click();
}
async function brushSize(page: Page, presses: number) {
  await page.getByTestId("editor-canvas").hover();
  for (let i = 0; i < Math.abs(presses); i++) await page.keyboard.press(presses > 0 ? "]" : "[");
}
async function altClick(page: Page, fx: number, fy: number) {
  await page.keyboard.down("Alt");
  await clickOnImage(page, fx, fy);
  await page.keyboard.up("Alt");
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
});

test("clone stamp copies the source and creates a non-destructive retouch layer", async ({ page }) => {
  await importImage(page, await makeScene(page, W, H, "#808080", [{ fill: "#ffffff", rect: [200, 300, 200, 200] }]));
  await tool(page, "clone");
  await altClick(page, 300 / W, 0.5);
  await expect(page.getByTestId("clone-source")).toBeVisible();
  await dragOnImage(page, 0.7, 0.5, 0.72, 0.5);
  await page.getByTestId("panel-layers").click();
  await expect(page.getByTestId("layer-row").filter({ hasText: "Retouch" })).toBeVisible();
  const png = await exportImageFile(page);
  expect((await regionStats(page, png, box(0.71, 0.5, 20))).mean).toBeGreaterThan(240);
  // Original intact: hiding the retouch layer brings the grey back.
  await page.getByRole("button", { name: /^Hide Retouch/ }).click();
  expect(Math.abs((await regionStats(page, await exportImageFile(page), box(0.71, 0.5, 20))).mean - 128)).toBeLessThan(4);
});

test("healing brush transfers texture but keeps destination tone", async ({ page }) => {
  await importImage(
    page,
    await makeScene(page, W, H, "#3c3c3c", [
      { fill: "#c8c8c8", rect: [0, 0, 800, 800] },
      { checker: [100, 200, 400, 400, 4], a: "#e6e6e6", b: "#aaaaaa" },
    ]),
  );
  await tool(page, "heal");
  await altClick(page, 300 / W, 0.5);
  await brushSize(page, 3);
  await dragOnImage(page, 1100 / W, 0.5, 1200 / W, 0.5);
  const s = await regionStats(page, await exportImageFile(page), { x: 1130, y: 390, w: 40, h: 20 });
  expect(s.std).toBeGreaterThan(5); // texture came across
  expect(Math.abs(s.mean - 60)).toBeLessThan(25); // but the dark tone was kept (a clone would be ~200)
});

test("spot healing removes a blemish with an automatic source", async ({ page }) => {
  await importImage(page, await makeScene(page, W, H, "#808080", [{ fill: "#000000", circle: [800, 400, 12] }]));
  await tool(page, "spot-heal");
  await clickOnImage(page, 0.5, 0.5);
  const s = await regionStats(page, await exportImageFile(page), box(0.5, 0.5, 16));
  expect(s.mean).toBeGreaterThan(110);
});

test("red-eye removal desaturates red pupils", async ({ page }) => {
  await importImage(page, await makeScene(page, W, H, "#506070", [{ fill: "#d01818", circle: [800, 400, 20] }]));
  await tool(page, "redeye");
  await clickOnImage(page, 0.5, 0.5);
  const s = await regionStats(page, await exportImageFile(page), box(0.5, 0.5, 12));
  expect(s.rgb[0]).toBeLessThan(80);
});

test("dodge lightens and burn darkens", async ({ page }) => {
  await importImage(page, await makeScene(page, W, H, "#808080", []));
  await tool(page, "dodge");
  await brushSize(page, 3);
  await dragOnImage(page, 0.2, 0.3, 0.4, 0.3);
  await tool(page, "burn");
  await dragOnImage(page, 0.2, 0.7, 0.4, 0.7);
  const png = await exportImageFile(page);
  expect((await regionStats(page, png, box(0.3, 0.3, 10))).mean).toBeGreaterThan(150);
  expect((await regionStats(page, png, box(0.3, 0.7, 10))).mean).toBeLessThan(105);
  expect(Math.abs((await regionStats(page, png, box(0.8, 0.5, 10))).mean - 128)).toBeLessThan(3);
});

test("blur, sharpen and dust brushes act locally", async ({ page }) => {
  await importImage(
    page,
    await makeScene(page, W, H, "#808080", [
      { checker: [0, 0, 800, 800, 4], a: "#b0b0b0", b: "#505050" },
      { checker: [800, 0, 400, 800, 6], a: "#b0b0b0", b: "#505050" },
      { blur: 1 },
      { specks: 0, color: "#000" },
    ]),
  );
  const before = await exportImageFile(page);
  await tool(page, "blur-brush");
  await brushSize(page, 3);
  await dragOnImage(page, 0.15, 0.5, 0.3, 0.5);
  await tool(page, "sharpen-brush");
  await dragOnImage(page, 0.55, 0.5, 0.7, 0.5);
  const after = await exportImageFile(page);
  const blurBefore = await regionStats(page, before, box(0.22, 0.5, 20));
  const blurAfter = await regionStats(page, after, box(0.22, 0.5, 20));
  expect(blurAfter.std).toBeLessThan(blurBefore.std * 0.6);
  const shBefore = await regionStats(page, before, box(0.62, 0.5, 20));
  const shAfter = await regionStats(page, after, box(0.62, 0.5, 20));
  expect(shAfter.std).toBeGreaterThan(shBefore.std * 1.15);
});

test("dust & scratches removes specks inside the stroke", async ({ page }) => {
  await importImage(page, await makeScene(page, W, H, "#808080", [{ specks: 4000, color: "#000000" }]));
  await tool(page, "dust");
  await brushSize(page, 6);
  await dragOnImage(page, 0.3, 0.5, 0.7, 0.5);
  const s = await regionStats(page, await exportImageFile(page), box(0.5, 0.5, 60));
  expect(s.min).toBeGreaterThan(90); // black specks gone
});

test("smudge drags colour along the stroke", async ({ page }) => {
  await importImage(page, await makeScene(page, W, H, "#e0e0e0", [{ fill: "#202020", rect: [0, 0, 800, 800] }]));
  await tool(page, "smudge");
  await brushSize(page, 3);
  await dragOnImage(page, 0.45, 0.5, 0.58, 0.5);
  const s = await regionStats(page, await exportImageFile(page), box(0.53, 0.5, 10));
  expect(s.mean).toBeLessThan(200);
});
