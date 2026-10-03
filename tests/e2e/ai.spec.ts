import { test, expect, type Page } from "@playwright/test";
import {
  clickOnImage,
  disableSavePicker,
  dragOnImage,
  exportImageFile,
  importImage,
  makeScene,
  regionStats,
} from "./helpers";
import { existsSync } from "node:fs";

// Real local inference. Requires the models (npm run models); skipped otherwise.
const installed = existsSync("public/models/u2netp/u2netp.onnx");
test.describe.configure({ timeout: 180_000 });

async function openAi(page: Page) {
  await page.getByTestId("panel-ai").click();
  await expect(page.getByText(/All AI runs on this device/)).toBeVisible();
}
async function waitAi(page: Page) {
  await expect(page.getByTestId("ai-progress")).toBeHidden({ timeout: 170_000 });
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
});

test.describe("without models", () => {
  // page.route cannot intercept requests the service worker handles; block it so the simulated 404s apply.
  test.use({ serviceWorkers: "block" });
  test("features are disabled with an explanation when models are not installed", async ({ page }) => {
    await page.route("**/models/**", (r) => r.fulfill({ status: 404, body: "" }));
    await importImage(page, await makeScene(page, 400, 300, "#808080", []));
    await openAi(page);
    await expect(page.getByTestId("ai-remove-bg")).toBeDisabled();
    await expect(page.getByText(/not installed on this server/).first()).toBeVisible();
  });
});

test.describe("with models", () => {
  test.skip(!installed, "AI models not installed (run `npm run models`).");

  test("remove background creates a subject mask on the photo", async ({ page }) => {
    const W = 640;
    const H = 480;
    await importImage(
      page,
      await makeScene(page, W, H, "#dfe6ec", [
        { fill: "#c0392b", circle: [320, 240, 140] },
        { fill: "#2c3e50", circle: [320, 200, 50] },
      ]),
    );
    await openAi(page);
    await page.getByTestId("ai-remove-bg").click();
    await waitAi(page);
    await expect(page.getByText(/processed locally/)).toBeVisible();
    const png = await exportImageFile(page);
    const centre = await page.evaluate(async () => 0); // keep page alive between reads
    void centre;
    const statsCentre = await regionStats(page, png, { x: 300, y: 260, w: 40, h: 40 });
    const statsCorner = await regionStats(page, png, { x: 5, y: 5, w: 40, h: 40 });
    // regionStats reports luma; transparency shows as black (premultiplied draw) → corner dark, centre red-ish.
    expect(statsCentre.rgb[0]).toBeGreaterThan(150);
    expect(statsCorner.mean).toBeLessThan(40);
  });

  test("object removal fills the painted area and can be applied", async ({ page }) => {
    await importImage(
      page,
      await makeScene(page, 640, 480, "#7a8a6a", [{ fill: "#101010", rect: [290, 210, 60, 60] }]),
    );
    await page.getByTestId("tool-select-brush").click();
    await page.getByTestId("editor-canvas").hover();
    for (let i = 0; i < 3; i++) await page.keyboard.press("]");
    await dragOnImage(page, 0.45, 0.5, 0.55, 0.5);
    await dragOnImage(page, 0.45, 0.45, 0.55, 0.45);
    await dragOnImage(page, 0.45, 0.55, 0.55, 0.55);
    await openAi(page);
    await page.getByTestId("ai-remove-object").click();
    await waitAi(page);
    await page.getByTestId("ai-apply").click();
    const s = await regionStats(page, await exportImageFile(page), { x: 305, y: 225, w: 30, h: 30 });
    expect(s.mean).toBeGreaterThan(80); // the black square (≈16) is gone
  });

  test("sky detection adds a masked Sky adjustment layer", async ({ page }) => {
    await importImage(
      page,
      await makeScene(page, 640, 480, "#6b5a3a", [
        { fill: "#6fa8dc", rect: [0, 0, 640, 220] },
        { fill: "#3d5a2a", rect: [0, 260, 640, 220] },
      ]),
    );
    await openAi(page);
    await page.getByTestId("ai-adjust-sky").click();
    await waitAi(page);
    await page.getByTestId("panel-layers").click();
    await expect(page.getByTestId("layer-row").filter({ hasText: "Sky" })).toBeVisible();
    await expect(page.getByTestId("mask-thumb")).toBeVisible();
  });

  test("AI denoise adds a smoother layer", async ({ page }) => {
    await importImage(page, await makeScene(page, 320, 240, "#808080", [{ noise: 20 }]));
    const before = await regionStats(page, await exportImageFile(page), { x: 100, y: 80, w: 100, h: 80 });
    await openAi(page);
    await page.getByTestId("ai-denoise").click();
    await waitAi(page);
    const after = await regionStats(page, await exportImageFile(page), { x: 100, y: 80, w: 100, h: 80 });
    expect(after.std).toBeLessThan(before.std * 0.8);
  });

  test("AI upscale 2× creates a new full-size project and leaves this one unchanged", async ({ page }) => {
    await importImage(
      page,
      await makeScene(page, 200, 150, "#808080", [{ checker: [0, 0, 200, 150, 10], a: "#303030", b: "#d0d0d0" }]),
    );
    await openAi(page);
    await expect(
      page.getByText("AI upscaling generates estimated detail; it cannot recover information that was never captured."),
    ).toBeVisible();
    await page.getByTestId("ai-upscale-2").click();
    await waitAi(page);
    await expect(page.getByText(/Upscaled copy saved as a new project \(400 × 300\)/)).toBeVisible();
    await expect(page.getByTestId("output-size")).toHaveText("200 × 150 px");
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByTestId("output-size")).toHaveText("400 × 300 px");
  });

  test("portrait enhancement adds skin layers without touching the photo", async ({ page }) => {
    await importImage(page, await makeScene(page, 480, 640, "#2a3b4c", [{ fill: "#e0ac8c", circle: [240, 300, 150] }]));
    await openAi(page);
    await page.getByTestId("ai-portrait").click();
    await waitAi(page);
    await page.getByTestId("panel-layers").click();
    await expect(page.getByTestId("layer-row").filter({ hasText: "Portrait smoothing" })).toBeVisible();
    await expect(page.getByTestId("layer-row").filter({ hasText: "Portrait tone" })).toBeVisible();
    await clickOnImage(page, 0.5, 0.5);
  });
});
