/* ═══════════════════════════════════════════════════════
   TAURIX · gestor-alertas.js

   Calcula alertas automáticas para un cliente.
   Reutilizable desde cartera, revisión y dashboard.

   calcularAlertasCliente(empresa_id) → Promise<Alert[]>

   Alert: { tipo, nivel: 'info'|'warning'|'critico', mensaje }
   ═══════════════════════════════════════════════════════ */

import { supabase }    from './supabase.js';
import { getYear, getTrim, getFacturasTrim, getFechaRango, calcIVA, TRIM_PLAZOS } from './utils.js';

/* ──────────────────────────────────────────
   PLAZO FISCAL → fecha real del trimestre actual
────────────────────────────────────────── */
const PLAZOS_FECHA = {
  T1: (y) => new Date(`${y}-04-20`),
  T2: (y) => new Date(`${y}-07-20`),
  T3: (y) => new Date(`${y}-10-20`),
  T4: (y) => new Date(`${y + 1}-01-30`),
};

/* ──────────────────────────────────────────
   FUNCIÓN PRINCIPAL
────────────────────────────────────────── */

/**
 * Calcula alertas automáticas para una empresa/cliente.
 * Todas las queries usan empresa_id directamente.
 *
 * @param {string} empresa_id
 * @returns {Promise<Array<{tipo,nivel,mensaje}>>}
 */
export async function calcularAlertasCliente(empresa_id) {
  if (!empresa_id) return [];

  const year = getYear();
  const trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const hoy = new Date();
  const alertas = [];

  /* ── Cargar datos en paralelo ── */
  const [facturasRes, cobrosRes, cierreRes, factAntRes] = await Promise.all([
    supabase.from('facturas')
      .select('tipo, base, iva, estado, cobrada, cliente_nif, fecha')
      .eq('empresa_id', empresa_id)
      .gte('fecha', ini).lte('fecha', fin),

    supabase.from('facturas')
      .select('id, base, iva, fecha, cobrada')
      .eq('empresa_id', empresa_id)
      .eq('tipo', 'emitida')
      .eq('cobrada', false),

    supabase.from('cierres_trimestrales')
      .select('gestor_revisado_en')
      .eq('empresa_id', empresa_id)
      .eq('year', year)
      .eq('trimestre', trim)
      .maybeSingle(),

    // Trimestre anterior para comparar ingresos
    (() => {
      const trims = ['T1','T2','T3','T4'];
      const idx   = trims.indexOf(trim);
      const antT  = idx === 0 ? 'T4' : trims[idx - 1];
      const antY  = idx === 0 ? year - 1 : year;
      const { ini: iniA, fin: finA } = getFechaRango(antY, antT);
      return supabase.from('facturas')
        .select('tipo, base, iva, estado')
        .eq('empresa_id', empresa_id)
        .gte('fecha', iniA).lte('fecha', finA);
    })(),
  ]);

  const facturas  = facturasRes.data  || [];
  const cobros    = cobrosRes.data    || [];
  const cierre    = cierreRes.data;
  const factAnt   = factAntRes.data   || [];

  const emitidas  = facturas.filter(f => f.tipo === 'emitida' && f.estado === 'emitida');
  const recibidas = facturas.filter(f => f.tipo === 'recibida');
  const sin_nif   = emitidas.filter(f => !f.cliente_nif?.trim());

  // Período de gracia: primeros 20 días del trimestre
  const TRIM_INICIO_DIA = { T1: '01-01', T2: '04-01', T3: '07-01', T4: '10-01' };
  const inicioTrim = new Date(`${year}-${TRIM_INICIO_DIA[trim]}T00:00:00`);
  const diasTranscurridos = Math.floor((hoy - inicioTrim) / 86400000);
  const enPeriodoGracia = diasTranscurridos < 20;

  /* ── Reglas ── */

  // Sin actividad — no alertar en los primeros 20 días del trimestre
  if (!enPeriodoGracia && emitidas.length === 0 && recibidas.length === 0) {
    alertas.push({ tipo: 'sin_actividad', nivel: 'critico',
      mensaje: 'No hay facturas ni gastos registrados en este trimestre.' });
  } else if (!enPeriodoGracia) {
    // Sin facturas emitidas
    if (emitidas.length === 0) {
      alertas.push({ tipo: 'sin_facturas', nivel: 'warning',
        mensaje: 'No hay facturas emitidas en este trimestre.' });
    }
    // Sin gastos
    if (recibidas.length === 0) {
      alertas.push({ tipo: 'sin_gastos', nivel: 'warning',
        mensaje: 'No hay gastos registrados en el trimestre. Posible subregistro.' });
    }
  }

  // Facturas sin NIF
  if (sin_nif.length > 0) {
    alertas.push({ tipo: 'sin_nif', nivel: 'critico',
      mensaje: `${sin_nif.length} factura${sin_nif.length > 1 ? 's' : ''} emitida${sin_nif.length > 1 ? 's' : ''} sin NIF del cliente.` });
  }

  // Facturas sin cobrar > 60 días
  const vencidas60 = cobros.filter(f => {
    const dias = Math.floor((hoy - new Date(f.fecha + 'T12:00:00')) / 86400000);
    return dias > 60;
  });
  if (vencidas60.length > 0) {
    const total = vencidas60.reduce((s, f) => s + f.base * (1 + (f.iva || 0) / 100), 0);
    const fmtE  = new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(total);
    alertas.push({ tipo: 'cobro_vencido', nivel: 'warning',
      mensaje: `${vencidas60.length} factura${vencidas60.length > 1 ? 's' : ''} sin cobrar con más de 60 días (${fmtE}).` });
  }

  // IVA > 50% vs trimestre anterior
  const ivaAct = calcIVA(facturas);
  const ivaAnt = calcIVA(factAnt);
  if (ivaAnt.rep.total > 0 && ivaAct.rep.total > ivaAnt.rep.total * 1.5) {
    alertas.push({ tipo: 'iva_alto', nivel: 'warning',
      mensaje: 'IVA repercutido más del 50% superior al trimestre anterior. Revisar.' });
  }

  // No revisado a 7 días del plazo
  if (!cierre?.gestor_revisado_en) {
    const plazoFn = PLAZOS_FECHA[trim];
    if (plazoFn) {
      const plazo = plazoFn(year);
      const diasRestantes = Math.ceil((plazo - hoy) / 86400000);
      if (diasRestantes >= 0 && diasRestantes <= 7) {
        alertas.push({ tipo: 'plazo_cercano', nivel: 'critico',
          mensaje: `Plazo de presentación en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''} (${TRIM_PLAZOS[trim]}). Trimestre aún sin revisar.` });
      }
    }
  }

  return alertas;
}

/* ──────────────────────────────────────────
   RENDER HELPER — bloque visual de alertas
   Reutilizable en revisión y dashboard
────────────────────────────────────────── */

/**
 * Renderiza un bloque HTML de alertas.
 * @param {Array} alertas  Array de { tipo, nivel, mensaje }
 * @param {object} opts    { titulo?: string, compact?: boolean }
 * @returns {string} HTML
 */
export function renderAlertasHtml(alertas, { titulo = 'Alertas detectadas', compact = false } = {}) {
  if (!alertas.length) {
    return compact ? '' : `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                  background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="#059669" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span style="font-size:13px;color:#065f46;font-weight:600">Sin alertas detectadas</span>
      </div>`;
  }

  const COLOR = { critico: '#dc2626', warning: '#d97706', info: '#2563eb' };
  const BG    = { critico: '#fef2f2', warning: '#fefce8', info:  '#eff6ff' };
  const ICO   = {
    critico: `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
               <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    warning: `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
               <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    info:    `<circle cx="12" cy="12" r="10"/>
               <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
  };

  const items = alertas.map(a => `
    <div style="display:flex;align-items:flex-start;gap:9px;padding:8px 0;
                border-bottom:1px solid var(--brd);last-child:border-bottom:none">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="${COLOR[a.nivel]}" stroke-width="2" style="flex-shrink:0;margin-top:1px">
        ${ICO[a.nivel] || ICO.info}
      </svg>
      <span style="font-size:12px;color:var(--t2);line-height:1.5">${a.mensaje}</span>
    </div>`).join('');

  if (compact) {
    return `<div style="display:flex;flex-direction:column;gap:0">${items}</div>`;
  }

  return `
    <div style="background:var(--srf);border:1px solid var(--brd);border-radius:12px;
                padding:16px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                  letter-spacing:.6px;color:var(--t3);margin-bottom:12px">
        ${titulo}
        <span style="margin-left:6px;background:#fef2f2;color:#dc2626;
                     font-size:10px;padding:1px 6px;border-radius:5px;font-weight:700">
          ${alertas.length}
        </span>
      </div>
      ${items}
    </div>`;
}
