'use server';

import { revalidatePath } from 'next/cache';
import { toggleCourseSelection, toggleUserTemplate } from '@/server/db/queries';
import { updateFreeCourse as dbUpdateFreeCourse } from "@/server/db/queries";
import { auth } from './auth';

export async function toggleTemplate(templateId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await toggleUserTemplate(session?.user.id, templateId);
  revalidatePath('/select');
}

export async function updateFreeCourse(courseItemId: string, filledCourseId: string) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  await dbUpdateFreeCourse(session?.user.id, courseItemId, filledCourseId);
  revalidatePath('/select');
}

export async function toggleCourse(courseId: string, take: boolean) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }

  await toggleCourseSelection(session.user.id, courseId, take);
  revalidatePath('/select');
}
