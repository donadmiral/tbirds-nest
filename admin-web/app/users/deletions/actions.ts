'use server';
import { revalidatePath } from 'next/cache';
import { runErasureReview } from '@/lib/adminErasureReview';

export async function reviewErasure(form: FormData) {
  const result = await runErasureReview(form);
  if (result.success) revalidatePath('/users/deletions');
  return result;
}
