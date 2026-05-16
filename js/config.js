const SUPABASE_URL = 'https://oqyjixphmdrhcmomskth.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qqov-1r2kMV5FXSp23_JCg_M8X8_uc9';
const STOCK_AUTH_URL = `${SUPABASE_URL}/functions/v1/stock-auth`;
const REST = `${SUPABASE_URL}/rest/v1`;
const REST_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};
