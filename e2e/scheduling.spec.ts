import { type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  selectCoreCourse,
  mutate,
  reloadSavedPage,
} from "./fixtures";

async function dragCourse(
  page: Page,
  source: Locator,
  target: Locator,
  waitForSave = true,
) {
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
  if (waitForSave) await mutate(page, () => page.mouse.up());
  else await page.mouse.up();
}

test("schedule drag updates immediately and rolls back failed saves @smoke", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await selectCoreCourse(page, user);
  await page.goto("/schedule");
  const boards = ["Available Courses", "Fall 2026", "Winter 2027", "Available Courses"]
    .map((name) => page.getByRole("region", { name, exact: true }));
  const course = (board: Locator) => board.getByRole("button", { name: /CS135/ });
  const assignmentURL = `**/api/v1/schedules/${user.scheduleId}/courses/*`;

  for (let index = 0; index < boards.length - 1; index++) {
    const source = boards[index];
    const target = boards[index + 1];
    // Reject each operation once, then retry it against the real API.
    for (const fail of [true, false]) {
      await page.waitForLoadState("networkidle");
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let releaseRefresh!: () => void;
      const heldRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      let refreshing!: () => void;
      const refreshStarted = new Promise<void>((resolve) => { refreshing = resolve; });
      const scheduleURL = `**/api/v1/schedules/${user.scheduleId}`;
      if (!fail) {
        await page.route(scheduleURL, async (route) => {
          refreshing();
          await heldRefresh;
          await route.continue();
        });
      }
      await page.route(assignmentURL, async (route) => {
        await held;
        if (fail) {
          await route.fulfill({
            status: 500,
            contentType: "application/problem+json",
            body: JSON.stringify({ title: "Save failed", status: 500 }),
          });
        } else await route.continue();
      });
      const response = page.waitForResponse((response) =>
        response.url().includes(`/api/v1/schedules/${user.scheduleId}/courses/`));
      try {
        await dragCourse(page, course(source), target, false);
        await expect(course(target)).toBeVisible();
        await expect(course(source)).toHaveCount(0);
        await expect(course(target)).toBeDisabled();
      } finally {
        release();
      }
      try {
        expect((await response).status()).toBe(fail ? 500 : 204);
        if (!fail) {
          await refreshStarted;
          await expect(course(target)).toBeVisible();
          await expect(course(source)).toHaveCount(0);
          await expect(course(target)).toBeDisabled();
        }
      } finally {
        releaseRefresh();
      }
      const saved = fail ? source : target;
      await expect(course(saved)).toBeEnabled();
      await expect(course(fail ? target : source)).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(fail ? 1 : 0);
      await page.unroute(assignmentURL);
      if (!fail) await page.unroute(scheduleURL);
      await reloadSavedPage(page);
      await expect(course(saved)).toBeVisible();
    }
  }
});

test("confirmed schedule changes survive a failed refresh @smoke", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await selectCoreCourse(page, user);
  await page.goto("/schedule");
  const boards = ["Available Courses", "Fall 2026", "Winter 2027", "Available Courses"]
    .map((name) => page.getByRole("region", { name, exact: true }));
  const course = (board: Locator) => board.getByRole("button", { name: /CS135/ });
  const scheduleURL = `**/api/v1/schedules/${user.scheduleId}`;
  for (let index = 0; index < boards.length - 1; index++) {
    await page.waitForLoadState("networkidle");
    await page.route(scheduleURL, (route) =>
      route.fulfill({ status: 500, body: "Refresh failed" }),
    );
    await dragCourse(page, course(boards[index]), boards[index + 1]);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(course(boards[index + 1])).toBeEnabled();
    await expect(course(boards[index])).toHaveCount(0);
    await page.unroute(scheduleURL);
    await reloadSavedPage(page);
    await expect(course(boards[index + 1])).toBeVisible();
  }
});

test("mobile course assignment previews and restores a failed save @mobile", async ({
  page,
  user,
  signIn,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(user);
  await selectCoreCourse(page, user);
  await page.goto("/schedule");
  const term = page.getByRole("combobox", { name: "Term for CS135", exact: true });
  const fall = page.getByRole("region", { name: "Fall 2026", exact: true });
  const assignmentURL = `**/api/v1/schedules/${user.scheduleId}/courses/*`;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(assignmentURL, async (route) => {
    await held;
    await route.fulfill({ status: 500, body: "Save failed" });
  });
  try {
    await term.click();
    await page.getByRole("option", { name: "Fall 2026", exact: true }).click();
    await expect(term).toHaveText("Fall 2026");
    await expect(term).toBeDisabled();
    await expect(
      fall.getByText("Designing Functional Programs", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(term).toBeEnabled();
  await expect(term).toHaveText("Unscheduled");
  await expect(fall).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute(assignmentURL);
  await term.click();
  await mutate(page, () =>
    page.getByRole("option", { name: "Fall 2026", exact: true }).click(),
  );
  await expect(term).toHaveText("Fall 2026");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await reloadSavedPage(page);
  await expect(term).toHaveText("Fall 2026");
});

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
