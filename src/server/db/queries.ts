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
  users, // Add import
} from "@/server/db/schema";
import { desc, eq, and, not, inArray } from "drizzle-orm";
import { type InferSelectModel } from 'drizzle-orm';

// Type definitions
type Course = InferSelectModel<typeof courses>;
type TemplateItem = InferSelectModel<typeof templateItems>;
type Template = InferSelectModel<typeof templates>;

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
    .where(eq(plans.userId, userId));
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
      itemId: courseItems.requirementId,
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
      eq(courseItems.type, "fixed")
    ));

  // Get free course items and their filled courses if any
  const freeCourseItems = await db
    .select({
      itemId: courseItems.requirementId,
      courseItemId: courseItems.id,
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

  // Combine the data
  return {
    ...template,
    items: items.map(item => ({
      ...item,
      fixedCourses: fixedCoursesForItems
        .filter(c => c.itemId === item.id)
        .map(c => ({
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
        .filter(c => c.itemId === item.id)
        .map(c => ({
          courseItemId: c.courseItemId,
          course: c.filledCourseId ? {
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
 * Gets all selected courses for a user
 */
export async function getSelectedCourses(userId: string) {
  return await db
    .select({
      courseId: selectedCourses.courseId
    })
    .from(selectedCourses)
    .innerJoin(plans, eq(plans.id, selectedCourses.planId))
    .innerJoin(users, eq(users.id, plans.userId))
    .where(and(eq(users.id, userId), eq(selectedCourses.selected, true)));
}

/**
 * Toggles a course selection for a user
 */
export async function toggleCourseSelection(userId: string, courseId: string, selected: boolean) {
  const userPlan = await getOrCreateUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get or create plan for user ${userId}`);
  }
  console.log("Toggling course selection", userId, courseId, selected);
  await db
    .insert(selectedCourses)
    .values({
      planId: userPlan.id,
      courseId,
      selected,
    })
    .onConflictDoUpdate({
      target: [selectedCourses.planId, selectedCourses.courseId],
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
  // Get courses that are only in this template
  const templateCourses = await db
    .select({ courseId: courseItems.courseId })
    .from(templateItems)
    .innerJoin(
      courseItems,
      eq(courseItems.requirementId, templateItems.id)
    )
    .where(and(eq(templateItems.templateId, templateId), eq(courseItems.type, "fixed")));

  // Remove course selections for courses unique to this template
  await db
    .delete(selectedCourses)
    .where(and(
      eq(selectedCourses.planId, planId),
      inArray(
        selectedCourses.courseId,
        templateCourses.map(c => c.courseId).filter((id): id is string => id !== null)
      )
    ));

  // Remove template from plan
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

export async function getCoursesWithRatings() {
  return await db
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
    .where(eq(planTemplates.planId, userPlan.id));

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
    // Remove the free course selection
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

