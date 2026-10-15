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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          id: string
          ip: string | null
          route: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          route?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          route?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_amendments: {
        Row: {
          approved_at: string | null
          approver_id: string | null
          approver_note: string | null
          attendance_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          reason: string
          request_time: string
          request_time_out: string | null
          request_type: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approver_id?: string | null
          approver_note?: string | null
          attendance_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          reason: string
          request_time: string
          request_time_out?: string | null
          request_type: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approver_id?: string | null
          approver_note?: string | null
          attendance_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          reason?: string
          request_time?: string
          request_time_out?: string | null
          request_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_amendments_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_amendments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance_daily_report"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_amendments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_amendments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_amendments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendances: {
        Row: {
          abnormal_reason: string | null
          clock_in_at: string | null
          clock_in_distance_m: number | null
          clock_in_lat: number | null
          clock_in_lng: number | null
          clock_out_at: string | null
          clock_out_distance_m: number | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          company_id: string
          created_at: string
          created_by: string | null
          device_hash: string | null
          early_leave_minutes: number
          employee_id: string
          id: string
          ip: string | null
          is_abnormal_location: boolean
          late_minutes: number
          note: string | null
          ot_minutes_134: number
          ot_minutes_167: number
          ot_minutes_holiday: number
          shift_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
          work_date: string
          work_minutes: number
        }
        Insert: {
          abnormal_reason?: string | null
          clock_in_at?: string | null
          clock_in_distance_m?: number | null
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_out_at?: string | null
          clock_out_distance_m?: number | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          device_hash?: string | null
          early_leave_minutes?: number
          employee_id: string
          id?: string
          ip?: string | null
          is_abnormal_location?: boolean
          late_minutes?: number
          note?: string | null
          ot_minutes_134?: number
          ot_minutes_167?: number
          ot_minutes_holiday?: number
          shift_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          work_date: string
          work_minutes?: number
        }
        Update: {
          abnormal_reason?: string | null
          clock_in_at?: string | null
          clock_in_distance_m?: number | null
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_out_at?: string | null
          clock_out_distance_m?: number | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          device_hash?: string | null
          early_leave_minutes?: number
          employee_id?: string
          id?: string
          ip?: string | null
          is_abnormal_location?: boolean
          late_minutes?: number
          note?: string | null
          ot_minutes_134?: number
          ot_minutes_167?: number
          ot_minutes_holiday?: number
          shift_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          work_date?: string
          work_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          company_id: string | null
          created_at: string
          id: string
          target_id: string | null
          target_table: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          company_id?: string | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          company_id?: string | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      changelogs: {
        Row: {
          content: string | null
          created_at: string
          created_by: string | null
          id: string
          released_at: string
          title: string
          type: string
          version: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          released_at?: string
          title: string
          type?: string
          version: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          released_at?: string
          title?: string
          type?: string
          version?: string
        }
        Relationships: []
      }
      collection_allocations: {
        Row: {
          allocated_amount: number
          collection_id: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          receivable_id: string
        }
        Insert: {
          allocated_amount?: number
          collection_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          receivable_id: string
        }
        Update: {
          allocated_amount?: number
          collection_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          receivable_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_allocations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_allocations_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_allocations_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          amount: number
          bank_account: string | null
          check_due_date: string | null
          check_no: string | null
          collect_date: string
          collection_no: string
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          method: string
          note: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          bank_account?: string | null
          check_due_date?: string | null
          check_no?: string | null
          collect_date?: string
          collection_no: string
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          method?: string
          note?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          bank_account?: string | null
          check_due_date?: string | null
          check_no?: string | null
          collect_date?: string
          collection_no?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          method?: string
          note?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          clock_radius_m: number
          code: string
          created_at: string
          created_by: string | null
          id: string
          invoice_entity: string | null
          is_active: boolean
          lat: number | null
          line_channel_key: string | null
          lng: number | null
          login_domain: string
          name: string
          phone: string | null
          short_name: string | null
          tax_id: string | null
          theme_color: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          clock_radius_m?: number
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_entity?: string | null
          is_active?: boolean
          lat?: number | null
          line_channel_key?: string | null
          lng?: number | null
          login_domain: string
          name: string
          phone?: string | null
          short_name?: string | null
          tax_id?: string | null
          theme_color?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          clock_radius_m?: number
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_entity?: string | null
          is_active?: boolean
          lat?: number | null
          line_channel_key?: string | null
          lng?: number | null
          login_domain?: string
          name?: string
          phone?: string | null
          short_name?: string | null
          tax_id?: string | null
          theme_color?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      company_modules: {
        Row: {
          company_id: string
          is_enabled: boolean
          module_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          is_enabled?: boolean
          module_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          is_enabled?: boolean
          module_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_modules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_modules_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "module_registry"
            referencedColumns: ["module_key"]
          },
        ]
      }
      cross_company_events: {
        Row: {
          actor_company_id: string
          actor_id: string | null
          created_at: string
          event: string
          id: string
          link_id: string
          payload: Json | null
        }
        Insert: {
          actor_company_id: string
          actor_id?: string | null
          created_at?: string
          event: string
          id?: string
          link_id: string
          payload?: Json | null
        }
        Update: {
          actor_company_id?: string
          actor_id?: string | null
          created_at?: string
          event?: string
          id?: string
          link_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "cross_company_events_actor_company_id_fkey"
            columns: ["actor_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "cross_company_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "group_reconciliation"
            referencedColumns: ["link_id"]
          },
        ]
      }
      cross_company_links: {
        Row: {
          agreed_amount: number
          agreed_due_date: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dispatched_at: string
          from_company_id: string
          from_order_id: string
          from_task_id: string
          id: string
          note: string | null
          payable_id: string | null
          receivable_id: string | null
          status: string
          to_company_id: string
          to_order_id: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
        }
        Insert: {
          agreed_amount?: number
          agreed_due_date?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string
          from_company_id: string
          from_order_id: string
          from_task_id: string
          id?: string
          note?: string | null
          payable_id?: string | null
          receivable_id?: string | null
          status?: string
          to_company_id: string
          to_order_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Update: {
          agreed_amount?: number
          agreed_due_date?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string
          from_company_id?: string
          from_order_id?: string
          from_task_id?: string
          id?: string
          note?: string | null
          payable_id?: string | null
          receivable_id?: string | null
          status?: string
          to_company_id?: string
          to_order_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cross_company_links_from_company_id_fkey"
            columns: ["from_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_from_order_id_fkey"
            columns: ["from_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_from_task_id_fkey"
            columns: ["from_task_id"]
            isOneToOne: false
            referencedRelation: "order_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_to_order_id_fkey"
            columns: ["to_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          company_id: string
          contact: string | null
          created_at: string
          created_by: string | null
          customer_code: string
          id: string
          is_active: boolean
          is_internal_partner: boolean
          name: string
          note: string | null
          payment_term: string
          phone: string | null
          tax_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          company_id: string
          contact?: string | null
          created_at?: string
          created_by?: string | null
          customer_code: string
          id?: string
          is_active?: boolean
          is_internal_partner?: boolean
          name: string
          note?: string | null
          payment_term?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          company_id?: string
          contact?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string
          id?: string
          is_active?: boolean
          is_internal_partner?: boolean
          name?: string
          note?: string | null
          payment_term?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          manager_id: string | null
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_manager_fk"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_no_counters: {
        Row: {
          company_id: string
          doc_type: string
          id: string
          last_seq: number
          period: string
        }
        Insert: {
          company_id: string
          doc_type: string
          id?: string
          last_seq?: number
          period: string
        }
        Update: {
          company_id?: string
          doc_type?: string
          id?: string
          last_seq?: number
          period?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_no_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          can_switch_company: boolean
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          emp_no: string
          hire_date: string | null
          id: string
          is_active: boolean
          line_bind_at: string | null
          line_bind_code: string | null
          line_user_id: string | null
          name: string
          note: string | null
          phone: string | null
          position: string | null
          role_id: string
          shift_id: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          can_switch_company?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          emp_no: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          line_bind_at?: string | null
          line_bind_code?: string | null
          line_user_id?: string | null
          name: string
          note?: string | null
          phone?: string | null
          position?: string | null
          role_id: string
          shift_id?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          can_switch_company?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          emp_no?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          line_bind_at?: string | null
          line_bind_code?: string | null
          line_user_id?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          position?: string | null
          role_id?: string
          shift_id?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          company_id: string | null
          context: Json | null
          created_at: string
          id: string
          level: string
          message: string | null
          route: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          level?: string
          message?: string | null
          route?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          level?: string
          message?: string | null
          route?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lookups: {
        Row: {
          category: string
          code: string
          company_id: string | null
          created_at: string
          id: string
          is_active: boolean
          label: string
          meta: Json | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          code: string
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          meta?: Json | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          code?: string
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          meta?: Json | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lookups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          menu_key: string
          min_tier: string | null
          module_key: string | null
          parent_id: string | null
          route: string | null
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          menu_key: string
          min_tier?: string | null
          module_key?: string | null
          parent_id?: string | null
          route?: string | null
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          menu_key?: string
          min_tier?: string | null
          module_key?: string | null
          parent_id?: string | null
          route?: string | null
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "module_registry"
            referencedColumns: ["module_key"]
          },
          {
            foreignKeyName: "menus_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      module_registry: {
        Row: {
          category: string
          created_at: string
          default_enabled: boolean
          is_active: boolean
          module_key: string
          name: string
          sort_order: number
        }
        Insert: {
          category: string
          created_at?: string
          default_enabled?: boolean
          is_active?: boolean
          module_key: string
          name: string
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          default_enabled?: boolean
          is_active?: boolean
          module_key?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      notification_rules: {
        Row: {
          category: string
          company_id: string
          created_at: string
          id: string
          in_app_enabled: boolean
          is_enabled: boolean
          line_enabled: boolean
          line_mode: string
          name: string
          params: Json
          recipient_scopes: string[]
          rule_code: string
          template_body: string | null
          template_title: string | null
          trigger_kind: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string
          id?: string
          in_app_enabled?: boolean
          is_enabled?: boolean
          line_enabled?: boolean
          line_mode?: string
          name: string
          params?: Json
          recipient_scopes?: string[]
          rule_code: string
          template_body?: string | null
          template_title?: string | null
          trigger_kind: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          id?: string
          in_app_enabled?: boolean
          is_enabled?: boolean
          line_enabled?: boolean
          line_mode?: string
          name?: string
          params?: Json
          recipient_scopes?: string[]
          rule_code?: string
          template_body?: string | null
          template_title?: string | null
          trigger_kind?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          company_id: string
          created_at: string
          dedupe_key: string | null
          employee_id: string
          id: string
          is_read: boolean
          line_attempts: number
          line_error: string | null
          line_sent_at: string | null
          line_status: string
          read_at: string | null
          ref_id: string | null
          ref_type: string | null
          rule_code: string
          title: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          dedupe_key?: string | null
          employee_id: string
          id?: string
          is_read?: boolean
          line_attempts?: number
          line_error?: string | null
          line_sent_at?: string | null
          line_status?: string
          read_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          rule_code: string
          title: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          dedupe_key?: string | null
          employee_id?: string
          id?: string
          is_read?: boolean
          line_attempts?: number
          line_error?: string | null
          line_sent_at?: string | null
          line_status?: string
          read_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          rule_code?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      order_costs: {
        Row: {
          amount: number
          company_id: string
          cost_type: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          order_id: string
          recognized_at: string
          source_id: string | null
          source_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          company_id: string
          cost_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id: string
          recognized_at?: string
          source_id?: string | null
          source_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          cost_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string
          recognized_at?: string
          source_id?: string | null
          source_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_costs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_costs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_task_logs: {
        Row: {
          changed_by: string | null
          company_id: string
          created_at: string
          id: string
          new_status: string
          old_status: string | null
          order_id: string
          order_task_id: string
          reason: string | null
        }
        Insert: {
          changed_by?: string | null
          company_id: string
          created_at?: string
          id?: string
          new_status: string
          old_status?: string | null
          order_id: string
          order_task_id: string
          reason?: string | null
        }
        Update: {
          changed_by?: string | null
          company_id?: string
          created_at?: string
          id?: string
          new_status?: string
          old_status?: string | null
          order_id?: string
          order_task_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_task_logs_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_task_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_task_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_task_logs_order_task_id_fkey"
            columns: ["order_task_id"]
            isOneToOne: false
            referencedRelation: "order_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      order_tasks: {
        Row: {
          assignee_id: string | null
          blocked_reason: string | null
          company_id: string
          created_at: string
          created_by: string | null
          done_at: string | null
          due_at: string | null
          id: string
          is_outsource: boolean
          note: string | null
          order_id: string
          outsource_due_at: string | null
          outsourced_at: string | null
          purchase_id: string | null
          started_at: string | null
          station_id: string
          status: string
          step_no: number
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
        }
        Insert: {
          assignee_id?: string | null
          blocked_reason?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          is_outsource?: boolean
          note?: string | null
          order_id: string
          outsource_due_at?: string | null
          outsourced_at?: string | null
          purchase_id?: string | null
          started_at?: string | null
          station_id: string
          status?: string
          step_no: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Update: {
          assignee_id?: string | null
          blocked_reason?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          is_outsource?: boolean
          note?: string | null
          order_id?: string
          outsource_due_at?: string | null
          outsourced_at?: string | null
          purchase_id?: string | null
          started_at?: string | null
          station_id?: string
          status?: string
          step_no?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tasks_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "work_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tasks_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_total: number
          amount_untaxed: number
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          item_name: string
          note: string | null
          order_no: string
          product_id: string | null
          qty: number
          routing_template_id: string | null
          source_link_id: string | null
          spec: string | null
          status: string
          tax_amount: number
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_total?: number
          amount_untaxed?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          item_name: string
          note?: string | null
          order_no: string
          product_id?: string | null
          qty?: number
          routing_template_id?: string | null
          source_link_id?: string | null
          spec?: string | null
          status?: string
          tax_amount?: number
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_total?: number
          amount_untaxed?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          item_name?: string
          note?: string | null
          order_no?: string
          product_id?: string | null
          qty?: number
          routing_template_id?: string | null
          source_link_id?: string | null
          spec?: string | null
          status?: string
          tax_amount?: number
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_routing_template_id_fkey"
            columns: ["routing_template_id"]
            isOneToOne: false
            referencedRelation: "routing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      payables: {
        Row: {
          amount: number
          balance: number | null
          company_id: string
          created_at: string
          created_by: string | null
          doc_no: string
          due_date: string | null
          id: string
          invoice_no: string | null
          note: string | null
          paid_amount: number
          purchase_id: string | null
          related_order_id: string | null
          source_type: string
          status: string
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          amount?: number
          balance?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          doc_no: string
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          note?: string | null
          paid_amount?: number
          purchase_id?: string | null
          related_order_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          amount?: number
          balance?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          doc_no?: string
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          note?: string | null
          paid_amount?: number
          purchase_id?: string | null
          related_order_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          allocated_amount: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          payable_id: string
          payment_id: string
        }
        Insert: {
          allocated_amount?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          payable_id: string
          payment_id: string
        }
        Update: {
          allocated_amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          payable_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_account: string | null
          check_due_date: string | null
          check_no: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          method: string
          note: string | null
          pay_date: string
          payment_no: string
          status: string
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          amount?: number
          bank_account?: string | null
          check_due_date?: string | null
          check_no?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          pay_date?: string
          payment_no: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          amount?: number
          bank_account?: string | null
          check_due_date?: string | null
          check_no?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          pay_date?: string
          payment_no?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          default_routing_template_id: string | null
          id: string
          is_active: boolean
          name: string
          product_code: string
          spec_template: string | null
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          default_routing_template_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          product_code: string
          spec_template?: string | null
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_routing_template_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          product_code?: string
          spec_template?: string | null
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_default_routing_template_id_fkey"
            columns: ["default_routing_template_id"]
            isOneToOne: false
            referencedRelation: "routing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_platform_admin: boolean
          last_login_at: string | null
          must_change_password: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          is_platform_admin?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_platform_admin?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_warehouse_in: boolean
          item_name: string
          purchase_id: string
          qty: number
          spec: string | null
          unit: string
          unit_price: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_warehouse_in?: boolean
          item_name: string
          purchase_id: string
          qty?: number
          spec?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_warehouse_in?: boolean
          item_name?: string
          purchase_id?: string
          qty?: number
          spec?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount_total: number
          amount_untaxed: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_date: string | null
          invoice_no: string | null
          note: string | null
          purchase_date: string
          purchase_no: string
          related_order_id: string | null
          source_type: string
          status: string
          tax_amount: number
          tax_type: string
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          amount_total?: number
          amount_untaxed?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_date?: string | null
          invoice_no?: string | null
          note?: string | null
          purchase_date?: string
          purchase_no: string
          related_order_id?: string | null
          source_type?: string
          status?: string
          tax_amount?: number
          tax_type?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          amount_total?: number
          amount_untaxed?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_date?: string | null
          invoice_no?: string | null
          note?: string | null
          purchase_date?: string
          purchase_no?: string
          related_order_id?: string | null
          source_type?: string
          status?: string
          tax_amount?: number
          tax_type?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      purge_policy: {
        Row: {
          days: number
          is_active: boolean
          key: string
          label: string
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          days: number
          is_active?: boolean
          key: string
          label: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          days?: number
          is_active?: boolean
          key?: string
          label?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      purge_run_log: {
        Row: {
          detail: Json | null
          dry_run: boolean
          duration_ms: number | null
          id: number
          ok: boolean
          ran_at: string
        }
        Insert: {
          detail?: Json | null
          dry_run: boolean
          duration_ms?: number | null
          id?: number
          ok: boolean
          ran_at?: string
        }
        Update: {
          detail?: Json | null
          dry_run?: boolean
          duration_ms?: number | null
          id?: number
          ok?: boolean
          ran_at?: string
        }
        Relationships: []
      }
      quotation_items: {
        Row: {
          amount: number
          id: string
          item_name: string
          qty: number
          quotation_id: string
          sort_order: number
          spec: string | null
          unit: string | null
          unit_price: number
        }
        Insert: {
          amount?: number
          id?: string
          item_name?: string
          qty?: number
          quotation_id: string
          sort_order?: number
          spec?: string | null
          unit?: string | null
          unit_price?: number
        }
        Update: {
          amount?: number
          id?: string
          item_name?: string
          qty?: number
          quotation_id?: string
          sort_order?: number
          spec?: string | null
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          note: string | null
          quote_date: string
          quote_no: string
          status: string
          subtotal: number
          tax_amount: number
          tax_type: string
          total: number
          updated_at: string
          updated_by: string | null
          valid_until: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          note?: string | null
          quote_date?: string
          quote_no: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_type?: string
          total?: number
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          note?: string | null
          quote_date?: string
          quote_no?: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_type?: string
          total?: number
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables: {
        Row: {
          amount: number
          balance: number | null
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          doc_no: string
          due_date: string | null
          id: string
          invoice_no: string | null
          note: string | null
          received_amount: number
          related_order_id: string | null
          source_type: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          balance?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          doc_no: string
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          note?: string | null
          received_amount?: number
          related_order_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          balance?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          doc_no?: string
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          note?: string | null
          received_amount?: number
          related_order_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receivables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      role_module_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_view: boolean
          company_id: string
          id: string
          module_key: string
          role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          company_id: string
          id?: string
          module_key: string
          role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          company_id?: string
          id?: string
          module_key?: string
          role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_module_permissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_module_permissions_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "module_registry"
            referencedColumns: ["module_key"]
          },
          {
            foreignKeyName: "role_module_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          sort_order: number
          tier: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          sort_order?: number
          tier: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number
          tier?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_template_steps: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_optional: boolean
          offset_days: number
          station_id: string
          step_no: number
          template_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_optional?: boolean
          offset_days?: number
          station_id: string
          step_no: number
          template_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_optional?: boolean
          offset_days?: number
          station_id?: string
          step_no?: number
          template_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_template_steps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_template_steps_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "work_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_template_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "routing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          product_category: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          product_category: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          product_category?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          break_minutes: number
          company_id: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          is_active: boolean
          late_tolerance_minutes: number
          name: string
          start_time: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          break_minutes?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          late_tolerance_minutes?: number
          name: string
          start_time: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          break_minutes?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          late_tolerance_minutes?: number
          name?: string
          start_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_configs: {
        Row: {
          company_id: string | null
          created_at: string
          description: string | null
          group_name: string | null
          id: string
          is_secret: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
          value_type: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          description?: string | null
          group_name?: string | null
          id?: string
          is_secret?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
          value_type?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          description?: string | null
          group_name?: string | null
          id?: string
          is_secret?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_company_context: {
        Row: {
          current_company_id: string
          switched_at: string
          user_id: string
        }
        Insert: {
          current_company_id: string
          switched_at?: string
          user_id: string
        }
        Update: {
          current_company_id?: string
          switched_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_company_context_current_company_id_fkey"
            columns: ["current_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          auto_dispatch: boolean
          bank_account: string | null
          company_id: string
          contact: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_outsource: boolean
          linked_company_id: string | null
          name: string
          note: string | null
          partner_routing_template_id: string | null
          payment_term: string
          phone: string | null
          tax_id: string | null
          updated_at: string
          updated_by: string | null
          vendor_code: string
          vendor_type: string
        }
        Insert: {
          auto_dispatch?: boolean
          bank_account?: string | null
          company_id: string
          contact?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_outsource?: boolean
          linked_company_id?: string | null
          name: string
          note?: string | null
          partner_routing_template_id?: string | null
          payment_term?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_code: string
          vendor_type?: string
        }
        Update: {
          auto_dispatch?: boolean
          bank_account?: string | null
          company_id?: string
          contact?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_outsource?: boolean
          linked_company_id?: string | null
          name?: string
          note?: string | null
          partner_routing_template_id?: string | null
          payment_term?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_code?: string
          vendor_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_partner_routing_template_id_fkey"
            columns: ["partner_routing_template_id"]
            isOneToOne: false
            referencedRelation: "routing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      work_stations: {
        Row: {
          code: string
          color: string | null
          company_id: string
          created_at: string
          created_by: string | null
          default_owner_id: string | null
          id: string
          is_active: boolean
          is_outsource_capable: boolean
          name: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          color?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          default_owner_id?: string | null
          id?: string
          is_active?: boolean
          is_outsource_capable?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          color?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_owner_id?: string | null
          id?: string
          is_active?: boolean
          is_outsource_capable?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_stations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_stations_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attendance_daily_report: {
        Row: {
          abnormal_reason: string | null
          clock_in_at: string | null
          clock_in_distance_m: number | null
          clock_out_at: string | null
          clock_out_distance_m: number | null
          company_id: string | null
          early_leave_minutes: number | null
          emp_no: string | null
          employee_id: string | null
          employee_name: string | null
          id: string | null
          is_abnormal_location: boolean | null
          late_minutes: number | null
          ot_minutes_134: number | null
          ot_minutes_167: number | null
          ot_minutes_holiday: number | null
          pending_amendments: number | null
          shift_end: string | null
          shift_name: string | null
          shift_start: string | null
          status: string | null
          work_date: string | null
          work_minutes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_monthly_summary: {
        Row: {
          abnormal_count: number | null
          absent_days: number | null
          company_id: string | null
          early_leave_days: number | null
          emp_no: string | null
          employee_id: string | null
          employee_name: string | null
          late_days: number | null
          missing_days: number | null
          month: string | null
          normal_days: number | null
          off_days: number | null
          total_days: number | null
          total_early_leave_minutes: number | null
          total_late_minutes: number | null
          total_ot_134: number | null
          total_ot_167: number | null
          total_ot_holiday: number | null
          total_work_minutes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      board_stats: {
        Row: {
          active_orders: number | null
          active_tasks: number | null
          assigned_count: number | null
          blocked_count: number | null
          company_id: string | null
          done_count: number | null
          due_today_count: number | null
          in_progress_count: number | null
          outsourced_count: number | null
          overdue_count: number | null
          pending_count: number | null
          waiting_customer_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      group_reconciliation: {
        Row: {
          agreed_amount: number | null
          agreed_due_date: string | null
          amount_mismatch: boolean | null
          completed_at: string | null
          dispatched_at: string | null
          from_company_id: string | null
          from_company_name: string | null
          from_item_name: string | null
          from_order_no: string | null
          link_id: string | null
          link_status: string | null
          payable_amount: number | null
          payable_status: string | null
          receivable_amount: number | null
          receivable_status: string | null
          to_company_id: string | null
          to_company_name: string | null
          to_order_no: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cross_company_links_from_company_id_fkey"
            columns: ["from_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_company_links_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      my_notification_count: {
        Row: {
          unread_count: number | null
        }
        Relationships: []
      }
      order_cost_summary: {
        Row: {
          company_id: string | null
          gross_profit: number | null
          item_name: string | null
          labor_cost: number | null
          material_cost: number | null
          order_amount: number | null
          order_id: string | null
          order_no: string | null
          other_cost: number | null
          outsource_cost: number | null
          total_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_costs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_costs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      outsource_stats: {
        Row: {
          cancelled_count: number | null
          completed_amount: number | null
          completed_count: number | null
          dispatched_count: number | null
          from_company_id: string | null
          in_progress_count: number | null
          outstanding_amount: number | null
          overdue_count: number | null
          rejected_count: number | null
          total_links: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cross_company_links_from_company_id_fkey"
            columns: ["from_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payables_summary: {
        Row: {
          amount: number | null
          balance: number | null
          company_id: string | null
          created_at: string | null
          doc_no: string | null
          due_date: string | null
          id: string | null
          invoice_no: string | null
          is_overdue: boolean | null
          note: string | null
          overdue_days: number | null
          paid_amount: number | null
          purchase_id: string | null
          related_order_id: string | null
          source_type: string | null
          status: string | null
          vendor_code: string | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables_summary: {
        Row: {
          amount: number | null
          balance: number | null
          company_id: string | null
          created_at: string | null
          customer_code: string | null
          customer_id: string | null
          customer_name: string | null
          doc_no: string | null
          due_date: string | null
          id: string | null
          invoice_no: string | null
          is_overdue: boolean | null
          note: string | null
          overdue_days: number | null
          received_amount: number | null
          related_order_id: string | null
          source_type: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receivables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate_collection: {
        Args: {
          p_allocations: Json
          p_amount: number
          p_bank_account?: string
          p_check_due_date?: string
          p_check_no?: string
          p_collect_date: string
          p_company_id: string
          p_created_by?: string
          p_customer_id: string
          p_method: string
          p_note?: string
        }
        Returns: Json
      }
      allocate_payment: {
        Args: {
          p_allocations: Json
          p_amount: number
          p_bank_account?: string
          p_check_due_date?: string
          p_check_no?: string
          p_company_id: string
          p_created_by?: string
          p_method: string
          p_note?: string
          p_pay_date: string
          p_vendor_id: string
        }
        Returns: Json
      }
      approve_amendment: {
        Args: { p_amendment_id: string; p_approved: boolean; p_note?: string }
        Returns: Json
      }
      bind_line_account: {
        Args: { p_code: string; p_line_user_id: string }
        Returns: Json
      }
      calc_due_date: {
        Args: { p_base_date?: string; p_payment_term: string }
        Returns: string
      }
      call_edge_function: {
        Args: { p_body: Json; p_fn_name: string }
        Returns: number
      }
      cancel_outsource: {
        Args: { p_link_id: string; p_reason?: string }
        Returns: Json
      }
      clock_in: { Args: { p_lat: number; p_lng: number }; Returns: Json }
      clock_out: { Args: { p_lat: number; p_lng: number }; Returns: Json }
      complete_outsource: { Args: { p_link_id: string }; Returns: Json }
      complete_password_change: { Args: never; Returns: undefined }
      confirm_purchase: { Args: { p_purchase_id: string }; Returns: Json }
      cron_guarded: { Args: { p_fn: string }; Returns: undefined }
      current_company_id: { Args: never; Returns: string }
      current_employee_id: { Args: never; Returns: string }
      current_role_code: { Args: never; Returns: string }
      dispatch_outsource: {
        Args: {
          p_amount: number
          p_due_date?: string
          p_note?: string
          p_task_id: string
          p_vendor_id: string
        }
        Returns: Json
      }
      emit_notification: {
        Args: {
          p_body: string
          p_company_id: string
          p_counterpart_company_id?: string
          p_dedupe_suffix?: string
          p_owner_employee_id: string
          p_ref_id: string
          p_ref_type: string
          p_rule_code: string
          p_title: string
        }
        Returns: number
      }
      ensure_company_context: { Args: never; Returns: string }
      expand_order_tasks: { Args: { p_order_id: string }; Returns: number }
      find_user_id_by_email: { Args: { p_email: string }; Returns: string }
      generate_line_bind_code: { Args: never; Returns: string }
      get_config: { Args: { p_key: string }; Returns: string }
      has_perm: {
        Args: { p_action: string; p_module: string }
        Returns: boolean
      }
      haversine_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_manager: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      login_companies: {
        Args: never
        Returns: {
          code: string
          login_domain: string
          name: string
          theme_color: string
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_line_result: {
        Args: { p_error?: string; p_id: string; p_ok: boolean }
        Returns: undefined
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      next_doc_no: {
        Args: { p_company_id: string; p_doc_type: string }
        Returns: string
      }
      notify_scan_all: { Args: never; Returns: number }
      purge_maintenance: { Args: { p_dry_run?: boolean }; Returns: Json }
      purge_maintenance_job: { Args: never; Returns: undefined }
      refresh_line_bind_code: {
        Args: { p_employee_id: string }
        Returns: string
      }
      reject_outsource: {
        Args: { p_link_id: string; p_reason?: string }
        Returns: Json
      }
      resolve_recipients: {
        Args: {
          p_company_id: string
          p_counterpart_company_id?: string
          p_owner_employee_id?: string
          p_scopes: string[]
        }
        Returns: string[]
      }
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: number }
      send_line_digests: { Args: never; Returns: number }
      switch_company: { Args: { p_company_id: string }; Returns: undefined }
      task_assign: {
        Args: { p_assignee_id: string; p_task_id: string }
        Returns: Json
      }
      task_block: {
        Args: { p_reason: string; p_task_id: string }
        Returns: Json
      }
      task_done: { Args: { p_task_id: string }; Returns: Json }
      task_skip: { Args: { p_task_id: string }; Returns: Json }
      task_start: { Args: { p_task_id: string }; Returns: Json }
      unbind_line_account: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      update_notification_rule: {
        Args: {
          p_in_app_enabled?: boolean
          p_is_enabled?: boolean
          p_line_enabled?: boolean
          p_line_mode?: string
          p_recipient_scopes?: string[]
          p_rule_id: string
        }
        Returns: undefined
      }
      user_company_ids: { Args: never; Returns: string[] }
      void_collection: { Args: { p_collection_id: string }; Returns: Json }
      void_payment: { Args: { p_payment_id: string }; Returns: Json }
      void_purchase: { Args: { p_purchase_id: string }; Returns: Json }
      write_audit: {
        Args: {
          p_action: string
          p_after: Json
          p_company_id: string
          p_target_id: string
          p_target_table: string
          p_user_id: string
        }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
