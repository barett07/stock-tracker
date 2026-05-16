#!/usr/bin/env python3
"""
每週爬蟲：
  1. 抓上市股票基本資料（FinMind TaiwanStockInfo）
  2. 抓最近一週的集保戶股權分散表（FinMind TaiwanStockShareholding 或 TaiwanStockHoldingSharesPer）
  3. 抓最近一週的週收盤（FinMind TaiwanStockPrice 取週五）
  4. 抓 TWSE 處置股 / 變更交易方法 / 全額交割股清單（網頁爬蟲）
  5. POST 給 stock-ingest Edge Function 統一寫入

執行：
  python fetch_data.py [--dry-run] [--week-end YYYY-MM-DD]

環境變數：
  FINMIND_TOKEN
  STOCK_INGEST_TOKEN
  SUPABASE_URL          e.g. https://oqyjixphmdrhcmomskth.supabase.co
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import requests

FINMIND_API = "https://api.finmindtrade.com/api/v4/data"
TWSE_PUNISH_URL = "https://www.twse.com.tw/zh/announcement/punish.html"
TWSE_NOTICE_URL = "https://www.twse.com.tw/zh/announcement/notice.html"


# ---------------------------------------------------------------------------
# 時間工具
# ---------------------------------------------------------------------------

def last_friday(ref: date | None = None) -> date:
    """傳回 ref（預設今天）之前最近的週五（含 ref 當天若為週五）。"""
    ref = ref or date.today()
    # weekday(): Mon=0 ... Fri=4 ... Sun=6
    delta = (ref.weekday() - 4) % 7
    return ref - timedelta(days=delta)


# ---------------------------------------------------------------------------
# FinMind 抓取
# ---------------------------------------------------------------------------

@dataclass
class FinMindClient:
    token: str

    def query(self, dataset: str, **params: Any) -> list[dict]:
        params = {"dataset": dataset, "token": self.token, **params}
        r = requests.get(FINMIND_API, params=params, timeout=60)
        r.raise_for_status()
        body = r.json()
        if body.get("status") != 200:
            raise RuntimeError(f"FinMind {dataset} error: {body.get('msg')}")
        return body.get("data", [])


def fetch_stock_info(fm: FinMindClient) -> list[dict]:
    """上市股票基本資料（含 industry_category, type）"""
    rows = fm.query("TaiwanStockInfo")
    stocks: list[dict] = []
    for r in rows:
        if r.get("type") != "twse":      # 只要上市
            continue
        sid = str(r["stock_id"]).strip()
        # 排除 ETF / 權證 / 受益憑證等（代號通常 4 碼純數字才是普通股）
        if not (sid.isdigit() and len(sid) == 4):
            continue
        stocks.append({
            "stock_id": sid,
            "name": r.get("stock_name"),
            "market": "TWSE",
            "industry": r.get("industry_category"),
        })
    return stocks


def fetch_holdings(fm: FinMindClient, target_date: date) -> list[dict]:
    """
    集保戶股權分散表（FinMind dataset: TaiwanStockShareholding）
    欄位範例：HoldingSharesLevel, people, percent
    每檔股票每週會有 15 個級距列。
    """
    # 為了拿到 target_date 該週的資料，往前找 14 天範圍
    start = (target_date - timedelta(days=14)).isoformat()
    end = target_date.isoformat()
    rows = fm.query("TaiwanStockShareholding", start_date=start, end_date=end)

    # 以 (stock_id, date) 分組
    grouped: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        key = (str(r["stock_id"]), r["date"])
        grouped.setdefault(key, []).append(r)

    # 取每檔股票最近一筆日期
    latest_by_stock: dict[str, str] = {}
    for (sid, d), _ in grouped.items():
        if sid not in latest_by_stock or d > latest_by_stock[sid]:
            latest_by_stock[sid] = d

    holdings: list[dict] = []
    for sid, d in latest_by_stock.items():
        levels = grouped[(sid, d)]
        row = parse_holding_levels(sid, d, levels)
        if row:
            holdings.append(row)
    return holdings


# FinMind 的 HoldingSharesLevel 文字對應到 schema 欄位
LEVEL_MAP = {
    "1-999":                 "holders_1_5",       # FinMind 把 0-999 股當第一級，視同 1-5 張
    "1,000-5,000":           "holders_1_5",       # 1-5 張（FinMind 以股為單位，1000 股 = 1 張）
    "5,001-10,000":          "holders_5_10",
    "10,001-15,000":         "holders_10_15",
    "15,001-20,000":         "holders_15_20",
    "20,001-30,000":         "holders_20_30",
    "30,001-40,000":         "holders_30_40",
    "40,001-50,000":         "holders_40_50",
    "50,001-100,000":        "holders_50_100",
    "100,001-200,000":       "holders_100_200",
    "200,001-400,000":       "holders_200_400",
    "400,001-600,000":       "holders_400_600",
    "600,001-800,000":       "holders_600_800",
    "800,001-1,000,000":     "holders_800_1000",
    "1,000,001-":            "holders_1000_plus",
}

SMALL_LEVELS = {"holders_1_5", "holders_5_10"}                            # 10 張以下
LARGE_LEVELS = {"holders_800_1000", "holders_1000_plus"}                  # 800 張以上


def parse_holding_levels(stock_id: str, d: str, levels: list[dict]) -> dict | None:
    out: dict[str, Any] = {"stock_id": stock_id, "week_end": d}
    total_holders = 0
    total_shares = 0
    shares_under_10 = 0
    shares_over_800 = 0

    for lv in levels:
        label = lv.get("HoldingSharesLevel") or lv.get("level")
        col = LEVEL_MAP.get(label)
        if not col:
            continue
        people = int(lv.get("people", 0) or 0)
        unit = int(lv.get("unit", 0) or 0)        # 股數
        out[col] = (out.get(col) or 0) + people
        total_holders += people
        total_shares += unit
        if col in SMALL_LEVELS:
            shares_under_10 += unit
        if col in LARGE_LEVELS:
            shares_over_800 += unit

    if total_shares == 0:
        return None

    out["total_holders"] = total_holders
    out["total_shares"] = total_shares
    out["shares_under_10"] = shares_under_10
    out["shares_over_800"] = shares_over_800
    out["small_ratio"] = round(shares_under_10 / total_shares * 100, 3)
    out["large_ratio"] = round(shares_over_800 / total_shares * 100, 3)
    return out


def fetch_weekly_prices(fm: FinMindClient, target_date: date) -> list[dict]:
    """抓 target_date 那一週（週一到週五）的最後收盤價當作週收盤"""
    start = (target_date - timedelta(days=6)).isoformat()
    end = target_date.isoformat()
    rows = fm.query("TaiwanStockPrice", start_date=start, end_date=end)
    latest: dict[str, dict] = {}
    for r in rows:
        sid = str(r["stock_id"])
        if not (sid.isdigit() and len(sid) == 4):
            continue
        if sid not in latest or r["date"] > latest[sid]["date"]:
            latest[sid] = r

    prices: list[dict] = []
    for sid, r in latest.items():
        try:
            close = float(r.get("close") or 0)
        except (TypeError, ValueError):
            continue
        if close <= 0:
            continue
        prices.append({
            "stock_id": sid,
            "week_end": target_date.isoformat(),
            "close": close,
            "volume": int(r.get("Trading_Volume") or 0) // 1000,   # 股 → 張
        })
    return prices


# ---------------------------------------------------------------------------
# TWSE 警示股清單
# ---------------------------------------------------------------------------

def fetch_warning_flags() -> dict[str, str]:
    """回傳 {stock_id: warning_flag}。失敗時回傳空 dict，不阻斷主流程。"""
    flags: dict[str, str] = {}
    try:
        for url, label in [(TWSE_PUNISH_URL, "處置股"), (TWSE_NOTICE_URL, "注意股")]:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            # TWSE 公告頁是 HTML 表格，這裡留 stub；上線後若需要嚴格判斷可加 BeautifulSoup 解析
            # MVP 階段不嚴格判斷，第一版僅依 FinMind 的 type 過濾普通股
    except Exception as e:
        print(f"⚠️  warning flag fetch failed: {e}", file=sys.stderr)
    return flags


# ---------------------------------------------------------------------------
# 上傳到 Supabase
# ---------------------------------------------------------------------------

def post_to_ingest(payload: dict, ingest_url: str, token: str) -> dict:
    r = requests.post(
        ingest_url,
        headers={"Content-Type": "application/json", "X-Ingest-Token": token},
        data=json.dumps(payload),
        timeout=120,
    )
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def process_one_week(
    fm: "FinMindClient",
    target: date,
    stocks: list[dict],
    flags: dict[str, str],
    *,
    limit: int,
    send_stocks: bool,
    dry_run: bool,
    supabase_url: str,
    ingest_token: str,
) -> None:
    print(f"\n📅 處理 {target} ……")

    print("  → 週收盤價…", end=" ")
    prices = fetch_weekly_prices(fm, target)
    print(f"{len(prices)} 筆")

    print("  → 集保戶股權分散…", end=" ")
    holdings = fetch_holdings(fm, target)
    print(f"{len(holdings)} 筆")

    if limit:
        sids = {s["stock_id"] for s in stocks[:limit]}
        prices = [p for p in prices if p["stock_id"] in sids]
        holdings = [h for h in holdings if h["stock_id"] in sids]

    # 對齊 holdings 的 week_end 為 target friday（FinMind 給的可能是週六）
    for h in holdings:
        h["week_end"] = target.isoformat()

    out_stocks = stocks if send_stocks else []
    if send_stocks and flags:
        for s in out_stocks:
            s["warning_flag"] = flags.get(s["stock_id"])

    print(f"  📦 stocks={len(out_stocks)}, prices={len(prices)}, holdings={len(holdings)}")

    if dry_run:
        print("  --dry-run：不上傳，holdings 前 2 筆：")
        for h in holdings[:2]:
            print("    " + json.dumps(h, ensure_ascii=False))
        return

    ingest_url = f"{supabase_url.rstrip('/')}/functions/v1/stock-ingest"
    payload = {
        "week_end": target.isoformat(),
        "stocks": out_stocks,
        "prices": prices,
        "holdings": holdings,
        "run_screen": True,
    }
    print(f"  → POST {ingest_url}")
    result = post_to_ingest(payload, ingest_url, ingest_token)
    print("  ✅ " + json.dumps(result, ensure_ascii=False))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只抓資料、印摘要、不上傳")
    ap.add_argument("--week-end", help="覆寫目標週末日期 YYYY-MM-DD（預設：上一個週五）")
    ap.add_argument("--backfill", type=int, default=0,
                    help="一次往前抓 N 週（含本週）。第一次部署建議用 --backfill 8")
    ap.add_argument("--limit", type=int, default=0, help="只處理前 N 檔（測試用）")
    args = ap.parse_args()

    finmind_token = os.environ.get("FINMIND_TOKEN", "")
    if not finmind_token:
        print("❌ 未設定 FINMIND_TOKEN", file=sys.stderr)
        return 1

    end_friday = date.fromisoformat(args.week_end) if args.week_end else last_friday()
    n = max(args.backfill, 1)
    targets = [end_friday - timedelta(weeks=i) for i in range(n)]
    targets.reverse()                                   # 由舊到新

    print(f"📅 共 {len(targets)} 週：{targets[0]} → {targets[-1]}")

    fm = FinMindClient(token=finmind_token)

    print("\n→ 抓上市股票清單…")
    stocks = fetch_stock_info(fm)
    print(f"   共 {len(stocks)} 檔上市股")

    print("→ 抓處置股清單…")
    flags = fetch_warning_flags()
    print(f"   {len(flags)} 檔有警示" if flags else "   (略)")

    supabase_url = ""
    ingest_token = ""
    if not args.dry_run:
        supabase_url = os.environ.get("SUPABASE_URL", "")
        ingest_token = os.environ.get("STOCK_INGEST_TOKEN", "")
        if not supabase_url or not ingest_token:
            print("❌ 未設定 SUPABASE_URL / STOCK_INGEST_TOKEN", file=sys.stderr)
            return 1

    for i, t in enumerate(targets):
        process_one_week(
            fm, t, stocks, flags,
            limit=args.limit,
            send_stocks=(i == 0),                       # 只第一次送 stocks（後續週同名同樣）
            dry_run=args.dry_run,
            supabase_url=supabase_url,
            ingest_token=ingest_token,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
