#!/bin/bash
# 部署 Edge Functions + 自動驗證
# verify_jwt 設定已寫死在 supabase/config.toml,CLI 會自動套用
# ⚠️ 若剛改過 Supabase secrets:CLI 部署不會讓 function 重載 secrets,
#    驗證失敗時改用 MCP deploy_edge_function(必帶 verify_jwt: false),見 NOTES.md
set -e
cd "$(dirname "$0")"
REF="oqyjixphmdrhcmomskth"
BASE="https://$REF.supabase.co/functions/v1"

for fn in stock-auth stock-ingest stock-screen; do
  supabase functions deploy "$fn" --project-ref "$REF"
done

echo ""
echo "===== 部署後驗證 ====="
FAIL=0

# 三個 function 都免 JWT(自帶 token/passcode 認證);被閘道擋 = verify_jwt 被重置
for fn in stock-auth stock-ingest stock-screen; do
  RESP=$(curl -s -X POST "$BASE/$fn" -H "Content-Type: application/json" -d '{}')
  if echo "$RESP" | grep -qi "authorization header"; then
    echo "❌ $fn 被閘道擋下:verify_jwt 被重置成 true,排程會 401!(曾連續失敗 6 週)"
    FAIL=1
  else
    echo "✅ $fn 正常(免 JWT,function 有執行:$(echo "$RESP" | head -c 40))"
  fi
done

if [ $FAIL -eq 0 ]; then
  echo ""
  echo "建議手動觸發排程做完整驗證:gh workflow run \"Weekly Fetch\""
fi

exit $FAIL
