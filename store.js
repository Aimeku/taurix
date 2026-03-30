/* ═══════════════════════════════════════════════════════
   TAURIX · gestor/store.js
   Estado y cache del módulo gestor.
   ═══════════════════════════════════════════════════════ */

const CARTERA_TTL_MS = 5 * 60 * 1000; // 5 minutos

let _carteraData = null;
let _carteraTs   = 0;

export function getGestorUserId() {
  return window.__TAURIX_SESSION__?.user?.id ?? null;
}

export function invalidarCartera() {
  _carteraData = null;
  _carteraTs   = 0;
}

export function setCarteraCache(data) {
  _carteraData = data;
  _carteraTs   = Date.now();
}

export function getCarteraCache() {
  if (!_carteraData) return null;
  if (Date.now() - _carteraTs > CARTERA_TTL_MS) { _carteraData = null; return null; }
  return _carteraData;
}
