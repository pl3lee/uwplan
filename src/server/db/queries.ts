import { db } from "@/server/db";
import { templates, userTemplates, userPlanCourses, plans, templateRequirementCourses, templateItems } from "@/server/db/schema";
import { desc, eq, and, not, inArray } from "drizzle-orm";

/**
 * Retrieves all available academic plan templates.
 * @returns Array of templates with their IDs and names, sorted by name.
 */
export async function getTemplates() {
  return await db
    .select({
      id: templates.id,
      name: templates.name,
    })
    .from(templates)
    .orderBy(templates.name);
}

/**
 * Gets the templates selected by a specific user.
 * @param userId - The ID of the user
 * @returns Array of template IDs selected by the user
 */
export async function getUserTemplates(userId: string) {
  return await db
    .select({
      templateId: userTemplates.templateId,
    })
    .from(userTemplates)
    .where(eq(userTemplates.userId, userId));
}

/**
 * Creates a new academic plan for a user based on a template.
 * @param userId - The ID of the user
 * @param templateId - The ID of the template to base the plan on
 * @param templateName - The name of the template
 * @returns The newly created plan
 */
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

/**
 * Gets all courses associated with a template.
 * @param templateId - The ID of the template
 * @returns A Set of course IDs that belong to the template
 * @private Internal helper function
 */
async function getCoursesForTemplate(templateId: number) {
  const items = await db.query.templateItems.findMany({
    where: eq(templateItems.templateId, templateId),
    with: {
      courses: {
        with: {
          course: true
        }
      }
    }
  });

  return new Set(items.flatMap(item =>
    item.courses.map(c => c.courseId)
  ));
}

/**
 * Gets all courses from templates selected by a user, excluding a specific template.
 * Used to determine which courses are shared across templates.
 * @param userId - The ID of the user
 * @param excludeTemplateId - The ID of the template to exclude
 * @returns A Set of course IDs from other selected templates
 * @private Internal helper function
 */
async function getCoursesInOtherTemplates(userId: string, excludeTemplateId: number) {
  // Get all selected templates except the one being removed
  const otherTemplates = await db.query.userTemplates.findMany({
    where: and(
      eq(userTemplates.userId, userId),
      not(eq(userTemplates.templateId, excludeTemplateId))
    ),
    with: {
      template: {
        with: {
          items: {
            with: {
              courses: true
            }
          }
        }
      }
    }
  });

  // Get all courses from other templates
  return new Set(otherTemplates.flatMap(ut =>
    ut.template.items.flatMap(item =>
      item.courses.map(c => c.courseId)
    )
  ));
}

/**
 * Deletes a plan and its associated course selections.
 * Also handles removal of unique course selections.
 * @param userId - The ID of the user
 * @param templateId - The ID of the template
 */
export async function deletePlanForTemplate(userId: string, templateId: number) {
  const plan = await getUserPlanForTemplate(userId, templateId);
  if (!plan) return;

  // Get courses unique to this template
  const templateCourses = await getCoursesForTemplate(templateId);
  const coursesInOtherTemplates = await getCoursesInOtherTemplates(userId, templateId);

  // Filter for courses that only exist in this template
  const uniqueCourses = Array.from(templateCourses)
    .filter(courseId => !coursesInOtherTemplates.has(courseId));

  // First, delete all course selections for this specific plan
  await db
    .delete(userPlanCourses)
    .where(eq(userPlanCourses.planId, plan.id));

  // Then, delete course selections that are unique to this template
  if (uniqueCourses.length > 0) {
    await db
      .delete(userPlanCourses)
      .where(and(
        eq(userPlanCourses.userId, userId),
        inArray(userPlanCourses.courseId, uniqueCourses)
      ));
  }

  // Finally delete the plan itself
  await db
    .delete(plans)
    .where(and(
      eq(plans.userId, userId),
      eq(plans.templateId, templateId),
    ));
}

/**
 * Retrieves a user's plan for a specific template.
 * @param userId - The ID of the user
 * @param templateId - The ID of the template
 * @returns The plan if found, null otherwise
 */
export async function getUserPlanForTemplate(userId: string, templateId: number) {
  return await db.query.plans.findFirst({
    where: and(
      eq(plans.userId, userId),
      eq(plans.templateId, templateId),
    ),
  });
}

/**
 * Toggles a template selection for a user.
 * If the template is selected, creates a new plan.
 * If the template is unselected, removes the plan and relevant course selections.
 * @param userId - The ID of the user
 * @param templateId - The ID of the template to toggle
 * @param templateName - The name of the template
 */
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

/**
 * Gets detailed information about all templates selected by a user.
 * Includes template items, courses, and their relationships.
 * @param userId - The ID of the user
 * @returns Object containing templates and their full details
 */
export async function getUserTemplateDetails(userId: string) {
  const userSelectedTemplates = await db.query.userTemplates.findMany({
    where: eq(userTemplates.userId, userId),
    with: {
      template: {
        include: {
          id: true,
          name: true,
          items: {
            with: {
              id: true,
              type: true,
              description: true,
              orderIndex: true,
              templateId: true,
              courses: {
                with: {
                  course: {
                    columns: {
                      id: true,
                      code: true,
                      name: true,
                      rating: true,
                      difficulty: true,
                      workload: true,
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  console.log(JSON.stringify(userSelectedTemplates, null, 2)); // For debugging

  return { templates: userSelectedTemplates, revalidated: Date.now() };
}

/**
 * Retrieves all course selections for a user.
 * @param userId - The ID of the user
 * @returns Map of course IDs to their selection state (true/false)
 */
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

/**
 * Toggles the selection state of a course for a user within a specific template.
 * Creates or updates the course selection in the user's plan.
 * @param userId - The ID of the user
 * @param templateId - The ID of the template containing the course
 * @param courseId - The ID of the course to toggle
 * @param take - The new selection state
 * @throws Error if no plan exists for the template
 */
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
