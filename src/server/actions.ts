'use server';

import { revalidatePath } from 'next/cache';
import { toggleUserTemplate } from '@/server/db/queries';
import { updateFreeCourse as dbUpdateFreeCourse } from "@/server/db/queries";

export async function toggleTemplate(userId: string, templateId: number) {
  await toggleUserTemplate(userId, templateId);
  revalidatePath('/select');
}

export async function updateFreeCourse(userId: string, courseItemId: number, filledCourseId: number) {
  await dbUpdateFreeCourse(userId, courseItemId, filledCourseId);
  revalidatePath('/select');
}

// export async function toggleCourse(userId: string, templateId: number, courseId: number, take: boolean) {
//   await toggleUserCourse(userId, templateId, courseId, take);
//   revalidatePath('/select');
// }
