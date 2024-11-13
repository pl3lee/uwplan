'use server';

import { revalidatePath } from 'next/cache';
import { toggleCourseSelection, toggleUserTemplate, createTemplate } from '@/server/db/queries';
import { updateFreeCourse as dbUpdateFreeCourse } from "@/server/db/queries";
import { auth } from './auth';
import { z } from 'zod';

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

  await createTemplate({
    name: "Computer Science (BMath)",
    description: "The standard Computer Science program for Bachelor of Mathematics students.",
    items: [
      {
        type: "instruction",
        description: "Complete all of the following",
        orderIndex: 0
      },
      {
        type: "requirement",
        description: "Complete all the following:",
        orderIndex: 1,
        courseType: "fixed",
        courses: ["CS136L", "CS341", "CS350"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 2,
        courseType: "fixed",
        courses: ["AMATH242", "CS370", "CS371"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 3,
        courseType: "fixed",
        courses: ["CS240", "CS240E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 4,
        courseType: "fixed",
        courses: ["CS241", "CS241E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 5,
        courseType: "fixed",
        courses: ["CS246", "CS246E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 6,
        courseType: "fixed",
        courses: ["CS251", "CS251E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 7,
        courseType: "fixed",
        courses: ["CS360", "CS365"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 8,
        courseType: "fixed",
        courses: ["MATH237", "MATH247"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 9,
        courseType: "fixed",
        courses: ["MATH239", "MATH249"]
      },
      {
        type: "requirement",
        description: "Complete 1 Complete 1 additional CS course chosen from CS340-CS398, CS440-CS489:",
        orderIndex: 10,
        courseType: "free",
        courses: [],
        courseCount: 1
      },
      {
        type: "requirement",
        description: "Complete 2 additional CS courses chosen from CS440-CS489.:",
        orderIndex: 11,
        courseType: "free",
        courses: [],
        courseCount: 2
      },
      {
        type: "requirement",
        description: "Complete 3 additional courses from: ACTSC, AMATH, CO, PMATH, STAT (see Additional Constraints):",
        orderIndex: 12,
        courseType: "free",
        courses: [],
        courseCount: 3
      }
    ]
  })
  revalidatePath('/select');
}
