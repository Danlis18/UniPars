import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Supabase на фронтенді використовується лише для автентифікації.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
