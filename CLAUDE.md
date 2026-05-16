# stock-tracker 專案說明

## 基本資訊

- **正式網址**：https://barett07.github.io/stock-tracker/
- **GitHub Repo**：https://github.com/barett07/stock-tracker（public，免費帳號的 private repo 無法用 Pages）
- **本地路徑**：`/Users/stan/Claude Code/stock-tracker`
- **上線日**：2026-05-16

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
- `TELEGRAM_BOT_TOKEN`：BotFather 發的（bot username `@stan_stock_chip_bot`）
- `TELEGRAM_CHAT_ID`：推播目標（個人或群組）

## GitHub Secrets（actions 用）

- `SUPABASE_URL`：`https://oqyjixphmdrhcmomskth.supabase.co`
- `STOCK_INGEST_TOKEN`：同 Supabase 那組

## 資料源（皆免費，無需 token）

- 集保戶股權分散表：`https://opendata.tdcc.com.tw/getOD.ashx?id=1-5`（每週六公布，只給本週快照）
- 全市場單日收盤：`https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`

> 註：FinMind 免費版的 `TaiwanStockHoldingSharesPer` 已改為付費，所以本專案改用上述官方來源。

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

---

## 已知技術細節與踩坑記錄

### FinMind 免費版無法用，已捨棄

FinMind 免費版（register 等級）的「集保戶股權分散表」（`TaiwanStockHoldingSharesPer`）與「全市場單日收盤」（不帶 `data_id` 的 `TaiwanStockPrice`）皆已改為付費（Sponsor 等級 NT$ 99/月起）。本專案改用 TDCC + TWSE 官方來源全部免費。

**未來若需要新籌碼資料**，先去 TDCC https://www.tdcc.com.tw/portal/zh/stats/openData 找對應 id，不要回頭找 FinMind。

### TDCC 只給「本週快照」，沒有歷史

`opendata.tdcc.com.tw/getOD.ashx?id=1-5` 每週六公布**僅當週**的全市場集保資料。沒有歷史檔下載點、沒有 zip 壓縮包、沒有付費歷史 API。所以：

- **不能 backfill**（爬蟲已移除 `--backfill` 參數）
- 第一批趨勢警示必須累積 4 週後才出現
- 累積期間（< 4 週）前端顯示「本週大戶集中度 TOP 30」+ 進度提示，避免畫面空白

如果要強行取得歷史，唯一方式是付費 FinMind Sponsor 一次性訂閱 1 個月做歷史 backfill，之後退訂改 TDCC。Stan 目前選擇純免費等 4 週。

### TDCC 持股分級代碼對應

TDCC CSV 的「持股分級」欄是 1-17 的數字，對應如下（schema 欄位以「張」為單位，TDCC 以「股」為單位，1 張 = 1000 股）：

| TDCC 分級 | 範圍（股）| schema 欄位 | 備註 |
|---:|---|---|---|
| 1 | 1-999 | `holders_1_5` | 不到 1 張，合併進「1-5 張」|
| 2 | 1,000-5,000 | `holders_1_5` | 1-5 張 |
| 3-13 | 5,001 - 800,000 | `holders_5_10` ~ `holders_600_800` | 直接對應 |
| 14 | 800,001-1,000,000 | `holders_800_1000` | |
| 15 | 1,000,001 以上 | `holders_1000_plus` | 千張大戶 |
| 16 | — | （跳過）| 差異數調整 |
| 17 | — | （跳過）| 合計列 |

**散戶**：級距 1+2+3（10 張以下）→ `shares_under_10` / `small_ratio`
**大戶**：級距 14+15（800 張以上）→ `shares_over_800` / `large_ratio`

詳見 `scripts/fetch_data.py` 的 `LEVEL_MAP`。

### 普通股代號過濾

TWSE STOCK_DAY_ALL 與 TDCC 都含 ETF、權證、債券。**普通股的過濾條件**：

```python
code.isdigit() and len(code) == 4 and code[0] != "0"
```

`00XX` 開頭都是 ETF（含 0050、0056、00878 等熱門 ETF）。`YY0061` 之類字母開頭是公司債、權證、特別股。

### TWSE 與 TDCC 必須雙向交集

TWSE STOCK_DAY_ALL 約 1075 檔上市普通股，TDCC 含上市+上櫃+興櫃約 2930 檔。`st_holdings.stock_id` 是 FOREIGN KEY 到 `st_stocks`，所以 holdings 必須過濾到「TWSE 有提供收盤的那些股票」才能寫入，否則 500 Server Error。

```python
twse_ids = {s["stock_id"] for s in stocks}
tdcc_ids = {h["stock_id"] for h in holdings}
keep = twse_ids & tdcc_ids   # 雙向交集
```

### TWSE OpenAPI 日期是民國年

`STOCK_DAY_ALL` 回傳的 `Date` 欄位是 7 碼民國年（`"1150515"` = 民國 115 年 5 月 15 日），不是西元。轉西元的方法：

```python
yy = int(roc[:3]) + 1911           # 115 → 2026
date = f"{yy}-{roc[3:5]}-{roc[5:]}"  # "2026-05-15"
```

### `week_end` 統一以 TDCC 的「資料日期」為準

TDCC CSV 的「資料日期」是「集保編表日」（通常是該週週五），TWSE 收盤的日期是「最後交易日」（同一週週五但偶爾不同）。為了讓 `st_prices` 與 `st_holdings` 能用 `week_end` JOIN，**爬蟲統一將兩邊的 `week_end` 設為 TDCC 那個日期**。

### stock-screen 對 capital null 不過濾

原 plan 想用「股本 > 3 億」過濾極小型雜訊，但 TWSE OpenAPI 與 TDCC 都不直接提供股本，所以 `st_stocks.capital` 目前都是 null。`stock-screen` Edge Function 內加了 `capital == null || capital >= CAPITAL_MIN` 邏輯，避免全部被誤過濾。

若 4 週後雜訊太多，可補抓 TWSE「個股月成交資訊」或證交所「上市公司基本資料」拿到股本，再啟用過濾。

### Edge Function 部署用 MCP，不用 supabase CLI

本機沒裝過 `supabase login`，且互動式登入難以從 Claude Code 自動化。實際部署都用 Supabase MCP 的 `deploy_edge_function` 工具，把本機 `index.ts` 內容傳上去（含 BOM 與中文字串要注意編碼）。

### Supabase Secrets 必須在 Dashboard 手動設

目前 Supabase MCP 沒有設 Edge Function secret 的工具。Edge Function 用的 5 個 secret（`STOCK_*` + `TELEGRAM_*`）只能：
- Dashboard：https://supabase.com/dashboard/project/oqyjixphmdrhcmomskth/functions/secrets
- 或 `supabase secrets set --project-ref oqyjixphmdrhcmomskth` CLI

### GitHub Pages 免費版要 public

Stan 的 GitHub 免費帳號 private repo **不能用 GitHub Pages**（會回 422 "Your current plan does not support GitHub Pages"）。所以 repo 設為 public。安全模型跟 familycal 一樣：
- 程式碼公開沒問題（anon key 在前端 config.js 本來就會被瀏覽器讀到）
- 所有敏感 token 都在 GitHub Secrets / Supabase Secrets，**沒寫入程式碼**
- `.gitignore` 已排除 `.env` 等檔

### Demo Mode（前端預覽用）

`?demo=1` query string 會跳過 Supabase 直接用 `mockFetch()` 內的假資料。本機沒部署後端時可以預覽完整 UI（含警示、TOP 30、詳情圖表）。詳見 `js/app.js` 的 `DEMO` 常數與 `mockFetch()` 函式。

### 累積進度 UI

`loadSnapshot()` 用 `S.weeks.length` 判斷累積週數，< 4 時顯示「資料累積中 X / 4 週」藍色提示條。`loadWeeks()` 從 `st_holdings` 撈 distinct `week_end`（不是從 `st_alerts`，因為累積期間還沒 alerts）。
