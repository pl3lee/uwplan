'use server';

import { revalidatePath } from 'next/cache';
import { addCourseToSchedule, changeScheduleName, changeTermRange, createSchedule, createTemplate, deleteSchedule, getSchedules, removeCourseFromSchedule, removeCourseSelection, toggleCourse, toggleUserTemplate, validateScheduleId, updateFreeCourse } from '@/server/db/queries';
import { auth } from './auth';
import { type CreateTemplateInput } from '@/types/template';
import { type Season } from '@/types/schedule';


export async function toggleUserTemplateAction(templateId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await toggleUserTemplate(session?.user.id, templateId);
  revalidatePath('/select');
}

export async function updateFreeCourseAction(courseItemId: string, filledCourseId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await updateFreeCourse(session?.user.id, courseItemId, filledCourseId);
  revalidatePath('/select');
}

export async function toggleCourseAction(courseItemId: string, take: boolean) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  console.log("courseItemId", courseItemId);
  await toggleCourse(session.user.id, courseItemId, take);
  revalidatePath('/select');
}

export async function removeCourseSelectionAction(courseId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await removeCourseSelection(session.user.id, courseId);
  revalidatePath('/select');
}

export async function createTemplateAction(template: CreateTemplateInput) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await createTemplate(template);


  revalidatePath('/select');
}

export async function createScheduleAction(name: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await createSchedule(session.user.id, name);


  revalidatePath('/schedule');
}

export async function addCourseToScheduleAction(scheduleId: string, courseId: string, term: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  try {
    await addCourseToSchedule(scheduleId, courseId, term);
  } catch (error) {
    console.error("Failed to add course to term", error);
  }
  revalidatePath('/schedule');
}

export async function removeCourseFromScheduleAction(scheduleId: string, courseId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  try {
    await removeCourseFromSchedule(scheduleId, courseId);
  } catch (error) {
    console.error("Failed to remove course from term", error);
  }
  revalidatePath('/schedule');
}

export async function changeScheduleNameAction(scheduleId: string, name: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  const hasAccess = await validateScheduleId(session.user.id, scheduleId);
  if (!hasAccess) {
    throw new Error('You do not have access to this schedule');
  }
  await changeScheduleName(scheduleId, name);
  revalidatePath('/schedule');
}

export async function deleteScheduleAction(scheduleId: string) {
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
}

export async function changeTermRangeAction(startTerm: Season, startYear: number, endTerm: Season, endYear: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await changeTermRange(session.user.id, startTerm, startYear, endTerm, endYear);
  revalidatePath('/schedule');
}