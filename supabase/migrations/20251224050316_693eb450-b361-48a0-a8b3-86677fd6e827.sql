-- Fix security issues: Add RLS policies to restrict public access

-- 1. admin_users - Only service role should access this
CREATE POLICY "admin_users_service_role_only" 
ON public.admin_users 
FOR ALL 
USING (false);

-- 2. request_logs - Only service role should access this
CREATE POLICY "request_logs_service_role_only" 
ON public.request_logs 
FOR ALL 
USING (false);

-- 3. access_keys - Only service role should access this
CREATE POLICY "access_keys_service_role_only" 
ON public.access_keys 
FOR ALL 
USING (false);

-- 4. blocked_clients - Only service role should access this
CREATE POLICY "blocked_clients_service_role_only" 
ON public.blocked_clients 
FOR ALL 
USING (false);

-- 5. rate_limits - Only service role should access this
CREATE POLICY "rate_limits_service_role_only" 
ON public.rate_limits 
FOR ALL 
USING (false);