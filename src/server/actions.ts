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

// const templateItemSchema = z.discriminatedUnion('type', [
//   z.object({
//     type: z.literal('instruction'),
//     description: z.string().min(1),
//     orderIndex: z.number(),
//   }),
//   z.object({
//     type: z.literal('separator'),
//     orderIndex: z.number(),
//   }),
//   z.object({
//     type: z.literal('requirement'),
//     description: z.string().min(1),
//     orderIndex: z.number(),
//     courseType: z.enum(['fixed', 'free']),
//     courses: z.array(z.string()),
//   }),
// ]);

// const createTemplateSchema = z.object({
//   name: z.string().min(1),
//   description: z.string().optional(),
//   items: z.array(templateItemSchema),
// });

// export async function createTemplateAction(input: z.infer<typeof createTemplateSchema>) {
//   const session = await auth();
//   if (!session?.user) {
//     throw new Error('Not authenticated');
//   }

//   const validatedInput = createTemplateSchema.parse(input);
//   await createTemplate(validatedInput);
//   revalidatePath('/create/template');
// }

export async function createTemplateAction() {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }


  revalidatePath('/select');
}
