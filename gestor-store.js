/* ═══════════════════════════════════════════════════════
   TAURIX · gestor/store.js
   Estado y cache del módulo gestor.
   ═══════════════════════════════════════════════════════ */

const CARTERA_TTL_MS  = 5 * 60 * 1000;  // 5 minutos
const NUM_CONFIG_TTL  = 30 * 1000;       // 30 segundos (numeración de docs)

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

/* ══════════════════════════════════════════════════════
   CACHE DE CONFIGURACIÓN DE SERIES (numeracion-docs.js)
   Clave: "tipo:serie"  →  { ...rowDocNumeracion, _ts: timestamp }
══════════════════════════════════════════════════════ */
const _numConfigCache = {};

/**
 * Devuelve la config cacheada si existe y no ha expirado.
 * @param {string} tipo
 * @param {string} serie - Año en string ('2026')
 * @returns {object|null}
 */
export function getNumConfigCached(tipo, serie) {
  const key  = `${tipo}:${serie}`;
  const entry = _numConfigCache[key];
  if (!entry) return null;
  if (Date.now() - entry._ts > NUM_CONFIG_TTL) {
    delete _numConfigCache[key];
    return null;
  }
  return entry;
}

/**
 * Guarda una config en cache.
 * @param {string} tipo
 * @param {string} serie
 * @param {object} data  - Fila de doc_numeracion
 */
export function setNumConfigCached(tipo, serie, data) {
  _numConfigCache[`${tipo}:${serie}`] = { ...data, _ts: Date.now() };
}

/**
 * Invalida la entrada de cache para un tipo+serie.
 * Llamar después de updateCounter o al detectar conflicto.
 * @param {string} tipo
 * @param {string} serie
 */
export function invalidarConfigSerie(tipo, serie) {
  delete _numConfigCache[`${tipo}:${serie}`];
}
