# stock-tracker 專案說明

## 基本資訊

- **正式網址**：https://barett07.github.io/stock-tracker/（上線後）
- **GitHub Repo**：https://github.com/barett07/stock-tracker
- **本地路徑**：`/Users/stan/Claude Code/stock-tracker`

## 技術架構

| 層 | 選擇 |
|---|---|
| 前端 | 純 HTML/CSS/JS，無 build tool，GitHub Pages 部署 |
| 資料庫 | 共用 RailwayShift 的 Supabase 專案（`oqyjixphmdrhcmomskth`） |
| Table 前綴 | `st_`（st_stocks、st_prices、st_holdings、st_alerts、st_watchlist） |
| 驗證 | Edge Function `stock-auth`（仿 familycal `fc-auth`） |
| 寫入 | Edge Function `stock-ingest`（由 GitHub Actions 呼叫） |
| 篩選 | Edge Function `stock-screen`（含 Telegram 推播） |
| 排程 | GitHub Actions，每週六 07:00 Asia/Taipei |
| 通知 | Telegram Bot |

## Supabase Secrets（在 dashboard 手動管理）

- `STOCK_EDITOR_PASSCODE`：Stan 用，可調整篩選條件
- `STOCK_VIEWER_PASSCODE`：給朋友，只能查看
- `STOCK_INGEST_TOKEN`：GitHub Actions 寫入用，隨機長字串
- `TELEGRAM_BOT_TOKEN`：BotFather 發的
- `TELEGRAM_CHAT_ID`：推播目標（個人或群組）
- `FINMIND_TOKEN`：FinMind 免費版註冊取得（Supabase 不直接用，僅作備援）

## GitHub Secrets（actions 用）

- `SUPABASE_URL`：`https://oqyjixphmdrhcmomskth.supabase.co`
- `STOCK_INGEST_TOKEN`：同 Supabase 那組
- `FINMIND_TOKEN`：抓資料用

## 資料表結構

詳見 `supabase/migrations/001_init.sql`。

## 部署流程

```bash
cd "/Users/stan/Claude Code/stock-tracker"
git add .
git commit -m "說明"
git push
```

Edge Function 部署（要先裝 supabase CLI）：

```bash
supabase functions deploy stock-auth --project-ref oqyjixphmdrhcmomskth
supabase functions deploy stock-ingest --project-ref oqyjixphmdrhcmomskth
supabase functions deploy stock-screen --project-ref oqyjixphmdrhcmomskth
```

## 使用者與權限

- **editor**：Stan — 可調整篩選參數、刪除歷史警示
- **viewer**：朋友 — 只能查看警示清單與股票詳情，可加自己的觀察清單

passcode 透過 `stock-auth` Edge Function 驗證後存到 `localStorage.st_auth_v1`。
