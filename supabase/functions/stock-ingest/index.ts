import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// GitHub Actions 呼叫此 Function 寫入每週爬蟲資料。
// 認證方式：header X-Ingest-Token 必須等於 STOCK_INGEST_TOKEN。
// payload 結構（單次呼叫可帶多種類型）:
// {
//   week_end: "2026-05-15",
//   stocks:    [{ stock_id, name, market, industry, capital, warning_flag }, ...],
//   prices:    [{ stock_id, week_end, close, volume }, ...],
//   holdings:  [{ stock_id, week_end, holders_1_5, ..., shares_under_10, ..., total_shares }, ...],
//   run_screen: true   // 寫完後是否觸發 stock-screen
// }

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://barett07.github.io',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const token = req.headers.get('X-Ingest-Token');
  if (!token || token !== Deno.env.get('STOCK_INGEST_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const body = await req.json();
  const { week_end, stocks, prices, holdings, run_screen } = body;

  if (!week_end) {
    return new Response(JSON.stringify({ error: 'week_end required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const summary: Record<string, number> = {};
  const errors: string[] = [];

  if (Array.isArray(stocks) && stocks.length > 0) {
    const { error, count } = await supabase
      .from('st_stocks')
      .upsert(stocks, { onConflict: 'stock_id', count: 'exact' });
    if (error) errors.push(`stocks: ${error.message}`);
    summary.stocks = count ?? stocks.length;
  }

  if (Array.isArray(prices) && prices.length > 0) {
    const { error, count } = await supabase
      .from('st_prices')
      .upsert(prices, { onConflict: 'stock_id,week_end', count: 'exact' });
    if (error) errors.push(`prices: ${error.message}`);
    summary.prices = count ?? prices.length;
  }

  if (Array.isArray(holdings) && holdings.length > 0) {
    const { error, count } = await supabase
      .from('st_holdings')
      .upsert(holdings, { onConflict: 'stock_id,week_end', count: 'exact' });
    if (error) errors.push(`holdings: ${error.message}`);
    summary.holdings = count ?? holdings.length;
  }

  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: errors.join('; '), summary }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  let screenResult: unknown = null;
  if (run_screen) {
    const screenUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stock-screen`;
    const res = await fetch(screenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Token': token,
      },
      body: JSON.stringify({ week_end }),
    });
    screenResult = await res.json().catch(() => ({ status: res.status }));
  }

  return new Response(JSON.stringify({ ok: true, summary, screen: screenResult }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
});
