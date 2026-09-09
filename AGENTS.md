<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# 祥興印刷／沂融企業社 營運系統 — 開發鐵則

> 本專案依《SA/SD v1.0》《DEV 開發時程與施工規則 v1.0》《基礎架構整併分析 v1.0》施工。
> 技術棧：Supabase（Postgres＋RLS＋Edge Functions＋pg_cron）＋ Lovable（TanStack Start／React／Tailwind／shadcn）。

## 1. 資料與權限

1. **權限只在 RLS，前端隱藏不算數。** 前端 `can(module, action)` 與後端 `has_perm(module, action)` 同源；頁面守門一律用 `<RequirePerm module=…>`，不要在頁面寫 `tier === 'staff'` 這種判斷。
2. **不要改 Supabase schema。** 所有 schema／政策變更都是 `supabase/migrations/NNN_*.sql`，先在 dev 跑過再上 prod。Lovable 指令一律加「不要修改資料庫結構」。
3. **service_role key 不進前端。** 需要 service_role 的動作（建帳、重設密碼、跨公司派工、LINE 推播）一律走 `supabase.functions.invoke()`。
4. 每張業務表都有 `company_id`；查詢不用手動加 `company_id` 條件（RLS 已限制），但**寫入時要帶 `company_id`**（政策 `with check` 需要）。
5. 商業邏輯（金額、成本認列、狀態轉換、單號）在 DB function／trigger／Edge Function，前端只顯示與呼叫。

## 2. 程式慣例（每一條都是踩過的坑）

1. **一定要接 `error`**：`const { data, error } = await supabase…; if (error) …`。`data` 為 null 不代表沒資料（token 過期、RLS、斷線）。
2. **寫入後加 `.select("id")` 驗筆數**：RLS 靜默擋掉時 `error` 是 null 但 0 列。0 列就要報錯，不能 toast「已儲存」。
3. **錯誤訊息一律過 `humanizeError(err, "動作名")`**（`@/lib/app-error`）；Edge Function 的錯誤用 `functionErrorMessage()`。
4. **日期一律用 `@/lib/dates` 的 `taipeiToday()` / `toDateStr()`**，禁止 `new Date().toISOString().slice(0,10)`（ESLint 會擋）。寫 `timestamptz` 才用 `toISOString()`。
5. **頁面守門等 `permsLoaded`**，不要只看 `loading`。
6. `useEffect` 依賴的陣列預設值用 module-scope 常數（`const EMPTY: T[] = []`），避免無限重跑。
7. 下拉選項走 `useLookup(category)`（`@/lib/lookups`），不要在頁面寫死選項；狀態機的值（工序／單據狀態）例外，那些在 DB CHECK 裡。
8. 新增功能頁：① `module_registry` 有該模組 → ② `menus` 加選單（`module_key` 對應）→ ③ 頁面包 `<RequirePerm module=…>`。前端零改動即可出現在側欄與權限矩陣。
9. 圖示欄位存 lucide-react 匯出名（`KanbanSquare`），由 `<Icon name=…>` 動態解析。
10. 查詢一律指定欄位，不用 `select("*")`（底座設定頁例外）；列表分頁 `range()`，每頁 50。

## 3. 目錄

- `src/lib/auth.tsx` AuthProvider：session／profile／company／employee／perms／modules，`can()`、`moduleEnabled()`、`switchCompany()`
- `src/components/RequirePerm.tsx` 頁面守門；`src/components/layout/*` 版面與側欄（資料驅動）
- `src/routes/dashboard/settings/*` 各公司自管：員工與帳號、角色與權限、通知規則、公司設定、代碼字典
- `src/routes/dashboard/system/*` 系統：選單、參數、三種日誌、版本更新
- `supabase/migrations/` 001–004 底座；`supabase/functions/` Edge Functions；`supabase/verify/` 越權驗證腳本（每個 Sprint 都要跑）
