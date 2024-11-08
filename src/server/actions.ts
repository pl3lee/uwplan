"use server"

import { toggleUserTemplate } from "./db/queries";

export async function toggleTemplate(userId: string, templateId: number) {
  await toggleUserTemplate(userId, templateId);
}
