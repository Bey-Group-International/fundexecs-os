import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { sanitizeBrandStudioDoc, type BrandStudioDoc } from '@/lib/brand-studio/persistence';

/**
 * The org's persisted Profile & Brand document. Request-cached; degrades to
 * the empty doc on failure.
 */
export const getBrandStudioDoc = cache(async (orgId: string): Promise<BrandStudioDoc> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('brand_studio')
    .select('data')
    .eq('org_id', orgId)
    .maybeSingle();
  return sanitizeBrandStudioDoc(data?.data);
});
