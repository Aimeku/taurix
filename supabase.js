import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cliente Supabase
 * ----------------
 * - SOLO frontend (anon / publishable key)
 * - OAuth Google
 * - Sesión persistente
 * - Refresh automático de tokens
 */

const SUPABASE_URL = "https://biiyzjzdvuahajndltap.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_0N1Nv7SkjpynYh10lieang_uUoHRHOf";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,       // Mantiene sesión al recargar
      autoRefreshToken: true,     // Renueva tokens automáticamente
      detectSessionInUrl: true,   // Necesario para OAuth (Google)
    },
    global: {
      headers: {
        "X-Client-Info": "autonomosaas-web",
      },
    },
  }
);
