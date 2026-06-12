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
      admin_launch_snapshots: {
        Row: {
          applications: number
          applications_approved: number
          created_at: string
          credits_earned: number
          id: string
          invites_accepted: number
          invites_sent: number
          members: number
          org_id: string
          referred_count: number
          snapshot_date: string
          updated_at: string
        }
        Insert: {
          applications?: number
          applications_approved?: number
          created_at?: string
          credits_earned?: number
          id?: string
          invites_accepted?: number
          invites_sent?: number
          members?: number
          org_id: string
          referred_count?: number
          snapshot_date?: string
          updated_at?: string
        }
        Update: {
          applications?: number
          applications_approved?: number
          created_at?: string
          credits_earned?: number
          id?: string
          invites_accepted?: number
          invites_sent?: number
          members?: number
          org_id?: string
          referred_count?: number
          snapshot_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_launch_snapshots_org_id_fkey"
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
      beta_ask_rate_limits: {
        Row: {
          bucket_key: string
          count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          count?: number
          window_start?: string
        }
        Relationships: []
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
          role: Database["public"]["Enums"]["org_member_role"]
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
          role?: Database["public"]["Enums"]["org_member_role"]
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
          role?: Database["public"]["Enums"]["org_member_role"]
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
      beta_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          label: string | null
          max_uses: number
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_member_role"]
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          org_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_member_role"]
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_member_role"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_profile_shares: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          org_id: string
          revoked_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          org_id: string
          revoked_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          org_id?: string
          revoked_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_profile_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_profile_shares_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_intro_requests: {
        Row: {
          created_at: string
          id: string
          org_id: string
          partner_id: string
          partner_name: string
          partner_type: string
          rationale: string | null
          requester_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          partner_id: string
          partner_name: string
          partner_type: string
          rationale?: string | null
          requester_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          partner_id?: string
          partner_name?: string
          partner_type?: string
          rationale?: string | null
          requester_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_intro_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_intro_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      distributions: {
        Row: {
          amount: number
          created_at: string
          distribution_date: string
          id: string
          kind: string
          lp_id: string | null
          memo: string | null
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          distribution_date?: string
          id?: string
          kind?: string
          lp_id?: string | null
          memo?: string | null
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          distribution_date?: string
          id?: string
          kind?: string
          lp_id?: string | null
          memo?: string | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributions_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "capital_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_account_entries: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          entry_date: string
          entry_type: string
          id: string
          lp_id: string | null
          memo: string | null
          org_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          entry_date?: string
          entry_type: string
          id?: string
          lp_id?: string | null
          memo?: string | null
          org_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          entry_date?: string
          entry_type?: string
          id?: string
          lp_id?: string | null
          memo?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_account_entries_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "capital_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_account_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      raise_pages: {
        Row: {
          accept_reservations: boolean
          created_at: string
          created_by: string | null
          exemption: string | null
          expires_at: string | null
          headline: string | null
          id: string
          min_check: number | null
          org_id: string
          revoked_at: string | null
          show_amounts: boolean
          title: string | null
          token: string
          updated_at: string
        }
        Insert: {
          accept_reservations?: boolean
          created_at?: string
          created_by?: string | null
          exemption?: string | null
          expires_at?: string | null
          headline?: string | null
          id?: string
          min_check?: number | null
          org_id: string
          revoked_at?: string | null
          show_amounts?: boolean
          title?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          accept_reservations?: boolean
          created_at?: string
          created_by?: string | null
          exemption?: string | null
          expires_at?: string | null
          headline?: string | null
          id?: string
          min_check?: number | null
          org_id?: string
          revoked_at?: string | null
          show_amounts?: boolean
          title?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raise_pages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raise_pages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      access_requests: {
        Row: {
          created_at: string
          email: string
          firm: string
          full_name: string
          id: string
          raising_range: string
          referral_code: string | null
          role_title: string
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          firm: string
          full_name: string
          id?: string
          raising_range: string
          referral_code?: string | null
          role_title: string
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          firm?: string
          full_name?: string
          id?: string
          raising_range?: string
          referral_code?: string | null
          role_title?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      raise_interests: {
        Row: {
          accredited: boolean | null
          attested_at: string | null
          created_at: string
          email: string
          id: string
          indicative_amount: number | null
          kind: string
          name: string
          note: string | null
          org_id: string
          raise_page_id: string
          reservation_amount: number | null
          reservation_status: string
          reviewer_note: string | null
          stripe_session_id: string | null
          verification_document_path: string | null
          verification_evidence: string | null
          verification_method: string | null
          verification_provider: string | null
          verification_provider_ref: string | null
          verification_provider_status: string | null
          verification_provider_url: string | null
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          accredited?: boolean | null
          attested_at?: string | null
          created_at?: string
          email: string
          id?: string
          indicative_amount?: number | null
          kind?: string
          name: string
          note?: string | null
          org_id: string
          raise_page_id: string
          reservation_amount?: number | null
          reservation_status?: string
          reviewer_note?: string | null
          stripe_session_id?: string | null
          verification_document_path?: string | null
          verification_evidence?: string | null
          verification_method?: string | null
          verification_provider?: string | null
          verification_provider_ref?: string | null
          verification_provider_status?: string | null
          verification_provider_url?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          accredited?: boolean | null
          attested_at?: string | null
          created_at?: string
          email?: string
          id?: string
          indicative_amount?: number | null
          kind?: string
          name?: string
          note?: string | null
          org_id?: string
          raise_page_id?: string
          reservation_amount?: number | null
          reservation_status?: string
          reviewer_note?: string | null
          stripe_session_id?: string | null
          verification_document_path?: string | null
          verification_evidence?: string | null
          verification_method?: string | null
          verification_provider?: string | null
          verification_provider_ref?: string | null
          verification_provider_status?: string | null
          verification_provider_url?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raise_interests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raise_interests_raise_page_id_fkey"
            columns: ["raise_page_id"]
            isOneToOne: false
            referencedRelation: "raise_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_link_claims: {
        Row: {
          beta_link_id: string
          claimed_at: string
          email: string
          id: string
          org_id: string
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          user_id: string
        }
        Insert: {
          beta_link_id: string
          claimed_at?: string
          email: string
          id?: string
          org_id: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id: string
        }
        Update: {
          beta_link_id?: string
          claimed_at?: string
          email?: string
          id?: string
          org_id?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_link_claims_beta_link_id_fkey"
            columns: ["beta_link_id"]
            isOneToOne: false
            referencedRelation: "beta_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_link_claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_link_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_link_claims_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_studio: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_studio_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
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
      capital_material_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          material_id: string
          org_id: string
          source: string
          source_snapshot: Json
          title: string
          version_number: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          material_id: string
          org_id: string
          source?: string
          source_snapshot?: Json
          title: string
          version_number: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          material_id?: string
          org_id?: string
          source?: string
          source_snapshot?: Json
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "capital_material_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_material_versions_material_org_fkey"
            columns: ["material_id", "org_id"]
            isOneToOne: false
            referencedRelation: "capital_materials"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "capital_material_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_materials: {
        Row: {
          audience: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          last_generated_at: string | null
          org_id: string
          spec: Json | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_generated_at?: string | null
          org_id: string
          spec?: Json | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_generated_at?: string | null
          org_id?: string
          spec?: Json | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_materials_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cap_table_entries: {
        Row: {
          amount_invested: number | null
          as_of_date: string | null
          created_at: string
          holder_name: string
          holder_type: string
          id: string
          memo: string | null
          org_id: string
          ownership_pct: number | null
          security_type: string
          units: number
          updated_at: string
        }
        Insert: {
          amount_invested?: number | null
          as_of_date?: string | null
          created_at?: string
          holder_name: string
          holder_type?: string
          id?: string
          memo?: string | null
          org_id: string
          ownership_pct?: number | null
          security_type?: string
          units?: number
          updated_at?: string
        }
        Update: {
          amount_invested?: number | null
          as_of_date?: string | null
          created_at?: string
          holder_name?: string
          holder_type?: string
          id?: string
          memo?: string | null
          org_id?: string
          ownership_pct?: number | null
          security_type?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cap_table_entries_org_id_fkey"
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
      org_subscriptions: {
        Row: {
          billing_interval: string
          cancel_at_period_end: boolean
          created_at: string
          credits_per_period: number
          current_period_end: string | null
          org_id: string
          plan: string
          seats: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          created_at?: string
          credits_per_period?: number
          current_period_end?: string | null
          org_id: string
          plan?: string
          seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          created_at?: string
          credits_per_period?: number
          current_period_end?: string | null
          org_id?: string
          plan?: string
          seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_invoices: {
        Row: {
          created_at: string
          credits_granted: number
          org_id: string
          period_end: string | null
          stripe_invoice_id: string
        }
        Insert: {
          created_at?: string
          credits_granted?: number
          org_id: string
          period_end?: string | null
          stripe_invoice_id: string
        }
        Update: {
          created_at?: string
          credits_granted?: number
          org_id?: string
          period_end?: string | null
          stripe_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_referral_codes: {
        Row: {
          code: string
          created_at: string
          org_id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          org_id: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_referral_codes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_referral_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_org_id: string
          referred_user_id: string
          referrer_org_id: string
          referrer_user_id: string
          source: string
          source_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          referred_org_id: string
          referred_user_id: string
          referrer_org_id: string
          referrer_user_id: string
          source: string
          source_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          referred_org_id?: string
          referred_user_id?: string
          referrer_org_id?: string
          referrer_user_id?: string
          source?: string
          source_id?: string | null
        }
        Relationships: []
      }
      referral_rewards: {
        Row: {
          commission_credits: number
          created_at: string
          credits_purchased: number
          id: string
          referral_id: string
          source_ref: string
          tier: number
        }
        Insert: {
          commission_credits: number
          created_at?: string
          credits_purchased: number
          id?: string
          referral_id: string
          source_ref: string
          tier?: number
        }
        Update: {
          commission_credits?: number
          created_at?: string
          credits_purchased?: number
          id?: string
          referral_id?: string
          source_ref?: string
          tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_tiers: {
        Row: {
          rate_bps: number
          tier: number
        }
        Insert: {
          rate_bps: number
          tier: number
        }
        Update: {
          rate_bps?: number
          tier?: number
        }
        Relationships: []
      }
      deal_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deal_id: string
          id: string
          org_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          deal_id: string
          id?: string
          org_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deal_id?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_notes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
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
          resolution: string | null
          resolved_at: string | null
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
          resolution?: string | null
          resolved_at?: string | null
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
          resolution?: string | null
          resolved_at?: string | null
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
      meeting_findings: {
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
            foreignKeyName: "meeting_findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_findings_run_id_org_id_fkey"
            columns: ["run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "meeting_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      meeting_runs: {
        Row: {
          commitment_probability: number | null
          contact_name: string | null
          created_at: string
          created_by: string
          deal_id: string | null
          id: string
          org_id: string
          sentiment: string | null
          status: string
          summary: string | null
        }
        Insert: {
          commitment_probability?: number | null
          contact_name?: string | null
          created_at?: string
          created_by: string
          deal_id?: string | null
          id?: string
          org_id: string
          sentiment?: string | null
          status?: string
          summary?: string | null
        }
        Update: {
          commitment_probability?: number | null
          contact_name?: string | null
          created_at?: string
          created_by?: string
          deal_id?: string | null
          id?: string
          org_id?: string
          sentiment?: string | null
          status?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_runs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_runs_org_id_fkey"
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
      gift_codes: {
        Row: {
          amount_cents: number
          code: string
          created_at: string
          credits: number
          email_sent_at: string | null
          id: string
          message: string | null
          occasion_date: string | null
          purchaser_user_id: string | null
          recipient_email: string | null
          recipient_name: string | null
          redeemed_at: string | null
          redeemed_by_org_id: string | null
          redeemed_by_user_id: string | null
          sender_name: string | null
          status: string
          stripe_session_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          code: string
          created_at?: string
          credits: number
          email_sent_at?: string | null
          id?: string
          message?: string | null
          occasion_date?: string | null
          purchaser_user_id?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          redeemed_at?: string | null
          redeemed_by_org_id?: string | null
          redeemed_by_user_id?: string | null
          sender_name?: string | null
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          code?: string
          created_at?: string
          credits?: number
          email_sent_at?: string | null
          id?: string
          message?: string | null
          occasion_date?: string | null
          purchaser_user_id?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          redeemed_at?: string | null
          redeemed_by_org_id?: string | null
          redeemed_by_user_id?: string | null
          sender_name?: string | null
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_codes_redeemed_by_org_id_fkey"
            columns: ["redeemed_by_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_objectives: {
        Row: {
          ai_recommendation: string | null
          approved_at: string | null
          archived_at: string | null
          capital_weight: number | null
          category: string | null
          closed_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          lifecycle_stage: string | null
          objective: string
          org_id: string
          owner_id: string | null
          owner_specialist: string | null
          parent_objective_id: string | null
          plan_id: string
          priority: string
          read_at: string | null
          source: string
          source_signal_id: string | null
          status: string
          timeline: string | null
          updated_at: string
        }
        Insert: {
          ai_recommendation?: string | null
          approved_at?: string | null
          archived_at?: string | null
          capital_weight?: number | null
          category?: string | null
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          lifecycle_stage?: string | null
          objective: string
          org_id: string
          owner_id?: string | null
          owner_specialist?: string | null
          parent_objective_id?: string | null
          plan_id: string
          priority?: string
          read_at?: string | null
          source?: string
          source_signal_id?: string | null
          status?: string
          timeline?: string | null
          updated_at?: string
        }
        Update: {
          ai_recommendation?: string | null
          approved_at?: string | null
          archived_at?: string | null
          capital_weight?: number | null
          category?: string | null
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          lifecycle_stage?: string | null
          objective?: string
          org_id?: string
          owner_id?: string | null
          owner_specialist?: string | null
          parent_objective_id?: string | null
          plan_id?: string
          priority?: string
          read_at?: string | null
          source?: string
          source_signal_id?: string | null
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
            foreignKeyName: "governance_objectives_parent_objective_id_fkey"
            columns: ["parent_objective_id"]
            isOneToOne: false
            referencedRelation: "governance_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_objectives_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "governance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_objectives_source_signal_id_fkey"
            columns: ["source_signal_id"]
            isOneToOne: false
            referencedRelation: "market_signals"
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
          owner_specialist: string | null
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
          owner_specialist?: string | null
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
          owner_specialist?: string | null
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
      integration_access_requests: {
        Row: {
          created_at: string
          id: string
          org_id: string
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_access_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          sync_frequency: string
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
          sync_frequency?: string
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
          sync_frequency?: string
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
      lp_room_answer_citations: {
        Row: {
          answer_id: string
          created_at: string
          document_id: string | null
          id: string
          label: string
          org_id: string
        }
        Insert: {
          answer_id: string
          created_at?: string
          document_id?: string | null
          id?: string
          label: string
          org_id: string
        }
        Update: {
          answer_id?: string
          created_at?: string
          document_id?: string | null
          id?: string
          label?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_room_answer_citations_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "lp_room_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_answer_citations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "lp_room_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_answer_citations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_room_answers: {
        Row: {
          author_id: string | null
          author_name: string
          author_role: string | null
          body: string
          created_at: string
          id: string
          org_id: string
          question_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          author_role?: string | null
          body: string
          created_at?: string
          id?: string
          org_id: string
          question_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string
          author_role?: string | null
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_room_answers_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_answers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "lp_room_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_room_documents: {
        Row: {
          access_level: string
          created_at: string
          id: string
          kind: string
          mime_type: string | null
          name: string
          org_id: string
          signed: boolean
          size_bytes: number
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          access_level?: string
          created_at?: string
          id?: string
          kind?: string
          mime_type?: string | null
          name: string
          org_id: string
          signed?: boolean
          size_bytes?: number
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          access_level?: string
          created_at?: string
          id?: string
          kind?: string
          mime_type?: string | null
          name?: string
          org_id?: string
          signed?: boolean
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lp_room_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_room_questions: {
        Row: {
          asked_by: string
          asker_name: string
          body: string
          created_at: string
          id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          asked_by: string
          asker_name: string
          body: string
          created_at?: string
          id?: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          asked_by?: string
          asker_name?: string
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_room_questions_asked_by_fkey"
            columns: ["asked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_room_update_attachments: {
        Row: {
          created_at: string
          document_id: string | null
          id: string
          name: string
          org_id: string
          update_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          id?: string
          name: string
          org_id: string
          update_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          id?: string
          name?: string
          org_id?: string
          update_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_room_update_attachments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "lp_room_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_update_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_update_attachments_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "lp_room_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_room_updates: {
        Row: {
          author_id: string | null
          author_name: string
          author_role: string
          body: string
          created_at: string
          id: string
          lifecycle: string
          org_id: string
          posted_at: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          author_role?: string
          body: string
          created_at?: string
          id?: string
          lifecycle?: string
          org_id: string
          posted_at?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          lifecycle?: string
          org_id?: string
          posted_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_room_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_room_updates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loop_events: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          metadata: Json
          org_id: string
          verb: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          metadata?: Json
          org_id: string
          verb: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          org_id?: string
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "loop_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loop_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      market_signals: {
        Row: {
          captured_at: string
          created_at: string
          embedding: string | null
          id: string
          kind: string
          normalized: Json | null
          occurred_at: string | null
          raw_payload: Json
          routed_specialist: string | null
          severity: string
          source: string
          source_external_id: string | null
        }
        Insert: {
          captured_at?: string
          created_at?: string
          embedding?: string | null
          id?: string
          kind: string
          normalized?: Json | null
          occurred_at?: string | null
          raw_payload?: Json
          routed_specialist?: string | null
          severity?: string
          source: string
          source_external_id?: string | null
        }
        Update: {
          captured_at?: string
          created_at?: string
          embedding?: string | null
          id?: string
          kind?: string
          normalized?: Json | null
          occurred_at?: string | null
          raw_payload?: Json
          routed_specialist?: string | null
          severity?: string
          source?: string
          source_external_id?: string | null
        }
        Relationships: []
      }
      formation_steps: {
        Row: {
          amended_at: string | null
          created_at: string
          filed_at: string
          filed_by: string | null
          id: string
          kind: string
          org_id: string
          status: string
          version: number
        }
        Insert: {
          amended_at?: string | null
          created_at?: string
          filed_at?: string
          filed_by?: string | null
          id?: string
          kind: string
          org_id: string
          status?: string
          version?: number
        }
        Update: {
          amended_at?: string | null
          created_at?: string
          filed_at?: string
          filed_by?: string | null
          id?: string
          kind?: string
          org_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "formation_steps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_formations: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_formations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_policies: {
        Row: {
          adopted_at: string | null
          adopted_by: string | null
          created_at: string
          decisions: Json
          id: string
          org_id: string
          policy_id: string
          status: string
        }
        Insert: {
          adopted_at?: string | null
          adopted_by?: string | null
          created_at?: string
          decisions?: Json
          id?: string
          org_id: string
          policy_id: string
          status?: string
        }
        Update: {
          adopted_at?: string | null
          adopted_by?: string | null
          created_at?: string
          decisions?: Json
          id?: string
          org_id?: string
          policy_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          deal_id: string | null
          est_value: number | null
          id: string
          intent: number | null
          name: string
          org_id: string
          segment: string | null
          signal: string | null
          source: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          est_value?: number | null
          id?: string
          intent?: number | null
          name: string
          org_id: string
          segment?: string | null
          signal?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          est_value?: number | null
          id?: string
          intent?: number | null
          name?: string
          org_id?: string
          segment?: string | null
          signal?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mandates: {
        Row: {
          created_at: string
          created_by: string | null
          experience: string | null
          firm: string | null
          geo: string | null
          investor_group: string
          investor_role: string | null
          objective: string | null
          org_id: string
          principal: string | null
          sectors: string[]
          size: string | null
          stage: string | null
          standing: string | null
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          experience?: string | null
          firm?: string | null
          geo?: string | null
          investor_group?: string
          investor_role?: string | null
          objective?: string | null
          org_id: string
          principal?: string | null
          sectors?: string[]
          size?: string | null
          stage?: string | null
          standing?: string | null
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          experience?: string | null
          firm?: string | null
          geo?: string | null
          investor_group?: string
          investor_role?: string | null
          objective?: string | null
          org_id?: string
          principal?: string | null
          sectors?: string[]
          size?: string | null
          stage?: string | null
          standing?: string | null
          updated_at?: string
          vehicle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mandates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
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
      earn_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          org_id: string | null
          role: string
          sources: Json
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          org_id?: string | null
          role: string
          sources?: Json
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          org_id?: string | null
          role?: string
          sources?: Json
          user_id?: string
        }
        Relationships: []
      }
      earn_workflow_steps: {
        Row: {
          created_at: string
          id: string
          ordinal: number
          result: Json | null
          specialist_slug: string | null
          status: string
          title: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ordinal?: number
          result?: Json | null
          specialist_slug?: string | null
          status?: string
          title: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ordinal?: number
          result?: Json | null
          specialist_slug?: string | null
          status?: string
          title?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "earn_workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "earn_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      earn_workflows: {
        Row: {
          created_at: string
          created_by: string
          current_step: number
          id: string
          kind: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          current_step?: number
          id?: string
          kind: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_step?: number
          id?: string
          kind?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "earn_workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earn_workflows_org_id_fkey"
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
      org_posture_snapshots: {
        Row: {
          capital: number | null
          compliance: number | null
          composite: number
          created_at: string
          execution: number | null
          governance: number | null
          id: string
          member_type: string | null
          org_id: string
          snapshot_date: string
          stage: string | null
          updated_at: string
        }
        Insert: {
          capital?: number | null
          compliance?: number | null
          composite: number
          created_at?: string
          execution?: number | null
          governance?: number | null
          id?: string
          member_type?: string | null
          org_id: string
          snapshot_date?: string
          stage?: string | null
          updated_at?: string
        }
        Update: {
          capital?: number | null
          compliance?: number | null
          composite?: number
          created_at?: string
          execution?: number | null
          governance?: number | null
          id?: string
          member_type?: string | null
          org_id?: string
          snapshot_date?: string
          stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_posture_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          tier: string | null
          type: Database["public"]["Enums"]["org_type"] | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          tier?: string | null
          type?: Database["public"]["Enums"]["org_type"] | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          tier?: string | null
          type?: Database["public"]["Enums"]["org_type"] | null
          updated_at?: string
          website?: string | null
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
      platform_admins: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
        }
        Relationships: []
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
      task_runs: {
        Row: {
          action: string
          agent_slug: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          org_id: string
          proposed_by: string | null
          status: string
          steps: Json
          task_id: string
          updated_at: string
        }
        Insert: {
          action: string
          agent_slug: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          org_id: string
          proposed_by?: string | null
          status?: string
          steps?: Json
          task_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          agent_slug?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          org_id?: string
          proposed_by?: string | null
          status?: string
          steps?: Json
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agent_slug: string | null
          assignee_id: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          org_id: string
          priority: number
          result: Json | null
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agent_slug?: string | null
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          org_id: string
          priority?: number
          result?: Json | null
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agent_slug?: string | null
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          org_id?: string
          priority?: number
          result?: Json | null
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
      trust_posture_snapshots: {
        Row: {
          coverage_pct: number
          created_at: string
          id: string
          iri: number
          org_id: string
          snapshot_date: string
          updated_at: string
        }
        Insert: {
          coverage_pct?: number
          created_at?: string
          id?: string
          iri: number
          org_id: string
          snapshot_date?: string
          updated_at?: string
        }
        Update: {
          coverage_pct?: number
          created_at?: string
          id?: string
          iri?: number
          org_id?: string
          snapshot_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_posture_snapshots_org_id_fkey"
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
      governance_bodies: {
        Row: {
          created_at: string
          id: string
          kind: string
          members: Json
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          members?: Json
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          members?: Json
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_bodies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          body: Json | null
          created_at: string
          id: string
          kind: string
          name: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          body?: Json | null
          created_at?: string
          id?: string
          kind: string
          name: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          body?: Json | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_room_links: {
        Row: {
          created_at: string
          document_id: string | null
          expires_at: string | null
          id: string
          label: string | null
          material_kind: string | null
          org_id: string
          token: string
          updated_at: string
          vetting: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          material_kind?: string | null
          org_id: string
          token: string
          updated_at?: string
          vetting?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          material_kind?: string | null
          org_id?: string
          token?: string
          updated_at?: string
          vetting?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_room_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "lp_room_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_room_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_room_views: {
        Row: {
          created_at: string
          id: string
          link_id: string
          org_id: string
          updated_at: string
          verified_at: string | null
          viewer: string
          viewer_email: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          link_id: string
          org_id: string
          updated_at?: string
          verified_at?: string | null
          viewer: string
          viewer_email?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          link_id?: string
          org_id?: string
          updated_at?: string
          verified_at?: string | null
          viewer?: string
          viewer_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_room_views_link_id_org_id_fkey"
            columns: ["link_id", "org_id"]
            isOneToOne: false
            referencedRelation: "data_room_links"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "data_room_views_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      closings: {
        Row: {
          amount: number | null
          counterparty: string | null
          created_at: string
          id: string
          kind: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          counterparty?: string | null
          created_at?: string
          id?: string
          kind: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          counterparty?: string | null
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "closings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_steps: {
        Row: {
          closing_id: string
          created_at: string
          id: string
          name: string
          org_id: string
          seq: number
          status: string
          updated_at: string
        }
        Insert: {
          closing_id: string
          created_at?: string
          id?: string
          name: string
          org_id: string
          seq: number
          status?: string
          updated_at?: string
        }
        Update: {
          closing_id?: string
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          seq?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_steps_closing_id_org_id_fkey"
            columns: ["closing_id", "org_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "closing_steps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_calls: {
        Row: {
          created_at: string
          due_at: string | null
          id: string
          kind: string
          label: string | null
          org_id: string
          pct: number | null
          status: string
          total: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_at?: string | null
          id?: string
          kind?: string
          label?: string | null
          org_id: string
          pct?: number | null
          status?: string
          total?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_at?: string | null
          id?: string
          kind?: string
          label?: string | null
          org_id?: string
          pct?: number | null
          status?: string
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_calls_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_lp_status: {
        Row: {
          call_id: string
          created_at: string
          id: string
          lp_ref: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          call_id: string
          created_at?: string
          id?: string
          lp_ref: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          call_id?: string
          created_at?: string
          id?: string
          lp_ref?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_lp_status_call_id_org_id_fkey"
            columns: ["call_id", "org_id"]
            isOneToOne: false
            referencedRelation: "capital_calls"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "call_lp_status_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signatures: {
        Row: {
          amount_label: string | null
          chased_at: string | null
          closing_id: string | null
          created_at: string
          document: string
          drives: string | null
          id: string
          org_id: string
          signed_at: string | null
          signer: string
          signer_role: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_label?: string | null
          chased_at?: string | null
          closing_id?: string | null
          created_at?: string
          document: string
          drives?: string | null
          id?: string
          org_id: string
          signed_at?: string | null
          signer: string
          signer_role?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_label?: string | null
          chased_at?: string | null
          closing_id?: string | null
          created_at?: string
          document?: string
          drives?: string | null
          id?: string
          org_id?: string
          signed_at?: string | null
          signer?: string
          signer_role?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signatures_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signatures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wires: {
        Row: {
          amount: number
          closing_id: string | null
          counterparty: string
          created_at: string
          currency: string
          direction: string
          drives: string | null
          id: string
          label: string | null
          org_id: string
          reference: string | null
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          closing_id?: string | null
          counterparty: string
          created_at?: string
          currency?: string
          direction: string
          drives?: string | null
          id?: string
          label?: string | null
          org_id: string
          reference?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          closing_id?: string | null
          counterparty?: string
          created_at?: string
          currency?: string
          direction?: string
          drives?: string | null
          id?: string
          label?: string | null
          org_id?: string
          reference?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wires_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wires_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          stream: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          stream: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          stream?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_tasks: {
        Row: {
          action: string | null
          created_at: string
          critical: boolean
          drives: string | null
          due_label: string | null
          id: string
          name: string | null
          org_id: string
          status: string
          subtasks: Json
          updated_at: string
          who: string | null
          workflow_id: string
        }
        Insert: {
          action?: string | null
          created_at?: string
          critical?: boolean
          drives?: string | null
          due_label?: string | null
          id?: string
          name?: string | null
          org_id: string
          status?: string
          subtasks?: Json
          updated_at?: string
          who?: string | null
          workflow_id: string
        }
        Update: {
          action?: string | null
          created_at?: string
          critical?: boolean
          drives?: string | null
          due_label?: string | null
          id?: string
          name?: string | null
          org_id?: string
          status?: string
          subtasks?: Json
          updated_at?: string
          who?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_tasks_workflow_id_org_id_fkey"
            columns: ["workflow_id", "org_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_run_at: string | null
          on_event: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          on_event: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          on_event?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_items: {
        Row: {
          action_label: string | null
          category: string
          checklist: Json
          created_at: string
          detail: string | null
          drives: string | null
          due_label: string | null
          id: string
          name: string | null
          org_id: string
          owner_name: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          action_label?: string | null
          category: string
          checklist?: Json
          created_at?: string
          detail?: string | null
          drives?: string | null
          due_label?: string | null
          id?: string
          name?: string | null
          org_id: string
          owner_name?: string | null
          severity: string
          status?: string
          updated_at?: string
        }
        Update: {
          action_label?: string | null
          category?: string
          checklist?: Json
          created_at?: string
          detail?: string | null
          drives?: string | null
          due_label?: string | null
          id?: string
          name?: string | null
          org_id?: string
          owner_name?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ir_items: {
        Row: {
          cat: string
          category: string | null
          contents: Json
          created_at: string
          detail: string | null
          drives: string | null
          due_at: string | null
          id: string
          name: string | null
          org_id: string
          status: string
          updated_at: string
          who: string | null
        }
        Insert: {
          cat: string
          category?: string | null
          contents?: Json
          created_at?: string
          detail?: string | null
          drives?: string | null
          due_at?: string | null
          id?: string
          name?: string | null
          org_id: string
          status?: string
          updated_at?: string
          who?: string | null
        }
        Update: {
          cat?: string
          category?: string | null
          contents?: Json
          created_at?: string
          detail?: string | null
          drives?: string | null
          due_at?: string | null
          id?: string
          name?: string | null
          org_id?: string
          status?: string
          updated_at?: string
          who?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ir_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      file_formation_step: {
        Args: {
          _data: Json
          _doc_body: string
          _kind: string
          _org_id: string
          _spec: Json
        }
        Returns: Json
      }
      accept_beta_invite: {
        Args: { _email: string; _invite_id?: string; _user_id: string }
        Returns: Json
      }
      propose_task_run: {
        Args: { p_action: string; p_steps: Json; p_task_id: string }
        Returns: string
      }
      decide_task_run: {
        Args: { p_decision: string; p_note: string; p_run_id: string }
        Returns: undefined
      }
      upsert_org_posture_snapshot: {
        Args: {
          _capital?: number
          _composite: number
          _compliance?: number
          _execution?: number
          _governance?: number
          _member_type?: string
          _org_id: string
          _stage?: string
        }
        Returns: undefined
      }
      upsert_trust_posture_snapshot: {
        Args: { _coverage_pct?: number; _iri: number; _org_id: string }
        Returns: undefined
      }
      log_loop_event: {
        Args: {
          _entity_id?: string
          _entity_type?: string
          _event_type: string
          _metadata?: Json
          _org_id: string
          _verb: string
        }
        Returns: undefined
      }
      claim_beta_link: {
        Args: { _email: string; _token: string; _user_id: string }
        Returns: { ok: boolean; error_reason: string }[]
      }
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
      beta_ask_rate_check: {
        Args: { _key: string; _max: number; _window_seconds: number }
        Returns: boolean
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
      claim_monthly_credit_grant: {
        Args: { _org_id: string }
        Returns: number
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
      save_onboarding_identity: {
        Args: {
          _full_name?: string | null
          _org_name?: string | null
          _org_type?: Database["public"]["Enums"]["org_type"] | null
          _role?: string | null
        }
        Returns: string
      }
      ensure_compliance_tier: { Args: { _org: string }; Returns: string }
      refresh_compliance_tier: {
        Args: { _org: string; _stale_days?: number }
        Returns: number
      }
      generate_deal_matches: { Args: { _org_id: string }; Returns: number }
      generate_lp_matches: { Args: { _org_id: string }; Returns: number }
      generate_signal_matches: { Args: { _org_id: string }; Returns: number }
      get_admin_metrics: { Args: { _org_id: string }; Returns: Json }
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      upsert_admin_launch_snapshot: {
        Args: {
          _org_id: string
          _members?: number
          _invites_sent?: number
          _invites_accepted?: number
          _applications?: number
          _applications_approved?: number
          _referred_count?: number
          _credits_earned?: number
        }
        Returns: undefined
      }
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
      claim_invoice_and_grant: {
        Args: {
          _amount: number
          _org_id: string
          _period_end?: string
          _reason?: string
          _stripe_invoice_id: string
        }
        Returns: number
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
      grant_referral_commission: {
        Args: {
          _credits_purchased: number
          _referred_org_id: string
          _source_ref: string
        }
        Returns: undefined
      }
      record_referral: {
        Args: {
          _referred_user_id: string
          _referrer_org_id: string
          _referrer_user_id: string
          _source: string
          _source_id?: string
        }
        Returns: undefined
      }
      get_gift_by_code: {
        Args: { _code: string }
        Returns: Json
      }
      redeem_gift: {
        Args: { _code: string; _org_id: string; _user_id: string }
        Returns: Json
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
