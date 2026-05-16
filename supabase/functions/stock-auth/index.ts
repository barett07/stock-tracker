import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  const { passcode } = await req.json();

  const editorPasscode = Deno.env.get('STOCK_EDITOR_PASSCODE');
  const viewerPasscode = Deno.env.get('STOCK_VIEWER_PASSCODE');

  let role: string | null = null;
  if (passcode && passcode === editorPasscode) {
    role = 'editor';
  } else if (passcode && passcode === viewerPasscode) {
    role = 'viewer';
  }

  if (!role) {
    return new Response(JSON.stringify({ error: '驗證碼錯誤' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ role }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
});
