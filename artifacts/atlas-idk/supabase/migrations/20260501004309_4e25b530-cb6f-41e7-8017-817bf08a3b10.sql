ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS output_guard_violation text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS output_guard_repaired boolean DEFAULT false;