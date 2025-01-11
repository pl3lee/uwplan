'use server';

import { revalidatePath } from 'next/cache';
import { addCourseToSchedule, changeScheduleName, changeTermRange, createSchedule, createTemplate, deleteSchedule, getSchedules, removeCourseFromSchedule, removeCourseSelection, toggleCourse, toggleUserTemplate, validateScheduleId, updateFreeCourse, getRole, deleteTemplate, getSelectedCourses, getScheduleCourses, templateNameExists, getTemplate, renameTemplate, getTemplateWithName } from '@/server/db/queries';
import { auth } from './auth';
import { type CreateTemplateInput } from '@/types/template';
import { type Season } from '@/types/schedule';


export async function toggleUserTemplateAction(templateId: string, take: boolean) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await toggleUserTemplate(session?.user.id, templateId, take);
    revalidatePath('/select');
  } catch (error) {
    console.error('Failed to toggle academic plan', error);
    throw new Error('Failed to toggle academic plan');
  }
}

export async function updateFreeCourseAction(courseItemId: string, filledCourseId: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await updateFreeCourse(session?.user.id, courseItemId, filledCourseId);
    revalidatePath('/select');
  } catch (error) {
    console.error('Failed to update free course', error);
    throw new Error('Failed to update free course');
  }
}

export async function toggleCourseAction(courseItemId: string, take: boolean) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await toggleCourse(session.user.id, courseItemId, take);
    revalidatePath('/select');
  } catch (error) {
    console.error('Failed to toggle course', error);
    throw new Error('Failed to toggle course');
  }
}

export async function removeCourseSelectionAction(courseId: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await removeCourseSelection(session.user.id, courseId);
    revalidatePath('/select');
  } catch (error) {
    console.error('Failed to remove course selection', error);
    throw new Error('Failed to remove course selection');
  }

}

// returns false if the template name is already in use
// returns true if the template name is not in use
export async function createTemplateAction(template: CreateTemplateInput) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    const templateExists = await templateNameExists(template.name);
    if (templateExists) {
      throw new Error('Academic plan name already exists');
    } else {
      await createTemplate(template, session.user.id);
      revalidatePath('/select');
    }
  } catch (error) {
    console.error("Failed to create academic plan", error);
    if (error instanceof Error) {
      return { error: { message: error.message }}
    } else {
      return { error: { message: 'Failed to create academic plan' }}
    }
  }
}

export async function deleteTemplateAction(templateId: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    const role = await getRole(session.user.id);
    const template = await getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    // admin
    if (role === 'admin') {
      await deleteTemplate(templateId);
      revalidatePath('/admin');
      revalidatePath('/manage/template');
      return;
    }

    // Non-admin can only modify their own templates
    if (!template.createdBy || template.createdBy !== session.user.id) {
      throw new Error('Not authorized');
    }

    await deleteTemplate(templateId);
    revalidatePath('/admin');
    revalidatePath('/manage/template');
  } catch (error) {
    console.error("Failed to delete academic plan", error);
    if (error instanceof Error) {
      return { error: { message: error.message }}
    } else {
      return { error: { message: 'Failed to delete academic plan' }}
    }
  }

}

export async function renameTemplateAction(templateId: string, name: string, description: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    const role = await getRole(session.user.id);
    const template = await getTemplate(templateId);
    const existingTemplate = await getTemplateWithName(name);
    if (existingTemplate && existingTemplate.id !== templateId) {
      throw new Error('Academic plan name already exists');
    }
    // admin
    if (role === 'admin') {
      await renameTemplate(templateId, name, description);
      revalidatePath('/admin');
      revalidatePath('/manage/template');
      return;
    }

    // Non-admin can only modify their own templates
    if (!template.createdBy || template.createdBy !== session.user.id) {
      throw new Error('Not authorized');
    }

    await renameTemplate(templateId, name, description);
    revalidatePath('/admin');
    revalidatePath('/manage/template');
  } catch (error) {
    console.error("Failed to rename academic plan", error);
    if (error instanceof Error) {
      return { error: { message: error.message }}
    } else {
      return { error: { message: 'Failed to rename academic plan' }}
    }
  }
}

export async function createScheduleAction(name: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await createSchedule(session.user.id, name);
    revalidatePath('/schedule');
  } catch (error) {
    console.error('Failed to create schedule', error);
    throw new Error('Failed to create schedule');
  }
}

export async function addCourseToScheduleAction(scheduleId: string, courseId: string, term: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await addCourseToSchedule(scheduleId, courseId, term);
    revalidatePath('/schedule');
  } catch (error) {
    console.error("Failed to add course to term", error);
    throw new Error('Failed to add course to term');
  }
}

export async function removeCourseFromScheduleAction(scheduleId: string, courseId: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await removeCourseFromSchedule(scheduleId, courseId);
    revalidatePath('/schedule');
  } catch (error) {
    console.error("Failed to remove course from term", error);
  }
}

export async function changeScheduleNameAction(scheduleId: string, name: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    const hasAccess = await validateScheduleId(session.user.id, scheduleId);
    if (!hasAccess) {
      throw new Error('You do not have access to this schedule');
    }
    if (name.length === 0) {
      throw new Error('Name cannot be empty');
    }
    await changeScheduleName(scheduleId, name);
    revalidatePath('/schedule');
  } catch (error) {
    console.error('Failed to change schedule name', error);
    throw new Error('Failed to change schedule');
  }

}

export async function deleteScheduleAction(scheduleId: string) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    const hasAccess = await validateScheduleId(session.user.id, scheduleId);
    if (!hasAccess) {
      throw new Error('You do not have access to this schedule');
    }
    // there must be at least one schedule for a plan
    const schedules = await getSchedules(session.user.id);
    if (schedules.length === 1) {
      throw new Error('Cannot delete the only schedule for a plan');
    }
    await deleteSchedule(scheduleId);
    revalidatePath('/schedule');
  } catch (error) {
    console.error('Failed to delete schedule', error);
    throw new Error('Failed to delete schedule');
  }

}

export async function changeTermRangeAction(startTerm: Season, startYear: number, endTerm: Season, endYear: number) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }
    await changeTermRange(session.user.id, startTerm, startYear, endTerm, endYear);
    revalidatePath('/schedule');
  } catch (error) {
    console.error('Failed to change term range', error);
    throw new Error('Failed to change term range');
  }

}



export async function exportScheduleToCSV(scheduleId: string) {
  try {
    const session = await auth()
    if (!session?.user) {
      throw new Error('Not authenticated')
    }

    const selectedCourses = await getSelectedCourses(session.user.id)
    const scheduledCourses = await getScheduleCourses(scheduleId)

    // Helper function to escape CSV field
    const escapeField = (field: string) => {
      if (field.includes(',') || field.includes('"')) {
        return `"${field.replace(/"/g, '""')}"`
      }
      return field
    }

    const coursesByTerm = new Map<string, string[]>();

    for (const course of scheduledCourses) {
      if (!course.term) continue;
      if (!coursesByTerm.has(course.term)) {
        coursesByTerm.set(course.term, []);
      }
      coursesByTerm.get(course.term)?.push(escapeField(`${course.courseCode}`));
    }

    let csvContent = 'Selected Courses:\n'
    selectedCourses.forEach(course => {
      csvContent += escapeField(`${course.courseCode} - ${course.courseName}`) + '\n'
    })

    csvContent += '\nScheduled Courses:\n'

    const maxCourses = Math.max(...Array.from(coursesByTerm.values()).map(courses => courses.length))
    csvContent += Array.from(coursesByTerm.keys()).map(escapeField).join(',') + '\n'

    for (let i = 0; i < maxCourses; i++) {
      const row = Array.from(coursesByTerm.values()).map(courses => courses[i] ?? '').join(',')
      csvContent += row + '\n'
    }

    return csvContent
  } catch (error) {
    console.error('Failed to export schedule to CSV', error);
    throw new Error('Failed to export schedule');
  }

}