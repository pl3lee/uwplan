import { test, expect, chooseTemplate } from "./fixtures";

test("copy an academic plan and reject its duplicate name", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  await page.goto("/create/template");
  await page
    .getByRole("combobox", { name: "Copy academic plan", exact: true })
    .click();
  await page
    .getByPlaceholder("Search framework...", { exact: true })
    .fill(user.templateName);
  await page
    .getByRole("option", { name: user.templateName, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByPlaceholder("Template Name", { exact: true }),
  ).toHaveValue(user.templateName);
  await expect(
    page.getByPlaceholder("CS135, CS136", { exact: true }),
  ).toHaveValue(/CS135/);
  await expect(
    page.getByLabel("How many courses?", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Create Academic Plan", exact: true })
    .click();
  await expect(
    page.getByText("Academic plan name already exists", { exact: true }),
  ).toBeVisible();
  const copy = `${user.templateName} copy`;
  await page.getByPlaceholder("Template Name", { exact: true }).fill(copy);
  await page
    .getByRole("button", { name: "Create Academic Plan", exact: true })
    .click();
  await expect(page).toHaveURL(/\/select$/);
  await chooseTemplate(page, copy);
  await expect(
    page.getByText("Complete the core and choose an elective", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Algebra for Honours Mathematics", { exact: true }),
  ).toBeVisible();
});

test("admin may rename another user's academic plan", async ({
  page,
  user,
  createUser,
  signIn,
  context,
}) => {
  const admin = await createUser({ admin: true });
  await signIn(admin);
  await page.goto("/admin");
  await page
    .getByRole("region", { name: user.templateName, exact: true })
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill(`${user.templateName} reviewed`);
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(
    page.getByRole("region", {
      name: `${user.templateName} reviewed`,
      exact: true,
    }),
  ).toBeVisible();
  await context.clearCookies();
  await signIn(user);
  await page.goto("/manage/template");
  await expect(
    page.getByRole("region", {
      name: `${user.templateName} reviewed`,
      exact: true,
    }),
  ).toBeVisible();
});

test("create a plan with each item type, rename it, and delete it", async ({
  page,
  user,
  signIn,
}) => {
  await signIn(user);
  const name = `Custom ${user.id.slice(0, 8)}`;
  await page.goto("/create/template");
  await page.getByPlaceholder("Template Name", { exact: true }).fill(name);
  await page
    .getByPlaceholder("Template Description", { exact: true })
    .fill("My degree requirements");
  await page
    .getByRole("button", { name: "Add Instruction", exact: true })
    .click();
  await page
    .getByPlaceholder("e.g. Complete all of the following", { exact: true })
    .fill("Read these requirements first");
  await page
    .getByRole("button", { name: "Add Fixed Requirement", exact: true })
    .click();
  await page
    .getByPlaceholder("e.g. Complete all of the following", { exact: true })
    .last()
    .fill("Required programming");
  await page
    .getByPlaceholder("CS135, CS136", { exact: true })
    .fill("CS135, CS136");
  await page
    .getByRole("button", { name: "Add Separator", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Free Requirement", exact: true })
    .click();
  await page
    .getByPlaceholder("e.g. Complete all of the following", { exact: true })
    .last()
    .fill("Your elective");
  await page.getByLabel("How many courses?", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Create Academic Plan", exact: true })
    .click();
  await expect(page).toHaveURL(/\/select$/);
  await chooseTemplate(page, name);
  await expect(
    page.getByText("Read these requirements first", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Required programming", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Elementary Algorithm Design", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Course code", { exact: true }),
  ).toHaveCount(1);
  await page.goto("/manage/template");
  // The same named region is useful to screen-reader users and survives layout changes.
  const card = page.getByRole("region", { name, exact: true });
  await card.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill(`${name} revised`);
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("Revised requirements");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  const renamed = page.getByRole("region", {
    name: `${name} revised`,
    exact: true,
  });
  await expect(renamed).toContainText("Revised requirements");
  await page.reload();
  await renamed.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(renamed).toHaveCount(0);
  await page.goto("/select");
  await expect(
    page.getByText("Required programming", { exact: true }),
  ).toHaveCount(0);
});
