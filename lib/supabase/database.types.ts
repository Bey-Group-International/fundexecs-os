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
      evidence: {
        Row: {
          created_at: string
          evidence_type: string | null
          id: string
          notes: string | null
          org_id: string
          proof_layer_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          evidence_type?: string | null
          id?: string
          notes?: string | null
          org_id: string
          proof_layer_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          evidence_type?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          proof_layer_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
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
      notifications: {
        Row: {
          created_at: string
          id: string
          org_id: string | null
          payload: Json
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string | null
          payload?: Json
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
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
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
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
      award_trust_xp: {
        Args: {
          _entity_id: string
          _entity_type: string
          _layer: string
          _org: string
        }
        Returns: number
      }
      create_organization: {
        Args: { _name: string; _type?: Database["public"]["Enums"]["org_type"] }
        Returns: string
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
      relationship_strength: {
        Args: { _count: number; _last: string }
        Returns: number
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
