import { test, expect, type Page } from "@playwright/test";
import exifr from "exifr";
import { disableSavePicker, importImage, makeFlatJpeg } from "./helpers";
import { makeBayerDng } from "./dng";
import { buildExif, exifJpegSegment, insertJpegSegments } from "@/engine/export/exifWriter";

async function exportJpeg(page: Page, mode: "all" | "no-location" | "none") {
  await page.getByTestId("open-export").click();
  await page.getByTestId(`meta-${mode}`).check();
  const d = page.waitForEvent("download");
  await page.getByTestId("export-confirm").click();
  const fs = await import("node:fs");
  return fs.readFileSync((await (await d).path())!);
}

test.beforeEach(async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
});

test("metadata modes: keep all, remove location, remove all — plus sRGB ICC tag", async ({ page }) => {
  const base = await makeFlatJpeg(page, 400, 300, "#808080");
  const exif = buildExif(
    { make: "TestCam", model: "X1", iso: 200, exposureTime: 1 / 125, fNumber: 4, hasGps: true, latitude: 51.5, longitude: -0.12 },
    { includeGps: true },
  );
  const jpeg = Buffer.from(insertJpegSegments(new Uint8Array(base), [exifJpegSegment(exif)]));
  await importImage(page, jpeg, "geo.jpg");

  let out = await exifr.parse(await exportJpeg(page, "all"), { tiff: true, exif: true, gps: true, icc: true });
  expect(out.Make).toBe("TestCam");
  expect(out.latitude).toBeCloseTo(51.5, 2);
  expect(out.ProfileDescription).toMatch(/sRGB/);

  out = await exifr.parse(await exportJpeg(page, "no-location"), { tiff: true, exif: true, gps: true });
  expect(out.Make).toBe("TestCam");
  expect(out.latitude).toBeUndefined();

  out = await exifr.parse(await exportJpeg(page, "none"), { tiff: true, exif: true, gps: true, icc: false });
  expect(out?.Make).toBeUndefined();
});

test("RAW originals get fresh EXIF from LibRaw metadata", async ({ page }) => {
  await page.getByTestId("edit-photo-input").setInputFiles({ name: "cam.dng", mimeType: "image/x-adobe-dng", buffer: makeBayerDng(320, 240) });
  await page.waitForURL(/\/editor\?project=/, { timeout: 60_000 });
  await expect(page.getByTestId("preview-canvas")).toBeVisible({ timeout: 60_000 });
  const out = await exifr.parse(await exportJpeg(page, "all"), { tiff: true, exif: true, icc: true });
  expect(out.Make).toBe("ProStudio");
  expect(out.Model).toBe("TestSensor");
  expect(out.ProfileDescription).toMatch(/sRGB/);
});
