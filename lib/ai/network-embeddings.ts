import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts, toVectorLiteral } from './voyage';

/* ============================================================================
 * lib/ai/network-embeddings.ts — backfill semantic embeddings for the network.
 *
 * Activates the semantic half of LP & Partner search (`search_network`). The
 * search RPC blends pgvector cosine with keyword + filters, but the cosine term
 * only contributes once a row carries an embedding. This phase walks each of
 * the three network sources (contacts, service providers, capital providers),
 * finds rows that have no embedding yet, builds a compact natural-language
 * description per row, embeds the batch via Voyage, and writes the vector back.
 *
 * Never-block: without VOYAGE_API_KEY it is a no-op; a failure on one kind or
 * one row is isolated and the rest proceed. Runs under the service role on the
 * existing intelligence cron. Capped per run so a large network is embedded
 * incrementally across cycles rather than in one expensive burst.
 * ========================================================================= */

/** Loose update surface — the `embedding` column is additive, not in gen types. */
type EmbedDb = {
  from: (table: string) => {
    select: (cols: string) => {
      is: (
        col: string,
        val: null
      ) => {
        limit: (n: number) => Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

interface NetworkKindConfig {
  /** Source table. */
  table: string;
  /** Columns to pull for building the embedding text (id is always included). */
  columns: string;
  /** Build the natural-language description embedded for this row. */
  describe: (row: Record<string, unknown>) => string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const KINDS: NetworkKindConfig[] = [
  {
    table: 'contacts',
    columns: 'id, full_name, title, company',
    describe: (r) => {
      const name = str(r.full_name) || 'Unnamed contact';
      const title = str(r.title);
      const company = str(r.company);
      const role = [title, company].filter(Boolean).join(' at ');
      return role ? `${name}, ${role}. Professional contact.` : `${name}. Professional contact.`;
    }
  },
  {
    table: 'service_providers',
    columns: 'id, name, category',
    describe: (r) => {
      const name = str(r.name) || 'Service provider';
      const category = str(r.category);
      return category
        ? `${name}. ${category} service provider / partner firm.`
        : `${name}. Service provider / partner firm.`;
    }
  },
  {
    table: 'capital_providers',
    columns: 'id, name, capital_types, check_size_min, check_size_max',
    describe: (r) => {
      const name = str(r.name) || 'Capital provider';
      const types = Array.isArray(r.capital_types)
        ? (r.capital_types as unknown[]).map((t) => str(t)).filter(Boolean)
        : [];
      const typeStr = types.length ? types.join(', ') : 'capital provider';
      const min = typeof r.check_size_min === 'number' ? r.check_size_min : null;
      const max = typeof r.check_size_max === 'number' ? r.check_size_max : null;
      let check = '';
      if (min != null && max != null) check = ` Typical check ${min}–${max}.`;
      else if (min != null) check = ` Check from ${min}.`;
      else if (max != null) check = ` Check up to ${max}.`;
      return `${name}. Capital provider / LP (${typeStr}).${check}`.trim();
    }
  }
];

/** Embed up to `maxPerKind` un-embedded rows in each network source. */
export async function embedNetworkRecords(
  maxPerKind = 50
): Promise<{ embedded: number; failed: number }> {
  if (!process.env.VOYAGE_API_KEY) return { embedded: 0, failed: 0 };

  const admin = createAdminClient();
  const db = admin as unknown as EmbedDb;

  let embedded = 0;
  let failed = 0;

  for (const kind of KINDS) {
    try {
      const { data, error } = await db
        .from(kind.table)
        .select(kind.columns)
        .is('embedding', null)
        .limit(maxPerKind);

      if (error || !data || data.length === 0) continue;

      const texts = data.map((row) => kind.describe(row));
      let vectors: number[][] = [];
      try {
        vectors = await embedTexts(texts, 'document');
      } catch {
        // Whole-batch embedding failure for this kind — skip, try next cycle.
        continue;
      }
      if (vectors.length !== data.length) continue;

      for (let i = 0; i < data.length; i++) {
        const id = str(data[i].id);
        if (!id) continue;
        const { error: updateError } = await db
          .from(kind.table)
          .update({ embedding: toVectorLiteral(vectors[i]) })
          .eq('id', id);
        if (updateError) {
          failed++;
          console.warn('[embedNetworkRecords] update failed:', kind.table, id, updateError.message);
        } else {
          embedded++;
        }
      }
    } catch (err) {
      // never-block per kind
      console.warn('[embedNetworkRecords] kind failed:', kind.table, err);
    }
  }

  return { embedded, failed };
}
