import { db } from "@/server/db";
import {
  templates,
  plans,
  templateItems,
  courseItems,
  selectedCourses,
  courses,
  planTemplates,
  freeCourses,
  users,
} from "@/server/db/schema";
import { type InstructionItem, type RequirementItem, type SeparatorItem, type CreateTemplateInput } from "@/types/template";
import { eq, and, inArray } from "drizzle-orm";



// Add type guard helper
function isValidCourse(course: { code: string | null; name: string | null; }): course is { code: string; name: string; } {
  return course.code !== null && course.name !== null;
}

/**
 * Retrieves all available academic plan templates.
 */
export async function getTemplates() {
  return await db
    .select({
      id: templates.id,
      name: templates.name,
      description: templates.description,
    })
    .from(templates)
    .orderBy(templates.name);
}

/**
 * Gets all templates linked to a user's plan.
 */
export async function getUserSelectedTemplates(userId: string) {
  return await db
    .select({
      name: templates.name,
      id: planTemplates.templateId,
      description: templates.description,
    })
    .from(planTemplates)
    .innerJoin(plans, eq(plans.id, planTemplates.planId))
    .innerJoin(templates, eq(templates.id, planTemplates.templateId))
    .where(eq(plans.userId, userId))
    .orderBy(templates.name);
}

/**
 * Gets a user's plan.
 * Each user has exactly one plan as per architecture.
 */
export async function getUserPlan(userId: string) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.userId, userId))
    .limit(1);
  return plan;
}

/**
 * Gets or creates a user's plan.
 * Every user must have exactly one plan.
 */
export async function getOrCreateUserPlan(userId: string) {
  // Try to get existing plan
  const [existingPlan] = await db
    .select()
    .from(plans)
    .where(eq(plans.userId, userId))
    .limit(1);

  if (existingPlan) return existingPlan;

  // Create new plan if none exists
  const [newPlan] = await db
    .insert(plans)
    .values({
      userId,
    })
    .returning();

  return newPlan;
}

/**
 * Gets detailed information about a template including all its items and courses.
 */
export async function getTemplateDetails(templateId: string) {
  // Get template
  const [template] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1);

  if (!template) return null;

  // Get template items
  const items = await db
    .select()
    .from(templateItems)
    .where(eq(templateItems.templateId, templateId))
    .orderBy(templateItems.orderIndex);

  // Get fixed courses for requirements
  const fixedCoursesForItems = await db
    .select({
      courseItemId: courseItems.id,
      templateItemId: courseItems.requirementId,
      courseId: courses.id,
      code: courses.code,
      name: courses.name,
      usefulRating: courses.usefulRating,
      likedRating: courses.likedRating,
      easyRating: courses.easyRating,
      numRatings: courses.numRatings,
      type: courseItems.type,
    })
    .from(courseItems)
    .innerJoin(courses, eq(courses.id, courseItems.courseId))
    .where(and(
      inArray(courseItems.requirementId, items.map(item => item.id)),
      eq(courseItems.type, "fixed"),
    ));

  // Get free course items and their filled courses if any
  const freeCourseItems = await db
    .select({
      courseItemId: courseItems.id,
      templateItemId: courseItems.requirementId,
      filledCourseId: freeCourses.filledCourseId,
      code: courses.code,
      name: courses.name,
      usefulRating: courses.usefulRating,
      likedRating: courses.likedRating,
      easyRating: courses.easyRating,
      numRatings: courses.numRatings,
    })
    .from(courseItems)
    .leftJoin(freeCourses, eq(freeCourses.courseItemId, courseItems.id))
    .leftJoin(courses, eq(courses.id, freeCourses.filledCourseId))
    .where(and(
      inArray(courseItems.requirementId, items.map(item => item.id)),
      eq(courseItems.type, "free")
    ));

  // Combine the data and filter out invalid courses
  return {
    ...template,
    items: items.map(item => ({
      ...item,
      fixedCourses: fixedCoursesForItems
        .filter(c => c.templateItemId === item.id && isValidCourse(c))
        .map(c => ({
          courseItemId: c.courseItemId,
          course: {
            id: c.courseId,
            code: c.code,
            name: c.name,
            usefulRating: c.usefulRating,
            likedRating: c.likedRating,
            easyRating: c.easyRating,
            numRatings: c.numRatings,
          }
        })),
      freeCourses: freeCourseItems
        .filter(c => c.templateItemId === item.id)
        .map(c => ({
          courseItemId: c.courseItemId,
          course: c.filledCourseId && isValidCourse(c) ? {
            id: c.filledCourseId,
            code: c.code,
            name: c.name,
            usefulRating: c.usefulRating,
            likedRating: c.likedRating,
            easyRating: c.easyRating,
            numRatings: c.numRatings
          } : null
        }))
    }))
  };
}

/**
 * Gets all selected course items for a user
 */
export async function getSelectedCourses(userId: string) {
  return await db
    .select({
      courseItemId: selectedCourses.courseItemId,
      courseId: courseItems.courseId, // We still need courseId for display purposes
    })
    .from(selectedCourses)
    .innerJoin(plans, eq(plans.id, selectedCourses.planId))
    .innerJoin(courseItems, eq(courseItems.id, selectedCourses.courseItemId))
    .innerJoin(users, eq(users.id, plans.userId))
    .where(and(
      eq(users.id, userId),
      eq(selectedCourses.selected, true)
    ));
}

/**
 * Toggles a course item selection for a user
 */
export async function toggleCourseSelection(userId: string, courseItemId: string, selected: boolean) {
  const userPlan = await getOrCreateUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get or create plan for user ${userId}`);
  }

  console.log("Toggling course selection", userId, courseItemId, selected);
  await db
    .insert(selectedCourses)
    .values({
      planId: userPlan.id,
      courseItemId,
      selected,
    })
    .onConflictDoUpdate({
      target: [selectedCourses.planId, selectedCourses.courseItemId],
      set: { selected },
    });
}


/**
 * Links a template to a plan
 */
export async function addTemplateToPlan(planId: string, templateId: string) {
  await db
    .insert(planTemplates)
    .values({
      planId,
      templateId,
    })
    .onConflictDoNothing();
}

/**
 * Removes a template from a plan and cleans up related course selections
 */
export async function removeTemplateFromPlan(planId: string, templateId: string) {
  await db
    .delete(planTemplates)
    .where(and(
      eq(planTemplates.planId, planId),
      eq(planTemplates.templateId, templateId)
    ));
}

export async function toggleUserTemplate(userId: string, templateId: string) {
  const userPlan = await getOrCreateUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get or create plan for user ${userId}`);
  }

  const planId = userPlan.id;

  const [existingTemplate] = await db
    .select()
    .from(planTemplates)
    .where(and(
      eq(planTemplates.planId, planId),
      eq(planTemplates.templateId, templateId)
    ))
    .limit(1);

  if (existingTemplate) {
    await removeTemplateFromPlan(planId, templateId);
  } else {
    await addTemplateToPlan(planId, templateId);
  }
}

// Modify getCoursesWithRatings to filter out invalid courses
export async function getCoursesWithRatings() {
  const coursesResults = await db
    .select({
      id: courses.id,
      code: courses.code,
      name: courses.name,
      usefulRating: courses.usefulRating,
      likedRating: courses.likedRating,
      easyRating: courses.easyRating,
      numRatings: courses.numRatings,
    })
    .from(courses)
    .orderBy(courses.code);

  return coursesResults.filter(isValidCourse);
}

export async function getUserTemplatesWithCourses(userId: string) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan) return [];

  // Get templates selected by user
  const selectedTemplates = await db
    .select({
      templateId: planTemplates.templateId,
    })
    .from(planTemplates)
    .innerJoin(templates, eq(templates.id, planTemplates.templateId))
    .where(eq(planTemplates.planId, userPlan.id))
    .orderBy(templates.name);

  // Get details for each template
  const templateDetails = await Promise.all(
    selectedTemplates.map(t => getTemplateDetails(t.templateId))
  );

  return templateDetails.filter((t): t is NonNullable<typeof t> => t !== null);
}

/**
 * Updates a free course selection for a user
 */
export async function updateFreeCourse(userId: string, courseItemId: string, filledCourseId: string | null) {
  if (filledCourseId === null) {
    // Delete the free course from table
    await db
      .delete(freeCourses)
      .where(and(
        eq(freeCourses.userId, userId),
        eq(freeCourses.courseItemId, courseItemId)
      ));
  } else {
    // Insert or update the free course selection
    await db
      .insert(freeCourses)
      .values({
        userId,
        courseItemId,
        filledCourseId
      })
      .onConflictDoUpdate({
        target: [freeCourses.userId, freeCourses.courseItemId],
        set: { filledCourseId },
      });
  }
}

// Add this new function to create templates
export async function createTemplate(input: CreateTemplateInput) {
  return await db.transaction(async (tx) => {
    // Insert the template first
    const [template] = await tx
      .insert(templates)
      .values({
        name: input.name,
        description: input.description,
      })
      .returning();

    if (!template) {
      tx.rollback();
      throw new Error("Failed to create template");
    }

    // Insert all template items

    for (const item of input.items) {
      const insertedTemplateItem = await tx
        .insert(templateItems)
        .values({
          templateId: template.id,
          type: item.type,
          description: 'description' in item ? item.description ?? null : null,
          orderIndex: item.orderIndex,
        })
        .returning({
          id: templateItems.id,
        });
      if ((insertedTemplateItem.length !== 1) || !insertedTemplateItem[0]) {
        tx.rollback();
        throw new Error("Failed to create template item");
      }
      const templateItemId = insertedTemplateItem[0].id;
      if (item.type === "requirement") {
        if (item.courseType == "fixed") {
          for (const courseCode of item.courses) {
            const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.code, courseCode)).limit(1);
            const courseId = course?.id;
            if (!courseId) {
              tx.rollback();
              throw new Error(`Course with code ${courseCode} not found`);
            }
            const insertedCourse = await tx
              .insert(courseItems)
              .values({
                requirementId: templateItemId,
                courseId,
                type: item.courseType
              })
              .returning();
            if (insertedCourse.length !== 1) {
              tx.rollback()
              throw new Error("Failed to create course item");
            }
          }
        } else if (item.courseType == "free" && item.courseCount) {
          // Free courses
          for (let i = 0; i < item.courseCount; i++) {
            const insertedCourse = await tx
              .insert(courseItems)
              .values({
                requirementId: templateItemId,
                type: item.courseType
              })
              .returning();
            if (insertedCourse.length !== 1) {
              tx.rollback()
              throw new Error("Failed to create course item");
            }
          }
        }
      }

    }
  });
}

