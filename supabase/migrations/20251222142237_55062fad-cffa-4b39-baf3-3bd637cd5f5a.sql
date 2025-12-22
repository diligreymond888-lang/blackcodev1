-- Allow service role to insert, update, delete keys (for telegram bot)
CREATE POLICY "Service role can manage keys"
ON public.access_keys
FOR ALL
USING (true)
WITH CHECK (true);