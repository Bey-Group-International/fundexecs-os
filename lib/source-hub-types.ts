// lib/source-hub-types.ts
// Standardized output envelope for all Source Hub modules.
// Every module must return VerifiedResult<T> — no raw data escapes unverified.

export interface VerifiedResult<T> {
  status: 'success' | 'warning' | 'failed';
  verified: boolean;
  confidence: number; // 0.0–1.0
  timestamp: string; // ISO 8601
  sources: DataSource[];
  data: T;
  errors?: string[];
  cache?: CacheMetadata;
}

export interface DataSource {
  provider: string;
  endpoint: string;
  latency_ms: number;
  verified: boolean;
  retrieved_at: string;
}

export interface CacheMetadata {
  cached: boolean;
  cache_hit: boolean;
  cached_at?: string;
  ttl_seconds: number;
  expires_at?: string;
}

export interface VerifiedPerson {
  id?: string;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  linkedin_url?: string;
  phone?: string;
  location?: string;
  seniority?: string;
  departments?: string[];
  provenance: 'apollo' | 'manual' | 'ai' | 'enriched';
  confidence: number;
}

export interface VerifiedCompany {
  id?: string;
  name: string;
  domain?: string;
  description?: string;
  industry?: string;
  employee_count?: number;
  employee_range?: string;
  revenue_range?: string;
  headquarters?: string;
  founded_year?: number;
  linkedin_url?: string;
  website?: string;
  funding_total?: number;
  funding_stage?: string;
  keywords?: string[];
  provenance: 'apollo' | 'manual' | 'ai' | 'enriched';
  confidence: number;
}

export interface VerifiedInvestor {
  id?: string;
  name: string;
  firm?: string;
  type?: 'family_office' | 'pension' | 'endowment' | 'foundation' | 'fund_of_funds' | 'sovereign_wealth' | 'vc' | 'pe' | 'other';
  aum_range?: string;
  strategy?: string[];
  geography?: string[];
  min_check?: number;
  max_check?: number;
  email?: string;
  linkedin_url?: string;
  website?: string;
  provenance: 'apollo' | 'manual' | 'ai' | 'enriched';
  confidence: number;
}

export interface FitAnalysis {
  fitScore: number; // 0–100
  rationale: string;
  signals: string[];
  firstMove: string;
}

export interface InvestorFitAnalysis {
  fitScore: number;
  rationale: string;
  suggestedApproach: string;
}
