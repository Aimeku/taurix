/* ═══════════════════════════════════════════════════════
   TAURIX · gestor-mensajes.js

   Mensajería simple gestor ↔ cliente.
   Sin tiempo real, sin sockets. Polling manual al abrir.
   ═══════════════════════════════════════════════════════ */

import { supabase }  from './supabase.js';
import { toast, fmtDate } from './utils.js';
import { getGestorUserId } from './gestor-store.js';
import { getContextoCliente, estaEnContextoCliente } from './gestor-context.js';

/* ──────────────────────────────────────────
   RENDER PRINCIPAL
────────────────────────────────────────── */

/**
 * Renderiza el hilo de mensajes en un contenedor.
 * Usado en la vista de revisión fiscal.
 * @param {HTMLElement} container
 * @param {string} empresa_id
 */
export async function renderMensajesCliente(container, empresa_id) {
  if (!container || !empresa_id) return;

  container.innerHTML = `
    <div id="msgLista" style="max-height:280px;overflow-y:auto;
                              display:flex;flex-direction:column;gap:6px;
                              padding:4px 0;margin-bottom:12px">
      <div style="text-align:center;font-size:12px;color:var(--t3);padding:16px">
        Cargando mensajes…
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <input id="msgInput" class="ff-input" placeholder="Escribe un mensaje al cliente…"
             style="flex:1" autocomplete="off"/>
      <button id="msgEnviarBtn" class="btn-primary"
              style="padding:9px 16px;white-space:nowrap">
        Enviar
      </button>
    </div>`;

  await _cargarMensajes(empresa_id, container.querySelector('#msgLista'));

  // Marcar mensajes del cliente como leídos al abrir
  _marcarLeidos(empresa_id);

  // Handler enviar
  const input = container.querySelector('#msgInput');
  const btn   = container.querySelector('#msgEnviarBtn');

  const enviar = async () => {
    const texto = input.value.trim();
    if (!texto) return;
    btn.disabled = true;

    const gestorId   = getGestorUserId();
    const esGestor   = estaEnContextoCliente();
    const autor_tipo = esGestor ? 'gestor' : 'cliente';
    const autor_id   = gestorId || window.__TAURIX_SESSION__?.user?.id;

    const { error } = await supabase.from('mensajes').insert({
      empresa_id,
      gestor_user_id: gestorId || await _resolverGestorId(empresa_id),
      autor_tipo,
      autor_id,
      texto,
      leido: false,
    });

    if (error) {
      toast('Error al enviar: ' + error.message, 'error');
      btn.disabled = false;
      return;
    }

    input.value = '';
    btn.disabled = false;
    await _cargarMensajes(empresa_id, container.querySelector('#msgLista'));
  };

  btn.addEventListener('click', enviar);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  });
}

/* ──────────────────────────────────────────
   CARGAR Y RENDERIZAR MENSAJES
────────────────────────────────────────── */

async function _cargarMensajes(empresa_id, lista) {
  if (!lista) return;

  const { data } = await supabase
    .from('mensajes')
    .select('id, autor_tipo, texto, leido, creado_en')
    .eq('empresa_id', empresa_id)
    .order('creado_en', { ascending: true })
    .limit(50);

  const msgs = data || [];

  if (!msgs.length) {
    lista.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">
        Sin mensajes. Inicia la conversación con el cliente.
      </div>`;
    return;
  }

  lista.innerHTML = msgs.map(m => {
    const esGestor = m.autor_tipo === 'gestor';
    return `
      <div style="display:flex;flex-direction:column;
                  align-items:${esGestor ? 'flex-end' : 'flex-start'}">
        <div style="max-width:85%;padding:8px 12px;border-radius:12px;
                    ${esGestor
                      ? 'background:#1a56db;color:#fff;border-bottom-right-radius:3px'
                      : 'background:var(--bg2);color:var(--t1);border-bottom-left-radius:3px'
                    };font-size:13px;line-height:1.5">
          ${_escapeHtml(m.texto)}
        </div>
        <div style="font-size:10px;color:var(--t4);margin-top:2px;
                    ${esGestor ? 'text-align:right' : ''}">
          ${esGestor ? 'Tú (gestor)' : 'Cliente'} · ${_fmtMsgDate(m.creado_en)}
          ${esGestor && !m.leido ? ' · <span style="color:#d97706">No leído</span>' : ''}
        </div>
      </div>`;
  }).join('');

  // Scroll al final
  lista.scrollTop = lista.scrollHeight;
}

/* ──────────────────────────────────────────
   HELPERS
────────────────────────────────────────── */

async function _marcarLeidos(empresa_id) {
  const uid = window.__TAURIX_SESSION__?.user?.id;
  if (!uid) return;
  // Si es gestor, marcar mensajes del cliente como leídos
  // Si es cliente, marcar mensajes del gestor como leídos
  const esGestor = estaEnContextoCliente();
  const tipoContraparte = esGestor ? 'cliente' : 'gestor';
  await supabase.from('mensajes')
    .update({ leido: true })
    .eq('empresa_id', empresa_id)
    .eq('autor_tipo', tipoContraparte)
    .eq('leido', false);
}

async function _resolverGestorId(empresa_id) {
  // Para el cliente que envía mensaje: buscar su gestor
  const { data } = await supabase
    .from('gestor_clients')
    .select('gestor_user_id')
    .eq('empresa_id', empresa_id)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();
  return data?.gestor_user_id || null;
}

function _escapeHtml(str) {
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/\n/g,'<br>');
}

function _fmtMsgDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  if (esHoy) return d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit' }) + ' '
    + d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
}

/* ──────────────────────────────────────────
   BADGE — nº mensajes no leídos
────────────────────────────────────────── */

/**
 * Devuelve el número de mensajes sin leer de un cliente.
 * @param {string} empresa_id
 * @param {'gestor'|'cliente'} perspectiva  Quién está leyendo
 */
export async function getMsgNoLeidos(empresa_id, perspectiva = 'gestor') {
  const tipoContraparte = perspectiva === 'gestor' ? 'cliente' : 'gestor';
  const { count } = await supabase
    .from('mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresa_id)
    .eq('autor_tipo', tipoContraparte)
    .eq('leido', false);
  return count || 0;
}
