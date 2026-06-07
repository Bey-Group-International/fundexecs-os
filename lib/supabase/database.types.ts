export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action_type: string
          admin_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action_type: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action_type?: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_brains: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_global: boolean
          name: string
          org_id: string | null
          persona: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_global?: boolean
          name: string
          org_id?: string | null
          persona?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_global?: boolean
          name?: string
          org_id?: string | null
          persona?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_brains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      allocations: {
        Row: {
          amount: number | null
          created_at: string
          deal_id: string
          id: string
          lp_id: string | null
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          deal_id: string
          id?: string
          lp_id?: string | null
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          deal_id?: string
          id?: string
          lp_id?: string | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_at: string
          invited_by: string | null
          last_sent_at: string
          note: string | null
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          last_sent_at?: string
          note?: string | null
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          last_sent_at?: string
          note?: string | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_routing_rules: {
        Row: {
          brain_id: string
          created_at: string
          id: string
          is_active: boolean
          org_id: string | null
          pattern: string
          priority: number
        }
        Insert: {
          brain_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string | null
          pattern: string
          priority?: number
        }
        Update: {
          brain_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string | null
          pattern?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "brain_routing_rules_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "ai_brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_routing_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_commitment_sources: {
        Row: {
          commitment_id: string
          created_at: string
          org_id: string
          source_id: string
          source_table: string
        }
        Insert: {
          commitment_id: string
          created_at?: string
          org_id: string
          source_id: string
          source_table: string
        }
        Update: {
          commitment_id?: string
          created_at?: string
          org_id?: string
          source_id?: string
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_commitment_sources_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: true
            referencedRelation: "capital_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_commitment_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_commitments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          expected_close: string | null
          id: string
          lp_id: string | null
          lp_type: string | null
          notes: string | null
          org_id: string
          stage: string
          tranche: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          expected_close?: string | null
          id?: string
          lp_id?: string | null
          lp_type?: string | null
          notes?: string | null
          org_id: string
          stage?: string
          tranche?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          expected_close?: string | null
          id?: string
          lp_id?: string | null
          lp_type?: string | null
          notes?: string | null
          org_id?: string
          stage?: string
          tranche?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_commitments_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "capital_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_commitments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_providers: {
        Row: {
          capital_types: string[]
          check_size_max: number | null
          check_size_min: number | null
          created_at: string
          criteria: Json
          id: string
          name: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          capital_types?: string[]
          check_size_max?: number | null
          check_size_min?: number | null
          created_at?: string
          criteria?: Json
          id?: string
          name: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          capital_types?: string[]
          check_size_max?: number | null
          check_size_min?: number | null
          created_at?: string
          criteria?: Json
          id?: string
          name?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chain_of_trust_records: {
        Row: {
          completion_percentage: number
          created_at: string
          current_layer: string
          entity_id: string
          entity_type: string
          id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          completion_percentage?: number
          created_at?: string
          current_layer?: string
          entity_id: string
          entity_type: string
          id?: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          completion_percentage?: number
          created_at?: string
          current_layer?: string
          entity_id?: string
          entity_type?: string
          id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chain_of_trust_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_identities: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          kind: string
          org_id: string
          value: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          kind: string
          org_id: string
          value: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          enrichment: Json
          full_name: string | null
          id: string
          org_id: string
          primary_email: string | null
          source_provider: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          enrichment?: Json
          full_name?: string | null
          id?: string
          org_id: string
          primary_email?: string | null
          source_provider?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          enrichment?: Json
          full_name?: string | null
          id?: string
          org_id?: string
          primary_email?: string | null
          source_provider?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_purchases: {
        Row: {
          amount_cents: number
          amount_credits: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          org_id: string
          status: string
          stripe_session_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          amount_credits: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          org_id: string
          status?: string
          stripe_session_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          amount_credits?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          org_id?: string
          status?: string
          stripe_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_purchases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          org_id: string
          reason: string
          ref_id: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          org_id: string
          reason: string
          ref_id?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          org_id?: string
          reason?: string
          ref_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_wallets: {
        Row: {
          balance: number
          created_at: string
          org_id: string
          plan: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          org_id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          org_id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_wallets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          name: string
          org_id: string
          owner_id: string | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          owner_id?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          owner_id?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      diligence_chunks: {
        Row: {
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          org_id: string
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          org_id: string
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diligence_chunks_document_id_org_id_fkey"
            columns: ["document_id", "org_id"]
            isOneToOne: false
            referencedRelation: "diligence_documents"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "diligence_chunks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diligence_documents: {
        Row: {
          created_at: string
          file_name: string
          id: string
          kind: string
          mime_type: string
          org_id: string
          run_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          kind?: string
          mime_type: string
          org_id: string
          run_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          kind?: string
          mime_type?: string
          org_id?: string
          run_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "diligence_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diligence_documents_run_id_org_id_fkey"
            columns: ["run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "diligence_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      diligence_findings: {
        Row: {
          agent: string
          citations: Json
          created_at: string
          detail: string | null
          id: string
          org_id: string
          run_id: string
          score: number | null
          summary: string
        }
        Insert: {
          agent: string
          citations?: Json
          created_at?: string
          detail?: string | null
          id?: string
          org_id: string
          run_id: string
          score?: number | null
          summary: string
        }
        Update: {
          agent?: string
          citations?: Json
          created_at?: string
          detail?: string | null
          id?: string
          org_id?: string
          run_id?: string
          score?: number | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "diligence_findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diligence_findings_run_id_org_id_fkey"
            columns: ["run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "diligence_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      diligence_runs: {
        Row: {
          conviction: number | null
          created_at: string
          created_by: string
          deal_id: string | null
          id: string
          org_id: string
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          conviction?: number | null
          created_at?: string
          created_by: string
          deal_id?: string | null
          id?: string
          org_id: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          conviction?: number | null
          created_at?: string
          created_by?: string
          deal_id?: string | null
          id?: string
          org_id?: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diligence_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diligence_runs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diligence_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence: {
        Row: {
          ai_validated_at: string | null
          ai_validation_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          evidence_type: string | null
          file_name: string | null
          id: string
          mime_type: string | null
          notes: string | null
          org_id: string
          proof_layer_id: string
          rejection_reason: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          ai_validated_at?: string | null
          ai_validation_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          evidence_type?: string | null
          file_name?: string | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          org_id: string
          proof_layer_id: string
          rejection_reason?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          ai_validated_at?: string | null
          ai_validation_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          evidence_type?: string | null
          file_name?: string | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          org_id?: string
          proof_layer_id?: string
          rejection_reason?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_proof_layer_id_fkey"
            columns: ["proof_layer_id"]
            isOneToOne: false
            referencedRelation: "proof_layers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_objectives: {
        Row: {
          ai_recommendation: string | null
          archived_at: string | null
          closed_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          objective: string
          org_id: string
          owner_id: string | null
          plan_id: string
          priority: string
          read_at: string | null
          status: string
          timeline: string | null
          updated_at: string
        }
        Insert: {
          ai_recommendation?: string | null
          archived_at?: string | null
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          objective: string
          org_id: string
          owner_id?: string | null
          plan_id: string
          priority?: string
          read_at?: string | null
          status?: string
          timeline?: string | null
          updated_at?: string
        }
        Update: {
          ai_recommendation?: string | null
          archived_at?: string | null
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          objective?: string
          org_id?: string
          owner_id?: string | null
          plan_id?: string
          priority?: string
          read_at?: string | null
          status?: string
          timeline?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_objectives_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_objectives_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_objectives_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "governance_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_plans: {
        Row: {
          created_at: string
          horizon: string | null
          id: string
          name: string
          org_id: string
          owner_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          horizon?: string | null
          id?: string
          name: string
          org_id: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          horizon?: string | null
          id?: string
          name?: string
          org_id?: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_plans_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          created_at: string
          external_account: string | null
          id: string
          last_synced_at: string | null
          metadata: Json
          org_id: string
          provider: string
          scopes: string[]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_account?: string | null
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          org_id: string
          provider: string
          scopes?: string[]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_account?: string | null
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          org_id?: string
          provider?: string
          scopes?: string[]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          connection_id: string | null
          contact_id: string | null
          created_at: string
          direction: string
          external_ref: string | null
          id: string
          metadata: Json
          occurred_at: string
          org_id: string
          provider: string | null
          subject: string | null
          summary: string | null
          type: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          external_ref?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id: string
          provider?: string | null
          subject?: string | null
          summary?: string | null
          type: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          external_ref?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string
          provider?: string | null
          subject?: string | null
          summary?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          brain_id: string
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          org_id: string | null
          token_count: number | null
        }
        Insert: {
          brain_id: string
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          org_id?: string | null
          token_count?: number | null
        }
        Update: {
          brain_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          org_id?: string | null
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "ai_brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          brain_id: string
          content: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string | null
          source: string | null
          title: string
          updated_at: string
          uri: string | null
        }
        Insert: {
          brain_id: string
          content?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string | null
          source?: string | null
          title: string
          updated_at?: string
          uri?: string | null
        }
        Update: {
          brain_id?: string
          content?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string | null
          source?: string | null
          title?: string
          updated_at?: string
          uri?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "ai_brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          acted_at: string | null
          acted_by: string | null
          created_at: string
          id: string
          kind: string
          org_id: string
          rationale: Json
          score: number
          status: string
          subject_id: string
        }
        Insert: {
          acted_at?: string | null
          acted_by?: string | null
          created_at?: string
          id?: string
          kind: string
          org_id: string
          rationale?: Json
          score: number
          status?: string
          subject_id: string
        }
        Update: {
          acted_at?: string | null
          acted_by?: string | null
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          rationale?: Json
          score?: number
          status?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_profiles: {
        Row: {
          bio: string | null
          completion_pct: number
          created_at: string
          details: Json
          display_name: string | null
          draft: Json
          focus_areas: string[]
          headline: string | null
          links: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          completion_pct?: number
          created_at?: string
          details?: Json
          display_name?: string | null
          draft?: Json
          focus_areas?: string[]
          headline?: string | null
          links?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          completion_pct?: number
          created_at?: string
          details?: Json
          display_name?: string | null
          draft?: Json
          focus_areas?: string[]
          headline?: string | null
          links?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          id: number
          title: string
        }
        Insert: {
          id?: never
          title: string
        }
        Update: {
          id?: never
          title?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          org_id: string | null
          payload: Json
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          org_id?: string | null
          payload?: Json
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          org_id?: string | null
          payload?: Json
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      objections: {
        Row: {
          category: string
          created_at: string
          id: string
          lp_id: string | null
          objection: string
          org_id: string
          rebuttal: string | null
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          lp_id?: string | null
          objection: string
          org_id: string
          rebuttal?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          lp_id?: string | null
          objection?: string
          org_id?: string
          rebuttal?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "objections_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "capital_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          tier: string | null
          type: Database["public"]["Enums"]["org_type"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tier?: string | null
          type?: Database["public"]["Enums"]["org_type"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tier?: string | null
          type?: Database["public"]["Enums"]["org_type"] | null
          updated_at?: string
        }
        Relationships: []
      }
      partnerships: {
        Row: {
          counterparty: string
          created_at: string
          id: string
          org_id: string
          stage: string
          type: string | null
          updated_at: string
        }
        Insert: {
          counterparty: string
          created_at?: string
          id?: string
          org_id: string
          stage?: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          counterparty?: string
          created_at?: string
          id?: string
          org_id?: string
          stage?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnerships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          member_type: string | null
          role: string | null
          updated_at: string
          xp: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          member_type?: string | null
          role?: string | null
          updated_at?: string
          xp?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          member_type?: string | null
          role?: string | null
          updated_at?: string
          xp?: number
        }
        Relationships: []
      }
      proof_layers: {
        Row: {
          ai_validation_notes: string | null
          chain_record_id: string
          completion_percentage: number
          created_at: string
          human_approval_status: string
          id: string
          layer_name: string
          layer_order: number
          org_id: string
          required_documents: Json
          required_tasks: Json
          updated_at: string
        }
        Insert: {
          ai_validation_notes?: string | null
          chain_record_id: string
          completion_percentage?: number
          created_at?: string
          human_approval_status?: string
          id?: string
          layer_name: string
          layer_order: number
          org_id: string
          required_documents?: Json
          required_tasks?: Json
          updated_at?: string
        }
        Update: {
          ai_validation_notes?: string | null
          chain_record_id?: string
          completion_percentage?: number
          created_at?: string
          human_approval_status?: string
          id?: string
          layer_name?: string
          layer_order?: number
          org_id?: string
          required_documents?: Json
          required_tasks?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_layers_chain_record_id_fkey"
            columns: ["chain_record_id"]
            isOneToOne: false
            referencedRelation: "chain_of_trust_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_layers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      relationships: {
        Row: {
          computed_at: string
          contact_id: string
          first_interaction_at: string | null
          id: string
          interaction_count: number
          last_inbound_at: string | null
          last_interaction_at: string | null
          last_outbound_at: string | null
          org_id: string
          signals: Json
          status: string
          strength: number
          user_id: string
        }
        Insert: {
          computed_at?: string
          contact_id: string
          first_interaction_at?: string | null
          id?: string
          interaction_count?: number
          last_inbound_at?: string | null
          last_interaction_at?: string | null
          last_outbound_at?: string | null
          org_id: string
          signals?: Json
          status?: string
          strength?: number
          user_id: string
        }
        Update: {
          computed_at?: string
          contact_id?: string
          first_interaction_at?: string | null
          id?: string
          interaction_count?: number
          last_inbound_at?: string | null
          last_interaction_at?: string | null
          last_outbound_at?: string | null
          org_id?: string
          signals?: Json
          status?: string
          strength?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_providers: {
        Row: {
          capabilities: Json
          category: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          category?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      synergy_opportunities: {
        Row: {
          created_at: string
          id: string
          org_id: string
          rationale: string | null
          score: number | null
          source_entity_id: string | null
          source_entity_type: string
          status: string
          target_entity_id: string | null
          target_entity_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          rationale?: string | null
          score?: number | null
          source_entity_id?: string | null
          source_entity_type: string
          status?: string
          target_entity_id?: string | null
          target_entity_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          rationale?: string | null
          score?: number | null
          source_entity_id?: string | null
          source_entity_type?: string
          status?: string
          target_entity_id?: string | null
          target_entity_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "synergy_opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          org_id: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          org_id: string
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          org_id?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          org_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      warm_introductions: {
        Row: {
          connector_contact_id: string | null
          connector_user_id: string | null
          created_at: string
          id: string
          org_id: string
          rationale: string | null
          requester_id: string | null
          status: string
          strength: number | null
          target_contact_id: string
          updated_at: string
        }
        Insert: {
          connector_contact_id?: string | null
          connector_user_id?: string | null
          created_at?: string
          id?: string
          org_id: string
          rationale?: string | null
          requester_id?: string | null
          status?: string
          strength?: number | null
          target_contact_id: string
          updated_at?: string
        }
        Update: {
          connector_contact_id?: string | null
          connector_user_id?: string | null
          created_at?: string
          id?: string
          org_id?: string
          rationale?: string | null
          requester_id?: string | null
          status?: string
          strength?: number | null
          target_contact_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warm_introductions_connector_contact_id_fkey"
            columns: ["connector_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warm_introductions_connector_user_id_fkey"
            columns: ["connector_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warm_introductions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warm_introductions_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warm_introductions_target_contact_id_fkey"
            columns: ["target_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      act_on_match: {
        Args: { _action: string; _match_id: string }
        Returns: Json
      }
      award_trust_xp: {
        Args: {
          _entity_id: string
          _entity_type: string
          _layer: string
          _org: string
        }
        Returns: number
      }
      capital_stack_summary: {
        Args: { _org_id: string }
        Returns: {
          active_total: number
          closed_total: number
          commitments: Json
          committed_total: number
          currency: string
          gap_to_target: number
          lp_type_totals: Json
          org_id: string
          soft_circle_total: number
          stage_totals: Json
          target_total: number
          withdrawn_total: number
        }[]
      }
      consume_credits: {
        Args: {
          _amount: number
          _org_id: string
          _reason: string
          _ref_id?: string
        }
        Returns: number
      }
      create_organization: {
        Args: { _name: string; _type?: Database["public"]["Enums"]["org_type"] }
        Returns: string
      }
      generate_deal_matches: { Args: { _org_id: string }; Returns: number }
      generate_lp_matches: { Args: { _org_id: string }; Returns: number }
      get_audit_trail: {
        Args: { _limit?: number; _org_id: string }
        Returns: {
          actor: string
          detail: string
          occurred_at: string
          score: number
          source: string
          title: string
        }[]
      }
      get_integration_secret: {
        Args: { _connection_id: string }
        Returns: {
          access_token: string
          connection_id: string
          expires_at: string
          refresh_token: string
          token_type: string
          updated_at: string
        }[]
      }
      grant_credits: {
        Args: {
          _amount: number
          _org_id: string
          _reason?: string
          _ref_id?: string
        }
        Returns: number
      }
      match_diligence_chunks: {
        Args: { match_count?: number; query_embedding: string; run_id: string }
        Returns: {
          content: string
          document_id: string
          file_name: string
          id: string
          similarity: number
          storage_path: string
        }[]
      }
      match_knowledge_chunks: {
        Args: {
          _org_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          brain_id: string
          content: string
          document_id: string
          id: string
          similarity: number
        }[]
      }
      record_credit_topup: {
        Args: {
          _amount_cents: number
          _amount_credits: number
          _metadata?: Json
          _org_id: string
          _status?: string
          _stripe_session_id: string
        }
        Returns: Json
      }
      relationship_strength: {
        Args: { _count: number; _last: string }
        Returns: number
      }
      resolve_objection: {
        Args: { _id: string }
        Returns: {
          category: string
          created_at: string
          id: string
          lp_id: string
          objection: string
          org_id: string
          rebuttal: string
          resolved_at: string
          status: string
          updated_at: string
        }[]
      }
      seed_demo_baseline_for_org: {
        Args: { _org: string; _user: string }
        Returns: undefined
      }
      seed_demo_for_member_type: {
        Args: { _org: string; _type: string; _user: string }
        Returns: undefined
      }
      seed_demo_for_user: {
        Args: { _org: string; _user: string }
        Returns: undefined
      }
      store_diligence_chunks: {
        Args: { _chunks: Json; _document_id: string }
        Returns: number
      }
      store_integration_secret: {
        Args: {
          _access_token: string
          _connection_id: string
          _expires_at?: string
          _refresh_token?: string
          _token_type?: string
        }
        Returns: undefined
      }
      upsert_objection: {
        Args: {
          _category: string
          _id?: string
          _lp_id: string
          _objection: string
          _org_id: string
          _rebuttal?: string
          _status?: string
        }
        Returns: {
          category: string
          created_at: string
          id: string
          lp_id: string
          objection: string
          org_id: string
          rebuttal: string
          resolved_at: string
          status: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      org_member_role: "owner" | "admin" | "member"
      org_type:
        | "fund"
        | "lp"
        | "operator"
        | "capital_provider"
        | "service_provider"
        | "partner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      org_member_role: ["owner", "admin", "member"],
      org_type: [
        "fund",
        "lp",
        "operator",
        "capital_provider",
        "service_provider",
        "partner",
      ],
    },
  },
} as const
