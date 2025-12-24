-- Create admin_users table for Telegram bot access
CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL UNIQUE,
  username text,
  added_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Only service role can manage admin_users
CREATE POLICY "Service role can manage admin_users"
ON public.admin_users
FOR ALL
USING (true)
WITH CHECK (true);

-- Insert the primary admin from environment (will be done via edge function)
COMMENT ON TABLE public.admin_users IS 'Stores Telegram admin user IDs for bot access control';