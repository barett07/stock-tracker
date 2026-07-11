# NOTES — stock-tracker 技術細節與踩坑記錄

## FinMind 免費版無法用,已捨棄

FinMind 免費版(register 等級)的「集保戶股權分散表」(`TaiwanStockHoldingSharesPer`)與「全市場單日收盤」(不帶 `data_id` 的 `TaiwanStockPrice`)皆已改為付費(Sponsor 等級 NT$ 99/月起)。本專案改用 TDCC + TWSE 官方來源全部免費。

**未來若需要新籌碼資料**,先去 TDCC https://www.tdcc.com.tw/portal/zh/stats/openData 找對應 id,不要回頭找 FinMind。

## TDCC 只給「本週快照」,沒有歷史

`opendata.tdcc.com.tw/getOD.ashx?id=1-5` 每週六公布**僅當週**的全市場集保資料。沒有歷史檔下載點、沒有 zip 壓縮包、沒有付費歷史 API。所以:

- **不能 backfill**(爬蟲已移除 `--backfill` 參數)
- 第一批趨勢警示必須累積 4 週後才出現
- 累積期間(< 4 週)前端顯示「本週大戶集中度 TOP 30」+ 進度提示,避免畫面空白

如果要強行取得歷史,唯一方式是付費 FinMind Sponsor 一次性訂閱 1 個月做歷史 backfill,之後退訂改 TDCC。Stan 目前選擇純免費等 4 週。

## TDCC 持股分級代碼對應

TDCC CSV 的「持股分級」欄是 1-17 的數字,對應如下(schema 欄位以「張」為單位,TDCC 以「股」為單位,1 張 = 1000 股):

| TDCC 分級 | 範圍(股)| schema 欄位 | 備註 |
|---:|---|---|---|
| 1 | 1-999 | `holders_1_5` | 不到 1 張,合併進「1-5 張」|
| 2 | 1,000-5,000 | `holders_1_5` | 1-5 張 |
| 3-13 | 5,001 - 800,000 | `holders_5_10` ~ `holders_600_800` | 直接對應 |
| 14 | 800,001-1,000,000 | `holders_800_1000` | |
| 15 | 1,000,001 以上 | `holders_1000_plus` | 千張大戶 |
| 16 | — | (跳過)| 差異數調整 |
| 17 | — | (跳過)| 合計列 |

**散戶**:級距 1+2+3(10 張以下)→ `shares_under_10` / `small_ratio`
**大戶**:級距 14+15(800 張以上)→ `shares_over_800` / `large_ratio`

詳見 `scripts/fetch_data.py` 的 `LEVEL_MAP`。

## 普通股代號過濾

TWSE STOCK_DAY_ALL 與 TDCC 都含 ETF、權證、債券。**普通股的過濾條件**:

```python
code.isdigit() and len(code) == 4 and code[0] != "0"
```

`00XX` 開頭都是 ETF(含 0050、0056、00878 等熱門 ETF)。`YY0061` 之類字母開頭是公司債、權證、特別股。

## TWSE 與 TDCC 必須雙向交集

TWSE STOCK_DAY_ALL 約 1075 檔上市普通股,TDCC 含上市+上櫃+興櫃約 2930 檔。`st_holdings.stock_id` 是 FOREIGN KEY 到 `st_stocks`,所以 holdings 必須過濾到「TWSE 有提供收盤的那些股票」才能寫入,否則 500 Server Error。

```python
twse_ids = {s["stock_id"] for s in stocks}
tdcc_ids = {h["stock_id"] for h in holdings}
keep = twse_ids & tdcc_ids   # 雙向交集
```

## TWSE OpenAPI 日期是民國年

`STOCK_DAY_ALL` 回傳的 `Date` 欄位是 7 碼民國年(`"1150515"` = 民國 115 年 5 月 15 日),不是西元。轉西元的方法:

```python
yy = int(roc[:3]) + 1911           # 115 → 2026
date = f"{yy}-{roc[3:5]}-{roc[5:]}"  # "2026-05-15"
```

## `week_end` 統一以 TDCC 的「資料日期」為準

TDCC CSV 的「資料日期」是「集保編表日」(通常是該週週五),TWSE 收盤的日期是「最後交易日」(同一週週五但偶爾不同)。為了讓 `st_prices` 與 `st_holdings` 能用 `week_end` JOIN,**爬蟲統一將兩邊的 `week_end` 設為 TDCC 那個日期**。

## stock-screen 對 capital null 不過濾

原 plan 想用「股本 > 3 億」過濾極小型雜訊,但 TWSE OpenAPI 與 TDCC 都不直接提供股本,所以 `st_stocks.capital` 目前都是 null。

**踩坑**:原本程式碼寫 `(s.capital ?? 0) >= CAPITAL_MIN`,null 被轉成 0,導致所有股票都被擋掉、紅黃燈永遠不會出現。正確寫法:

```typescript
s.capital === null || s.capital >= CAPITAL_MIN
```

若 4 週後雜訊太多,可補抓 TWSE「個股月成交資訊」或證交所「上市公司基本資料」拿到股本,再啟用過濾。

## Edge Function 部署必須用 MCP,不能只靠 supabase CLI

`supabase functions deploy --project-ref` 可以上傳程式碼,但**不會讓 Edge Function 重新載入 secrets**。實測:用 CLI 重部署後呼叫仍然拿到 401,改用 Supabase MCP 的 `deploy_edge_function` 工具後立刻生效。

**所以標準流程是:**
1. `supabase secrets set KEY=VALUE --project-ref oqyjixphmdrhcmomskth`(更新 secret 值)
2. MCP `deploy_edge_function`(重部署,讓 function 吃到新 secret),**必帶 `verify_jwt: false`**(見下一條)

`supabase secrets set` 後 `supabase secrets list` 的 digest 確實會變,但 function 需要 MCP 重新部署才能讀到新值。

## 🚨 verify_jwt 被靜默重置 → 連續 6 週排程失敗(2026-07-09 修復)

`weekly-fetch.yml` 從 2026-05-30 起連續 6 週失敗,兩種交錯症狀:

1. **`stock-ingest` 回 401**:`stock-ingest`/`stock-screen` 靠自己的 `X-Ingest-Token` 認證,不需要 JWT,但 Supabase 上的 `verify_jwt` 不知何時被改回 `true`(預設值)。GitHub Actions 沒帶 Authorization JWT,請求在程式碼執行前就被閘道擋掉。
2. **TWSE OpenAPI 偶發回傳空內容**:非我方問題,`fetch_data.py` 的 `fetch_twse_daily_all()` 已加重試(最多 3 次、間隔 5 秒)緩解。

**根本原因**:MCP `deploy_edge_function` 的 `verify_jwt` 參數**預設是 `true`**。專案沒有 `supabase/config.toml` 宣告各 function 的設定,只要哪次重部署忘了明確帶 `verify_jwt: false`,就會被靜默改回預設值。跟「CLI 部署不會重載 secrets」同類:**部署動作有副作用,不是純粹的程式碼上傳**。

**規則**:重部署 `stock-ingest`、`stock-screen` 時一定要帶 `verify_jwt: false`,部署後手動觸發一次 workflow 驗證(`gh workflow run "Weekly Fetch"`)。若常忘記,考慮補 `supabase/config.toml` 把設定寫死進 git。

(2026-07-09 修復後手動觸發已成功;第一次真正的 schedule 驗證是 2026-07-11 週六 07:00。)

## Edge Function CORS 設定

所有三個 Edge Function 的 CORS 限定為 `https://barett07.github.io`(不是 `*`):
- `stock-auth`:前端呼叫,限定網域
- `stock-screen`:前端呼叫,限定網域
- `stock-ingest`:GitHub Actions 呼叫(非瀏覽器,CORS 對其無效),限定網域不影響排程

**新增 Edge Function 時也應沿用此設定,不要用 `*`。**

## XSS 防護

`js/app.js` 底部定義了 `escapeHtml(s)` 函式。**所有從 Supabase 撈回的文字欄位(股票名稱、產業別等)在 innerHTML 中都已套用 `escapeHtml()`。** 新增 innerHTML 渲染時務必沿用。

## Supabase Secrets 必須在 Dashboard 手動設

目前 Supabase MCP 沒有設 Edge Function secret 的工具。Edge Function 用的 5 個 secret(`STOCK_*` + `TELEGRAM_*`)只能:
- Dashboard:https://supabase.com/dashboard/project/oqyjixphmdrhcmomskth/functions/secrets
- 或 `supabase secrets set --project-ref oqyjixphmdrhcmomskth` CLI

## GitHub Pages 免費版要 public

Stan 的 GitHub 免費帳號 private repo **不能用 GitHub Pages**(會回 422 "Your current plan does not support GitHub Pages")。所以 repo 設為 public。安全模型跟 familycal 一樣:
- 程式碼公開沒問題(anon key 在前端 config.js 本來就會被瀏覽器讀到)
- 所有敏感 token 都在 GitHub Secrets / Supabase Secrets,**沒寫入程式碼**
- `.gitignore` 已排除 `.env` 等檔

## Demo Mode(前端預覽用)

`?demo=1` query string 會跳過 Supabase 直接用 `mockFetch()` 內的假資料。本機沒部署後端時可以預覽完整 UI(含警示、TOP 30、詳情圖表)。詳見 `js/app.js` 的 `DEMO` 常數與 `mockFetch()` 函式。

## PostgREST 預設最多回傳 1000 筆

Supabase PostgREST 的 `max-rows` 預設是 **1000**。URL 帶 `&limit=5000` 也沒用,server 端會截斷。

**踩坑實例**:`loadWeeks()` 原本用 `SELECT week_end FROM st_holdings ORDER BY week_end DESC LIMIT 5000` 期望拿到所有週次再去重複,但每週約有 1080 筆資料,1000 筆截斷後全部都是最新那週,導致前端只顯示「1 / 4 週」、累積進度永遠不增加。

**解法**:需要 aggregate / distinct 的查詢一律用 RPC(database function)在 DB 端處理,不要讓 PostgREST 傳大量資料再前端去重複。本專案已建立 `get_distinct_weeks()` function(`supabase/migrations/002_add_get_distinct_weeks_rpc.sql`),`loadWeeks()` 改呼叫 `/rpc/get_distinct_weeks`。

## 累積進度 UI

`loadSnapshot()` 用 `S.weeks.length` 判斷累積週數,< 4 時顯示「資料累積中 X / 4 週」藍色提示條。`loadWeeks()` 呼叫 RPC `get_distinct_weeks` 取得各週 `week_end`(不直接查 `st_holdings` 全表,也不查 `st_alerts`,因為累積期間還沒 alerts)。
