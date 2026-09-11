import { type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  selectCoreCourse,
  mutate,
  reloadSavedPage,
} from "./fixtures";

async function dragCourse(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Course and term must be visible to drag");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 10,
    from.y + from.height / 2,
    { steps: 5 },
  );
  await page.mouse.move(
    to.x + to.width / 2,
    to.y + Math.min(to.height / 2, 100),
    { steps: 20 },
  );
  await mutate(page, () => page.mouse.up());
}

test("create, rename, and delete schedules while retaining the final schedule @smoke", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await page.goto("/schedule");
  await expect(
    page.getByRole("button", { name: "Delete Schedule", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Add Schedule", exact: true }).click();
  await page.getByLabel("Schedule Name", { exact: true }).fill("Alternative");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const alternative = page.getByRole("link", {
    name: "Alternative",
    exact: true,
  });
  await alternative.click();
  await expect(alternative).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: "Rename Schedule", exact: true })
    .click();
  await page.getByLabel("New Name", { exact: true }).fill("Co-op Plan");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Co-op Plan", exact: true }),
  ).toBeVisible();
  await reloadSavedPage(page);
  await expect(
    page.getByRole("link", { name: "Co-op Plan", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Schedule", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Co-op Plan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Default", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete Schedule", exact: true }),
  ).toBeDisabled();
});

test("drag courses between terms, export CSV, and remove assignments", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await selectCoreCourse(page, user);
  await page.goto("/schedule");
  const available = page.getByRole("region", {
    name: "Available Courses",
    exact: true,
  });
  const fall = page.getByRole("region", { name: "Fall 2026", exact: true });
  const winter = page.getByRole("region", { name: "Winter 2027", exact: true });
  await dragCourse(
    page,
    available.getByRole("button", { name: /CS135/ }),
    fall,
  );
  await expect(fall.getByText("CS135", { exact: true })).toBeVisible();
  await reloadSavedPage(page);
  await expect(fall.getByText("CS135", { exact: true })).toBeVisible();
  await dragCourse(page, fall.getByRole("button", { name: /CS135/ }), winter);
  await expect(winter.getByText("CS135", { exact: true })).toBeVisible();
  await expect(fall.getByText("CS135", { exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await mutate(page, () =>
    page.getByRole("button", { name: "Export to CSV", exact: true }).click(),
  );
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  expect(await readFile((await download.path())!, "utf8")).toBe(
    "Selected Courses:\nCS135 - Designing Functional Programs\n\nScheduled Courses:\nWinter 2027\nCS135\n",
  );
  await dragCourse(
    page,
    winter.getByRole("button", { name: /CS135/ }),
    available,
  );
  await expect(available.getByText("CS135", { exact: true })).toBeVisible();
  await reloadSavedPage(page);
  await expect(winter.getByText("CS135", { exact: true })).toHaveCount(0);
  await expect(available.getByText("CS135", { exact: true })).toBeVisible();
});

test("term range changes survive reload", async ({ page, user, signIn }) => {
  await signIn(user);
  await page.goto("/schedule");
  await page.getByRole("combobox", { name: "End year", exact: true }).click();
  await mutate(page, () =>
    page.getByRole("option", { name: "2028", exact: true }).click(),
  );
  await expect(
    page.getByRole("region", { name: "Spring 2028", exact: true }),
  ).toBeVisible();
  await reloadSavedPage(page);
  await expect(
    page.getByRole("combobox", { name: "End year", exact: true }),
  ).toHaveText("2028");
  await page
    .getByRole("combobox", { name: "Start season", exact: true })
    .click();
  await mutate(page, () =>
    page.getByRole("option", { name: "Winter", exact: true }).click(),
  );
  await expect(
    page.getByRole("region", { name: "Winter 2026", exact: true }),
  ).toBeVisible();
  await reloadSavedPage(page);
  await expect(
    page.getByRole("combobox", { name: "Start season", exact: true }),
  ).toHaveText("Winter");
});

test("mobile navigation and course assignment @mobile", async ({
  page,
  user,
  signIn,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(user);
  await selectCoreCourse(page, user);
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Schedule Your Courses", exact: true }),
  ).toBeVisible();
  const term = page.getByRole("combobox", {
    name: "Term for CS135",
    exact: true,
  });
  await term.click();
  await mutate(page, () =>
    page.getByRole("option", { name: "Fall 2026", exact: true }).click(),
  );
  await expect(term).toBeEnabled();
  await reloadSavedPage(page);
  await expect(term).toHaveText("Fall 2026");
  await term.click();
  await mutate(page, () =>
    page.getByRole("option", { name: "Winter 2027", exact: true }).click(),
  );
  await expect(term).toBeEnabled();
  await reloadSavedPage(page);
  await expect(term).toHaveText("Winter 2027");
  await term.click();
  await mutate(page, () =>
    page.getByRole("option", { name: "Unscheduled", exact: true }).click(),
  );
  await expect(term).toBeEnabled();
  await reloadSavedPage(page);
  await expect(term).toHaveText("Unscheduled");
  await page.getByRole("link", { name: "Select", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Select Your Courses", exact: true }),
  ).toBeVisible();
});
