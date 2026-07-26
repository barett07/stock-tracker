# CLAUDE.md — stock-tracker

**台股籌碼追蹤** — 每週抓集保戶股權分散表,追蹤大戶/散戶比例變化並推播警示。

- 正式網址:https://barett07.github.io/stock-tracker/(repo public,免費帳號 private 無法用 Pages)
- 上線日:2026-05-16

## 架構速覽

| 層 | 選擇 |
|---|---|
| 前端 | 純 HTML/CSS/JS,無 build tool,GitHub Pages 部署 |
| 資料庫 | 共用 RailwayShift 的 Supabase 專案(`oqyjixphmdrhcmomskth`),table 前綴 `st_` |
| Edge Functions | `stock-auth`(驗證)、`stock-ingest`(GitHub Actions 寫入)、`stock-screen`(篩選 + Telegram 推播) |
| 排程 | GitHub Actions `weekly-fetch.yml`,每天 07:00 Asia/Taipei 檢查,DB 已有同週資料就跳過(TDCC 遇颱風假會延後公布) |
| 資料源 | TDCC 股權分散表 + TWSE STOCK_DAY_ALL(皆免費,FinMind 已捨棄) |

- 資料表結構:`supabase/migrations/001_init.sql`
- 權限:editor(Stan,可調篩選/刪警示)、viewer(朋友,唯讀+自己的觀察清單);passcode 經 `stock-auth` 驗證後存 `localStorage.st_auth_v1`
- Secrets:Supabase 端 `STOCK_EDITOR_PASSCODE`、`STOCK_VIEWER_PASSCODE`、`STOCK_INGEST_TOKEN`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`(只能在 Dashboard 或 CLI 設);GitHub 端 `SUPABASE_URL`、`STOCK_INGEST_TOKEN`
- Telegram bot:`@stan_stock_chip_bot`;設定教學見 `TELEGRAM_SETUP.md`
- 前端預覽:`?demo=1` 用假資料跳過後端

## 先讀這些

- **`NOTES.md`** — 所有踩坑記錄與資料細節:TDCC/TWSE 資料源限制、持股分級對應表、民國年轉換、week_end 規則、verify_jwt 六週失敗始末、PostgREST 1000 筆上限、demo mode。**動爬蟲、Edge Function、篩選邏輯前先查對應段落。**

## ⚠️ 紅線(不知道就會犯錯,細節在 NOTES.md)

1. **Edge Function 部署一律用 `./deploy.sh`**(verify_jwt 已寫死在 `supabase/config.toml`,腳本含部署後自動驗證)。verify_jwt 被靜默重置曾導致排程連續失敗 6 週。例外:剛改過 secrets 時 CLI 部署不會重載,驗證失敗就改用 MCP 部署(必帶 `verify_jwt: false`),詳見 NOTES.md
2. **innerHTML 中所有 Supabase 文字欄位必須套 `escapeHtml()`**(定義在 `js/app.js` 底部)
3. **新 Edge Function 的 CORS 限定 `https://barett07.github.io`**,不要用 `*`
4. **PostgREST 最多回 1000 筆**,aggregate/distinct 一律用 RPC 在 DB 端做
5. TDCC 沒有歷史資料,**不能 backfill**;TWSE 日期是 7 碼民國年
6. holdings 寫入前必須與 TWSE 股票清單**雙向交集**(FK 約束,否則 500)
7. **對比度須過 WCAG AA**(按鈕文字、表單標籤、placeholder、focus 框、錯誤訊息都算);**不要用裸 `vh`**:版面高度(`min-height`)用 `dvh`、彈窗/捲動區上限(`max-height`)用 `svh`(iOS Safari 網址列);**不用純黑 `#000` / 純白 `#fff`**,改用 off-black / off-white
8. **畫面上的數字一律來自真實資料**;`?demo=1` 的假資料必須明顯標示,不可混充真實籌碼數據。**空狀態、載入中、錯誤狀態都要有畫面**,不能空白

## ✅ 改完自檢(交付前逐條確認)

- 改了 innerHTML?→ Supabase 來的文字都套了 `escapeHtml()`
- 改了 Edge Function?→ 用 `./deploy.sh` 部署且驗證全綠;改了排程相關就 `gh workflow run "Weekly Fetch"` 實測
- 改了爬蟲?→ 民國年轉換、雙向交集、week_end 規則都沒破壞(NOTES.md)
- 前端改動用 `?demo=1` 本地預覽過
- 改了畫面?→ 對比度過 WCAG AA;沒有裸 `vh`(min-height→`dvh`、max-height→`svh`);沒有純黑純白;空/載入中/錯誤狀態都有畫面;數字都是真的

## 部署

```bash
cd "/Users/stan/Claude Code/stock-tracker"
git add . && git commit -m "說明" && git push
```

Edge Function 部署見紅線第 1 條。

## 協作規則

- **寫任何程式碼前**,先與 Stan 討論方向,等 Stan 說「開始生成」才動手,不可推測性實作
- **發布三步驟,不可跳過**:1. 本地預覽讓 Stan 確認 → 2. Stan OK 後才 `git add` + `git commit` → 3. Stan 明確說「推上去」才 `git push`
