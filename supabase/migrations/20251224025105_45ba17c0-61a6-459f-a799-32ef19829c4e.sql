-- Enable REPLICA IDENTITY FULL for realtime updates
ALTER TABLE public.blocked_clients REPLICA IDENTITY FULL;
ALTER TABLE public.rate_limits REPLICA IDENTITY FULL;
ALTER TABLE public.request_logs REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.blocked_clients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rate_limits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.request_logs;