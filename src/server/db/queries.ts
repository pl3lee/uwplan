import { db } from "@/server/db";
import {
  templates,
  plans,
  templateItems,
  templateRequirementCourses,
  selectedCourses,
  courses,
  planTemplates,
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
      templateId: planTemplates.templateId,
    })
    .from(planTemplates)
    .innerJoin(plans, eq(plans.id, planTemplates.planId))
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
export async function getTemplateDetails(templateId: number) {
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

  // Get courses for requirements
  const coursesForItems = await db
    .select({
      itemId: templateRequirementCourses.itemId,
      courseId: courses.id,
      code: courses.code,
      name: courses.name,
      usefulRating: courses.usefulRating,
      likedRating: courses.likedRating,
      easyRating: courses.easyRating,
      numRatings: courses.numRatings,
    })
    .from(templateRequirementCourses)
    .innerJoin(courses, eq(courses.id, templateRequirementCourses.courseId))
    .where(inArray(
      templateRequirementCourses.itemId,
      items.map(item => item.id)
    ));

  // Combine the data
  return {
    ...template,
    items: items.map(item => ({
      ...item,
      courses: coursesForItems
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
        }))
    }))
  };
}

/**
 * Gets all selected courses for a plan
 */
export async function getSelectedCourses(planId: number) {
  return await db
    .select({
      courseId: selectedCourses.courseId,
      selected: selectedCourses.selected,
    })
    .from(selectedCourses)
    .where(eq(selectedCourses.planId, planId));
}

/**
 * Toggles a course selection in a plan
 */
export async function toggleCourseSelection(planId: number, courseId: number, selected: boolean) {
  await db
    .insert(selectedCourses)
    .values({
      planId,
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
export async function addTemplateToPlan(planId: number, templateId: number) {
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
export async function removeTemplateFromPlan(planId: number, templateId: number) {
  // Get courses that are only in this template
  const templateCourses = await db
    .select({ courseId: templateRequirementCourses.courseId })
    .from(templateItems)
    .innerJoin(
      templateRequirementCourses,
      eq(templateRequirementCourses.itemId, templateItems.id)
    )
    .where(eq(templateItems.templateId, templateId));

  // Remove course selections for courses unique to this template
  await db
    .delete(selectedCourses)
    .where(and(
      eq(selectedCourses.planId, planId),
      inArray(
        selectedCourses.courseId,
        templateCourses.map(c => c.courseId)
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
