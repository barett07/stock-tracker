# Stock Tracker — 台股籌碼追蹤

每週自動抓「集保戶股權分散表」，找出**股價低、但大戶默默收購**的潛伏標的。

## 篩選條件（籌碼集中度版）

- 上市股票（不含 OTC）
- 收盤價 < 15 元
- 排除全額交割、變更交易方法、停止買賣
- **大戶**：800 張以上持股人數佔比 → 過去 4 週連續上升
- **散戶**：10 張以下持股人數佔比 → 過去 4 週連續下降
- 股本 > 3 億（避免極小型雜訊）

**等級**：
- 🟡 黃燈 — 4 週中 3 週滿足趨勢
- 🔴 紅燈 — 4 週連續滿足（Telegram 推播）

## 架構

- **資料源（皆免費）**：
  - 集保戶股權分散表 — [TDCC 開放資料](https://opendata.tdcc.com.tw/getOD.ashx?id=1-5) `id=1-5`
  - 全市場單日收盤 — [TWSE OpenAPI](https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL) `STOCK_DAY_ALL`
- **排程**：GitHub Actions 每週六 07:00 (Asia/Taipei)
- **後端**：Supabase（共用 RailwayShift 專案，表前綴 `st_`）
- **通知**：Telegram Bot
- **前端**：純 HTML/JS，GitHub Pages 部署

## 線上網址

https://barett07.github.io/stock-tracker/

## 上線時程

TDCC 開放資料**只提供本週快照**（沒有歷史檔），所以需要 4 週連續累積後才能跑出第一批警示。
排程是每週六 07:00 自動執行，第 4 個週六起會收到 Telegram 紅燈推播。

## 本地開發

```bash
# 預覽前端
cd "/Users/stan/Claude Code/stock-tracker"
python3 -m http.server 8000
# 開 http://localhost:8000

# 測試 Python 爬蟲
cd scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python fetch_data.py --dry-run
```
