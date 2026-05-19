import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 篩選邏輯（籌碼集中度版）：
//   close < PRICE_MAX
//   warning_flag IS NULL
//   capital >= CAPITAL_MIN
//   過去 4 週 large_ratio 連續上升（嚴格遞增）→ 1 票
//   過去 4 週 small_ratio 連續下降（嚴格遞減）→ 1 票
//   兩者皆滿足 → 紅燈；其中之一滿足、另一在 4 週中 3 週滿足 → 黃燈

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://barett07.github.io',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PRICE_MAX = 15;
const CAPITAL_MIN = 300_000_000;   // 3 億
const WEEKS_WINDOW = 4;

function strictlyIncreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i++) if (!(xs[i] > xs[i - 1])) return false;
  return true;
}
function strictlyDecreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i++) if (!(xs[i] < xs[i - 1])) return false;
  return true;
}
function countIncreasing(xs: number[]): number {
  let c = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) c++;
  return c;
}
function countDecreasing(xs: number[]): number {
  let c = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1]) c++;
  return c;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const token = req.headers.get('X-Ingest-Token');
  if (!token || token !== Deno.env.get('STOCK_INGEST_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const { week_end } = await req.json();
  if (!week_end) {
    return new Response(JSON.stringify({ error: 'week_end required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. 找出本週收盤價符合條件的股票
  const { data: priceRows, error: priceErr } = await supabase
    .from('st_prices')
    .select('stock_id, close')
    .eq('week_end', week_end)
    .lt('close', PRICE_MAX);
  if (priceErr) return errJson(priceErr.message, 500);

  const candidateIds = (priceRows ?? []).map((r) => r.stock_id);
  if (candidateIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, alerts: 0, note: 'no candidates' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // 2. 過濾基本資料（股本、警示旗標）
  const { data: stockRows, error: stockErr } = await supabase
    .from('st_stocks')
    .select('stock_id, name, capital, warning_flag')
    .in('stock_id', candidateIds);
  if (stockErr) return errJson(stockErr.message, 500);

  const eligible = (stockRows ?? []).filter(
    (s) => !s.warning_flag && (s.capital ?? 0) >= CAPITAL_MIN,
  );
  const eligibleIds = eligible.map((s) => s.stock_id);
  if (eligibleIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, alerts: 0, note: 'no eligible stocks' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // 3. 拉每檔近 4 週 holdings
  const { data: holdRows, error: holdErr } = await supabase
    .from('st_holdings')
    .select('stock_id, week_end, large_ratio, small_ratio')
    .in('stock_id', eligibleIds)
    .lte('week_end', week_end)
    .order('week_end', { ascending: true });
  if (holdErr) return errJson(holdErr.message, 500);

  const byStock = new Map<string, { week_end: string; large_ratio: number; small_ratio: number }[]>();
  for (const r of holdRows ?? []) {
    if (!byStock.has(r.stock_id)) byStock.set(r.stock_id, []);
    byStock.get(r.stock_id)!.push(r);
  }

  // 4. 判斷紅燈/黃燈
  const priceMap = new Map((priceRows ?? []).map((r) => [r.stock_id, r.close]));
  const nameMap = new Map(eligible.map((s) => [s.stock_id, s.name]));
  const alerts: {
    stock_id: string;
    week_end: string;
    level: 'red' | 'yellow';
    close: number;
    large_ratio_trend: number[];
    small_ratio_trend: number[];
    notes: string;
  }[] = [];

  for (const sid of eligibleIds) {
    const series = byStock.get(sid);
    if (!series || series.length < WEEKS_WINDOW) continue;
    const last4 = series.slice(-WEEKS_WINDOW);
    const large = last4.map((x) => Number(x.large_ratio));
    const small = last4.map((x) => Number(x.small_ratio));
    if (large.some(Number.isNaN) || small.some(Number.isNaN)) continue;

    const largeUp = strictlyIncreasing(large);
    const smallDown = strictlyDecreasing(small);
    const largeUpDays = countIncreasing(large);
    const smallDownDays = countDecreasing(small);

    let level: 'red' | 'yellow' | null = null;
    if (largeUp && smallDown) level = 'red';
    else if ((largeUp && smallDownDays >= 2) || (smallDown && largeUpDays >= 2)) level = 'yellow';
    else if (largeUpDays >= 2 && smallDownDays >= 2) level = 'yellow';

    if (level) {
      alerts.push({
        stock_id: sid,
        week_end,
        level,
        close: Number(priceMap.get(sid)),
        large_ratio_trend: large,
        small_ratio_trend: small,
        notes: `大戶比變化 ${large[0].toFixed(2)}→${large[3].toFixed(2)}, 散戶比變化 ${small[0].toFixed(2)}→${small[3].toFixed(2)}`,
      });
    }
  }

  // 5. 寫入 st_alerts（upsert 避免重跑時重複）
  if (alerts.length > 0) {
    const { error } = await supabase
      .from('st_alerts')
      .upsert(alerts, { onConflict: 'stock_id,week_end' });
    if (error) return errJson(`insert alerts: ${error.message}`, 500);
  }

  // 6. Telegram 推播（只推紅燈）
  const reds = alerts.filter((a) => a.level === 'red');
  let telegramStatus: unknown = 'skipped';
  if (reds.length > 0) {
    telegramStatus = await pushTelegram(reds, nameMap, week_end);
  }

  return new Response(JSON.stringify({
    ok: true,
    week_end,
    alerts: alerts.length,
    red: reds.length,
    yellow: alerts.length - reds.length,
    telegram: telegramStatus,
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
});

async function pushTelegram(
  reds: { stock_id: string; close: number; large_ratio_trend: number[]; small_ratio_trend: number[] }[],
  nameMap: Map<string, string>,
  weekEnd: string,
): Promise<unknown> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return 'missing telegram secrets';

  const lines: string[] = [];
  lines.push(`🔴 *本週紅燈警示*（${weekEnd}）`);
  lines.push('');
  lines.push('股價 < 15、大戶比 4 週連續上升、散戶比 4 週連續下降：');
  lines.push('');
  for (const r of reds.slice(0, 30)) {
    const name = nameMap.get(r.stock_id) ?? '';
    const lt = r.large_ratio_trend;
    const st = r.small_ratio_trend;
    lines.push(`• \`${r.stock_id}\` ${name} — 收 ${r.close.toFixed(2)}`);
    lines.push(`   大戶比 ${lt[0].toFixed(1)} → ${lt[3].toFixed(1)} ｜散戶比 ${st[0].toFixed(1)} → ${st[3].toFixed(1)}`);
  }
  if (reds.length > 30) {
    lines.push('');
    lines.push(`（另有 ${reds.length - 30} 檔，請至網頁查看）`);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  return { status: res.status, ok: res.ok };
}

function errJson(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
