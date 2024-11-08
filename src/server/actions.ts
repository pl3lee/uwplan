'use server';

import { revalidatePath } from 'next/cache';
import { toggleUserTemplate } from '@/server/db/queries';

export async function toggleTemplate(userId: string, templateId: number) {
  await toggleUserTemplate(userId, templateId);
  revalidatePath('/select');
}
