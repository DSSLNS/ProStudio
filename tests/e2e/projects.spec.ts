import { test, expect } from "@playwright/test";
import { disableSavePicker, importImage, makeTestJpeg } from "./helpers";

test("save, reopen, rename, duplicate, export and re-import a project", async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
  await importImage(page, await makeTestJpeg(page, 600, 400), "holiday.jpg");
  const exposure = page.getByRole("textbox", { name: "Exposure value" });
  await exposure.click();
  await exposure.fill("0.5");
  await exposure.press("Enter");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Project saved locally")).toBeVisible();

  await page.goto("/projects");
  const card = page.getByTestId("project-card").filter({ hasText: "holiday" });
  await expect(card).toBeVisible();

  // Reopen keeps the edit.
  await card.getByRole("link").click();
  await expect(page.getByRole("textbox", { name: "Exposure value" })).toHaveValue("+0.50 EV");

  // Rename.
  await page.goto("/projects");
  await page.getByRole("button", { name: "Actions for holiday" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Beach");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByTestId("project-card").filter({ hasText: "Beach" })).toBeVisible();

  // Duplicate.
  await page.getByRole("button", { name: "Actions for Beach" }).first().click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByTestId("project-card").filter({ hasText: "Beach copy" })).toBeVisible();

  // Export .prostudio.
  await page.getByRole("button", { name: "Actions for Beach copy" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export .prostudio/ }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe("Beach copy.prostudio");
  const path = (await d.path())!;

  // Delete the copy, then re-import it from the file.
  await page.getByRole("button", { name: "Actions for Beach copy" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("project-card").filter({ hasText: "Beach copy" })).toHaveCount(0);

  await page.getByTestId("open-project-input").setInputFiles(path);
  await page.waitForURL(/\/editor\?project=/);
  await expect(page.getByRole("textbox", { name: "Exposure value" })).toHaveValue("+0.50 EV");
});
