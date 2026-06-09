import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCapitalStackData } from '@/lib/queries/capital-stack';
import { getFundProfile } from '@/lib/queries/fund-profile';
import type { Database } from '@/lib/supabase/database.types';
import {
  buildMaterialSourceSnapshot,
  MATERIAL_AUDIENCES,
  MATERIAL_KINDS,
  MATERIAL_SOURCES,
  MATERIAL_STATUSES,
  type MaterialAudience,
  type MaterialKind,
  type MaterialSource,
  type MaterialSourceSnapshot,
  type MaterialStatus
} from '@/lib/materials/template';

type MaterialRow = Database['public']['Tables']['capital_materials']['Row'];
type VersionRow = Database['public']['Tables']['capital_material_versions']['Row'];

export interface CapitalMaterialVersion {
  id: string;
  versionNumber: number;
  title: string;
  body: string;
  source: MaterialSource;
  createdAt: string;
}

export interface CapitalMaterial {
  id: string;
  kind: MaterialKind;
  audience: MaterialAudience;
  title: string;
  status: MaterialStatus;
  createdAt: string;
  updatedAt: string;
  lastGeneratedAt: string | null;
  latestVersion: CapitalMaterialVersion | null;
  versionCount: number;
}

export interface MaterialsStudioStats {
  total: number;
  draft: number;
  ready: number;
  archived: number;
  versionCount: number;
}

export interface MaterialsStudioData {
  source: MaterialSourceSnapshot;
  materials: CapitalMaterial[];
  stats: MaterialsStudioStats;
  empty: boolean;
}

function firstOf<T extends readonly string[]>(allowed: T, value: string): T[number] {
  return allowed.includes(value) ? value : allowed[0];
}

function toMaterial(row: MaterialRow, latest: VersionRow | null, versionCount: number) {
  return {
    id: row.id,
    kind: firstOf(MATERIAL_KINDS, row.kind) as MaterialKind,
    audience: firstOf(MATERIAL_AUDIENCES, row.audience) as MaterialAudience,
    title: row.title,
    status: firstOf(MATERIAL_STATUSES, row.status) as MaterialStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastGeneratedAt: row.last_generated_at,
    latestVersion: latest
      ? {
          id: latest.id,
          versionNumber: latest.version_number,
          title: latest.title,
          body: latest.body,
          source: firstOf(MATERIAL_SOURCES, latest.source) as MaterialSource,
          createdAt: latest.created_at
        }
      : null,
    versionCount
  };
}

export async function getMaterialSourceSnapshot(orgId: string): Promise<MaterialSourceSnapshot> {
  const [profile, capital] = await Promise.all([
    getFundProfile(orgId),
    getCapitalStackData(orgId).catch(() => ({ summary: null }))
  ]);

  return buildMaterialSourceSnapshot(profile, capital.summary);
}

export async function getMaterialsStudioData(orgId: string): Promise<MaterialsStudioData> {
  const supabase = await createClient();

  const [source, materialsResult] = await Promise.all([
    getMaterialSourceSnapshot(orgId),
    supabase
      .from('capital_materials')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(100)
  ]);

  if (materialsResult.error) {
    throw new Error(materialsResult.error.message);
  }

  const materialRows = (materialsResult.data ?? []) as MaterialRow[];
  const materialIds = materialRows.map((row) => row.id);
  let versions: VersionRow[] = [];

  if (materialIds.length > 0) {
    const { data, error } = await supabase
      .from('capital_material_versions')
      .select('*')
      .eq('org_id', orgId)
      .in('material_id', materialIds)
      .order('version_number', { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    versions = (data ?? []) as VersionRow[];
  }

  const latestByMaterial = new Map<string, VersionRow>();
  const countByMaterial = new Map<string, number>();

  for (const version of versions) {
    countByMaterial.set(version.material_id, (countByMaterial.get(version.material_id) ?? 0) + 1);
    if (!latestByMaterial.has(version.material_id)) {
      latestByMaterial.set(version.material_id, version);
    }
  }

  const materials = materialRows.map((row) =>
    toMaterial(row, latestByMaterial.get(row.id) ?? null, countByMaterial.get(row.id) ?? 0)
  );

  const stats: MaterialsStudioStats = {
    total: materials.length,
    draft: materials.filter((material) => material.status === 'draft').length,
    ready: materials.filter((material) => material.status === 'ready').length,
    archived: materials.filter((material) => material.status === 'archived').length,
    versionCount: versions.length
  };

  return {
    source,
    materials,
    stats,
    empty: materials.length === 0
  };
}
