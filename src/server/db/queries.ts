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
    .orderBy(desc(templates.id));
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
