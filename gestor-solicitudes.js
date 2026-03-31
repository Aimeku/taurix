/* ═══════════════════════════════════════════════════════
   TAURIX · gestor-solicitudes.js

   Solicitudes de documentos gestor → cliente.
   El gestor pide; el cliente ve y marca como completado.
   ═══════════════════════════════════════════════════════ */

import { supabase } from './supabase.js';
import {
  toast, openModal, closeModal,
  getYear, getTrim, fmtDate, TRIM_LABELS
} from './utils.js';
import { getGestorUserId } from './gestor-store.js';
import { getContextoCliente } from './gestor-context.js';
import { invalidarCartera } from './gestor-store.js';

/* ──────────────────────────────────────────
   PLANTILLAS RÁPIDAS
────────────────────────────────────────── */
const PLANTILLAS = [
  { id: 'gastos_trim',  label: 'Facturas de gastos del trimestre',
    titulo: 'Facturas de gastos del trimestre',
    desc:   'Sube todas las facturas de gastos que hayas tenido este trimestre.' },
  { id: 'extracto',    label: 'Extracto bancario',
    titulo: 'Extracto bancario del trimestre',
    desc:   'Sube el extracto bancario del periodo.' },
  { id: 'justificantes', label: 'Justificantes y tickets',
    titulo: 'Justificantes y tickets del trimestre',
    desc:   'Sube los tickets y justificantes de gastos menores.' },
  { id: 'otros',       label: 'Otro documento…',
    titulo: '', desc: '' },
];

/* ──────────────────────────────────────────
   MODAL — CREAR SOLICITUD
────────────────────────────────────────── */

/**
 * Abre el modal para crear una solicitud de documentos.
 * El gestor selecciona plantilla, personaliza y envía.
 */
export function abrirModalSolicitud() {
  const ctx  = getContextoCliente();
  const year = getYear();
  const trim = getTrim();

  if (!ctx?.empresa_id) {
    toast('No hay cliente activo.', 'error');
    return;
  }

  openModal(`
    <div class="modal" style="max-width:500px">
      <div class="modal-hd">
        <span class="modal-title">📋 Solicitar documentos</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p style="font-size:13px;color:var(--t3);margin-bottom:16px">
          El cliente recibirá un aviso en su dashboard.
        </p>

        <!-- Plantillas rápidas -->
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:12px;font-weight:700;
                         color:var(--t2);margin-bottom:8px">Plantilla rápida</label>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${PLANTILLAS.map(p => `
              <button
                onclick="window._selPlantilla('${p.id}')"
                data-pid="${p.id}"
                style="text-align:left;padding:9px 12px;border:1.5px solid var(--brd);
                       border-radius:9px;background:var(--srf);cursor:pointer;
                       font-size:13px;color:var(--t2);transition:all .12s"
                onmouseover="this.style.borderColor='var(--ox)';this.style.color='var(--t1)'"
                onmouseout="this.style.borderColor='var(--brd)';this.style.color='var(--t2)'">
                ${p.label}
              </button>`).join('')}
          </div>
        </div>

        <div style="border-top:1px solid var(--brd);padding-top:16px">
          <div class="modal-field">
            <label>Título de la solicitud</label>
            <input id="solTitulo" class="ff-input" placeholder="Ej: Facturas de gastos del T1 2025" autocomplete="off"/>
          </div>
          <div class="modal-field">
            <label>Descripción <span style="font-weight:400;color:var(--t4)">(opcional)</span></label>
            <textarea id="solDesc" class="ff-input" rows="2"
              placeholder="Instrucciones adicionales para el cliente…"
              style="resize:vertical"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="modal-field">
              <label>Trimestre</label>
              <select id="solTrim" class="ff-select">
                <option value="T1" ${trim==='T1'?'selected':''}>T1 (Ene–Mar)</option>
                <option value="T2" ${trim==='T2'?'selected':''}>T2 (Abr–Jun)</option>
                <option value="T3" ${trim==='T3'?'selected':''}>T3 (Jul–Sep)</option>
                <option value="T4" ${trim==='T4'?'selected':''}>T4 (Oct–Dic)</option>
              </select>
            </div>
            <div class="modal-field">
              <label>Año</label>
              <input id="solYear" class="ff-input" type="number" value="${year}" min="2020" max="2099"/>
            </div>
          </div>
          <div class="modal-field">
            <label>Fecha límite <span style="font-weight:400;color:var(--t4)">(opcional)</span></label>
            <input id="solFecha" class="ff-input" type="date"/>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="solEnviarBtn">📤 Enviar solicitud</button>
      </div>
    </div>`);

  // Seleccionar plantilla
  window._selPlantilla = (pid) => {
    const p = PLANTILLAS.find(x => x.id === pid);
    if (!p) return;
    const tituloEl = document.getElementById('solTitulo');
    const descEl   = document.getElementById('solDesc');
    if (tituloEl && p.titulo) tituloEl.value = p.titulo;
    if (descEl   && p.desc)   descEl.value   = p.desc;
    // Resaltar seleccionada
    document.querySelectorAll('[data-pid]').forEach(b => {
      b.style.borderColor = b.dataset.pid === pid ? 'var(--ox)' : 'var(--brd)';
      b.style.background  = b.dataset.pid === pid ? 'rgba(249,115,22,.06)' : 'var(--srf)';
    });
  };

  document.getElementById('solEnviarBtn').addEventListener('click', async () => {
    const titulo = document.getElementById('solTitulo').value.trim();
    if (!titulo) { toast('El título es obligatorio.', 'error'); return; }

    const gestorId = getGestorUserId();
    const btn = document.getElementById('solEnviarBtn');
    btn.disabled = true;
    btn.textContent = 'Enviando…';

    const { error } = await supabase.from('solicitudes_documentos').insert({
      gestor_user_id: gestorId,
      empresa_id:     ctx.empresa_id,
      titulo,
      descripcion:    document.getElementById('solDesc').value.trim() || null,
      tipo:           'otros',
      trimestre:      document.getElementById('solTrim').value,
      year:           parseInt(document.getElementById('solYear').value),
      fecha_limite:   document.getElementById('solFecha').value || null,
      estado:         'pendiente',
    });

    if (error) {
      toast('Error al enviar: ' + error.message, 'error');
      btn.disabled = false;
      btn.textContent = '📤 Enviar solicitud';
      return;
    }

    toast('✅ Solicitud enviada. El cliente la verá en su dashboard.', 'success');
    closeModal();
    invalidarCartera();
  });
}

/* ──────────────────────────────────────────
   RENDER — LISTA DE SOLICITUDES (gestor)
────────────────────────────────────────── */

/**
 * Renderiza las solicitudes de un cliente en un contenedor.
 * Usado en la vista de revisión fiscal.
 * @param {HTMLElement} container
 * @param {string} empresa_id
 */
export async function renderSolicitudesGestor(container, empresa_id) {
  if (!container || !empresa_id) return;

  container.innerHTML = `<div style="font-size:12px;color:var(--t3)">Cargando solicitudes…</div>`;

  const { data } = await supabase
    .from('solicitudes_documentos')
    .select('*')
    .eq('empresa_id', empresa_id)
    .order('creada_en', { ascending: false })
    .limit(10);

  const solicitudes = data || [];

  if (!solicitudes.length) {
    container.innerHTML = `
      <div style="font-size:12px;color:var(--t3);padding:8px 0">
        Sin solicitudes enviadas.
      </div>`;
    return;
  }

  container.innerHTML = solicitudes.map(s => {
    const pendiente = s.estado === 'pendiente';
    const color     = pendiente ? '#d97706' : '#059669';
    const bg        = pendiente ? '#fefce8' : '#f0fdf4';
    return `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
                  gap:10px;padding:9px 0;border-bottom:1px solid var(--brd)">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--t1);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${s.titulo}
          </div>
          <div style="font-size:11px;color:var(--t4);margin-top:2px">
            ${s.trimestre ? `${s.trimestre} ${s.year} · ` : ''}
            Enviada ${fmtDate(s.creada_en?.slice(0,10))}
            ${s.fecha_limite ? ` · Límite: ${fmtDate(s.fecha_limite)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="background:${bg};color:${color};font-size:10px;
                       font-weight:700;padding:2px 7px;border-radius:5px">
            ${pendiente ? 'Pendiente' : 'Completada'}
          </span>
          ${pendiente ? `
            <button
              onclick="window._marcarSolCompletada('${s.id}', this)"
              style="background:none;border:1px solid var(--brd);border-radius:6px;
                     padding:2px 8px;font-size:11px;cursor:pointer;color:var(--t3)">
              ✓
            </button>` : ''}
        </div>
      </div>`;
  }).join('');

  // Handler para marcar completada desde el lado del gestor
  window._marcarSolCompletada = async (id, btn) => {
    btn.disabled = true;
    const { error } = await supabase
      .from('solicitudes_documentos')
      .update({ estado: 'completado', completada_en: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
    toast('Solicitud marcada como completada.', 'success');
    renderSolicitudesGestor(container, empresa_id);
    invalidarCartera();
  };
}

/* ──────────────────────────────────────────
   RENDER — BLOQUE CLIENTE (dashboard cliente)
────────────────────────────────────────── */

/**
 * Renderiza el bloque "Tu gestor necesita esto" en el dashboard del cliente.
 * @param {HTMLElement} container
 * @param {string} empresa_id
 */
export async function renderSolicitudesCliente(container, empresa_id) {
  if (!container || !empresa_id) return;

  const [solRes, msgRes] = await Promise.all([
    supabase.from('solicitudes_documentos')
      .select('id, titulo, trimestre, year, fecha_limite, creada_en')
      .eq('empresa_id', empresa_id)
      .eq('estado', 'pendiente')
      .order('creada_en', { ascending: false }),

    supabase.from('mensajes')
      .select('id')
      .eq('empresa_id', empresa_id)
      .eq('autor_tipo', 'gestor')
      .eq('leido', false),
  ]);

  const solicitudes    = solRes.data || [];
  const msgNoLeidos    = msgRes.data?.length || 0;

  if (!solicitudes.length && !msgNoLeidos) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  container.innerHTML = `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;
                padding:16px 20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:${solicitudes.length ? '12px' : '0'}">
        <div style="display:flex;align-items:center;gap:8px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="#d97706" stroke-width="2.5">
            <path d="M22 17H2a3 3 0 000 6h20a3 3 0 000-6z"/>
            <path d="M5 17V7a2 2 0 012-2h10a2 2 0 012 2v10"/>
          </svg>
          <span style="font-size:13px;font-weight:700;color:#92400e">
            Tu gestor necesita esto
          </span>
          ${msgNoLeidos ? `
            <span style="background:#dc2626;color:#fff;font-size:10px;font-weight:700;
                         padding:1px 6px;border-radius:10px">
              ${msgNoLeidos} mensaje${msgNoLeidos > 1 ? 's' : ''}
            </span>` : ''}
        </div>
        <button onclick="window._switchView('revision-cliente')"
          style="font-size:12px;font-weight:600;color:#d97706;background:none;
                 border:1px solid #fde68a;border-radius:7px;padding:3px 10px;cursor:pointer">
          Ver detalles →
        </button>
      </div>
      ${solicitudes.slice(0,3).map(s => `
        <div style="display:flex;align-items:center;gap:7px;padding:5px 0;
                    border-top:1px solid #fde68a">
          <span style="width:5px;height:5px;border-radius:50%;
                       background:#d97706;flex-shrink:0"></span>
          <span style="font-size:12px;color:#78350f">${s.titulo}</span>
          ${s.fecha_limite ? `
            <span style="margin-left:auto;font-size:11px;color:#b45309">
              Límite: ${fmtDate(s.fecha_limite)}
            </span>` : ''}
        </div>`).join('')}
      ${solicitudes.length > 3 ? `
        <div style="font-size:11px;color:#b45309;padding-top:6px">
          + ${solicitudes.length - 3} solicitud${solicitudes.length - 3 > 1 ? 'es' : ''} más
        </div>` : ''}
    </div>`;
}
