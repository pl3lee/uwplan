import { db } from "@/server/db";
import {
  courseItems,
  courses,
  freeCourses,
  plans,
  planTemplates,
  scheduleCourses,
  schedules,
  selectedCourses,
  templateItems,
  templates,
  users,
  userTermRanges,
} from "@/server/db/schema";
import { type Season } from "@/types/schedule";
import { type CreateTemplateInput } from "@/types/template";
import { and, eq, inArray, or } from "drizzle-orm";
import { cache } from "react";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Type guard to check if a course object has valid code and name
 * @param course - Object containing course data
 * @returns True if course has valid code and name
 */
function isValidCourse(course: { code: string | null; name: string | null; }): course is { code: string; name: string; } {
  return course.code !== null && course.name !== null;
}

// ============================================================================
// User Management
// ============================================================================

/**
 * Retrieves all users
 * @returns Array of user objects
 */
export async function getUsers() {
  try {
    return await db
      .select()
      .from(users)
  } catch (error) {
    console.error("Failed to get users:", error);
    throw new Error("Failed to get users");
  }
}

/**
 * Gets the user's role
 * @param userId - ID of the user
 * @returns User's role or undefined if not found
 */
export const getRole = cache(async (userId: string) => {
  try {
    const [role] = await db
      .select({
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!role) {
      await db.update(users).set({ role: "user" }).where(eq(users.id, userId));
      return "user";
    }
    return role.role;
  } catch (error) {
    console.error("Failed to get role:", error);
    throw new Error("Failed to get role");
  }
});

// ============================================================================
// Plan Management
// ============================================================================

/**
 * Gets a user's plan. Each user has exactly one plan as per architecture
 * @param userId - ID of the user
 * @returns User's plan object or undefined if not found
 */
export const getUserPlan = cache(async (userId: string) => {
  try {
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
  } catch (error) {
    console.error("Failed to get or create user plan:", error);
    throw new Error("Failed to get or create user plan");
  }
})

// ============================================================================
// Template Management
// ============================================================================

/**
 * Retrieves all available academic plan templates
 * @returns Array of template objects containing id, name and description
 */
export async function getTemplates() {
  try {
    return await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        createdBy: templates.createdBy,
      })
      .from(templates)
      .orderBy(templates.name);
  } catch (error) {
    console.error("Failed to get templates:", error);
    throw new Error("Failed to get templates");
  }
}

/**
 * Retrieves template
 * @param templateId - ID of the template
 * @returns Array of template objects containing id, name and description
 */
export async function getTemplate(templateId: string) {
  try {
    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);
    if (!template) {
      throw new Error(`Template with ID ${templateId} not found`);
    }
    return template
  } catch (error) {
    console.error("Failed to get template:", error);
    throw new Error("Failed to get template");
  }
}

/**
 * Retrieves all templates with a specific name
 * @returns Template object or undefined
 */
export async function getTemplateWithName(name: string) {
  try {
    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.name, name));
    return template;
  } catch (error) {
    console.error("Failed to get templates with name:", error);
    throw new Error("Failed to get templates with name");
  }
}

/**
 * Checks if a template name already exists
 * @returns True if the name exists, false otherwise
 */
export async function templateNameExists(name: string) {
  try {
    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.name, name))
      .limit(1);
    if (template) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Failed to check if template name exists:", error);
    throw new Error("Failed to check if template name exists");
  }
}

/**
 * Gets all templates linked to a user's plan
 * @param userId - ID of the user
 * @returns Array of template objects with name, id and description
 */
export async function getUserSelectedTemplates(userId: string) {
  try {
    return await db
      .select({
        name: templates.name,
        id: planTemplates.templateId,
        description: templates.description,
        createdBy: templates.createdBy,
      })
      .from(planTemplates)
      .innerJoin(plans, eq(plans.id, planTemplates.planId))
      .where(eq(plans.userId, userId))
      .innerJoin(templates, eq(templates.id, planTemplates.templateId));
  } catch (error) {
    console.error("Failed to get user selected templates:", error);
    throw new Error("Failed to get user selected templates");
  }
}

/**
 * Gets all templates created by a user
 * @param userId - ID of the user
 */
export async function getTemplatesCreatedByUser(userId: string) {
  try {
    return await db
      .select()
      .from(templates)
      .where(eq(templates.createdBy, userId));
  } catch (error) {
    console.error("Failed to get templates created by user:", error);
    throw new Error("Failed to get templates created by user");
  }
}

/**
 * Gets detailed information about a template including all its items and courses
 * @param userId - ID of the user
 * @param templateId - ID of the template
 * @returns Template object with detailed items and courses or null if not found
 */
export async function getTemplateDetails(userId: string, templateId: string) {
  try {
    const [[template], items] = await Promise.all([
      // Get template
      db
        .select()
        .from(templates)
        .where(eq(templates.id, templateId))
        .limit(1),
      // Get template items
      db
        .select()
        .from(templateItems)
        .where(eq(templateItems.templateId, templateId))
        .orderBy(templateItems.orderIndex)
    ])

    if (!template) return null;

    const [fixedCourseItems, freeCourseItems] = await Promise.all([
      // Get fixed course items with details
      db
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
          description: courses.description,
          antireqs: courses.antireqs,
          prereqs: courses.prereqs,
          coreqs: courses.coreqs,
        })
        .from(courseItems)
        .where(and(
          inArray(courseItems.requirementId, items.map(item => item.id)),
          eq(courseItems.type, "fixed"),
        ))
        .innerJoin(courses, eq(courses.id, courseItems.courseId)),
      // Get free course items and their filled courses if any
      db
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
          description: courses.description,
          antireqs: courses.antireqs,
          prereqs: courses.prereqs,
          coreqs: courses.coreqs,
        })
        .from(courseItems)
        .where(and(
          inArray(courseItems.requirementId, items.map(item => item.id)),
          eq(courseItems.type, "free")
        ))
        .leftJoin(freeCourses, and(
          eq(freeCourses.courseItemId, courseItems.id),
          eq(freeCourses.userId, userId)
        ))
        .leftJoin(courses, eq(courses.id, freeCourses.filledCourseId))
    ])

    // Combine the data and filter out invalid courses
    return {
      ...template,
      items: items.map(item => ({
        ...item,
        fixedCourses: fixedCourseItems
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
              description: c.description,
              antireqs: c.antireqs,
              prereqs: c.prereqs,
              coreqs: c.coreqs,
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
              numRatings: c.numRatings,
              description: c.description ?? '',
              antireqs: c.antireqs ?? '',
              prereqs: c.prereqs ?? '',
              coreqs: c.coreqs ?? '',
            } : null
          }))
      }))
    };
  } catch (error) {
    console.error("Failed to get template details:", error);
    throw new Error("Failed to get template details");
  }
}

/**
 * Creates a new academic plan template
 * @param input - Template creation input data
 * @param userId - ID of the user creating the template
 * @returns Created template object
 */
export async function createTemplate(input: CreateTemplateInput, userId: string | null) {
  try {
    return await db.transaction(async (tx) => {
      // Insert the template first
      const [template] = await tx
        .insert(templates)
        .values({
          name: input.name,
          description: input.description,
          createdBy: userId ?? null,
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
  } catch (error) {
    console.error("Failed to create template:", error);
    throw new Error("Failed to create template");
  }
}

/**
 * Deletes a template
 * @param templateId - ID of the template to delete
 */
export async function deleteTemplate(templateId: string) {
  try {
    await db
      .delete(templates)
      .where(eq(templates.id, templateId));
  } catch (error) {
    console.error("Failed to delete template:", error);
    throw new Error("Failed to delete template");
  }
}

/**
 * Renames a template, including its description
 * @param templateId - ID of the template to delete
 */
export async function renameTemplate(templateId: string, name: string, description: string) {
  try {
    await db
      .update(templates)
      .set({ name, description })
      .where(eq(templates.id, templateId));
  } catch (error) {
    console.error("Failed to rename template:", error);
    throw new Error("Failed to rename template");
  }
}

// ============================================================================
// Template-Plan Relations
// ============================================================================

/**
 * Links a template to a plan
 * @param planId - ID of the plan
 * @param templateId - ID of the template
 */
export async function addTemplateToPlan(planId: string, templateId: string) {
  try {
    await db
      .insert(planTemplates)
      .values({
        planId,
        templateId,
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error("Failed to add template to plan:", error);
    throw new Error("Failed to add template to plan");
  }

}

/**
 * Removes a template from a plan
 * @param planId - ID of the plan
 * @param templateId - ID of the template
 */
export async function removeTemplateFromPlan(planId: string, templateId: string) {
  try {
    await db.transaction(async (tx) => {
      const courseItemsInTemplate = tx
        .select({ id: courseItems.id })
        .from(courseItems)
        .innerJoin(templateItems, eq(templateItems.id, courseItems.requirementId))
        .where(eq(templateItems.templateId, templateId))

      await Promise.all([
        tx
          .delete(planTemplates)
          .where(and(
            eq(planTemplates.planId, planId),
            eq(planTemplates.templateId, templateId)
          )),
        tx
          .update(selectedCourses)
          .set({ selected: false })
          .where(and(
            eq(selectedCourses.planId, planId),
            inArray(selectedCourses.courseItemId, courseItemsInTemplate)
          ))
      ])
    });
  } catch (error) {
    console.error("Failed to remove template from plan:", error);
    throw new Error("Failed to remove template from plan");
  }
}

/**
 * Toggles a template selection for a user
 * @param userId - ID of the user
 * @param templateId - ID of the template to toggle
 */
export async function toggleUserTemplate(userId: string, templateId: string, take: boolean) {
  try {
    const userPlan = await getUserPlan(userId);
    if (!userPlan) {
      throw new Error(`Failed to get or create plan for user ${userId}`);
    }

    const planId = userPlan.id;

    if (!take) {
      await removeTemplateFromPlan(planId, templateId);
    } else {
      await addTemplateToPlan(planId, templateId);
    }
  } catch (error) {
    console.error("Failed to toggle user template:", error);
    throw new Error("Failed to toggle user template");
  }
}

/**
 * Gets all templates selected by a user with associated courses
 * @param userId - ID of the user
 * @returns Array of templates with course information
 */
export async function getUserTemplatesWithCourses(userId: string) {
  try {
    const userPlan = await getUserPlan(userId);
    if (!userPlan) return [];

    // Get templates selected by user
    const selectedTemplates = await db
      .select({
        templateId: planTemplates.templateId,
      })
      .from(planTemplates)
      .where(eq(planTemplates.planId, userPlan.id))
      .innerJoin(templates, eq(templates.id, planTemplates.templateId))


    // Get details for each template
    const templateDetails = await Promise.all(
      selectedTemplates.map(t => getTemplateDetails(userId, t.templateId))
    );

    return templateDetails.filter((t): t is NonNullable<typeof t> => t !== null);
  } catch (error) {
    console.error("Failed to get user templates with courses:", error);
    throw new Error("Failed to get user templates with courses");
  }
}

// ============================================================================
// Course Selection & Management
// ============================================================================

/**
 * Gets all courses with their associated ratings
 * @returns Array of course objects with rating information
 */
export const getCoursesWithRatings = cache(async () => {
  try {
    const coursesResults = await db
      .select({
        id: courses.id,
        code: courses.code,
        name: courses.name,
        usefulRating: courses.usefulRating,
        likedRating: courses.likedRating,
        easyRating: courses.easyRating,
        numRatings: courses.numRatings,
        description: courses.description,
        antireqs: courses.antireqs,
        prereqs: courses.prereqs,
        coreqs: courses.coreqs,
      })
      .from(courses)
      .orderBy(courses.code);

    return coursesResults.filter(isValidCourse);
  } catch (error) {
    console.error("Failed to get courses with ratings:", error);
    throw new Error("Failed to get courses with ratings");
  }
})

/**
 * Gets all selected course items for a user
 * @param userId - ID of the user
 * @returns Array of selected course objects
 */
export async function getSelectedCourses(userId: string) {
  try {
    const userPlan = await getUserPlan(userId);
    if (!userPlan) throw new Error(`Failed to get plan for user ${userId}`);

    return await db
      .select({
        courseItemId: selectedCourses.courseItemId,
        courseId: courses.id,
        courseCode: courses.code,
        courseName: courses.name,
        courseDescription: courses.description,
        courseAntireqs: courses.antireqs,
        coursePrereqs: courses.prereqs,
        courseCoreqs: courses.coreqs
      })
      .from(selectedCourses)
      .where(and(eq(selectedCourses.planId, userPlan.id), eq(selectedCourses.selected, true)))
      .innerJoin(courseItems, eq(courseItems.id, selectedCourses.courseItemId))
      .leftJoin(freeCourses, and(
        eq(freeCourses.courseItemId, courseItems.id),
        eq(freeCourses.userId, userId)
      ))
      .leftJoin(courses, or(
        and(eq(courseItems.type, "fixed"), eq(courses.id, courseItems.courseId)),
        and(eq(courseItems.type, "free"), eq(courses.id, freeCourses.filledCourseId))
      ));
  } catch (error) {
    console.error("Failed to get selected courses:", error);
    throw new Error("Failed to get selected courses");
  }
}

/**
 * Toggles a course item selection for a user
 * @param userId - ID of the user
 * @param courseItemId - ID of the course item
 * @param selected - Whether to select or deselect the course
 */
export async function toggleCourse(userId: string, courseItemId: string, selected: boolean) {
  try {
    const userPlan = await getUserPlan(userId);
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
  } catch (error) {
    console.error("Failed to toggle course:", error);
    throw new Error("Failed to toggle course");
  }
}

/**
 * Removes a course selection for a user
 * @param userId - ID of the user
 * @param courseId - ID of the course to remove
 */
export async function removeCourseSelection(userId: string, courseId: string) {
  const userPlan = await getUserPlan(userId);
  if (!userPlan) {
    throw new Error(`Failed to get plan for user ${userId}`);
  }

  try {
    // Find all course items that contain this course
    const courseItemsToUnselect = db
      .select({
        courseItemId: courseItems.id,
      })
      .from(courseItems)
      .leftJoin(freeCourses, and(
        eq(freeCourses.courseItemId, courseItems.id),
        eq(freeCourses.userId, userId)
      ))
      .where(or(
        and(eq(courseItems.type, "fixed"), eq(courseItems.courseId, courseId)),
        and(eq(courseItems.type, "free"), eq(freeCourses.filledCourseId, courseId))
      ));

    // find all user schedules
    const userSchedules = db
      .select({
        id: schedules.id,
      })
      .from(schedules)
      .where(eq(schedules.planId, userPlan.id))


    await db.transaction(async (tx) => {
      await Promise.all([
        // Remove selections for all instances of this course
        tx
          .delete(selectedCourses)
          .where(and(
            eq(selectedCourses.planId, userPlan.id),
            inArray(
              selectedCourses.courseItemId,
              courseItemsToUnselect
            )
          )),
        // Remove course from all user schedules
        tx
          .delete(scheduleCourses)
          .where(and(
            inArray(scheduleCourses.scheduleId, userSchedules),
            eq(scheduleCourses.courseId, courseId)
          ))
      ])
    })
  } catch (e) {
    console.error("Failed to remove course selection", e);
    throw new Error("Failed to remove course selection");
  }
}

/**
 * Updates a free course selection for a user
 * @param userId - ID of the user
 * @param courseItemId - ID of the course item
 * @param filledCourseId - ID of the selected course or null to clear selection
 */
export async function updateFreeCourse(userId: string, courseItemId: string, filledCourseId: string | null) {
  try {
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
  } catch (error) {
    console.error("Failed to update free course:", error);
    throw new Error("Failed to update free course");
  }
}

// ============================================================================
// Schedule Management
// ============================================================================

/**
 * Gets all schedules for a user
 * @param userId - ID of the user
 * @returns Array of schedule objects
 */
export async function getSchedules(userId: string) {
  try {
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
  } catch (error) {
    console.error("Failed to get schedules:", error);
    throw new Error("Failed to get schedules");
  }
}

/**
 * Gets all courses in a schedule
 * @param scheduleId - ID of the schedule
 * @returns Array of course objects in the schedule
 */
export async function getScheduleCourses(scheduleId: string) {
  try {
    return await db
      .select({
        courseId: scheduleCourses.courseId,
        term: scheduleCourses.term,
        courseCode: courses.code,
        courseName: courses.name,
        courseDescription: courses.description,
        courseAntireqs: courses.antireqs,
        coursePrereqs: courses.prereqs,
        courseCoreqs: courses.coreqs
      })
      .from(scheduleCourses)
      .where(eq(scheduleCourses.scheduleId, scheduleId))
      .innerJoin(courses, eq(courses.id, scheduleCourses.courseId));
  } catch (error) {
    console.error("Failed to get schedule courses:", error);
    throw new Error("Failed to get schedule courses");
  }
}

/**
 * Creates a new schedule for a user
 * @param userId - ID of the user
 * @param name - Name of the schedule
 */
export async function createSchedule(userId: string, name: string) {
  try {
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
  } catch (error) {
    console.error("Failed to create schedule:", error);
    throw new Error("Failed to create schedule");
  }
}

/**
 * Deletes a schedule
 * @param scheduleId - ID of the schedule to delete
 */
export async function deleteSchedule(scheduleId: string) {
  try {
    await db
      .delete(schedules)
      .where(eq(schedules.id, scheduleId));
  } catch (error) {
    console.error("Failed to delete schedule:", error);
    throw new Error("Failed to delete schedule");
  }
}

/**
 * Changes the name of a schedule
 * @param scheduleId - ID of the schedule
 * @param name - New name for the schedule
 */
export async function changeScheduleName(scheduleId: string, name: string) {
  try {
    await db
      .update(schedules)
      .set({ name })
      .where(eq(schedules.id, scheduleId));
  } catch (error) {
    console.error("Failed to change schedule name:", error);
    throw new Error("Failed to change schedule name");
  }
}

/**
 * Adds a course to a schedule in a specific term
 * @param scheduleId - ID of the schedule
 * @param courseId - ID of the course
 * @param term - Term to add the course to
 */
export async function addCourseToSchedule(scheduleId: string, courseId: string, term: string) {
  try {
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
      });
  } catch (error) {
    console.error("Failed to add course to schedule:", error);
    throw new Error("Failed to add course to schedule");
  }
}

/**
 * Removes a course from a schedule
 * @param scheduleId - ID of the schedule
 * @param courseId - ID of the course
 */
export async function removeCourseFromSchedule(scheduleId: string, courseId: string) {
  try {
    await db
      .delete(scheduleCourses)
      .where(and(
        eq(scheduleCourses.scheduleId, scheduleId),
        eq(scheduleCourses.courseId, courseId)
      ));
  } catch (error) {
    console.error("Failed to remove course from schedule:", error);
    throw new Error("Failed to remove course from schedule");
  }
}

/**
 * Validates that a user has access to a specific schedule
 * @param userId - ID of the user
 * @param scheduleId - ID of the schedule
 * @returns True if user has access, false otherwise
 */
export async function validateScheduleId(userId: string, scheduleId: string) {
  try {
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

    return !!schedule;
  } catch (error) {
    console.error("Failed to validate schedule access:", error);
    throw new Error("Failed to validate schedule access");
  }
}

// ============================================================================
// Term Range Management
// ============================================================================

/**
 * Gets a user's term range selection
 * @param userId - ID of the user
 * @returns Term range object
 * @throws Error if term range not found
 */
export async function getTermRange(userId: string) {
  try {
    const [termRange] = await db
      .select()
      .from(userTermRanges)
      .where(eq(userTermRanges.userId, userId))
      .limit(1);
    if (!termRange) {
      console.error(`Failed to get term range for user ${userId}`);
      throw new Error(`Failed to get term range for user ${userId}`);
    }
    return termRange;
  } catch (error) {
    console.error("Failed to get term range:", error);
    throw new Error("Failed to get term range");
  }
}

/**
 * Updates a user's term range selection
 * @param userId - ID of the user
 * @param startTerm - Starting term season
 * @param startYear - Starting year
 * @param endTerm - Ending term season
 * @param endYear - Ending year
 */
export async function changeTermRange(userId: string, startTerm: Season, startYear: number, endTerm: Season, endYear: number) {
  try {
    await db
      .update(userTermRanges)
      .set({
        startTerm,
        startYear,
        endTerm,
        endYear,
      })
      .where(eq(userTermRanges.userId, userId));
  } catch (error) {
    console.error("Failed to change term range:", error);
    throw new Error("Failed to change term range");
  }
}

// ============================================================================
// Function Return Types
// ============================================================================

export type SelectedCourses = Awaited<ReturnType<typeof getSelectedCourses>>;
export type TermRange = Awaited<ReturnType<typeof getTermRange>>;