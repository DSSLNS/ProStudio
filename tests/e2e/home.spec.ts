import { test, expect } from "@playwright/test";
import { trackGetUserMedia } from "./helpers";

test("homepage offers Take Photo and Edit Photo without requesting the camera", async ({ page }) => {
  await trackGetUserMedia(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "PROSTUDIO" })).toBeVisible();
  await expect(page.getByText("Professional Photography & Photo Editing")).toBeVisible();
  await expect(page.getByTestId("take-photo")).toContainText("TAKE PHOTO");
  await expect(page.getByTestId("edit-photo")).toContainText("EDIT PHOTO");
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open project" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls)).toBe(0);
});

test("Take Photo opens the camera mode chooser", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("take-photo").click();
  await expect(page).toHaveURL(/\/camera$/);
  await expect(page.getByText("AUTO MODE")).toBeVisible();
  await expect(page.getByText("MANUAL MODE")).toBeVisible();
});

test("rejects a non-image file with a clear message", async ({ page }) => {
  await page.goto("/");
  await page
    .getByTestId("edit-photo-input")
    .setInputFiles({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("hello world, not an image") });
  await expect(page.getByText(/not a recognised image format/)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
