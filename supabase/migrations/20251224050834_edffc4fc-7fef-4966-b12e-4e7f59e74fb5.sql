-- Fix SECURITY DEFINER functions by adding caller verification

-- Update check_rate_limit to verify service role
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_client_id text, p_endpoint text, p_max_requests integer DEFAULT 30, p_window_seconds integer DEFAULT 60)
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
  v_role text;
BEGIN
  -- Verify caller is service role
  v_role := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', 'anon');
  IF v_role != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

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

-- Update log_request to verify service role
CREATE OR REPLACE FUNCTION public.log_request(p_client_id text, p_endpoint text, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_was_blocked boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Verify caller is service role
  v_role := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', 'anon');
  IF v_role != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  INSERT INTO request_logs (client_id, endpoint, ip_address, user_agent, was_blocked)
  VALUES (p_client_id, p_endpoint, p_ip_address, p_user_agent, p_was_blocked);
END;
$$;