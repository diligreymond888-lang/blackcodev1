-- Drop the insecure public SELECT policy
DROP POLICY IF EXISTS "Anyone can read keys for validation" ON public.access_keys;

-- Create a SECURITY DEFINER function for safe key validation
CREATE OR REPLACE FUNCTION public.validate_access_key(p_key_value text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key record;
BEGIN
  SELECT * INTO v_key
  FROM access_keys
  WHERE key_value = p_key_value
    AND is_active = true
    AND is_used = false
    AND (is_lifetime = true OR expires_at > now());
  
  IF NOT FOUND THEN
    -- Check if key exists but is used
    SELECT * INTO v_key
    FROM access_keys
    WHERE key_value = p_key_value;
    
    IF NOT FOUND THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'invalid');
    ELSIF v_key.is_used THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'used');
    ELSIF NOT v_key.is_active THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'inactive');
    ELSIF NOT v_key.is_lifetime AND v_key.expires_at <= now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired');
    ELSE
      RETURN jsonb_build_object('valid', false, 'reason', 'invalid');
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'valid', true,
    'id', v_key.id,
    'is_lifetime', v_key.is_lifetime,
    'expires_at', v_key.expires_at
  );
END;
$$;

-- Create a SECURITY DEFINER function to mark key as used
CREATE OR REPLACE FUNCTION public.use_access_key(p_key_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key record;
BEGIN
  -- Verify the key exists and is valid before marking as used
  SELECT * INTO v_key
  FROM access_keys
  WHERE id = p_key_id
    AND is_active = true
    AND is_used = false
    AND (is_lifetime = true OR expires_at > now());
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_or_used');
  END IF;
  
  -- Mark as used
  UPDATE access_keys
  SET is_used = true, used_at = now()
  WHERE id = p_key_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'key_value', v_key.key_value,
    'is_lifetime', v_key.is_lifetime,
    'expires_at', v_key.expires_at
  );
END;
$$;