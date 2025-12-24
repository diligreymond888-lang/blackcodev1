-- Create table for tracking rate limits per client
CREATE TABLE public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  endpoint text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id, endpoint)
);

-- Create table for blocked clients
CREATE TABLE public.blocked_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  reason text NOT NULL DEFAULT 'rate_limit_exceeded',
  blocked_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

-- Create table for request logs (for monitoring)
CREATE TABLE public.request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  endpoint text NOT NULL,
  ip_address text,
  user_agent text,
  was_blocked boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access for edge functions
CREATE POLICY "Service role can manage rate_limits" ON public.rate_limits
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage blocked_clients" ON public.blocked_clients
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage request_logs" ON public.request_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Allow anon to read blocked status (for frontend check)
CREATE POLICY "Anyone can check if blocked" ON public.blocked_clients
  FOR SELECT USING (true);

-- Create function to check and update rate limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_client_id text,
  p_endpoint text,
  p_max_requests integer DEFAULT 30,
  p_window_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_blocked boolean;
  v_block_expires timestamp with time zone;
  v_current_count integer;
  v_window_start timestamp with time zone;
  v_now timestamp with time zone := now();
BEGIN
  -- First check if client is blocked
  SELECT is_active, expires_at INTO v_is_blocked, v_block_expires
  FROM blocked_clients
  WHERE client_id = p_client_id AND is_active = true;
  
  IF v_is_blocked AND v_block_expires > v_now THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'blocked', true,
      'expires_at', v_block_expires,
      'reason', 'blocked'
    );
  END IF;
  
  -- Unblock if expired
  IF v_is_blocked AND v_block_expires <= v_now THEN
    UPDATE blocked_clients SET is_active = false WHERE client_id = p_client_id;
  END IF;
  
  -- Get or create rate limit entry
  SELECT request_count, window_start INTO v_current_count, v_window_start
  FROM rate_limits
  WHERE client_id = p_client_id AND endpoint = p_endpoint;
  
  IF NOT FOUND THEN
    -- Create new entry
    INSERT INTO rate_limits (client_id, endpoint, request_count, window_start)
    VALUES (p_client_id, p_endpoint, 1, v_now);
    
    RETURN jsonb_build_object(
      'allowed', true,
      'remaining', p_max_requests - 1,
      'reset_at', v_now + (p_window_seconds || ' seconds')::interval
    );
  END IF;
  
  -- Check if window has expired
  IF v_window_start + (p_window_seconds || ' seconds')::interval < v_now THEN
    -- Reset window
    UPDATE rate_limits 
    SET request_count = 1, window_start = v_now
    WHERE client_id = p_client_id AND endpoint = p_endpoint;
    
    RETURN jsonb_build_object(
      'allowed', true,
      'remaining', p_max_requests - 1,
      'reset_at', v_now + (p_window_seconds || ' seconds')::interval
    );
  END IF;
  
  -- Increment counter
  v_current_count := v_current_count + 1;
  
  UPDATE rate_limits 
  SET request_count = v_current_count
  WHERE client_id = p_client_id AND endpoint = p_endpoint;
  
  -- Check if over limit
  IF v_current_count > p_max_requests THEN
    -- Block the client
    INSERT INTO blocked_clients (client_id, reason, expires_at, request_count)
    VALUES (p_client_id, 'rate_limit_exceeded', v_now + interval '5 minutes', v_current_count)
    ON CONFLICT (client_id) DO UPDATE SET
      is_active = true,
      expires_at = v_now + interval '5 minutes',
      request_count = EXCLUDED.request_count,
      blocked_at = v_now;
    
    RETURN jsonb_build_object(
      'allowed', false,
      'blocked', true,
      'expires_at', v_now + interval '5 minutes',
      'reason', 'rate_limit_exceeded'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', p_max_requests - v_current_count,
    'reset_at', v_window_start + (p_window_seconds || ' seconds')::interval
  );
END;
$$;

-- Create function to log requests
CREATE OR REPLACE FUNCTION public.log_request(
  p_client_id text,
  p_endpoint text,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_was_blocked boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO request_logs (client_id, endpoint, ip_address, user_agent, was_blocked)
  VALUES (p_client_id, p_endpoint, p_ip_address, p_user_agent, p_was_blocked);
END;
$$;

-- Create indexes for performance
CREATE INDEX idx_rate_limits_client_endpoint ON public.rate_limits(client_id, endpoint);
CREATE INDEX idx_blocked_clients_client ON public.blocked_clients(client_id) WHERE is_active = true;
CREATE INDEX idx_request_logs_client ON public.request_logs(client_id);
CREATE INDEX idx_request_logs_created ON public.request_logs(created_at);