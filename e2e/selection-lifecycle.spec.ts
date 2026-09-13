import { type Page } from "@playwright/test";
import {
  test, expect, chooseTemplate, mutate, selectCoreCourse, reloadSavedPage,
} from "./fixtures";

async function navigate(page: Page, name: "Select" | "Schedule") {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", {
    name: name === "Select" ? "Select Your Courses" : "Schedule Your Courses",
    exact: true,
  })).toBeVisible();
}

async function assign(page: Page, code: string) {
  const picker = page.getByRole("combobox", { name: `Term for ${code}`, exact: true });
  await picker.click();
  await mutate(page, () => page.getByRole("option", { name: "Fall 2026", exact: true }).click());
  await expect(picker).toHaveText("Fall 2026");
}

async function absent(page: Page, code: string) {
  await expect(page.getByRole("combobox", { name: `Term for ${code}`, exact: true })).toHaveCount(0);
  await expect(page.getByText(code, { exact: true })).toHaveCount(0);
}

test("detaching plans retains shared courses until their last selection is removed @smoke @mobile", async ({
  page, user, createUser, signIn,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const other = await createUser();
  await signIn(user);
  await selectCoreCourse(page, user);
  await chooseTemplate(page, other.templateName);
  for (const checkbox of await page.getByRole("checkbox", { name: "Take CS135", exact: true }).all()) {
    if (!(await checkbox.isChecked())) await mutate(page, () => checkbox.check());
  }
  await navigate(page, "Schedule");
  await assign(page, "CS135");
  await navigate(page, "Select");
  await chooseTemplate(page, user.templateName);
  await navigate(page, "Schedule");
  await expect(page.getByRole("combobox", { name: "Term for CS135", exact: true })).toHaveText("Fall 2026");
  await reloadSavedPage(page);
  await expect(page.getByRole("combobox", { name: "Term for CS135", exact: true })).toHaveText("Fall 2026");
  await navigate(page, "Select");
  await chooseTemplate(page, other.templateName);
  await navigate(page, "Schedule");
  await absent(page, "CS135");
  await reloadSavedPage(page);
  await absent(page, "CS135");
});

test("free choices keep shared assignments and remove replaced or cleared courses @smoke @mobile", async ({
  page, user, signIn,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(user);
  await selectCoreCourse(page, user);
  const input = page.getByPlaceholder("Course code", { exact: true });
  const freeRow = page.getByRole("row").filter({ has: input });
  await mutate(page, () => input.fill("CS135"));
  await mutate(page, () => freeRow.getByRole("checkbox").check());
  await navigate(page, "Schedule");
  await assign(page, "CS135");
  await navigate(page, "Select");
  const fixedRow = page.getByRole("row").filter({ hasText: "Designing Functional Programs" })
    .filter({ hasNot: input });
  await mutate(page, () => fixedRow.getByRole("checkbox").uncheck());
  await navigate(page, "Schedule");
  await expect(page.getByRole("combobox", { name: "Term for CS135", exact: true })).toHaveText("Fall 2026");
  await navigate(page, "Select");
  await mutate(page, () => input.fill("CS136"));
  await navigate(page, "Schedule");
  await absent(page, "CS135");
  await expect(page.getByRole("combobox", { name: "Term for CS136", exact: true })).toHaveText("Unscheduled");
  await assign(page, "CS136");
  await navigate(page, "Select");
  await chooseTemplate(page, user.templateName);
  await chooseTemplate(page, user.templateName);
  await expect(input).toHaveValue("CS136");
  await expect(freeRow.getByRole("checkbox")).not.toBeChecked();
  await mutate(page, () => freeRow.getByRole("checkbox").check());
  await navigate(page, "Schedule");
  await expect(page.getByRole("combobox", { name: "Term for CS136", exact: true })).toHaveText("Unscheduled");
  await assign(page, "CS136");
  await navigate(page, "Select");
  await mutate(page, () => input.fill(""));
  await navigate(page, "Schedule");
  await absent(page, "CS136");
  await reloadSavedPage(page);
  await absent(page, "CS136");
});

test("deselecting a course removes it from every alternative schedule @mobile", async ({ page, user, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(user);
  await selectCoreCourse(page, user);
  await navigate(page, "Schedule");
  await assign(page, "CS135");
  await page.getByRole("button", { name: "Add Schedule", exact: true }).click();
  await page.getByLabel("Schedule Name", { exact: true }).fill("Alternative");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("link", { name: "Alternative", exact: true }).click();
  await assign(page, "CS135");
  await navigate(page, "Select");
  await mutate(page, () => page.getByRole("checkbox", { name: "Take CS135", exact: true }).uncheck());
  await navigate(page, "Schedule");
  for (const name of ["Default", "Alternative"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await absent(page, "CS135");
    await reloadSavedPage(page);
    await absent(page, "CS135");
  }
});

test("deleting a scheduled template cleans the saved schedule @mobile", async ({ page, user, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(user);
  await selectCoreCourse(page, user);
  await navigate(page, "Schedule");
  await assign(page, "CS135");
  await page.goto("/manage/template");
  await page.getByRole("region", { name: user.templateName, exact: true })
    .getByRole("button", { name: "Delete", exact: true }).click();
  await mutate(page, () => page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click());
  await page.goto("/schedule");
  await absent(page, "CS135");
  await reloadSavedPage(page);
  await absent(page, "CS135");
});

test("a delayed assignment cannot resurrect a course deselected in another tab @mobile", async ({ page, user, signIn, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(user);
  await selectCoreCourse(page, user);
  await navigate(page, "Schedule");
  const second = await context.newPage();
  await second.goto("/select");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const url = `**/api/v1/schedules/${user.scheduleId}/courses/*`;
  await page.route(url, async (route) => { await held; await route.continue(); });
  const response = page.waitForResponse((r) => r.url().includes(`/api/v1/schedules/${user.scheduleId}/courses/`));
  try {
    await page.getByRole("combobox", { name: "Term for CS135", exact: true }).click();
    await page.getByRole("option", { name: "Fall 2026", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Term for CS135", exact: true })).toBeDisabled();
    await mutate(second, () => second.getByRole("checkbox", { name: "Take CS135", exact: true }).uncheck());
  } finally { release(); }
  expect((await response).status()).toBe(404);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute(url);
  await second.close();
  await reloadSavedPage(page);
  await absent(page, "CS135");
});

test("template copies preserve explicitly authored course order", async ({ page, user, signIn }) => {
  await signIn(user);
  const name = `Ordered ${user.id}`;
  await page.goto("/create/template");
  await page.getByPlaceholder("Template Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add Fixed Requirement", exact: true }).click();
  await page.getByPlaceholder("e.g. Complete all of the following", { exact: true }).fill("Authored sequence");
  await page.getByPlaceholder("CS135, CS136", { exact: true }).fill("MATH135, CS136, CS135");
  await page.getByRole("button", { name: "Create Academic Plan", exact: true }).click();
  await expect(page).toHaveURL(/\/select$/);
  await page.goto("/create/template");
  await page.getByRole("combobox", { name: "Copy academic plan", exact: true }).click();
  await page.getByPlaceholder("Search framework...", { exact: true }).fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByPlaceholder("CS135, CS136", { exact: true })).toHaveValue("MATH135, CS136, CS135");
});
