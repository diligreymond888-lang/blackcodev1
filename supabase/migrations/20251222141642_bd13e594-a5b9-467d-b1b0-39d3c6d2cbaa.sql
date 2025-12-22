-- Create table for access keys
CREATE TABLE public.access_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_value TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_lifetime BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY;

-- Allow anyone to check if a key exists (for validation)
CREATE POLICY "Anyone can read keys for validation"
ON public.access_keys
FOR SELECT
USING (true);

-- Insert some sample keys for testing
INSERT INTO public.access_keys (key_value, expires_at, is_lifetime) VALUES
  ('TEST-KEY-001', now() + interval '7 days', false),
  ('LIFETIME-KEY', null, true),
  ('EXPIRED-KEY', now() - interval '1 day', false);