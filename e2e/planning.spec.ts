import {
  test,
  expect,
  chooseTemplate,
  mutate,
  reloadSavedPage,
} from "./fixtures";

test("public pages and protected routes @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /UWPlan/ }).first(),
  ).toBeVisible();
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: /Privacy Policy/i }),
  ).toBeVisible();
  for (const path of [
    "/select",
    "/schedule",
    "/create/template",
    "/manage/template",
    "/admin",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin$/);
  }
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }),
  ).toBeVisible();
});

test("template choices and fixed/free course selections persist @smoke", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await page.goto("/select");
  await chooseTemplate(page, user.templateName);
  await expect(
    page.getByText("Complete the core and choose an elective", { exact: true }),
  ).toBeVisible();
  const fixed = page
    .getByRole("row")
    .filter({ hasText: "Designing Functional Programs" })
    .getByRole("checkbox");
  await mutate(page, () => fixed.check());
  const selected = page.getByRole("table").first();
  await expect(selected.getByText("CS135", { exact: true })).toBeVisible();
  await mutate(page, () =>
    page
      .getByRole("row")
      .filter({ hasText: "Algebra for Honours Mathematics" })
      .getByRole("checkbox")
      .check(),
  );
  await expect(selected.getByText("MATH135", { exact: true })).toBeVisible();
  await selected.getByRole("button", { name: "Code", exact: true }).click();
  await expect(selected.getByRole("row").nth(1)).toContainText("MATH135");
  await mutate(page, () =>
    selected
      .getByRole("row")
      .filter({ hasText: "MATH135" })
      .getByRole("button", { name: "Remove", exact: true })
      .click(),
  );
  await expect(selected.getByText("MATH135", { exact: true })).toHaveCount(0);
  await mutate(page, () =>
    page.getByPlaceholder("Course code", { exact: true }).fill("econ 101"),
  );
  const free = page
    .getByRole("row")
    .filter({ has: page.getByPlaceholder("Course code", { exact: true }) });
  await expect(free).toContainText("Introduction to Microeconomics");
  await mutate(page, () => free.getByRole("checkbox").check());
  await expect(selected.getByText("ECON101", { exact: true })).toBeVisible();
  await reloadSavedPage(page);
  await expect(selected.getByText("CS135", { exact: true })).toBeVisible();
  await expect(selected.getByText("ECON101", { exact: true })).toBeVisible();
  await mutate(page, () =>
    page.getByPlaceholder("Course code", { exact: true }).fill("CS136"),
  );
  await expect(selected.getByText("CS136", { exact: true })).toBeVisible();
  await expect(selected.getByText("ECON101", { exact: true })).toHaveCount(0);
  await mutate(page, () =>
    selected
      .getByRole("row")
      .filter({ hasText: "CS135" })
      .getByRole("button", { name: "Remove", exact: true })
      .click(),
  );
  await expect(fixed).not.toBeChecked();
  await mutate(page, () => free.getByRole("checkbox").uncheck());
  await expect(selected.getByRole("row")).toHaveCount(1);
  await chooseTemplate(page, user.templateName);
  await reloadSavedPage(page);
  await expect(page.getByText("Core courses", { exact: true })).toHaveCount(0);
});

test("logout and expired sessions protect saved data @smoke", async ({
  page,
  user,
  signIn,
  createUser,
}) => {
  await signIn(user);
  await page.goto("/select");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/select");
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(await createUser({ expired: true }));
  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/signin$/);
});

test("ordinary users cannot see another schedule or the admin page", async ({
  page,
  user,
  signIn,
  createUser,
}) => {
  const other = await createUser();
  await signIn(user);
  await page.goto(`/schedule?scheduleId=${other.scheduleId}`);
  await expect(
    page.getByText(
      "You do not have access to this schedule, or the schedule is invalid.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export to CSV" })).toHaveCount(
    0,
  );
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/select$/);
  await page.goto("/manage/template");
  await expect(
    page.getByText(user.templateName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(other.templateName, { exact: true })).toHaveCount(
    0,
  );
});

test("admin can view users and manage templates", async ({
  page,
  createUser,
  signIn,
}) => {
  const admin = await createUser({ admin: true });
  await signIn(admin);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin page" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: `${admin.id}@example.test`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(admin.templateName, { exact: true }),
  ).toBeVisible();
});


test("free-course typing preserves suffixes while a save is delayed @smoke", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await page.goto("/select");
  await chooseTemplate(page, user.templateName);
  const input = page.getByPlaceholder("Course code", { exact: true });
  const free = page.getByRole("row").filter({ has: input });
  let release!: () => void;
  const heldResponse = new Promise<void>((resolve) => { release = resolve; });
  let saving!: () => void;
  const firstSave = new Promise<void>((resolve) => { saving = resolve; });
  let held = false;
  await page.route("**/*", async (route) => {
    if (held || !["POST", "PUT", "PATCH"].includes(route.request().method())) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    saving();
    await heldResponse;
    await route.fulfill({ response });
  });
  try {
    await input.pressSequentially("CS245");
    await firstSave;
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await page.keyboard.type("E");
    await expect(input).toHaveValue("CS245E");
  } finally {
    release();
  }
  await expect(free).toContainText("Logic and Computation (Enriched)");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("CS245E");
  await reloadSavedPage(page);
  await expect(input).toHaveValue("CS245E");
  await expect(free).toContainText("Logic and Computation (Enriched)");
});
