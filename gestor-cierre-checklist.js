/* ═══════════════════════════════════════════════════════
   TAURIX · gestor-cierre-checklist.js

   Checklist de cierre trimestral.
   Evalúa si un trimestre está listo para presentar
   los modelos 303 y 130.

   Dos modos de uso:

   1. Con datos precalculados (desde revisión — sin queries extra):
      calcularChecklistDesde(datos)

   2. Standalone con empresa_id (para otros contextos):
      calcularChecklistCierre(empresa_id, year, trim)
   ═══════════════════════════════════════════════════════ */

import { supabase }     from './supabase.js';
import { getFacturasTrim, getFechaRango, calcIVA, calcIRPF } from './utils.js';
import { calcularAlertasCliente } from './gestor-alertas.js';
import { calcularScoreFiscal }    from './gestor-score.js';

/* ──────────────────────────────────────────
   FUNCIÓN PRINCIPAL — standalone
────────────────────────────────────────── */

/**
 * Calcula el checklist de cierre completo haciendo sus propias queries.
 * @param {string} empresa_id
 * @param {number} year
 * @param {string} trim  'T1'|'T2'|'T3'|'T4'
 * @returns {Promise<ChecklistResult>}
 */
export async function calcularChecklistCierre(empresa_id, year, trim) {
  if (!empresa_id) return _checklistVacio();

  const { ini, fin } = getFechaRango(year, trim);

  const [facRes, solRes, alertas, cierreRes] = await Promise.all([
    supabase.from('facturas')
      .select('tipo, base, iva, estado, cliente_nif, cobrada')
      .eq('empresa_id', empresa_id)
      .gte('fecha', ini).lte('fecha', fin),

    supabase.from('solicitudes_documentos')
      .select('id')
      .eq('empresa_id', empresa_id)
      .eq('estado', 'pendiente'),

    calcularAlertasCliente(empresa_id),

    supabase.from('cierres_trimestrales')
      .select('gestor_revisado_en, modelo_303_ok, modelo_130_ok')
      .eq('empresa_id', empresa_id)
      .eq('year', year)
      .eq('trimestre', trim)
      .maybeSingle(),
  ]);

  const facturas  = facRes.data  || [];
  const emitidas  = facturas.filter(f => f.tipo === 'emitida' && f.estado === 'emitida');
  const recibidas = facturas.filter(f => f.tipo === 'recibida');
  const sin_nif   = emitidas.filter(f => !f.cliente_nif?.trim()).length;

  const iva  = calcIVA(facturas);
  const irpf = calcIRPF(facturas);

  const facturacion_trim = irpf.ingresos;
  const gastos_trim      = irpf.gastos;
  const iva_estimado     = iva.resultado;
  const solicitudes_pendientes = solRes.data?.length || 0;
  const ya_revisado = !!cierreRes.data?.gestor_revisado_en;

  const { score } = calcularScoreFiscal({
    facturacion_trim, gastos_trim, iva_estimado,
    alertas, solicitudes_pendientes,
    facturas_emitidas_count: emitidas.length,
  });

  return _construirChecklist({
    emitidas, recibidas, sin_nif,
    iva_estimado, irpf,
    alertas, solicitudes_pendientes,
    score, ya_revisado,
    modelo_303_ok: !!cierreRes.data?.modelo_303_ok,
    modelo_130_ok: !!cierreRes.data?.modelo_130_ok,
  });
}

/* ──────────────────────────────────────────
   FUNCIÓN CON DATOS PRECALCULADOS
   Para usar desde gestor-revision-cliente.js
   sin queries adicionales
────────────────────────────────────────── */

/**
 * Calcula el checklist a partir de datos ya disponibles.
 * @param {object} datos
 * @param {Array}  datos.emitidas
 * @param {Array}  datos.recibidas
 * @param {number} datos.sin_nif
 * @param {object} datos.iva          Resultado de calcIVA()
 * @param {object} datos.irpf         Resultado de calcIRPF()
 * @param {Array}  datos.alertas
 * @param {number} datos.solicitudes_pendientes
 * @param {number} datos.score_fiscal
 * @param {object} datos.cierre       Fila de cierres_trimestrales o null
 * @returns {ChecklistResult}
 */
export function calcularChecklistDesde({
  emitidas = [], recibidas = [], sin_nif = 0,
  iva = {}, irpf = {},
  alertas = [], solicitudes_pendientes = 0,
  score_fiscal = 100, cierre = null,
}) {
  return _construirChecklist({
    emitidas, recibidas, sin_nif,
    iva_estimado: iva.resultado ?? 0,
    irpf,
    alertas, solicitudes_pendientes,
    score: score_fiscal,
    ya_revisado:  !!cierre?.gestor_revisado_en,
    modelo_303_ok: !!cierre?.modelo_303_ok,
    modelo_130_ok: !!cierre?.modelo_130_ok,
  });
}

/* ──────────────────────────────────────────
   LÓGICA INTERNA
────────────────────────────────────────── */

function _construirChecklist({
  emitidas, recibidas, sin_nif,
  iva_estimado, irpf,
  alertas, solicitudes_pendientes,
  score, ya_revisado,
  modelo_303_ok, modelo_130_ok,
}) {
  const motivos = [];

  // ── Facturas emitidas ──
  // OK si hay al menos 1, o si no hay ninguna pero tampoco gastos
  // (trimestre vacío — puede ser válido para autónomos inactivos)
  const facturas_emitidas_ok = emitidas.length > 0
    || (emitidas.length === 0 && recibidas.length === 0);
  if (!facturas_emitidas_ok) motivos.push('Sin facturas emitidas en el trimestre');
  if (sin_nif > 0) motivos.push(`${sin_nif} factura${sin_nif > 1 ? 's' : ''} sin NIF del cliente`);

  // ── Gastos ──
  const gastos_ok = recibidas.length > 0 || score > 70;
  if (!gastos_ok) motivos.push('Sin gastos registrados y score fiscal bajo');

  // ── IVA coherente ──
  // Incoherente si IVA repercutido > 40% de la facturación base
  const facturacion = emitidas.reduce((s, f) => s + (f.base || 0), 0);
  const iva_ok = facturacion === 0
    || (iva_estimado >= -50000 && iva_estimado <= facturacion * 0.40);
  if (!iva_ok) motivos.push('IVA estimado fuera de rango — revisar facturas');

  // ── IRPF ──
  const irpf_ok = (irpf.rendimiento ?? 0) >= 0 || emitidas.length === 0;
  if (!irpf_ok) motivos.push('Rendimiento IRPF negativo — revisar ingresos y gastos');

  // ── Solicitudes resueltas ──
  const solicitudes_resueltas = solicitudes_pendientes === 0;
  if (!solicitudes_resueltas)
    motivos.push(`${solicitudes_pendientes} solicitud${solicitudes_pendientes > 1 ? 'es' : ''} de documentos pendiente${solicitudes_pendientes > 1 ? 's' : ''}`);

  // ── Alertas críticas resueltas ──
  const alertas_criticas = alertas.filter(a => a.nivel === 'critico');
  const alertas_resueltas = alertas_criticas.length === 0;
  if (!alertas_resueltas)
    alertas_criticas.forEach(a => motivos.push(a.mensaje));

  // ── Modelos ──
  const modelo_303 = iva_ok && gastos_ok ? 'ok' : 'revisar';
  const modelo_130 = irpf_ok && facturas_emitidas_ok ? 'ok' : 'revisar';

  // ── Estado global ──
  let estado_global;
  if (!solicitudes_resueltas || alertas_criticas.length > 0) {
    estado_global = 'bloqueado';
  } else if (!iva_ok || !irpf_ok || !gastos_ok || sin_nif > 0 || score < 80) {
    estado_global = 'revisar';
  } else {
    estado_global = 'ok';
  }

  return {
    estado_global,
    ya_revisado,
    checklist: {
      facturas_emitidas_ok,
      gastos_ok,
      iva_ok,
      irpf_ok,
      solicitudes_resueltas,
      alertas_resueltas,
    },
    modelos: { modelo_303, modelo_130 },
    motivos,
  };
}

function _checklistVacio() {
  return {
    estado_global: 'revisar',
    ya_revisado: false,
    checklist: {
      facturas_emitidas_ok: false,
      gastos_ok:            false,
      iva_ok:               false,
      irpf_ok:              false,
      solicitudes_resueltas: true,
      alertas_resueltas:    true,
    },
    modelos: { modelo_303: 'revisar', modelo_130: 'revisar' },
    motivos: ['No se pudo cargar la información del cliente'],
  };
}

/* ──────────────────────────────────────────
   RENDER — bloque HTML del checklist
────────────────────────────────────────── */

const ESTADO_COLOR = { ok: '#059669', revisar: '#d97706', bloqueado: '#dc2626' };
const ESTADO_BG    = { ok: '#f0fdf4', revisar: '#fefce8', bloqueado: '#fef2f2' };
const ESTADO_LABEL = {
  ok:        'Listo para presentar',
  revisar:   'Revisión recomendada',
  bloqueado: 'Bloqueado — pendientes',
};

/**
 * Genera el HTML completo del bloque de checklist de cierre.
 * @param {ChecklistResult} resultado
 * @param {string} trim   'T1'|'T2'|'T3'|'T4'
 * @param {number} year
 * @returns {string} HTML
 */
export function renderChecklistCierreHtml(resultado, trim, year) {
  const { estado_global, ya_revisado, checklist, modelos, motivos } = resultado;
  const color = ESTADO_COLOR[estado_global];
  const bg    = ESTADO_BG[estado_global];
  const label = ESTADO_LABEL[estado_global];

  const items = [
    { key: 'facturas_emitidas_ok', label: 'Facturas emitidas' },
    { key: 'gastos_ok',            label: 'Gastos registrados' },
    { key: 'iva_ok',               label: 'IVA coherente (Mod. 303)' },
    { key: 'irpf_ok',              label: 'IRPF calculado (Mod. 130)' },
    { key: 'solicitudes_resueltas', label: 'Sin solicitudes pendientes' },
    { key: 'alertas_resueltas',    label: 'Sin alertas críticas' },
  ];

  const itemsHtml = items.map(item => {
    const ok  = checklist[item.key];
    const ico = ok
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="#059669" stroke-width="2.5">
           <polyline points="20 6 9 17 4 12"/>
         </svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="#d97706" stroke-width="2.5">
           <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
           <line x1="12" y1="9" x2="12" y2="13"/>
           <line x1="12" y1="17" x2="12.01" y2="17"/>
         </svg>`;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;
                  border-bottom:1px solid var(--brd)">
        <span style="flex-shrink:0">${ico}</span>
        <span style="font-size:12px;color:${ok ? 'var(--t2)' : '#92400e'};
                     flex:1">${item.label}</span>
        <span style="font-size:10px;font-weight:700;
                     color:${ok ? '#059669' : '#d97706'}">
          ${ok ? 'OK' : 'Pendiente'}
        </span>
      </div>`;
  }).join('');

  const modelosHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      ${_modeloBadge('Modelo 303', modelos.modelo_303)}
      ${_modeloBadge('Modelo 130', modelos.modelo_130)}
    </div>`;

  const motivosHtml = motivos.length ? `
    <div style="margin-top:10px;padding:10px 12px;background:${bg};
                border-radius:8px;border:1px solid ${color}22">
      ${motivos.map(m => `
        <div style="display:flex;align-items:flex-start;gap:6px;
                    font-size:11px;color:${color};padding:2px 0">
          <span style="flex-shrink:0;margin-top:1px">▸</span>
          <span>${m}</span>
        </div>`).join('')}
    </div>` : '';

  const revisadoBadge = ya_revisado ? `
    <span style="background:#f0fdf4;color:#059669;font-size:10px;font-weight:700;
                 padding:2px 8px;border-radius:5px;border:1px solid #bbf7d0">
      ✓ Trimestre revisado
    </span>` : '';

  return `
    <div style="background:var(--srf);border:1px solid var(--brd);
                border-radius:12px;padding:18px;margin-bottom:0">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:14px">
        <div>
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                      letter-spacing:.6px;color:var(--t3)">
            Checklist cierre ${trim} ${year}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${revisadoBadge}
          <span style="background:${bg};color:${color};font-size:10px;font-weight:700;
                       padding:3px 9px;border-radius:6px;border:1px solid ${color}33">
            ${label}
          </span>
        </div>
      </div>

      <!-- Items -->
      ${itemsHtml}

      <!-- Modelos -->
      ${modelosHtml}

      <!-- Motivos -->
      ${motivosHtml}

    </div>`;
}

function _modeloBadge(label, estado) {
  const ok    = estado === 'ok';
  const color = ok ? '#059669' : '#d97706';
  const bg    = ok ? '#f0fdf4' : '#fefce8';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 10px;background:${bg};border-radius:8px;
                border:1px solid ${color}33">
      <span style="font-size:11px;font-weight:700;color:${color}">${label}</span>
      <span style="font-size:10px;font-weight:800;color:${color}">
        ${ok ? '✓ OK' : '⚠ Revisar'}
      </span>
    </div>`;
}
