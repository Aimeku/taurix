/* ═══════════════════════════════════════════════════════
   TAURIX · gestor-revision-cliente.js

   Panel de revisión fiscal por cliente para el gestor.
   El gestor revisa un trimestre completo en ~1 minuto.

   USO:
     import { renderRevisionCliente } from './gestor-revision-cliente.js';
     renderRevisionCliente(document.getElementById('view-revision-cliente'));
   ═══════════════════════════════════════════════════════ */

import { supabase }    from './supabase.js';
import {
  getYear, getTrim, getFacturasTrim,
  calcIVA, calcIRPF,
  fmt, fmtDate,
  TRIM_LABELS, TRIM_PLAZOS,
  toast
} from './utils.js';
import { getContextoCliente } from './gestor-context.js';
import { invalidarCartera }   from './gestor-store.js';
import { calcularAlertasCliente, renderAlertasHtml } from './gestor-alertas.js';
import { abrirModalSolicitud, renderSolicitudesGestor } from './gestor-solicitudes.js';
import { renderMensajesCliente } from './gestor-mensajes.js';
import { calcularScoreFiscal } from './gestor-score.js';
import { calcularChecklistDesde, renderChecklistCierreHtml } from './gestor-cierre-checklist.js';

/* ──────────────────────────────────────────
   ESTADO LOCAL
────────────────────────────────────────── */
const _state = {
  checks: {
    ingresos:    false,
    gastos:      false,
    sin_nif:     false,
    pendientes:  false,
    iva:         false,
    irpf:        false,
    todo_listo:  false,
  },
  notas: '',
};

/* ──────────────────────────────────────────
   ENTRADA PRINCIPAL
────────────────────────────────────────── */

/**
 * Renderiza el panel de revisión en el contenedor dado.
 * @param {HTMLElement} container
 */
export async function renderRevisionCliente(container) {
  if (!container) return;

  const ctx      = getContextoCliente();
  const year     = getYear();
  const trim     = getTrim();
  const periodo  = `${TRIM_LABELS[trim]} · ${year}`;
  const nombre   = ctx?.nombre || 'Cliente';

  // Resetear estado local — cada cliente y trimestre empieza limpio
  _state.checks.ingresos   = false;
  _state.checks.gastos     = false;
  _state.checks.sin_nif    = false;
  _state.checks.pendientes = false;
  _state.checks.iva        = false;
  _state.checks.irpf       = false;
  _state.checks.todo_listo = false;
  _state.notas = '';

  container.innerHTML = `
    <div class="view-header">
      <div class="view-title-group">
        <h1 class="view-title">Revisión fiscal</h1>
        <p class="view-sub">${nombre} · ${periodo}</p>
      </div>
      <div class="view-actions">
        <button class="btn-outline" onclick="window._abrirModalSolicitud()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Solicitar documentos
        </button>
        <button class="btn-outline" onclick="window._switchView('dashboard')">
          ← Volver al dashboard
        </button>
      </div>
    </div>
    <div id="revisionContent">
      <div style="text-align:center;padding:40px;color:var(--t3);font-size:13px">
        Cargando datos fiscales…
      </div>
    </div>`;

  // Exponer modal de solicitud
  window._abrirModalSolicitud = abrirModalSolicitud;

  // Cargar datos + alertas en paralelo
  const [facturas, cierre, facturasTrimAnterior, alertas] = await Promise.all([
    getFacturasTrim(year, trim),
    _loadCierre(ctx?.empresa_id, year, trim),
    _loadTrimAnterior(year, trim),
    calcularAlertasCliente(ctx?.empresa_id),
  ]);

  // Calcular métricas
  const iva  = calcIVA(facturas);
  const irpf = calcIRPF(facturas);

  const emitidas  = facturas.filter(f => f.tipo === 'emitida' && f.estado === 'emitida');
  const recibidas = facturas.filter(f => f.tipo === 'recibida');
  const sin_nif   = emitidas.filter(f => !f.cliente_nif?.trim());
  const sin_cobrar = emitidas.filter(f => !f.cobrada);
  const sin_proveedor = recibidas.filter(f => !f.proveedor_nombre?.trim() && !f.cliente_nombre?.trim());

  // Comparar con trimestre anterior para detectar ingresos anormales
  const irpfAnt = calcIRPF(facturasTrimAnterior);
  const ingresoAnormal = irpfAnt.ingresos > 0 &&
    irpf.ingresos > irpfAnt.ingresos * 1.5;

  // Semáforo global
  const problemas = [
    sin_nif.length > 0,
    emitidas.length === 0 && recibidas.length === 0,
    ingresoAnormal,
  ].filter(Boolean).length;

  const semaforo = cierre?.gestor_revisado_en
    ? 'verde'
    : problemas > 0
    ? 'rojo'
    : 'amarillo';

  // Restaurar checks del estado guardado si hay cierre previo
  if (cierre?.gestor_revisado_en) {
    // Restaurar cada check individualmente desde los campos guardados.
    // Si el campo es null (registro antiguo antes de la migración) → true por defecto.
    _state.checks.ingresos   = cierre.check_ingresos   ?? true;
    _state.checks.gastos     = cierre.check_gastos     ?? true;
    _state.checks.sin_nif    = cierre.check_sin_nif    ?? true;
    _state.checks.pendientes = cierre.check_pendientes ?? true;
    _state.checks.iva        = cierre.check_iva        ?? true;
    _state.checks.irpf       = cierre.check_irpf       ?? true;
    _state.checks.todo_listo = cierre.check_todo_listo ?? true;
  }
  if (cierre?.gestor_notas) {
    _state.notas = cierre.gestor_notas;
  }

  // Score fiscal (sin queries extra — usa datos ya calculados)
  const solicitudes_pendientes_count = alertas
    .filter(a => a.tipo === 'solicitudes_pendientes').length;

  const { score: score_fiscal } = calcularScoreFiscal({
    facturacion_trim:        irpf.ingresos,
    gastos_trim:             irpf.gastos,
    iva_estimado:            iva.resultado,
    alertas,
    solicitudes_pendientes:  solicitudes_pendientes_count,
    facturas_emitidas_count: emitidas.length,
  });

  // Checklist de cierre (sin queries extra)
  const checklistCierre = calcularChecklistDesde({
    emitidas, recibidas,
    sin_nif: sin_nif.length,
    iva, irpf,
    alertas,
    solicitudes_pendientes: solicitudes_pendientes_count,
    score_fiscal,
    cierre,
  });

  _renderContent(container.querySelector('#revisionContent'), {
    facturas, emitidas, recibidas,
    sin_nif, sin_cobrar, sin_proveedor,
    iva, irpf, irpfAnt,
    ingresoAnormal, semaforo, cierre,
    alertas, score_fiscal, checklistCierre,
    year, trim, periodo, nombre,
    empresa_id: ctx?.empresa_id,
  });
}

/* ──────────────────────────────────────────
   RENDER PRINCIPAL
────────────────────────────────────────── */

function _renderContent(wrap, d) {
  const {
    emitidas, recibidas, sin_nif, sin_cobrar, sin_proveedor,
    iva, irpf, irpfAnt, ingresoAnormal,
    semaforo, cierre, alertas = [],
    checklistCierre, year, trim, periodo, nombre, empresa_id,
  } = d;

  const revisadoEn = cierre?.gestor_revisado_en
    ? fmtDate(cierre.gestor_revisado_en.slice(0, 10))
    : null;

  const COLOR = { verde: '#059669', amarillo: '#d97706', rojo: '#dc2626' };
  const BG    = { verde: '#f0fdf4', amarillo: '#fefce8', rojo: '#fef2f2' };
  const LABEL = { verde: 'Revisado', amarillo: 'Pendiente', rojo: 'Requiere atención' };

  wrap.innerHTML = `

    <!-- Banner de estado -->
    <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;
                background:${BG[semaforo]};border-radius:12px;
                border:1px solid ${COLOR[semaforo]}33;margin-bottom:24px">
      <div style="width:10px;height:10px;border-radius:50%;
                  background:${COLOR[semaforo]};flex-shrink:0"></div>
      <div style="flex:1;font-size:13px;font-weight:600;color:${COLOR[semaforo]}">
        ${LABEL[semaforo]}
        ${revisadoEn ? `<span style="font-weight:400;color:var(--t3)"> · Revisado el ${revisadoEn}</span>` : ''}
      </div>
      <span style="font-size:12px;color:var(--t3)">${periodo}</span>
    </div>

    <!-- Grid 2 columnas -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">

      <!-- COL 1: Resumen fiscal -->
      <div>
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                    letter-spacing:.6px;color:var(--t3);margin-bottom:14px">
          Resumen fiscal
        </div>

        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          ${_kpi('Ingresos netos', fmt(irpf.ingresos), 'blue')}
          ${_kpi('Gastos deducibles', fmt(irpf.gastos), 'amber')}
          ${_kpi('IVA modelo 303', fmt(iva.resultado),
              iva.resultado > 0 ? 'red' : 'green',
              iva.resultado > 0 ? 'A ingresar' : 'A compensar')}
          ${_kpi('IRPF modelo 130', fmt(irpf.resultado),
              irpf.resultado > 0 ? 'red' : 'green',
              irpf.resultado > 0 ? 'A ingresar' : 'Sin pago')}
        </div>

        <!-- Detalle de operaciones -->
        <div style="background:var(--srf);border:1px solid var(--brd);
                    border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                      letter-spacing:.6px;color:var(--t3);margin-bottom:12px">
            Detalle de operaciones
          </div>
          ${_fila('Facturas emitidas', emitidas.length, emitidas.length === 0 ? 'warn' : 'ok')}
          ${_fila('Facturas recibidas (gastos)', recibidas.length, recibidas.length === 0 ? 'warn' : 'ok')}
          ${_fila('Facturas sin NIF cliente', sin_nif.length, sin_nif.length > 0 ? 'error' : 'ok')}
          ${_fila('Facturas sin cobrar', sin_cobrar.length, sin_cobrar.length > 3 ? 'warn' : 'ok')}
          ${_fila('Gastos sin proveedor', sin_proveedor.length, sin_proveedor.length > 0 ? 'warn' : 'ok')}
          ${ingresoAnormal ? _fila('Ingresos +50% vs trimestre anterior', '⚠️ Sí', 'warn') : ''}
          ${emitidas.length === 0 && recibidas.length === 0
            ? `<div style="margin-top:8px;padding:8px 10px;background:#fef2f2;
                           border-radius:8px;font-size:12px;color:#dc2626;font-weight:600">
                ⚠️ Sin actividad registrada en este trimestre
              </div>`
            : ''}
        </div>

        <!-- IVA desglose -->
        <div style="background:var(--srf);border:1px solid var(--brd);
                    border-radius:12px;padding:16px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                      letter-spacing:.6px;color:var(--t3);margin-bottom:12px">
            Desglose IVA (Mod. 303)
          </div>
          ${_fila('IVA repercutido 21%', fmt(iva.rep[21]))}
          ${_fila('IVA repercutido 10%', fmt(iva.rep[10]))}
          ${_fila('IVA repercutido 4%',  fmt(iva.rep[4]))}
          ${_fila('IVA soportado (gastos)', fmt(iva.sop.total))}
          <div style="border-top:1px solid var(--brd);margin-top:8px;padding-top:8px">
            ${_fila('Resultado', fmt(iva.resultado),
                iva.resultado > 0 ? 'error' : 'ok',
                true)}
          </div>
        </div>
      </div>

      <!-- COL 2: Checklist de cierre automático + confirmación gestor -->
      <div>
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                    letter-spacing:.6px;color:var(--t3);margin-bottom:14px">
          Checklist de cierre
        </div>

        <!-- Checklist automático -->
        ${checklistCierre ? renderChecklistCierreHtml(checklistCierre, trim, year) : ''}

        <!-- Confirmación manual del gestor -->
        <div style="background:var(--srf);border:1px solid var(--brd);
                    border-radius:12px;padding:18px;margin-top:14px;margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;color:var(--t3);
                      margin-bottom:12px">Confirmación del gestor</div>
          ${_check('ingresos',   'Ingresos revisados')}
          ${_check('gastos',     'Gastos revisados')}
          ${_check('sin_nif',    'Facturas sin NIF revisadas')}
          ${_check('pendientes', 'Facturas pendientes revisadas')}
          ${_check('iva',        'IVA (Mod. 303) correcto')}
          ${_check('irpf',       'IRPF (Mod. 130) correcto')}
          <div style="border-top:1px solid var(--brd);margin-top:12px;padding-top:12px">
            ${_check('todo_listo', 'Todo listo para presentar impuestos', true)}
          </div>
        </div>

        <!-- Notas del gestor -->
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:11px;font-weight:800;
                         text-transform:uppercase;letter-spacing:.6px;
                         color:var(--t3);margin-bottom:8px">
            Notas internas
          </label>
          <textarea id="revisionNotas"
            class="ff-input"
            rows="3"
            placeholder="Observaciones sobre este cliente y trimestre…"
            style="resize:vertical;font-size:13px">${_state.notas}</textarea>
        </div>

        <!-- Botón marcar revisado -->
        <button
          id="btnMarcarRevisado"
          class="btn-primary"
          style="width:100%;justify-content:center;font-size:14px;padding:12px"
          onclick="window._marcarTrimRevisado()">
          ${cierre?.gestor_revisado_en
            ? '✓ Trimestre ya revisado — Actualizar notas'
            : '✓ Marcar trimestre como revisado'}
        </button>

        ${revisadoEn
          ? `<div style="margin-top:10px;text-align:center;font-size:12px;color:var(--t3)">
               Revisado por última vez el ${revisadoEn}
             </div>`
          : ''}

        <!-- Plazo fiscal -->
        <div style="margin-top:16px;padding:12px 14px;background:var(--bg2);
                    border-radius:10px;font-size:12px;color:var(--t3)">
          <span style="font-weight:600;color:var(--t2)">Plazo presentación:</span>
          ${TRIM_PLAZOS[trim] || '—'}
        </div>
      </div>

    </div>

    <!-- Alertas detectadas -->
    <div id="revisionAlertas" style="margin-top:20px"></div>

    <!-- Solicitudes y mensajes -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">

      <!-- Solicitudes -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:12px">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                      letter-spacing:.6px;color:var(--t3)">
            Solicitudes de documentos
          </div>
          <button onclick="window._abrirModalSolicitud()"
            style="font-size:11px;font-weight:600;color:var(--ox);background:none;
                   border:1px solid var(--ox);border-radius:6px;
                   padding:3px 9px;cursor:pointer">
            + Nueva
          </button>
        </div>
        <div style="background:var(--srf);border:1px solid var(--brd);
                    border-radius:12px;padding:14px">
          <div id="revisionSolicitudes">
            <div style="font-size:12px;color:var(--t3)">Cargando…</div>
          </div>
        </div>
      </div>

      <!-- Mensajes -->
      <div>
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;
                    letter-spacing:.6px;color:var(--t3);margin-bottom:12px">
          Mensajes con el cliente
        </div>
        <div style="background:var(--srf);border:1px solid var(--brd);
                    border-radius:12px;padding:14px">
          <div id="revisionMensajes"></div>
        </div>
      </div>

    </div>`;

  // Restaurar checks del estado
  _syncChecks();

  // Registrar handlers de checkboxes
  wrap.querySelectorAll('.revision-check').forEach(cb => {
    cb.addEventListener('change', () => {
      _state.checks[cb.dataset.key] = cb.checked;
      _actualizarProgreso(wrap);
    });
  });

  // Guardar notas en estado al escribir
  const notasEl = wrap.querySelector('#revisionNotas');
  if (notasEl) {
    notasEl.addEventListener('input', () => {
      _state.notas = notasEl.value;
    });
  }

  // Handler del botón — expuesto en window
  window._marcarTrimRevisado = () => _guardarRevision(empresa_id, year, trim);

  _actualizarProgreso(wrap);

  // Alertas detectadas
  const alertasEl = wrap.querySelector('#revisionAlertas');
  if (alertasEl) alertasEl.innerHTML = renderAlertasHtml(alertas);

  // Solicitudes (async, no bloquea el render)
  const solEl = wrap.querySelector('#revisionSolicitudes');
  if (solEl && empresa_id) renderSolicitudesGestor(solEl, empresa_id);

  // Mensajes (async)
  const msgEl = wrap.querySelector('#revisionMensajes');
  if (msgEl && empresa_id) renderMensajesCliente(msgEl, empresa_id);
}

/* ──────────────────────────────────────────
   GUARDAR REVISIÓN EN BD
────────────────────────────────────────── */

async function _guardarRevision(empresa_id, year, trim) {
  if (!empresa_id) {
    toast('No hay cliente activo.', 'error');
    return;
  }

  const btn = document.getElementById('btnMarcarRevisado');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  const notas = document.getElementById('revisionNotas')?.value?.trim() || null;

  // Campos base — siempre guardan aunque las columnas check_* no existan aún
  const camposBase = {
    gestor_revisado_en: new Date().toISOString(),
    modelo_303_ok:      !!_state.checks.iva || !!_state.checks.irpf,
    modelo_130_ok:      !!_state.checks.irpf,
    gestor_notas:       notas,
  };

  // Campos check_* — se añaden si existen en la tabla (migración opcional)
  const camposCheck = {
    check_ingresos:   !!_state.checks.ingresos,
    check_gastos:     !!_state.checks.gastos,
    check_sin_nif:    !!_state.checks.sin_nif,
    check_pendientes: !!_state.checks.pendientes,
    check_iva:        !!_state.checks.iva,
    check_irpf:       !!_state.checks.irpf,
    check_todo_listo: !!_state.checks.todo_listo,
  };

  // 1. Intentar actualizar si ya existe la fila
  const { data: existente, error: selectErr } = await supabase
    .from('cierres_trimestrales')
    .select('id')
    .eq('empresa_id', empresa_id)
    .eq('year', year)
    .eq('trimestre', trim)
    .maybeSingle();

  let guardadoOk = false;

  if (existente?.id) {
    // UPDATE — la fila ya existe
    const { error: updateErr } = await supabase
      .from('cierres_trimestrales')
      .update({ ...camposBase, ...camposCheck })
      .eq('id', existente.id);

    if (updateErr) {
      // Reintentar sin check_* por si las columnas no están migradas
      const { error: updateErr2 } = await supabase
        .from('cierres_trimestrales')
        .update(camposBase)
        .eq('id', existente.id);
      if (updateErr2) {
        toast('Error al guardar: ' + updateErr2.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✓ Marcar trimestre como revisado'; }
        return;
      }
    }
    guardadoOk = true;

  } else {
    // INSERT — primera vez para este trimestre
    const { error: insertErr } = await supabase
      .from('cierres_trimestrales')
      .insert({
        empresa_id,
        year,
        trimestre: trim,
        ...camposBase,
        ...camposCheck,
      });

    if (insertErr) {
      // Reintentar sin check_* por si las columnas no están migradas
      const { error: insertErr2 } = await supabase
        .from('cierres_trimestrales')
        .insert({ empresa_id, year, trimestre: trim, ...camposBase });
      if (insertErr2) {
        toast('Error al guardar: ' + insertErr2.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✓ Marcar trimestre como revisado'; }
        return;
      }
    }
    guardadoOk = true;
  }

  if (!guardadoOk) return;

  toast('✅ Trimestre marcado como revisado', 'success');

  // Invalidar cache y recargar cartera en segundo plano
  invalidarCartera();
  if (window._refreshCartera) window._refreshCartera();

  // Re-render de esta vista con datos actualizados
  const container = document.getElementById('view-revision-cliente');
  if (container) await renderRevisionCliente(container);
}

/* ──────────────────────────────────────────
   HELPERS DE DATOS
────────────────────────────────────────── */

async function _loadCierre(empresa_id, year, trim) {
  if (!empresa_id) return null;
  const { data } = await supabase
    .from('cierres_trimestrales')
    .select(`
      id,
      gestor_revisado_en, gestor_notas,
      modelo_303_ok, modelo_130_ok,
      check_ingresos, check_gastos, check_sin_nif,
      check_pendientes, check_iva, check_irpf, check_todo_listo
    `)
    .eq('empresa_id', empresa_id)
    .eq('year', year)
    .eq('trimestre', trim)
    .maybeSingle();
  return data;
}

async function _loadTrimAnterior(year, trim) {
  const trims   = ['T1','T2','T3','T4'];
  const idx     = trims.indexOf(trim);
  const antTrim = idx === 0 ? 'T4' : trims[idx - 1];
  const antYear = idx === 0 ? year - 1 : year;
  return getFacturasTrim(antYear, antTrim);
}

/* ──────────────────────────────────────────
   HELPERS UI
────────────────────────────────────────── */

function _kpi(label, value, color = 'blue', sub = '') {
  const icons = {
    blue:  `<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>`,
    amber: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    red:   `<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>`,
    green: `<polyline points="20 6 9 17 4 12"/>`,
  };
  return `
    <div class="kpi-card kpi-${color}">
      <div class="kpi-top">
        <span class="kpi-lbl">${label}</span>
        <div class="kpi-icon kpi-icon--${color}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5">${icons[color] || icons.blue}</svg>
        </div>
      </div>
      <div class="kpi-val">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
}

function _fila(label, value, estado = 'ok', negrita = false) {
  const color = estado === 'error' ? '#dc2626'
              : estado === 'warn'  ? '#d97706'
              : 'var(--t3)';
  const dot = estado !== 'ok'
    ? `<span style="width:6px;height:6px;border-radius:50%;
                    background:${color};flex-shrink:0;margin-top:1px"></span>`
    : `<span style="width:6px;height:6px;border-radius:50%;
                    background:#d1d5db;flex-shrink:0;margin-top:1px"></span>`;
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;
                gap:8px;padding:5px 0;border-bottom:1px solid var(--brd)">
      <div style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t2)">
        ${dot}${label}
      </div>
      <span style="font-size:12px;font-weight:${negrita ? '700' : '500'};
                   color:${estado !== 'ok' ? color : 'var(--t1)'};
                   white-space:nowrap">
        ${value}
      </span>
    </div>`;
}

function _check(key, label, destacado = false) {
  const checked = _state.checks[key] ? 'checked' : '';
  return `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 0;
                  cursor:pointer;${destacado ? 'font-weight:700' : ''}
                  border-bottom:1px solid var(--brd)">
      <input type="checkbox" class="revision-check"
             data-key="${key}" ${checked}
             style="width:16px;height:16px;cursor:pointer;accent-color:#059669;flex-shrink:0"/>
      <span style="font-size:13px;color:var(--t${destacado ? '1' : '2'})">${label}</span>
    </label>`;
}

function _syncChecks() {
  document.querySelectorAll('.revision-check').forEach(cb => {
    cb.checked = !!_state.checks[cb.dataset.key];
  });
}

function _actualizarProgreso(wrap) {
  const total     = Object.keys(_state.checks).length;
  const marcados  = Object.values(_state.checks).filter(Boolean).length;
  const pct       = Math.round((marcados / total) * 100);
  const btn       = document.getElementById('btnMarcarRevisado');
  if (btn && marcados === total) {
    btn.style.opacity = '1';
  } else if (btn) {
    btn.style.opacity = '0.7';
  }
}
