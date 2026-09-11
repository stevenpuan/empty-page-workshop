# S8 — LINE 帳號綁定機制 交付說明

**Sprint Tag:** S8-LINE  
**日期:** 2026-09-11  
**範圍:** LINE 綁定碼自助綁定 + Webhook 接收

---

## 一、交付物件

| 類型 | 名稱 | 說明 |
|------|------|------|
| Migration | `013_line_binding.sql` | 綁定碼欄位、產碼函式、綁定/解綁函式 |
| Edge Function | `line-webhook` | 接收 LINE Webhook，處理綁定碼比對 |

## 二、資料庫變更

### 新增欄位（employees 表）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `line_bind_code` | text | 6 碼綁定碼（大寫英數，排除 0OI1L 混淆字） |
| `line_bind_at` | timestamptz | 綁定時間 |

### 新增索引

- `uq_employees_line_bind_code` — 唯一索引（partial, WHERE NOT NULL）

### 新增函式（5 個）

| 函式 | 權限 | 說明 |
|------|------|------|
| `generate_line_bind_code()` | DEFINER / authenticated | 產生唯一 6 碼（碰撞重試） |
| `trg_auto_line_bind_code()` | DEFINER | 新員工 INSERT 自動產碼 trigger |
| `refresh_line_bind_code(uuid)` | DEFINER / authenticated | 重新產碼並清除舊綁定 |
| `bind_line_account(text, text)` | DEFINER / anon + authenticated | Webhook 呼叫，綁定碼 → line_user_id |
| `unbind_line_account(uuid)` | DEFINER / authenticated | 清除 line_user_id 和綁定時間 |

### 新增觸發器

- `auto_line_bind_code` — BEFORE INSERT ON employees，自動產碼

## 三、Edge Function: line-webhook

### 功能

接收 LINE Messaging API 的 Webhook 事件，支援：

1. **follow 事件** — 用戶加好友時，回覆歡迎訊息引導輸入綁定碼
2. **綁定碼** — 員工輸入 6 碼，自動比對並綁定 `line_user_id`
3. **「解綁」指令** — 清除綁定
4. **「狀態」/「查詢」指令** — 查看當前綁定資訊
5. **「幫助」指令** — 顯示可用指令列表

### Webhook URL

```
祥興印刷：https://sfpjbimwmhqpywjsfhgl.supabase.co/functions/v1/line-webhook?key=XX
沂融企業社：https://sfpjbimwmhqpywjsfhgl.supabase.co/functions/v1/line-webhook?key=YR
```

### 安全設計

- **簽章驗證**：使用 `LINE_CHANNEL_SECRET_{key}` 驗證 `x-line-signature`（HMAC-SHA256）
- **綁定碼防碰撞**：唯一索引 + loop 重試
- **一 LINE 一員工**：同一 LINE user_id 不可綁定多個員工
- **已綁定保護**：已綁定的帳號需主管重新產碼才能改綁

### 所需 Secrets（Supabase Dashboard → Edge Functions → Secrets）

| Secret 名稱 | 來源 |
|-------------|------|
| `LINE_CHANNEL_TOKEN_XX` | 祥興印刷 LINE Official Account → Messaging API → Channel Access Token |
| `LINE_CHANNEL_TOKEN_YR` | 沂融企業社 LINE Official Account → Channel Access Token |
| `LINE_CHANNEL_SECRET_XX` | 祥興印刷 → Channel Secret |
| `LINE_CHANNEL_SECRET_YR` | 沂融企業社 → Channel Secret |

## 四、LINE 官方帳號設定步驟

### 1. 建立 LINE Official Account（如尚未建立）

1. 前往 [LINE Official Account Manager](https://manager.line.biz/)
2. 建立帳號（祥興印刷 / 沂融企業社各一個）
3. 進入「設定」→「Messaging API」→ 啟用

### 2. 取得 Channel 資訊

1. 前往 [LINE Developers Console](https://developers.line.biz/)
2. 選擇對應的 Provider → Channel
3. 記下 **Channel Secret**
4. 點「Issue」產生 **Channel Access Token (long-lived)**

### 3. 設定 Webhook URL

1. LINE Developers Console → Channel → Messaging API
2. Webhook URL 填入：
   - 祥興：`https://sfpjbimwmhqpywjsfhgl.supabase.co/functions/v1/line-webhook?key=XX`
   - 沂融：`https://sfpjbimwmhqpywjsfhgl.supabase.co/functions/v1/line-webhook?key=YR`
3. 開啟「Use webhook」
4. 關閉「Auto-reply messages」（系統接管回覆）

### 4. 存入 Supabase Secrets

在 Supabase Dashboard → Project Settings → Edge Functions → Secrets 新增：
- `LINE_CHANNEL_TOKEN_XX` = 祥興的 Channel Access Token
- `LINE_CHANNEL_TOKEN_YR` = 沂融的 Channel Access Token
- `LINE_CHANNEL_SECRET_XX` = 祥興的 Channel Secret
- `LINE_CHANNEL_SECRET_YR` = 沂融的 Channel Secret

### 5. 設定 companies 表的 line_channel_key

```sql
UPDATE companies SET line_channel_key = 'XX' WHERE short_code = 'XX';
UPDATE companies SET line_channel_key = 'YR' WHERE short_code = 'YR';
```

## 五、員工綁定流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  老闆/主管    │     │   員工 LINE   │     │  line-webhook │
│  系統頁面     │     │   聊天室      │     │  Edge Fn      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 查看員工綁定碼      │                    │
       │ (如 8SRTP5)        │                    │
       │ ──告知員工──→      │                    │
       │                    │                    │
       │                    │ 加好友              │
       │                    │ ──────────────────→│
       │                    │   ←歡迎訊息────────│
       │                    │                    │
       │                    │ 傳送 "8SRTP5"      │
       │                    │ ──────────────────→│
       │                    │                    │ bind_line_account()
       │                    │   ←✅ 綁定成功！────│
       │                    │                    │
       │                    │ ← 系統通知推播 ─────│ (trg_line_push_immediate)
```

## 六、前端整合建議（Lovable）

1. **員工管理頁** — 顯示每位員工的 `line_bind_code`、`line_user_id`（已綁定/未綁定狀態）、`line_bind_at`
2. **重新產碼按鈕** — 呼叫 `refresh_line_bind_code(employee_id)`，適用於員工換手機等情境
3. **綁定碼可複製** — 方便主管用 LINE 轉發給員工
4. **個人設定頁（員工）** — 顯示自己的 LINE 綁定狀態

## 七、統計

| 項目 | 本次新增 | 累計 |
|------|---------|------|
| 欄位 | +2 | — |
| 函式 | +5 | 76 |
| 觸發器 | +1 | — |
| 索引 | +1 | — |
| Edge Functions | +1 | 5 |
