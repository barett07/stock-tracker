#!/usr/bin/env python3
"""
每週爬蟲（完全免費版 — 用 TWSE OpenAPI + TDCC 開放資料）：

  1. TWSE OpenAPI 抓全市場單日收盤（STOCK_DAY_ALL）
     → 取得 stock_id, name, close, volume
  2. TDCC 開放資料抓本週集保戶股權分散表（id=1-5）
     → 取得各持股級距人數、計算 large_ratio / small_ratio
  3. 整合後 POST 給 stock-ingest Edge Function

執行：
  python fetch_data.py [--dry-run] [--limit N]

注意：
  - TDCC 只提供「本週快照」，沒有歷史檔，所以不支援 --backfill
  - 第一次部署到第 4 週才會出現警示（因為要 4 週連續趨勢）

環境變數：
  STOCK_INGEST_TOKEN
  SUPABASE_URL          e.g. https://oqyjixphmdrhcmomskth.supabase.co
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
from datetime import date
from typing import Any

import requests

TWSE_DAILY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TDCC_SHAREHOLDING = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"

UA = {"User-Agent": "Mozilla/5.0 (stock-tracker)"}


# ---------------------------------------------------------------------------
# TWSE — 全市場單日收盤
# ---------------------------------------------------------------------------

def fetch_twse_daily_all() -> tuple[list[dict], list[dict], str | None]:
    """回傳 (stocks, prices, trade_date_iso)。
    stocks: [{stock_id, name, market}, ...]
    prices: [{stock_id, week_end, close, volume}, ...]
    """
    r = requests.get(TWSE_DAILY_ALL, headers=UA, timeout=60)
    r.raise_for_status()
    data = r.json()

    if not data:
        return [], [], None

    # Date 民國 "1150515" → 西元 "2026-05-15"
    roc = data[0].get("Date", "")
    if len(roc) != 7 or not roc.isdigit():
        raise RuntimeError(f"TWSE date format unexpected: {roc!r}")
    trade_date = f"{int(roc[:3]) + 1911:04d}-{roc[3:5]}-{roc[5:]}"

    stocks: list[dict] = []
    prices: list[dict] = []
    for row in data:
        code = row.get("Code", "").strip()
        if not (code.isdigit() and len(code) == 4 and code[0] != "0"):
            continue  # 普通股：4 碼純數字、首碼非 0（00XX 是 ETF）
        name = row.get("Name", "").strip()
        close_str = (row.get("ClosingPrice") or "").strip()
        if not close_str or close_str == "--":
            continue
        try:
            close = float(close_str)
        except ValueError:
            continue
        if close <= 0:
            continue
        stocks.append({"stock_id": code, "name": name, "market": "TWSE"})
        try:
            volume_shares = int(row.get("TradeVolume", 0) or 0)
        except (TypeError, ValueError):
            volume_shares = 0
        prices.append({
            "stock_id": code,
            "week_end": trade_date,
            "close": close,
            "volume": volume_shares // 1000,  # 股 → 張
        })

    return stocks, prices, trade_date


# ---------------------------------------------------------------------------
# TDCC — 本週集保戶股權分散表
# ---------------------------------------------------------------------------

# TDCC 持股分級代碼 → schema 欄位（級距 16=差異調整、17=合計，跳過）
LEVEL_MAP = {
    1:  "holders_1_5",        # 1-999 股，合併到「1-5 張」
    2:  "holders_1_5",        # 1-5 張（1,000-5,000 股）
    3:  "holders_5_10",
    4:  "holders_10_15",
    5:  "holders_15_20",
    6:  "holders_20_30",
    7:  "holders_30_40",
    8:  "holders_40_50",
    9:  "holders_50_100",
    10: "holders_100_200",
    11: "holders_200_400",
    12: "holders_400_600",
    13: "holders_600_800",
    14: "holders_800_1000",
    15: "holders_1000_plus",
}
SMALL_LEVELS = {1, 2, 3}      # 10 張以下
LARGE_LEVELS = {14, 15}       # 800 張以上


def fetch_tdcc_shareholding() -> tuple[list[dict], str | None]:
    """回傳 (holdings, week_end_iso)。
    holdings: [{stock_id, week_end, holders_*, small_ratio, large_ratio, ...}, ...]
    """
    r = requests.get(TDCC_SHAREHOLDING, headers=UA, timeout=120)
    r.raise_for_status()
    text = r.content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    by_stock: dict[str, dict[int, dict[str, int]]] = {}
    week_end: str | None = None

    for row in reader:
        sid = (row.get("證券代號") or "").strip()
        if not (sid.isdigit() and len(sid) == 4 and sid[0] != "0"):
            continue  # 同 TWSE：普通股、排除 ETF
        try:
            level = int(row.get("持股分級", 0))
        except ValueError:
            continue
        if level not in LEVEL_MAP:
            continue
        d = (row.get("資料日期") or "").strip()
        if d and len(d) == 8 and not week_end:
            week_end = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        try:
            people = int(row.get("人數") or 0)
            shares = int(row.get("股數") or 0)
        except ValueError:
            people, shares = 0, 0
        by_stock.setdefault(sid, {})[level] = {"people": people, "shares": shares}

    holdings: list[dict] = []
    for sid, levels in by_stock.items():
        out: dict[str, Any] = {"stock_id": sid, "week_end": week_end}
        total_holders = 0
        total_shares = 0
        shares_under_10 = 0
        shares_over_800 = 0
        for lvl, d in levels.items():
            col = LEVEL_MAP[lvl]
            out[col] = (out.get(col) or 0) + d["people"]
            total_holders += d["people"]
            total_shares += d["shares"]
            if lvl in SMALL_LEVELS:
                shares_under_10 += d["shares"]
            if lvl in LARGE_LEVELS:
                shares_over_800 += d["shares"]
        if total_shares == 0:
            continue
        out["total_holders"] = total_holders
        out["total_shares"] = total_shares
        out["shares_under_10"] = shares_under_10
        out["shares_over_800"] = shares_over_800
        out["small_ratio"] = round(shares_under_10 / total_shares * 100, 3)
        out["large_ratio"] = round(shares_over_800 / total_shares * 100, 3)
        holdings.append(out)

    return holdings, week_end


# ---------------------------------------------------------------------------
# 上傳到 Supabase
# ---------------------------------------------------------------------------

def post_to_ingest(payload: dict, ingest_url: str, token: str) -> dict:
    r = requests.post(
        ingest_url,
        headers={"Content-Type": "application/json", "X-Ingest-Token": token},
        data=json.dumps(payload),
        timeout=180,
    )
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只抓資料、印摘要、不上傳")
    ap.add_argument("--limit", type=int, default=0, help="只處理前 N 檔（測試用）")
    args = ap.parse_args()

    print("→ TWSE 全市場單日收盤…", flush=True)
    stocks, prices, trade_date = fetch_twse_daily_all()
    print(f"   {len(prices)} 檔，交易日 {trade_date}", flush=True)

    print("→ TDCC 集保戶股權分散表…", flush=True)
    holdings, hold_date = fetch_tdcc_shareholding()
    print(f"   {len(holdings)} 檔，集保資料日 {hold_date}", flush=True)

    # 對齊 holdings 與 prices 的 week_end（取 TDCC 集保資料日為主）
    week_end = hold_date or trade_date or date.today().isoformat()
    for p in prices:
        p["week_end"] = week_end
    for h in holdings:
        h["week_end"] = week_end

    # 兩邊都有的股票才保留
    stock_ids_in_holdings = {h["stock_id"] for h in holdings}
    stocks = [s for s in stocks if s["stock_id"] in stock_ids_in_holdings]
    prices = [p for p in prices if p["stock_id"] in stock_ids_in_holdings]

    if args.limit:
        stocks = stocks[: args.limit]
        sids = {s["stock_id"] for s in stocks}
        prices = [p for p in prices if p["stock_id"] in sids]
        holdings = [h for h in holdings if h["stock_id"] in sids]

    print(f"\n📦 摘要：stocks={len(stocks)}, prices={len(prices)}, holdings={len(holdings)}", flush=True)
    print(f"   week_end = {week_end}")

    if args.dry_run:
        print("\n--dry-run：不上傳，holdings 前 2 筆：")
        for h in holdings[:2]:
            print("  " + json.dumps(h, ensure_ascii=False))
        return 0

    supabase_url = os.environ.get("SUPABASE_URL", "")
    ingest_token = os.environ.get("STOCK_INGEST_TOKEN", "")
    if not supabase_url or not ingest_token:
        print("❌ 未設定 SUPABASE_URL / STOCK_INGEST_TOKEN", file=sys.stderr)
        return 1

    ingest_url = f"{supabase_url.rstrip('/')}/functions/v1/stock-ingest"
    payload = {
        "week_end": week_end,
        "stocks": stocks,
        "prices": prices,
        "holdings": holdings,
        "run_screen": True,
    }
    print(f"\n→ POST {ingest_url}", flush=True)
    result = post_to_ingest(payload, ingest_url, ingest_token)
    print("✅ " + json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
