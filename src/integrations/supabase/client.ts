// Supabase client（Digital_printing_Org / dev）
// 只允許 URL 與 anon(publishable) key 出現在前端。service_role 一律走 Edge Function。
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ??
  "https://sfpjbimwmhqpywjsfhgl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmcGpiaW13bWhxcHl3anNmaGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MDU5OTQsImV4cCI6MjEwNDQ4MTk5NH0.0b6eDPNtsalT6VR-G-QkfKaBeXqoJNOAgzi4FAGvztU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
  },
});

export const SUPABASE_PROJECT_URL = SUPABASE_URL;
