// 全站共用 client。尚未產生 Database 型別前以 any 使用；
// 之後以 `supabase gen types` 產出 src/integrations/supabase/types.ts 再收斂型別。
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typed } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = typed as unknown as SupabaseClient<any, any, any>;
