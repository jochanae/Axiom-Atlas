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
      bought_lessons: {
        Row: {
          description: string | null
          financial_cost: number | null
          id: string
          linked_decision_id: string
          time_cost: number | null
          user_id: string
        }
        Insert: {
          description?: string | null
          financial_cost?: number | null
          id?: string
          linked_decision_id: string
          time_cost?: number | null
          user_id: string
        }
        Update: {
          description?: string | null
          financial_cost?: number | null
          id?: string
          linked_decision_id?: string
          time_cost?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bought_lessons_linked_decision_id_fkey"
            columns: ["linked_decision_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      build_states: {
        Row: {
          created_at: string
          duration_ms: number | null
          id: string
          label: string | null
          project_id: string
          session_id: string | null
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          label?: string | null
          project_id: string
          session_id?: string | null
          state?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          label?: string | null
          project_id?: string
          session_id?: string | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          card_payload: Json | null
          card_schema_version: number | null
          committed_card_id: string | null
          content: string
          created_at: string
          decision_catch: Json | null
          id: string
          intent_type: string | null
          output_guard_repaired: boolean | null
          output_guard_violation: string | null
          role: string
          session_id: string
          surfaced_memories: Json | null
          user_id: string
        }
        Insert: {
          card_payload?: Json | null
          card_schema_version?: number | null
          committed_card_id?: string | null
          content: string
          created_at?: string
          decision_catch?: Json | null
          id?: string
          intent_type?: string | null
          output_guard_repaired?: boolean | null
          output_guard_violation?: string | null
          role: string
          session_id: string
          surfaced_memories?: Json | null
          user_id: string
        }
        Update: {
          card_payload?: Json | null
          card_schema_version?: number | null
          committed_card_id?: string | null
          content?: string
          created_at?: string
          decision_catch?: Json | null
          id?: string
          intent_type?: string | null
          output_guard_repaired?: boolean | null
          output_guard_violation?: string | null
          role?: string
          session_id?: string
          surfaced_memories?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_committed_card_id_fkey"
            columns: ["committed_card_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      entries: {
        Row: {
          build_id: string | null
          card_schema_version: number
          catch_against_id: string | null
          cost_of_lesson: number | null
          created_at: string
          details: string | null
          deviation: boolean
          deviation_reason: string | null
          id: string
          is_violation: boolean
          locked_at: string | null
          mode: string | null
          project_id: string
          session_id: string | null
          severity: string
          source_message_id: string | null
          status: string
          summary: string | null
          supersedes_id: string | null
          title: string
          touched: Json | null
          updated_at: string
          user_id: string
          verb: string | null
        }
        Insert: {
          build_id?: string | null
          card_schema_version?: number
          catch_against_id?: string | null
          cost_of_lesson?: number | null
          created_at?: string
          details?: string | null
          deviation?: boolean
          deviation_reason?: string | null
          id?: string
          is_violation?: boolean
          locked_at?: string | null
          mode?: string | null
          project_id: string
          session_id?: string | null
          severity?: string
          source_message_id?: string | null
          status?: string
          summary?: string | null
          supersedes_id?: string | null
          title: string
          touched?: Json | null
          updated_at?: string
          user_id: string
          verb?: string | null
        }
        Update: {
          build_id?: string | null
          card_schema_version?: number
          catch_against_id?: string | null
          cost_of_lesson?: number | null
          created_at?: string
          details?: string | null
          deviation?: boolean
          deviation_reason?: string | null
          id?: string
          is_violation?: boolean
          locked_at?: string | null
          mode?: string | null
          project_id?: string
          session_id?: string | null
          severity?: string
          source_message_id?: string | null
          status?: string
          summary?: string | null
          supersedes_id?: string | null
          title?: string
          touched?: Json | null
          updated_at?: string
          user_id?: string
          verb?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_files: {
        Row: {
          content: string
          created_at: string
          filename: string
          id: string
          language: string
          parent_id: string | null
          project_id: string
          session_id: string | null
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          filename: string
          id?: string
          language?: string
          parent_id?: string | null
          project_id: string
          session_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          filename?: string
          id?: string
          language?: string
          parent_id?: string | null
          project_id?: string
          session_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "generated_files_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "generated_files"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          category: string
          common_mistake: string | null
          created_at: string
          frequency: string | null
          id: string
          one_liner: string
          reversibility: string | null
          reversibility_label: string | null
          slug: string
          status: string
          term: string
          usage_count: number
          what_it_means: string | null
          what_to_do_next: string | null
          why_it_comes_up: string | null
        }
        Insert: {
          category: string
          common_mistake?: string | null
          created_at?: string
          frequency?: string | null
          id?: string
          one_liner: string
          reversibility?: string | null
          reversibility_label?: string | null
          slug: string
          status?: string
          term: string
          usage_count?: number
          what_it_means?: string | null
          what_to_do_next?: string | null
          why_it_comes_up?: string | null
        }
        Update: {
          category?: string
          common_mistake?: string | null
          created_at?: string
          frequency?: string | null
          id?: string
          one_liner?: string
          reversibility?: string | null
          reversibility_label?: string | null
          slug?: string
          status?: string
          term?: string
          usage_count?: number
          what_it_means?: string | null
          what_to_do_next?: string | null
          why_it_comes_up?: string | null
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          build_id: string | null
          card_schema_version: number
          cost_of_lesson: number | null
          created_at: string
          description: string | null
          extracted_from_session_id: string | null
          id: string
          is_violation: boolean
          project_id: string
          severity: string
          status: string
          title: string
          user_id: string
          verb: string | null
        }
        Insert: {
          build_id?: string | null
          card_schema_version?: number
          cost_of_lesson?: number | null
          created_at?: string
          description?: string | null
          extracted_from_session_id?: string | null
          id?: string
          is_violation?: boolean
          project_id: string
          severity?: string
          status?: string
          title: string
          user_id: string
          verb?: string | null
        }
        Update: {
          build_id?: string | null
          card_schema_version?: number
          cost_of_lesson?: number | null
          created_at?: string
          description?: string | null
          extracted_from_session_id?: string | null
          id?: string
          is_violation?: boolean
          project_id?: string
          severity?: string
          status?: string
          title?: string
          user_id?: string
          verb?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_extracted_from_session_id_fkey"
            columns: ["extracted_from_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      parked_items: {
        Row: {
          card_schema_version: number
          created_at: string
          id: string
          kind: string | null
          label: string
          project_id: string | null
          resolved_at: string | null
          session_id: string | null
          severity: string
          source_context: string | null
          status: string | null
          user_id: string
          verb: string | null
        }
        Insert: {
          card_schema_version?: number
          created_at?: string
          id?: string
          kind?: string | null
          label: string
          project_id?: string | null
          resolved_at?: string | null
          session_id?: string | null
          severity?: string
          source_context?: string | null
          status?: string | null
          user_id: string
          verb?: string | null
        }
        Update: {
          card_schema_version?: number
          created_at?: string
          id?: string
          kind?: string | null
          label?: string
          project_id?: string | null
          resolved_at?: string | null
          session_id?: string | null
          severity?: string
          source_context?: string | null
          status?: string | null
          user_id?: string
          verb?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parked_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parked_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_compass: {
        Row: {
          aesthetics: string | null
          attachment_hint: string | null
          audience: string | null
          compass_md: string | null
          created_at: string
          has_attachment: boolean
          id: string
          project_id: string
          seed_material: string | null
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          aesthetics?: string | null
          attachment_hint?: string | null
          audience?: string | null
          compass_md?: string | null
          created_at?: string
          has_attachment?: boolean
          id?: string
          project_id: string
          seed_material?: string | null
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          aesthetics?: string | null
          attachment_hint?: string | null
          audience?: string | null
          compass_md?: string | null
          created_at?: string
          has_attachment?: boolean
          id?: string
          project_id?: string
          seed_material?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      project_invitations: {
        Row: {
          created_at: string
          id: string
          invited_by: string
          invited_email: string
          project_id: string
          role: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by: string
          invited_email: string
          project_id: string
          role?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          project_id?: string
          role?: string
          status?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          committed_at: string | null
          created_at: string
          id: string
          last_opened_at: string
          name: string
          shape: Json
          status: string
          surface_mode: string
          user_id: string
          working_title: string | null
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          id?: string
          last_opened_at?: string
          name: string
          shape?: Json
          status?: string
          surface_mode?: string
          user_id: string
          working_title?: string | null
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          id?: string
          last_opened_at?: string
          name?: string
          shape?: Json
          status?: string
          surface_mode?: string
          user_id?: string
          working_title?: string | null
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          benefit: string | null
          content: string
          created_at: string
          definition: string | null
          id: string
          kind: string
          priority: string
          project_id: string
          session_id: string
          status: string
          user_id: string
        }
        Insert: {
          benefit?: string | null
          content: string
          created_at?: string
          definition?: string | null
          id?: string
          kind?: string
          priority?: string
          project_id: string
          session_id: string
          status?: string
          user_id: string
        }
        Update: {
          benefit?: string | null
          content?: string
          created_at?: string
          definition?: string | null
          id?: string
          kind?: string
          priority?: string
          project_id?: string
          session_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          resolved: boolean
          session_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          resolved?: boolean
          session_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          resolved?: boolean
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string
          id: string
          mode: string | null
          project_id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string | null
          project_id: string
          status?: string
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string | null
          project_id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_nodes: {
        Row: {
          content: Json | null
          created_at: string
          id: string
          project_id: string
          session_id: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          content?: Json | null
          created_at?: string
          id?: string
          project_id: string
          session_id?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          content?: Json | null
          created_at?: string
          id?: string
          project_id?: string
          session_id?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workspace_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_nodes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
