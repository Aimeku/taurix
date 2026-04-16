/* ═══════════════════════════════════════════════════════════════════
   TAURIX · numeracion-docs.js   v1.0
   Sistema unificado de numeración de documentos.

   TIPOS SOPORTADOS: factura · presupuesto · albaran · proforma
   VARIABLES DE FORMATO: {YEAR} {MONTH} {NUM} {NUM2} {NUM3} {NUM4}

   ── MIGRACIÓN SUPABASE (ejecutar UNA VEZ en SQL Editor) ──────────

   CREATE TABLE IF NOT EXISTS doc_numeracion (
     id              uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
     user_id         uuid         REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
     empresa_id      uuid         NULL,          -- reservado para multi-tenant
     tipo            text         NOT NULL,       -- 'factura'|'presupuesto'|'albaran'|'proforma'
     serie           text         NOT NULL,       -- año: '2025', '2026', …
     formato         text         NOT NULL DEFAULT 'F-{YEAR}-{NUM4}',
     numero_inicial  integer      NOT NULL DEFAULT 1 CHECK (numero_inicial >= 1),
     ultimo_numero   integer      NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
     updated_at      timestamptz  DEFAULT now(),
     CONSTRAINT doc_numeracion_uq UNIQUE (user_id, tipo, serie)
   );

   ALTER TABLE doc_numeracion ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "doc_numeracion_owner"
     ON doc_numeracion FOR ALL
     USING  (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);

   ── NOTAS DE DISEÑO ───────────────────────────────────────────────
   · Para facturas el RPC get_next_factura_number sigue siendo
     la fuente de verdad (atomicidad garantizada por Supabase).
     doc_numeracion solo gestiona el numero_inicial y el formato.
   · Para el resto (presupuesto, albaran, proforma) doc_numeracion
     es la única fuente de verdad.  La atomicidad se logra mediante
     optimistic locking (UPDATE ... WHERE ultimo_numero = X + retry).
   · Si la tabla doc_numeracion no existe aún, se activa el fallback
     legacy (scan-last+1) para no romper nada.
   · empresa_id se incluye para futura arquitectura multi-tenant.
     Hoy siempre es NULL y el filtro se hace por user_id.
   ═══════════════════════════════════════════════════════════════════ */

import { supabase }  from './supabase.js';
import { SESSION }   from './utils.js';
import {
  getNumConfigCached,
  setNumConfigCached,
  invalidarConfigSerie,
} from './gestor-store.js';

/* ══════════════════════════════════════════════════════
   CONFIGURACIÓN POR DEFECTO  (una entrada por tipo)
══════════════════════════════════════════════════════ */
export const TIPO_CONFIG = {
  factura:     { formato: 'F-{YEAR}-{NUM4}',   label: 'Facturas',     tabla: 'facturas',     campoNum: 'numero_factura' },
  presupuesto: { formato: 'P-{YEAR}-{NUM4}',   label: 'Presupuestos', tabla: 'presupuestos', campoNum: 'numero'         },
  albaran:     { formato: 'A-{YEAR}-{NUM4}',   label: 'Albaranes',    tabla: 'presupuestos', campoNum: 'albaran_numero' },
  proforma:    { formato: 'PRF-{YEAR}-{NUM3}', label: 'Proformas',    tabla: 'proformas',    campoNum: 'numero'         },
};

/* ══════════════════════════════════════════════════════
   FORMATEADOR
══════════════════════════════════════════════════════ */

/**
 * Aplica variables al formato y devuelve la cadena final.
 * Variables: {YEAR} {MONTH} {NUM} {NUM2} {NUM3} {NUM4}
 */
export function formatNumero(formato, { year, month = 1, num }) {
  return formato
    .replace('{YEAR}',  String(year))
    .replace('{MONTH}', String(month).padStart(2, '0'))
    .replace('{NUM4}',  String(num).padStart(4, '0'))
    .replace('{NUM3}',  String(num).padStart(3, '0'))
    .replace('{NUM2}',  String(num).padStart(2, '0'))
    .replace('{NUM}',   String(num));
}

/**
 * Genera una cadena de vista previa para el modal de configuración.
 * Por defecto muestra el número 1 del año actual.
 */
export function previewNumero(formato, num = 1) {
  const d = new Date();
  return formatNumero(formato, { year: d.getFullYear(), month: d.getMonth() + 1, num });
}

/* ══════════════════════════════════════════════════════
   HELPERS INTERNOS
══════════════════════════════════════════════════════ */

/** Extrae la serie (año) desde una fecha ISO o la fecha de hoy. */
function _serie(fecha) {
  if (fecha) return new Date(fecha + 'T12:00:00').getFullYear().toString();
  return new Date().getFullYear().toString();
}

/** Mes actual (1-12) */
function _mes() { return new Date().getMonth() + 1; }

/**
 * Escanea la BD para encontrar el número más alto ya emitido
 * para este tipo y serie.  Se usa para inicializar el contador
 * sin perder correlatividad con documentos previos.
 */
async function _scanMaxExistente(tipo, serie) {
  const uid = SESSION?.user?.id;
  if (!uid) return 0;

  try {
    switch (tipo) {
      case 'presupuesto': {
        const { data } = await supabase.from('presupuestos')
          .select('numero').eq('user_id', uid)
          .like('numero', `%-${serie}-%`)
          .order('numero', { ascending: false }).limit(1);
        const raw = data?.[0]?.numero;
        if (!raw) return 0;
        const m = raw.match(/(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      }
      case 'albaran': {
        const { data } = await supabase.from('presupuestos')
          .select('albaran_numero').eq('user_id', uid).eq('estado', 'albaran')
          .like('albaran_numero', `%-${serie}-%`)
          .order('albaran_numero', { ascending: false }).limit(1);
        const raw = data?.[0]?.albaran_numero;
        if (!raw) return 0;
        const m = raw.match(/(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      }
      case 'proforma': {
        const { data } = await supabase.from('proformas')
          .select('numero').eq('user_id', uid)
          .like('numero', `%-${serie}-%`)
          .order('numero', { ascending: false }).limit(1);
        const raw = data?.[0]?.numero;
        if (!raw) return 0;
        const m = raw.match(/(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      }
      case 'factura': {
        // Para facturas el contador vive en factura_series
        const { data } = await supabase.from('factura_series')
          .select('ultimo_numero').eq('user_id', uid).eq('serie', serie)
          .maybeSingle();
        return data?.ultimo_numero || 0;
      }
      default:
        return 0;
    }
  } catch (e) {
    console.warn('[numeracion-docs] _scanMaxExistente:', e.message);
    return 0;
  }
}

/**
 * Lee la config desde doc_numeracion (con cache en gestor-store).
 * Devuelve null si no existe o si la tabla no está disponible.
 */
async function _readConfig(tipo, serie) {
  const cached = getNumConfigCached(tipo, serie);
  if (cached) return cached;

  const uid = SESSION?.user?.id;
  if (!uid) return null;

  try {
    const { data, error } = await supabase.from('doc_numeracion')
      .select('*')
      .eq('user_id', uid)
      .eq('tipo', tipo)
      .eq('serie', serie)
      .maybeSingle();

    if (error) {
      // La tabla puede no existir aún — fallar silenciosamente
      if (!error.message?.includes('does not exist') && !error.message?.includes('relation')) {
        console.warn('[numeracion-docs] _readConfig:', error.message);
      }
      return null;
    }

    if (data) {
      setNumConfigCached(tipo, serie, data);
      return data;
    }
    return null;
  } catch (e) {
    console.warn('[numeracion-docs] _readConfig catch:', e.message);
    return null;
  }
}

/**
 * Crea la fila de configuración inicial para un tipo+serie.
 * Respeta el numero_inicial deseado Y no va por debajo del máximo
 * ya existente en BD (para no reutilizar números).
 */
async function _ensureConfig(tipo, serie, numero_inicial = 1) {
  const uid = SESSION?.user?.id;
  if (!uid) return null;

  const defFormato = TIPO_CONFIG[tipo]?.formato || 'F-{YEAR}-{NUM4}';

  // No bajar del máximo existente — preserva correlatividad
  const maxExistente  = await _scanMaxExistente(tipo, serie);
  const inicialSafe   = Math.max(1, numero_inicial);
  const ultimoInicial = Math.max(maxExistente, inicialSafe - 1);

  try {
    const { data, error } = await supabase.from('doc_numeracion')
      .insert({
        user_id:        uid,
        tipo,
        serie,
        formato:        defFormato,
        numero_inicial: inicialSafe,
        ultimo_numero:  ultimoInicial,
        updated_at:     new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      // Race condition: otro proceso ya insertó — releer
      if (error.message?.includes('unique') || error.message?.includes('duplicate') ||
          error.message?.includes('doc_numeracion_uq')) {
        return await _readConfig(tipo, serie);
      }
      console.warn('[numeracion-docs] _ensureConfig insert:', error.message);
      return null;
    }

    setNumConfigCached(tipo, serie, data);
    return data;
  } catch (e) {
    console.warn('[numeracion-docs] _ensureConfig catch:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   FALLBACK LEGACY
   Activo cuando doc_numeracion no existe en BD.
   Réplica del comportamiento anterior: scan-last + 1.
══════════════════════════════════════════════════════ */
async function _fallbackLegacy(tipo, serie) {
  const uid = SESSION?.user?.id;
  const def = TIPO_CONFIG[tipo] || { formato: 'F-{YEAR}-{NUM4}' };
  const year = parseInt(serie);

  try {
    const max = await _scanMaxExistente(tipo, serie);
    return formatNumero(def.formato, { year, month: _mes(), num: max + 1 });
  } catch (e) {
    console.warn('[numeracion-docs] _fallbackLegacy:', e.message);
    const prefix = def.formato.split('{')[0] || 'F-';
    return `${prefix}${serie}-0001`;
  }
}

/* ══════════════════════════════════════════════════════
   API PÚBLICA
══════════════════════════════════════════════════════ */

/**
 * Obtiene y reserva el siguiente número para un tipo de documento.
 *
 * @param {string}  tipo   - 'presupuesto' | 'albaran' | 'proforma'
 *                           (para 'factura' usar emitirFacturaDB en facturas.js)
 * @param {string?} fecha  - ISO date string; determina el año/serie.
 *                           Si no se indica, se usa la fecha de hoy.
 * @returns {Promise<string>} - Número formateado, ej: "P-2026-0013"
 */
export async function getNextDocumentNumber(tipo, fecha = null) {
  if (tipo === 'factura') {
    console.warn('[numeracion-docs] Para facturas usa emitirFacturaDB (RPC atómico).');
  }

  const serie = _serie(fecha);
  const uid   = SESSION?.user?.id;
  if (!uid) throw new Error('getNextDocumentNumber: sin sesión activa');

  // 1. Leer config (o crearla si es la primera vez)
  let config = await _readConfig(tipo, serie);
  if (!config) {
    config = await _ensureConfig(tipo, serie);
  }

  // Si la tabla no existe, activar fallback legacy
  if (!config) {
    return _fallbackLegacy(tipo, serie);
  }

  const nuevoNumero = config.ultimo_numero + 1;

  // 2. Incremento pseudo-atómico con optimistic locking
  //    UPDATE WHERE ultimo_numero = old → sólo actualiza si nadie se adelantó
  const { data: updated } = await supabase.from('doc_numeracion')
    .update({
      ultimo_numero: nuevoNumero,
      updated_at:    new Date().toISOString(),
    })
    .eq('user_id',       uid)
    .eq('tipo',          tipo)
    .eq('serie',         serie)
    .eq('ultimo_numero', config.ultimo_numero)   // ← optimistic lock
    .select()
    .maybeSingle();

  // 3. Si falló (concurrent write), releer y reintentar hasta 3 veces
  if (!updated) {
    for (let retry = 0; retry < 3; retry++) {
      invalidarConfigSerie(tipo, serie);
      const fresh = await _readConfig(tipo, serie);
      if (!fresh) break;
      const n2 = fresh.ultimo_numero + 1;
      const { data: r2 } = await supabase.from('doc_numeracion')
        .update({ ultimo_numero: n2, updated_at: new Date().toISOString() })
        .eq('user_id',       uid)
        .eq('tipo',          tipo)
        .eq('serie',         serie)
        .eq('ultimo_numero', fresh.ultimo_numero)
        .select()
        .maybeSingle();
      if (r2) {
        setNumConfigCached(tipo, serie, r2);
        return formatNumero(r2.formato, { year: parseInt(serie), month: _mes(), num: n2 });
      }
      // pequeña espera antes del siguiente intento
      await new Promise(res => setTimeout(res, 50 * (retry + 1)));
    }
    // Último recurso: usar el número calculado aunque no hayamos confirmado el lock
    console.warn('[numeracion-docs] Optimistic lock agotado para', tipo, serie, '— usando', nuevoNumero);
  }

  const row     = updated || config;
  const formato = row.formato || TIPO_CONFIG[tipo]?.formato || 'F-{YEAR}-{NUM4}';
  const num     = updated ? nuevoNumero : nuevoNumero;

  if (updated) setNumConfigCached(tipo, serie, updated);

  return formatNumero(formato, { year: parseInt(serie), month: _mes(), num });
}

/**
 * Actualiza la configuración de una serie (número inicial y/o formato).
 * Llamado desde el modal de configuración de numeración.
 *
 * @param {string} tipo
 * @param {{ numero_inicial: number, formato?: string, serie?: string }} opts
 */
export async function updateCounter(tipo, { numero_inicial, formato, serie } = {}) {
  const year = serie || new Date().getFullYear().toString();
  const uid  = SESSION?.user?.id;
  if (!uid) throw new Error('updateCounter: sin sesión activa');

  const defFormato    = TIPO_CONFIG[tipo]?.formato || 'F-{YEAR}-{NUM4}';
  const nuevoFormato  = formato || defFormato;
  const nuevoInicial  = Math.max(1, Number(numero_inicial) || 1);

  // No retroceder por debajo de lo ya emitido
  const maxExistente = await _scanMaxExistente(tipo, year);
  const ultimoSafe   = Math.max(maxExistente, nuevoInicial - 1);

  const { error } = await supabase.from('doc_numeracion')
    .upsert({
      user_id:        uid,
      tipo,
      serie:          year,
      formato:        nuevoFormato,
      numero_inicial: nuevoInicial,
      ultimo_numero:  ultimoSafe,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,tipo,serie' });

  if (error) throw new Error('updateCounter: ' + error.message);

  // Para facturas: sincronizar también factura_series (usada por el RPC)
  if (tipo === 'factura') {
    await _syncFacturaSeries(uid, year, ultimoSafe);
    // Mantener también perfil_fiscal.serie_formato para compatibilidad
    await supabase.from('perfil_fiscal')
      .upsert({
        user_id:       uid,
        serie_formato: nuevoFormato,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .then(({ error: e }) => {
        if (e) console.warn('[numeracion-docs] perfil_fiscal sync:', e.message);
      });
  }

  invalidarConfigSerie(tipo, year);
}

/**
 * Sincroniza factura_series con el ultimo_numero calculado
 * para que el RPC get_next_factura_number devuelva el número correcto.
 * @internal
 */
async function _syncFacturaSeries(uid, serie, ultimoNumero) {
  const { data: existing } = await supabase.from('factura_series')
    .select('id').eq('user_id', uid).eq('serie', serie).maybeSingle();

  if (existing) {
    await supabase.from('factura_series')
      .update({ ultimo_numero: ultimoNumero })
      .eq('user_id', uid).eq('serie', serie);
  } else {
    // Insertar para que el RPC empiece en el numero correcto
    const { error } = await supabase.from('factura_series')
      .insert({ user_id: uid, serie, ultimo_numero: ultimoNumero });
    if (error && !error.message?.includes('unique') && !error.message?.includes('duplicate')) {
      console.warn('[numeracion-docs] _syncFacturaSeries insert:', error.message);
    }
  }
}

/**
 * Lee el número inicial configurado para facturas de un año.
 * Llamado por emitirFacturaDB al crear una nueva factura_series.
 *
 * @param {string} serie - Año en string ('2026')
 * @returns {Promise<number>} - numero_inicial (default 1)
 */
export async function getNumeroInicialFactura(serie) {
  const config = await _readConfig('factura', serie);
  return config?.numero_inicial || 1;
}

/**
 * Lee la configuración de una serie concreta.
 * @param {string}  tipo
 * @param {string?} serie - Año. Default: año actual.
 */
export async function getSerieConfig(tipo, serie = null) {
  const year = serie || new Date().getFullYear().toString();
  return _readConfig(tipo, year);
}

/**
 * Lee la configuración de todos los tipos para el año actual.
 * Usado por el modal de configuración.
 * Para tipos sin config guardada, devuelve los valores por defecto
 * + el máximo existente en BD como referencia para el usuario.
 *
 * @returns {Promise<Record<string, object>>}
 */
export async function getAllSerieConfigs() {
  const year = new Date().getFullYear().toString();
  const result = {};

  for (const tipo of Object.keys(TIPO_CONFIG)) {
    const saved = await _readConfig(tipo, year);
    if (saved) {
      result[tipo] = saved;
    } else {
      // Config no guardada aún: mostrar defecto + máximo actual como referencia
      const maxExistente = await _scanMaxExistente(tipo, year);
      result[tipo] = {
        tipo,
        serie:          year,
        formato:        TIPO_CONFIG[tipo].formato,
        numero_inicial: 1,
        ultimo_numero:  maxExistente,   // informativo
        _sinGuardar:    true,           // flag interno para la UI
      };
    }
  }

  return result;
}
