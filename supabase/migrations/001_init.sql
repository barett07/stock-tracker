-- stock-tracker 初始 schema
-- 共用 RailwayShift Supabase 專案，全部用 st_ 前綴

-- =====================================================
-- 1. 股票基本資料
-- =====================================================
CREATE TABLE IF NOT EXISTS st_stocks (
  stock_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  market      TEXT DEFAULT 'TWSE',          -- 'TWSE' / 'OTC'（MVP 只 TWSE）
  industry    TEXT,
  capital     BIGINT,                        -- 股本（元）
  warning_flag TEXT,                         -- NULL / '全額交割' / '變更交易' / '停止買賣'
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- 2. 每週價格快照
-- =====================================================
CREATE TABLE IF NOT EXISTS st_prices (
  stock_id    TEXT REFERENCES st_stocks(stock_id) ON DELETE CASCADE,
  week_end    DATE NOT NULL,
  close       NUMERIC(10,2) NOT NULL,
  volume      BIGINT,                        -- 該週累計成交張數
  PRIMARY KEY (stock_id, week_end)
);

CREATE INDEX IF NOT EXISTS st_prices_week_idx ON st_prices(week_end DESC);

-- =====================================================
-- 3. 集保戶股權分散
-- =====================================================
CREATE TABLE IF NOT EXISTS st_holdings (
  stock_id          TEXT REFERENCES st_stocks(stock_id) ON DELETE CASCADE,
  week_end          DATE NOT NULL,
  -- 各持股級距「人數」
  holders_1_5       INT,    -- 1-5 張
  holders_5_10      INT,
  holders_10_15     INT,
  holders_15_20     INT,
  holders_20_30     INT,
  holders_30_40     INT,
  holders_40_50     INT,
  holders_50_100    INT,
  holders_100_200   INT,
  holders_200_400   INT,
  holders_400_600   INT,
  holders_600_800   INT,
  holders_800_1000  INT,
  holders_1000_plus INT,
  total_holders     INT,
  -- 預先計算的關鍵比例（佔總股數的百分比）
  small_ratio       NUMERIC(6,3),            -- 10 張以下持有「股數」佔比
  large_ratio       NUMERIC(6,3),            -- 800 張以上持有「股數」佔比
  -- 持股「股數」（張）— 用來算 ratio
  shares_under_10   BIGINT,
  shares_over_800   BIGINT,
  total_shares      BIGINT,
  PRIMARY KEY (stock_id, week_end)
);

CREATE INDEX IF NOT EXISTS st_holdings_week_idx ON st_holdings(week_end DESC);

-- =====================================================
-- 4. 篩選結果
-- =====================================================
CREATE TABLE IF NOT EXISTS st_alerts (
  id                 BIGSERIAL PRIMARY KEY,
  stock_id           TEXT REFERENCES st_stocks(stock_id) ON DELETE CASCADE,
  week_end           DATE NOT NULL,
  level              TEXT NOT NULL CHECK (level IN ('yellow', 'red')),
  close              NUMERIC(10,2),
  large_ratio_trend  NUMERIC(6,3)[],         -- 過去 4 週 large_ratio
  small_ratio_trend  NUMERIC(6,3)[],         -- 過去 4 週 small_ratio
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (stock_id, week_end)
);

CREATE INDEX IF NOT EXISTS st_alerts_week_idx ON st_alerts(week_end DESC, level);

-- =====================================================
-- 5. 使用者觀察清單
-- =====================================================
CREATE TABLE IF NOT EXISTS st_watchlist (
  id                  BIGSERIAL PRIMARY KEY,
  user_passcode_hash  TEXT NOT NULL,         -- SHA-256(passcode) 後存，避免明碼
  stock_id            TEXT REFERENCES st_stocks(stock_id) ON DELETE CASCADE,
  note                TEXT,
  added_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_passcode_hash, stock_id)
);

CREATE INDEX IF NOT EXISTS st_watchlist_user_idx ON st_watchlist(user_passcode_hash);

-- =====================================================
-- RLS：前端用 anon key 只能 read，寫入一律走 Edge Function (service role)
-- =====================================================
ALTER TABLE st_stocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_prices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE st_watchlist ENABLE ROW LEVEL SECURITY;

-- 前端只能 SELECT
CREATE POLICY st_stocks_read    ON st_stocks    FOR SELECT TO anon USING (true);
CREATE POLICY st_prices_read    ON st_prices    FOR SELECT TO anon USING (true);
CREATE POLICY st_holdings_read  ON st_holdings  FOR SELECT TO anon USING (true);
CREATE POLICY st_alerts_read    ON st_alerts    FOR SELECT TO anon USING (true);
-- watchlist：前端不直接讀，全部走 Edge Function 用 passcode 換取
