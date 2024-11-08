import { db } from "@/server/db";
import { templates, userTemplates } from "@/server/db/schema";
import { desc, eq, and } from "drizzle-orm";

export async function getTemplates() {
  return await db
    .select({
      id: templates.id,
      name: templates.name,
    })
    .from(templates)
    .orderBy(templates.name);
}

export async function getUserTemplates(userId: string) {
  return await db
    .select({
      templateId: userTemplates.templateId,
    })
    .from(userTemplates)
    .where(eq(userTemplates.userId, userId));
}

export async function toggleUserTemplate(userId: string, templateId: number) {
  const exists = await db.query.userTemplates.findFirst({
    where: and(
      eq(userTemplates.userId, userId),
      eq(userTemplates.templateId, templateId),
    ),
  });

  if (exists) {
    await db
      .delete(userTemplates)
      .where(and(
        eq(userTemplates.userId, userId),
        eq(userTemplates.templateId, templateId),
      ));
  } else {
    await db.insert(userTemplates).values({
      userId,
      templateId,
    });
  }
}

export async function getUserTemplateDetails(userId: string) {
  const userSelectedTemplates = await db.query.userTemplates.findMany({
    where: eq(userTemplates.userId, userId),
    with: {
      template: {
        columns: {
          id: true,
          name: true,
        },
        with: {
          items: {
            columns: {
              id: true,
              type: true,
              description: true,
              orderIndex: true,
            },
            with: {
              courses: {
                with: {
                  course: true,
                },
              },
            },
            orderBy: (items) => [items.orderIndex],
          },
        },
      },
    },
  });

  return { templates: userSelectedTemplates, revalidated: Date.now() };
}
