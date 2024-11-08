import { db } from "@/server/db";
import { templates, userTemplates, userPlanCourses, plans } from "@/server/db/schema";
import { desc, eq, and } from "drizzle-orm";

export async function getTemplates() {
  return await db
    .select({
      id: templates.id,
      name: templates.name,
    })
    .from(templates)
    .orderBy(templates.name);
}

export async function getUserTemplates(userId: string) {
  return await db
    .select({
      templateId: userTemplates.templateId,
    })
    .from(userTemplates)
    .where(eq(userTemplates.userId, userId));
}

export async function createPlanForTemplate(userId: string, templateId: number, templateName: string) {
  const planName = `${templateName} Plan`; // Create a default plan name
  return await db
    .insert(plans)
    .values({
      userId,
      templateId,
      name: planName,
    })
    .returning()
    .then(plans => plans[0]);
}

export async function deletePlanForTemplate(userId: string, templateId: number) {
  // Get the plan first
  const plan = await getUserPlanForTemplate(userId, templateId);
  if (!plan) return;

  // Delete all course selections for this plan
  await db
    .delete(userPlanCourses)
    .where(and(
      eq(userPlanCourses.userId, userId),
      eq(userPlanCourses.planId, plan.id),
    ));

  // Then delete the plan itself
  await db
    .delete(plans)
    .where(and(
      eq(plans.userId, userId),
      eq(plans.templateId, templateId),
    ));
}

export async function getUserPlanForTemplate(userId: string, templateId: number) {
  return await db.query.plans.findFirst({
    where: and(
      eq(plans.userId, userId),
      eq(plans.templateId, templateId),
    ),
  });
}

export async function toggleUserTemplate(userId: string, templateId: number, templateName: string) {
  const exists = await db.query.userTemplates.findFirst({
    where: and(
      eq(userTemplates.userId, userId),
      eq(userTemplates.templateId, templateId),
    ),
  });

  if (exists) {
    // Delete template selection and associated plan
    await deletePlanForTemplate(userId, templateId);
    await db
      .delete(userTemplates)
      .where(and(
        eq(userTemplates.userId, userId),
        eq(userTemplates.templateId, templateId),
      ));
  } else {
    // Create template selection and plan
    await db.insert(userTemplates).values({
      userId,
      templateId,
    });
    await createPlanForTemplate(userId, templateId, templateName);
  }
}

export async function getUserTemplateDetails(userId: string) {
  const userSelectedTemplates = await db.query.userTemplates.findMany({
    where: eq(userTemplates.userId, userId),
    with: {
      template: {
        columns: {
          id: true,
          name: true,
        },
        with: {
          items: {
            columns: {
              id: true,
              type: true,
              description: true,
              orderIndex: true,
            },
            with: {
              courses: {
                with: {
                  course: true,
                },
              },
            },
            orderBy: (items) => [items.orderIndex],
          },
        },
      },
    },
  });

  return { templates: userSelectedTemplates, revalidated: Date.now() };
}

export async function getUserCourseSelections(userId: string) {
  const selections = await db
    .select({
      courseId: userPlanCourses.courseId,
      take: userPlanCourses.take,
    })
    .from(userPlanCourses)
    .where(eq(userPlanCourses.userId, userId));

  return new Map(selections.map(s => [s.courseId, s.take]));
}

export async function toggleUserCourse(userId: string, templateId: number, courseId: number, take: boolean) {
  // Get or create plan for this template
  const plan = await getUserPlanForTemplate(userId, templateId);
  if (!plan) throw new Error("No plan found for template");

  await db
    .insert(userPlanCourses)
    .values({
      userId,
      planId: plan.id,
      courseId,
      take,
    })
    .onConflictDoUpdate({
      target: [userPlanCourses.userId, userPlanCourses.courseId],
      set: { take },
    });
}
