'use server';

import { revalidatePath } from 'next/cache';
import { createTemplate, removeCourseSelection, toggleCourseSelection, toggleUserTemplate } from '@/server/db/queries';
import { updateFreeCourse as dbUpdateFreeCourse } from "@/server/db/queries";
import { auth } from './auth';
import { CreateTemplateInput } from '@/types/template';


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

export async function toggleCourse(courseItemId: string, take: boolean) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  console.log("courseItemId", courseItemId);
  await toggleCourseSelection(session.user.id, courseItemId, take);
  revalidatePath('/select');
}

export async function removeCourse(courseId: string) {
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
