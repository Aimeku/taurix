/* ═══════════════════════════════════════════════════════
   TAURIX · services/query-context.js

   Determina qué campo/valor usar en las queries de Supabase
   según el contexto activo del usuario:

   1. Gestor viendo cliente  → { field:'empresa_id', value: empresa_id_del_cliente }
   2. Empresa propia activa  → { field:'empresa_id', value: empresa_id_propia }
   3. Usuario personal       → { field:'user_id',    value: uid } (comportamiento original)

   USO:
     import { getQueryContext } from '../services/query-context.js';
     const ctx = getQueryContext();
     supabase.from('facturas').select('*').eq(ctx.field, ctx.value)
   ═══════════════════════════════════════════════════════ */

export const GESTOR_CTX_KEY = 'tg_gestor_ctx';

/**
 * Devuelve { field, value } para usar en .eq() de Supabase.
 * Compatible con el código existente: si no hay contexto gestor
 * ni empresa activa, devuelve user_id como siempre.
 */
export function getQueryContext() {
  // 1. Gestor está viendo un cliente
  const raw = sessionStorage.getItem(GESTOR_CTX_KEY);
  if (raw) {
    try {
      const ctx = JSON.parse(raw);
      if (ctx?.empresa_id) return { field: 'empresa_id', value: ctx.empresa_id };
    } catch (_) {
      sessionStorage.removeItem(GESTOR_CTX_KEY);
    }
  }

  // 2. Empresa propia seleccionada en el selector de la topbar
  const empresaId = localStorage.getItem('tg_empresa_id');
  if (empresaId) return { field: 'empresa_id', value: empresaId };

  // 3. Fallback: user_id — comportamiento original, siempre funciona
  const uid = window.__TAURIX_SESSION__?.user?.id ?? null;
  return { field: 'user_id', value: uid };
}

/** true si el gestor está actualmente en el contexto de un cliente */
export function estaEnContextoCliente() {
  const raw = sessionStorage.getItem(GESTOR_CTX_KEY);
  if (!raw) return false;
  try { return !!JSON.parse(raw)?.empresa_id; } catch (_) { return false; }
}

/** Datos del cliente activo o null: { empresa_id, nombre } */
export function getContextoCliente() {
  const raw = sessionStorage.getItem(GESTOR_CTX_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
