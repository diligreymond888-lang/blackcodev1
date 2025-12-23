-- Add columns to track key usage
ALTER TABLE public.access_keys 
ADD COLUMN is_used boolean NOT NULL DEFAULT false,
ADD COLUMN used_at timestamp with time zone DEFAULT NULL;