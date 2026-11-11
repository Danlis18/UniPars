import { createClient } from "@supabase/supabase-js";

// Лише https://<ref>.supabase.co — шляхи на кшталт /rest/v1 часто копіюють разом з URL
function baseUrl(raw) {
  let v = (raw || "").trim().replace(/^["']|["']$/g, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    return new URL(v).origin;
  } catch {
    return "";
  }
}

const url = baseUrl(import.meta.env.VITE_SUPABASE_URL);
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// Supabase на фронтенді використовується лише для автентифікації.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
