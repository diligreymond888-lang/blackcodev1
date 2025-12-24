import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-id',
};

// Hash sensitive data for privacy
async function hashSensitiveData(data: string): Promise<string> {
  if (data === 'unknown') return 'unknown';
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = req.headers.get('x-client-id') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const ipAddress = req.headers.get('x-forwarded-for') || 
                      req.headers.get('x-real-ip') || 
                      'unknown';

    const body = await req.json().catch(() => ({}));
    const { action, endpoint = 'general' } = body;

    console.log(`[Anti-DDoS] Client: ${clientId}, Action: ${action}, Endpoint: ${endpoint}`);

    if (action === 'check') {
      // Check rate limit using the database function
      const { data: rateLimitResult, error: rateLimitError } = await supabase
        .rpc('check_rate_limit', {
          p_client_id: clientId,
          p_endpoint: endpoint,
          p_max_requests: 50,
          p_window_seconds: 60
        });

      if (rateLimitError) {
        console.error('[Anti-DDoS] Rate limit check error:', rateLimitError);
        return new Response(JSON.stringify({
          allowed: true, // Fail open for now
          error: 'Rate limit check failed'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Hash IP and user agent before logging for privacy
      const ipHash = await hashSensitiveData(ipAddress);
      const uaHash = await hashSensitiveData(userAgent);

      // Log the request with hashed data
      await supabase.rpc('log_request', {
        p_client_id: clientId,
        p_endpoint: endpoint,
        p_ip_address: ipHash,
        p_user_agent: uaHash,
        p_was_blocked: !rateLimitResult?.allowed
      });

      console.log(`[Anti-DDoS] Result:`, rateLimitResult);

      return new Response(JSON.stringify(rateLimitResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'status') {
      // Get current blocked status
      const { data: blockedData } = await supabase
        .from('blocked_clients')
        .select('*')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .maybeSingle();

      if (blockedData && new Date(blockedData.expires_at) > new Date()) {
        return new Response(JSON.stringify({
          blocked: true,
          expires_at: blockedData.expires_at,
          reason: blockedData.reason
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get rate limit status
      const { data: rateData } = await supabase
        .from('rate_limits')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();

      return new Response(JSON.stringify({
        blocked: false,
        rate_limit: rateData ? {
          request_count: rateData.request_count,
          window_start: rateData.window_start
        } : null
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'stats') {
      // Get protection stats (for admin/display)
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const { count: totalRequests } = await supabase
        .from('request_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneHourAgo.toISOString());

      const { count: blockedRequests } = await supabase
        .from('request_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneHourAgo.toISOString())
        .eq('was_blocked', true);

      const { count: activeBlocks } = await supabase
        .from('blocked_clients')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      return new Response(JSON.stringify({
        total_requests_1h: totalRequests || 0,
        blocked_requests_1h: blockedRequests || 0,
        active_blocks: activeBlocks || 0,
        protection_active: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Anti-DDoS] Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      allowed: true // Fail open
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
