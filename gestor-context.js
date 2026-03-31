/* ═══════════════════════════════════════════════════════
   TAURIX · gestor/context.js

   Context switch: el gestor entra y sale de cuentas cliente.
   Cuando está en contexto de cliente, todas las queries
   usan empresa_id del cliente en lugar del user_id propio.
   ═══════════════════════════════════════════════════════ */

import { supabase } from './supabase.js';
import { GESTOR_CTX_KEY, estaEnContextoCliente, getContextoCliente }
  from './query-context.js';
import { invalidarCartera } from './gestor-store.js';

export { estaEnContextoCliente, getContextoCliente };

const BANNER_ID = 'gestorContextBanner';

/* ──────────────────────────────────────────
   ENTRAR EN CLIENTE
────────────────────────────────────────── */

/**
 * El gestor entra en la cuenta de un cliente.
 * @param {string} empresa_id  UUID de la empresa del cliente
 * @param {string} nombre      Nombre para mostrar en el banner
 */
export function entrarEnCliente(empresa_id, nombre) {
  if (!empresa_id) {
    console.error('[gestor/context] entrarEnCliente: empresa_id requerido');
    return;
  }
  sessionStorage.setItem(GESTOR_CTX_KEY, JSON.stringify({ empresa_id, nombre }));
  _mostrarBanner(nombre);
  _marcarSidebarGestor(true);
  if (window._refresh)    window._refresh();
  if (window._switchView) window._switchView('dashboard');
}

/* ──────────────────────────────────────────
   SALIR DEL CLIENTE
────────────────────────────────────────── */

export function salirDeCliente() {
  sessionStorage.removeItem(GESTOR_CTX_KEY);
  _ocultarBanner();
  _marcarSidebarGestor(false);
  invalidarCartera();
  if (window._switchView) window._switchView('cartera');
  // Recargar la cartera con datos frescos — refleja el estado revisado inmediatamente
  setTimeout(() => {
    if (window._refreshCartera) {
      window._refreshCartera();
    }
  }, 50);
}

/* ──────────────────────────────────────────
   BANNER DE CONTEXTO
   Se crea una vez, se muestra/oculta después
────────────────────────────────────────── */

function _ensureBanner() {
  if (document.getElementById(BANNER_ID)) return;
  const el = document.createElement('div');
  el.id = BANNER_ID;
  el.style.cssText = [
    'display:none',
    'align-items:center',
    'gap:10px',
    'padding:7px 20px',
    'background:var(--srf,#f0fdf4)',
    'border-bottom:2px solid #059669',
    'font-size:13px',
    'font-weight:600',
    'color:#065f46',
    'position:sticky',
    'top:0',
    'z-index:200',
    'flex-shrink:0',
  ].join(';');
  el.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="#059669" stroke-width="2.5" style="flex-shrink:0">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>
    </svg>
    <span style="color:#6b7280;font-weight:400">Gestionando:</span>
    <strong id="${BANNER_ID}-nombre"></strong>
    <span style="flex:1"></span>
    <button id="${BANNER_ID}-volver"
      style="background:none;border:1.5px solid #059669;border-radius:7px;
             padding:3px 12px;font-size:12px;font-weight:700;color:#065f46;
             cursor:pointer;white-space:nowrap">
      ← Volver a mi cartera
    </button>`;
  // Insertar al inicio del app-main
  const appMain = document.querySelector('.app-main');
  if (appMain) appMain.insertBefore(el, appMain.firstChild);
  document.getElementById(`${BANNER_ID}-volver`)
    ?.addEventListener('click', salirDeCliente);
}

function _mostrarBanner(nombre) {
  _ensureBanner();
  const el = document.getElementById(BANNER_ID);
  const nm = document.getElementById(`${BANNER_ID}-nombre`);
  if (nm) nm.textContent = nombre;
  if (el) el.style.display = 'flex';
}

function _ocultarBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.style.display = 'none';
}

function _marcarSidebarGestor(activo) {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  nav.style.borderLeft = activo ? '3px solid #059669' : '';
}

/* ──────────────────────────────────────────
   WINDOW GLOBALS — solo los necesarios
────────────────────────────────────────── */

// Botón del banner llama a esto
window._salirDeCliente = salirDeCliente;

// Las tarjetas de la cartera llaman a esto desde onclick
// Recibe owner_id (user_id del cliente) — resuelve empresa_id
window._entrarEnCuenta = async (ownerId, nombreFallback) => {
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, nombre, nif')
    .eq('user_id', ownerId)
    .limit(1)
    .maybeSingle();

  if (!empresa) {
    // Intentar con gestor_clients directamente por si ya está migrado
    const uid = window.__TAURIX_SESSION__?.user?.id;
    const { data: gc } = await supabase
      .from('gestor_clients')
      .select('empresa_id, nombre_cliente')
      .eq('gestor_user_id', uid)
      .limit(1)
      .maybeSingle();

    if (gc?.empresa_id) {
      entrarEnCliente(gc.empresa_id, gc.nombre_cliente || nombreFallback);
      return;
    }

    // Si no hay empresa configurada, informar
    const { toast } = await import('../utils.js');
    toast('Este cliente aún no tiene empresa configurada en Taurix.', 'warn');
    return;
  }

  entrarEnCliente(empresa.id, empresa.nombre || nombreFallback);
};

// También exponer entrarEnCliente directamente para gestor/cartera.js
window._entrarEnCliente = entrarEnCliente;

/* ──────────────────────────────────────────
   RESTAURAR CONTEXTO AL RECARGAR
   (sessionStorage persiste durante la sesión)
────────────────────────────────────────── */

export function restaurarContextoSiExiste() {
  if (!estaEnContextoCliente()) return;
  const ctx = getContextoCliente();
  _mostrarBanner(ctx.nombre || 'Cliente');
  _marcarSidebarGestor(true);
}
