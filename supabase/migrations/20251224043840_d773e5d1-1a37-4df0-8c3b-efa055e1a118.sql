-- Create broadcasts table
CREATE TABLE public.broadcasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_by TEXT
);

-- Enable RLS
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

-- Allow public read access for active broadcasts
CREATE POLICY "Anyone can view active broadcasts"
ON public.broadcasts
FOR SELECT
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Enable realtime for broadcasts
ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcasts;