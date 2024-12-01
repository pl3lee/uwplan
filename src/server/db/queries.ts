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
  schedules,
  scheduleCourses,
  userTermRanges,
} from "@/server/db/schema";
import { type Season } from "@/types/schedule";
import { type InstructionItem, type RequirementItem, type SeparatorItem, type CreateTemplateInput } from "@/types/template";
import { eq, and, inArray, isNotNull } from "drizzle-orm";



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
      courseCode: courses.code,
      courseName: courses.name
    })
    .from(selectedCourses)
    .innerJoin(plans, eq(plans.id, selectedCourses.planId))
    .innerJoin(courseItems, eq(courseItems.id, selectedCourses.courseItemId))
    .innerJoin(users, eq(users.id, plans.userId))
    .innerJoin(courses, eq(courses.id, courseItems.courseId))
    .where(and(
      eq(users.id, userId),
      eq(selectedCourses.selected, true),
    ));
}

// Add this type export
export type SelectedCourses = Awaited<ReturnType<typeof getSelectedCourses>>;

/**
 * Toggles a course item selection for a user
 */
export async function toggleCourse(userId: string, courseItemId: string, selected: boolean) {
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
 * Removes all instances of courseId from a user's selected courses
 */
export async function removeCourseSelection(userId: string, courseId: string) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get plan for user ${userId}`);
  }

  try {
    // Find all course items that contain this course
    const courseItemsToUnselect = await db
      .select({
        courseItemId: courseItems.id,
      })
      .from(courseItems)
      .where(eq(courseItems.courseId, courseId));


    // Remove selections for all instances of this course
    await db
      .delete(selectedCourses)
      .where(and(
        eq(selectedCourses.planId, userPlan.id),
        inArray(
          selectedCourses.courseItemId,
          courseItemsToUnselect.map(item => item.courseItemId)
        )
      ));

    // find all user schedules
    const userSchedules = await getSchedules(userId)
    const userSchedulesIds = userSchedules.map(schedule => schedule.id)
    // Remove course from all user schedules
    await db
      .delete(scheduleCourses)
      .where(and(
        inArray(scheduleCourses.scheduleId, userSchedulesIds),
        eq(scheduleCourses.courseId, courseId)
      ))
  } catch (e) {
    console.error("Failed to remove course selection", e);
  }
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
 * Removes a template from a plan
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
    await db
      .update(courseItems)
      .set({ courseId: filledCourseId })
      .where(eq(courseItems.id, courseItemId));
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

export async function getSchedules(userId: string) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan) return [];

  const userSchedules = await db
    .select({
      id: schedules.id,
      name: schedules.name,
    })
    .from(schedules)
    .where(eq(schedules.planId, userPlan.id))

  return userSchedules;
}

/**
 * Gets courses that are in a schedule
 */
export async function getScheduleCourses(scheduleId: string) {
  return await db
    .select({
      courseId: scheduleCourses.courseId,
      term: scheduleCourses.term,
      courseCode: courses.code,
      courseName: courses.name,
    })
    .from(scheduleCourses)
    .innerJoin(courses, eq(courses.id, scheduleCourses.courseId))
    .where(eq(scheduleCourses.scheduleId, scheduleId));
}

export async function createSchedule(userId: string, name: string) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get plan for user ${userId}`);
  }

  await db
    .insert(schedules)
    .values({
      planId: userPlan.id,
      name,
    });
}

export async function addCourseToSchedule(scheduleId: string, courseId: string, term: string) {
  await db
    .insert(scheduleCourses)
    .values({
      term,
      scheduleId,
      courseId,
    })
    .onConflictDoUpdate({
      target: [scheduleCourses.scheduleId, scheduleCourses.courseId],
      set: { term },
    })
}

export async function removeCourseFromSchedule(scheduleId: string, courseId: string) {
  await db
    .delete(scheduleCourses)
    .where(and(
      eq(scheduleCourses.scheduleId, scheduleId),
      eq(scheduleCourses.courseId, courseId)
    ));
}

// validates that user has access to the schedule
export async function validateScheduleId(userId: string, scheduleId: string) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get plan for user ${userId}`);
  }

  const [schedule] = await db
    .select()
    .from(schedules)
    .where(and(
      eq(schedules.id, scheduleId),
      eq(schedules.planId, userPlan.id)
    ))
    .limit(1);

  if (!schedule) {
    return false;
  } else {
    return true;
  }
}

export async function changeScheduleName(scheduleId: string, name: string) {
  await db
    .update(schedules)
    .set({ name })
    .where(eq(schedules.id, scheduleId));
}

export async function deleteSchedule(scheduleId: string) {
  await db
    .delete(schedules)
    .where(eq(schedules.id, scheduleId));
}

export async function changeTermRange(userId: string, startTerm: Season, startYear: number, endTerm: Season, endYear: number) {
  await db
    .update(userTermRanges)
    .set({
      startTerm,
      startYear,
      endTerm,
      endYear,
    })
    .where(eq(userTermRanges.userId, userId));
}

export async function getTermRange(userId: string) {
  const [termRange] = await db
    .select()
    .from(userTermRanges)
    .where(eq(userTermRanges.userId, userId))
    .limit(1);
  if (!termRange) {
    throw new Error(`Failed to get term range for user ${userId}`);
  }
  return termRange
}

export type TermRange = Awaited<ReturnType<typeof getTermRange>>;