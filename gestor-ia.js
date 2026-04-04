/* ═══════════════════════════════════════════════════════════════════
   TAURIX · gestor-ia.js
   Asistente Fiscal IA — Powered by Claude (Anthropic)

   INTEGRACIÓN:
   1. Importar este módulo en main.js:
      import { initGestorIA } from './gestor-ia.js';
   2. Llamar después de que la app cargue:
      initGestorIA();
   3. El botón flotante aparece automáticamente en todas las vistas.

   DEPENDENCIAS:
   - tax-connector.js  → getContextoParaClaude(), getTaxContextResult()
   - styles.css        → variables CSS de Taurix ya disponibles
   ═══════════════════════════════════════════════════════════════════ */

import { getContextoParaClaude, getTaxContextResult } from './tax-connector.js';

/* ══════════════════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════════════════ */

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 1024;

/* ══════════════════════════════════════════════════════════════════
   ESTADO DEL CHAT
══════════════════════════════════════════════════════════════════ */

const state = {
  open:       false,
  messages:   [],   // { role: 'user'|'assistant', content: string }[]
  loading:    false,
  systemCtx:  null, // se carga al abrir el panel
};

/* ══════════════════════════════════════════════════════════════════
   INIT — Punto de entrada público
══════════════════════════════════════════════════════════════════ */

export function initGestorIA() {
  _injectStyles();
  _injectHTML();
  _bindEvents();
}

/* ══════════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════════ */

function _injectStyles() {
  if (document.getElementById('gia-styles')) return;
  const s = document.createElement('style');
  s.id = 'gia-styles';
  s.textContent = `

/* ── Botón flotante ── */
#gia-fab {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 9999;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--ox);
  border: none;
  box-shadow: 0 4px 24px rgba(249,115,22,.45), 0 2px 8px rgba(0,0,0,.18);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s;
  outline: none;
}
#gia-fab:hover {
  transform: scale(1.08) translateY(-2px);
  box-shadow: 0 8px 36px rgba(249,115,22,.55), 0 2px 10px rgba(0,0,0,.2);
}
#gia-fab:active { transform: scale(.96); }
#gia-fab svg { width: 26px; height: 26px; color: #fff; transition: opacity .15s; }
#gia-fab.open svg.ico-chat { display: none; }
#gia-fab:not(.open) svg.ico-close { display: none; }
#gia-fab-badge {
  position: absolute;
  top: -2px; right: -2px;
  width: 14px; height: 14px;
  background: var(--green);
  border: 2px solid var(--bg);
  border-radius: 50%;
  display: none;
}
#gia-fab-badge.visible { display: block; }

/* ── Panel principal ── */
#gia-panel {
  position: fixed;
  bottom: 100px;
  right: 28px;
  z-index: 9998;
  width: 420px;
  max-width: calc(100vw - 48px);
  height: 620px;
  max-height: calc(100vh - 120px);
  background: var(--srf);
  border: 1px solid var(--brd);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-lg), 0 0 0 1px rgba(249,115,22,.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateY(24px) scale(.96);
  opacity: 0;
  pointer-events: none;
  transition: transform .22s cubic-bezier(.34,1.2,.64,1), opacity .18s ease;
}
#gia-panel.open {
  transform: translateY(0) scale(1);
  opacity: 1;
  pointer-events: all;
}

/* ── Header ── */
#gia-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--brd);
  flex-shrink: 0;
  background: var(--srf);
}
.gia-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--ox);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gia-avatar svg { width: 18px; height: 18px; color: #fff; }
.gia-title-block { flex: 1; min-width: 0; }
.gia-title {
  font-family: var(--font-hd);
  font-size: 14px;
  font-weight: 800;
  color: var(--t1);
  letter-spacing: -.02em;
  line-height: 1.2;
}
.gia-subtitle {
  font-size: 11.5px;
  color: var(--t3);
  line-height: 1.3;
}
.gia-online-dot {
  width: 7px; height: 7px;
  background: var(--green);
  border-radius: 50%;
  animation: gia-pulse 2.4s infinite;
  flex-shrink: 0;
}
@keyframes gia-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(5,150,105,.45); }
  50%      { box-shadow: 0 0 0 5px rgba(5,150,105,0); }
}
#gia-clear-btn {
  background: none;
  border: none;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--t4);
  font-size: 11.5px;
  font-family: var(--font);
  transition: background .12s, color .12s;
  flex-shrink: 0;
}
#gia-clear-btn:hover { background: var(--bg2); color: var(--t2); }

/* ── Quick actions ── */
#gia-quick {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--brd);
  flex-shrink: 0;
  background: var(--srf2);
}
.gia-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  background: var(--srf);
  border: 1px solid var(--brd);
  border-radius: 100px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--t2);
  cursor: pointer;
  white-space: nowrap;
  transition: all .12s;
  font-family: var(--font);
}
.gia-chip:hover {
  background: var(--ox-lt);
  border-color: var(--ox-mid);
  color: var(--ox-dd);
}
.gia-chip svg { width: 12px; height: 12px; flex-shrink: 0; }

/* ── Mensajes ── */
#gia-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}
#gia-messages::-webkit-scrollbar { width: 4px; }
#gia-messages::-webkit-scrollbar-track { background: transparent; }
#gia-messages::-webkit-scrollbar-thumb { background: var(--brd2); border-radius: 4px; }

/* ── Welcome ── */
#gia-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px 16px;
  gap: 10px;
  flex: 1;
}
.gia-welcome-icon {
  width: 52px; height: 52px;
  border-radius: 16px;
  background: var(--ox-lt);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 6px;
}
.gia-welcome-icon svg { width: 24px; height: 24px; color: var(--ox); }
#gia-welcome h3 {
  font-family: var(--font-hd);
  font-size: 16px; font-weight: 800;
  color: var(--t1); letter-spacing: -.02em; margin: 0;
}
#gia-welcome p {
  font-size: 13px; color: var(--t3); line-height: 1.6; margin: 0;
  max-width: 300px;
}

/* ── Burbujas ── */
.gia-msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
  animation: gia-msg-in .2s ease;
}
@keyframes gia-msg-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.gia-msg.user { align-self: flex-end; }
.gia-msg.assistant { align-self: flex-start; }

.gia-bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 13.5px;
  line-height: 1.65;
  word-wrap: break-word;
}
.gia-msg.user .gia-bubble {
  background: var(--t1);
  color: #fff;
  border-radius: 16px 16px 4px 16px;
}
.gia-msg.assistant .gia-bubble {
  background: var(--srf2);
  color: var(--t1);
  border: 1px solid var(--brd);
  border-radius: 16px 16px 16px 4px;
}
.gia-bubble strong { font-weight: 700; }
.gia-bubble code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: rgba(0,0,0,.06);
  padding: 1px 5px;
  border-radius: 4px;
}
.gia-msg.user .gia-bubble code {
  background: rgba(255,255,255,.15);
}
.gia-bubble .gia-amount {
  font-family: var(--font-hd);
  font-weight: 800;
  color: var(--ox);
  font-size: 15px;
}
.gia-msg.user .gia-bubble .gia-amount { color: #FFD0A8; }

/* ── Typing indicator ── */
.gia-typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 10px 14px;
  background: var(--srf2);
  border: 1px solid var(--brd);
  border-radius: 16px 16px 16px 4px;
  align-self: flex-start;
}
.gia-typing span {
  width: 6px; height: 6px;
  background: var(--t4);
  border-radius: 50%;
  animation: gia-bounce .9s infinite ease-in-out;
}
.gia-typing span:nth-child(2) { animation-delay: .15s; }
.gia-typing span:nth-child(3) { animation-delay: .30s; }
@keyframes gia-bounce {
  0%,80%,100% { transform: translateY(0); }
  40%          { transform: translateY(-6px); }
}

/* ── Card fiscal ── */
.gia-card {
  background: var(--srf);
  border: 1px solid var(--brd);
  border-radius: 12px;
  overflow: hidden;
  margin-top: 8px;
  font-size: 13px;
}
.gia-card-header {
  padding: 10px 14px;
  background: var(--srf2);
  border-bottom: 1px solid var(--brd);
  font-weight: 700;
  font-size: 12px;
  color: var(--t2);
  letter-spacing: .01em;
  text-transform: uppercase;
  display: flex; align-items: center; gap: 7px;
}
.gia-card-header svg { width: 13px; height: 13px; color: var(--ox); }
.gia-card-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--brd);
}
.gia-card-row:last-child { border-bottom: none; }
.gia-card-row .label { color: var(--t3); font-size: 12.5px; }
.gia-card-row .val   { font-weight: 700; color: var(--t1); font-size: 13px; font-family: var(--font-hd); }
.gia-card-row .val.pagar  { color: var(--red); }
.gia-card-row .val.compen { color: var(--green); }
.gia-card-row .val.orange { color: var(--ox); }

/* ── Footer / input ── */
#gia-footer {
  padding: 12px 16px 14px;
  border-top: 1px solid var(--brd);
  flex-shrink: 0;
  background: var(--srf);
}
#gia-form {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
#gia-input {
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  padding: 10px 13px;
  background: var(--bg);
  border: 1px solid var(--brd);
  border-radius: 10px;
  font-size: 13.5px;
  font-family: var(--font);
  color: var(--t1);
  resize: none;
  outline: none;
  line-height: 1.5;
  transition: border-color .12s;
  overflow-y: hidden;
}
#gia-input::placeholder { color: var(--t4); }
#gia-input:focus { border-color: var(--ox); }
#gia-send {
  width: 40px; height: 40px;
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  background: var(--ox);
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, transform .1s;
}
#gia-send:hover:not(:disabled) { background: var(--ox-d); transform: scale(1.05); }
#gia-send:disabled { background: var(--brd2); cursor: not-allowed; }
#gia-send svg { width: 16px; height: 16px; }
.gia-footer-note {
  font-size: 10.5px;
  color: var(--t4);
  text-align: center;
  margin-top: 7px;
  line-height: 1.4;
}

/* ── Context loading overlay ── */
#gia-ctx-loading {
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,.85);
  backdrop-filter: blur(4px);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px;
  z-index: 10;
  border-radius: var(--r-xl);
}
#gia-ctx-loading.hidden { display: none; }
.gia-ctx-spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--brd2);
  border-top-color: var(--ox);
  border-radius: 50%;
  animation: gia-spin .7s linear infinite;
}
@keyframes gia-spin { to { transform: rotate(360deg); } }
.gia-ctx-label { font-size: 13px; color: var(--t3); }

`;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════════
   HTML
══════════════════════════════════════════════════════════════════ */

function _injectHTML() {
  if (document.getElementById('gia-fab')) return;

  // FAB
  const fab = document.createElement('button');
  fab.id = 'gia-fab';
  fab.setAttribute('aria-label', 'Abrir asistente fiscal IA');
  fab.innerHTML = `
    <svg class="ico-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
    <div id="gia-fab-badge"></div>
  `;

  // Panel
  const panel = document.createElement('div');
  panel.id = 'gia-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Asistente fiscal Taurix');
  panel.innerHTML = `
    <div id="gia-ctx-loading">
      <div class="gia-ctx-spinner"></div>
      <span class="gia-ctx-label">Cargando contexto fiscal…</span>
    </div>

    <div id="gia-header">
      <div class="gia-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <div class="gia-title-block">
        <div class="gia-title">Asesor Fiscal IA</div>
        <div class="gia-subtitle" id="gia-ctx-label">Taurix · Conectando…</div>
      </div>
      <div class="gia-online-dot" title="Contexto fiscal cargado"></div>
      <button id="gia-clear-btn" title="Borrar conversación">Limpiar</button>
    </div>

    <div id="gia-quick">
      <button class="gia-chip" data-q="¿Qué modelos tengo que presentar este trimestre?">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ¿Qué presento?
      </button>
      <button class="gia-chip" data-q="¿Cuánto tengo que pagar de IVA este trimestre? Dame el resumen del Modelo 303.">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        IVA · 303
      </button>
      <button class="gia-chip" data-q="¿Cuánto sale el Modelo 130 de IRPF este trimestre? ¿Tengo que pagarlo?">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        IRPF · 130
      </button>
      <button class="gia-chip" data-q="¿Cuáles son mis alertas fiscales activas y qué debo hacer?">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Alertas
      </button>
      <button class="gia-chip" data-q="¿Cuánto debería reservar cada mes para la declaración de la Renta? Dime también el tipo efectivo estimado.">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Proyección
      </button>
    </div>

    <div id="gia-messages">
      <div id="gia-welcome">
        <div class="gia-welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <h3>Tu asesor fiscal siempre disponible</h3>
        <p>Pregúntame sobre tus modelos trimestrales, plazos, importes a pagar, gastos deducibles o lo que necesites. Conozco tu situación fiscal real.</p>
      </div>
    </div>

    <div id="gia-footer">
      <div id="gia-form">
        <textarea
          id="gia-input"
          placeholder="Escribe tu pregunta fiscal…"
          rows="1"
          maxlength="1200"
          autocomplete="off"
          spellcheck="true"
        ></textarea>
        <button id="gia-send" disabled title="Enviar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div class="gia-footer-note">Respuestas basadas en tus datos fiscales reales · Siempre consulta con tu asesor</div>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);
}

/* ══════════════════════════════════════════════════════════════════
   EVENTOS
══════════════════════════════════════════════════════════════════ */

function _bindEvents() {
  const fab    = document.getElementById('gia-fab');
  const panel  = document.getElementById('gia-panel');
  const input  = document.getElementById('gia-input');
  const send   = document.getElementById('gia-send');
  const clear  = document.getElementById('gia-clear-btn');

  // Toggle panel
  fab.addEventListener('click', () => {
    state.open = !state.open;
    fab.classList.toggle('open', state.open);
    panel.classList.toggle('open', state.open);
    if (state.open && !state.systemCtx) _loadContext();
    if (state.open) setTimeout(() => input.focus(), 250);
  });

  // Input auto-resize
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    send.disabled = !input.value.trim() || state.loading;
  });

  // Enter para enviar (Shift+Enter = nueva línea)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!send.disabled) _sendMessage();
    }
  });

  // Botón enviar
  send.addEventListener('click', _sendMessage);

  // Limpiar
  clear.addEventListener('click', () => {
    state.messages = [];
    _renderMessages();
  });

  // Quick chips
  document.getElementById('gia-quick').addEventListener('click', e => {
    const chip = e.target.closest('.gia-chip');
    if (!chip) return;
    const q = chip.dataset.q;
    if (q) _sendQuestion(q);
  });
}

/* ══════════════════════════════════════════════════════════════════
   CARGAR CONTEXTO FISCAL
══════════════════════════════════════════════════════════════════ */

async function _loadContext() {
  const overlay  = document.getElementById('gia-ctx-loading');
  const subtitle = document.getElementById('gia-ctx-label');
  overlay.classList.remove('hidden');

  try {
    const [ctxText, ctxResult] = await Promise.all([
      getContextoParaClaude(),
      getTaxContextResult(),
    ]);

    state.systemCtx  = ctxText;
    state.taxResult  = ctxResult;

    const trimLabel = { T1:'1er Trim', T2:'2º Trim', T3:'3er Trim', T4:'4º Trim' };
    subtitle.textContent = `${trimLabel[ctxResult.trim] ?? ctxResult.trim} ${ctxResult.year} · Contexto cargado`;

    // Mensaje de bienvenida contextual automático
    if (state.messages.length === 0) _sendWelcomeMessage(ctxResult);

  } catch (err) {
    console.error('[GestorIA] Error cargando contexto fiscal:', err);
    subtitle.textContent = 'Contexto fiscal no disponible';
    state.systemCtx = `Eres el asesor fiscal de Taurix. El contexto fiscal no pudo cargarse. Ayuda al usuario con consultas fiscales generales y pídele que compruebe su configuración de Supabase. Responde siempre en español.`;
  } finally {
    overlay.classList.add('hidden');
    document.getElementById('gia-send').disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   MENSAJE DE BIENVENIDA CONTEXTUAL
══════════════════════════════════════════════════════════════════ */

function _sendWelcomeMessage(ctx) {
  const trim = ctx.trim;
  const year = ctx.year;
  const r303 = ctx.r303;
  const r130 = ctx.r130;
  const alertasUrgentes = (ctx.alertas ?? []).filter(a =>
    a.severidad === 'critica' || a.severidad === 'alta'
  );

  const fmt = n => new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2
  }).format(n || 0);

  const trimLabel = { T1:'1T', T2:'2T', T3:'3T', T4:'4T' };

  // Construir resumen HTML de las tarjetas
  let cardHTML = `
    <div class="gia-card">
      <div class="gia-card-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${trimLabel[trim]} ${year} · Resumen fiscal
      </div>
      <div class="gia-card-row">
        <span class="label">Modelo 303 · IVA</span>
        <span class="val ${r303.resultado_final > 0 ? 'pagar' : 'compen'}">
          ${fmt(Math.abs(r303.resultado_final))}
          ${r303.resultado_final > 0 ? '▲ a ingresar' : '▼ a compensar'}
        </span>
      </div>
      <div class="gia-card-row">
        <span class="label">Modelo 130 · IRPF</span>
        <span class="val ${r130.resultado > 0 ? 'pagar' : 'compen'}">
          ${r130.resultado > 0 ? fmt(r130.resultado) + ' a ingresar' : 'Sin pago'}
        </span>
      </div>
      ${alertasUrgentes.length > 0 ? `
      <div class="gia-card-row">
        <span class="label">Alertas urgentes</span>
        <span class="val orange">${alertasUrgentes.length} alerta${alertasUrgentes.length > 1 ? 's' : ''}</span>
      </div>` : ''}
    </div>
  `;

  const texto = `¡Hola! Ya tengo cargados tus datos fiscales del <strong>${trimLabel[trim]} de ${year}</strong>. Este es tu resumen rápido:`;

  _addMessage('assistant', texto + cardHTML);
}

/* ══════════════════════════════════════════════════════════════════
   ENVIAR MENSAJE
══════════════════════════════════════════════════════════════════ */

function _sendMessage() {
  const input = document.getElementById('gia-input');
  const text  = input.value.trim();
  if (!text || state.loading) return;

  input.value  = '';
  input.style.height = 'auto';
  document.getElementById('gia-send').disabled = true;

  _sendQuestion(text);
}

async function _sendQuestion(text) {
  if (state.loading) return;

  // Asegurarse de que el contexto está cargado
  if (!state.systemCtx) {
    await _loadContext();
  }

  // Ocultar welcome si hay mensajes
  const welcome = document.getElementById('gia-welcome');
  if (welcome) welcome.style.display = 'none';

  // Añadir mensaje del usuario
  state.messages.push({ role: 'user', content: text });
  _addMessage('user', _escapeHTML(text));

  // Typing indicator
  const typingId = _showTyping();
  state.loading  = true;
  document.getElementById('gia-send').disabled = true;

  try {
    const reply = await _callClaude(text);
    _removeTyping(typingId);
    state.messages.push({ role: 'assistant', content: reply });
    _addMessage('assistant', _formatAssistantReply(reply));
  } catch (err) {
    _removeTyping(typingId);
    _addMessage('assistant', `<span style="color:var(--red)">Error al contactar con el asistente. Comprueba tu conexión.</span>`);
    console.error('[GestorIA] API error:', err);
  } finally {
    state.loading = false;
    document.getElementById('gia-send').disabled = !document.getElementById('gia-input').value.trim();
  }
}

/* ══════════════════════════════════════════════════════════════════
   LLAMADA A LA API DE ANTHROPIC
══════════════════════════════════════════════════════════════════ */

async function _callClaude(userMessage) {
  const systemPrompt = `Eres el asesor fiscal integrado en Taurix, una aplicación profesional de gestión fiscal para autónomos y pymes en España.

Tienes acceso al contexto fiscal REAL del contribuyente. Úsalo para dar respuestas concretas con importes reales, no genéricos.

REGLAS DE RESPUESTA:
1. Responde SIEMPRE en español.
2. Usa los importes y porcentajes reales del contexto fiscal (los datos están más abajo).
3. Sé directo y concreto. Si preguntan "¿cuánto tengo que pagar?", di la cifra exacta.
4. Cita la norma legal cuando sea relevante (art. concreto, LIVA, LIRPF…).
5. Para importes importantes, usa el formato: **X.XXX,XX €**
6. Si detectas algo urgente (plazo inminente, alerta crítica), menciónalo claramente.
7. Distingue entre datos reales (del contexto) y estimaciones.
8. Respuestas concisas pero completas. Máximo 3-4 párrafos salvo que pregunten algo complejo.
9. No uses markdown con # o ## — usa **negrita** para destacar.
10. No inventes datos que no estén en el contexto.

CONTEXTO FISCAL REAL DEL USUARIO:
${state.systemCtx}`;

  // Construir historial (máx 12 mensajes para no exceder el contexto)
  const historial = state.messages.slice(-12).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   historial,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.content
    ?.filter(b => b.type === 'text')
    .map(b => b.text)
    .join('') ?? '';

  return text;
}

/* ══════════════════════════════════════════════════════════════════
   RENDER MENSAJES
══════════════════════════════════════════════════════════════════ */

function _addMessage(role, htmlContent) {
  const container = document.getElementById('gia-messages');

  // Quitar welcome
  const welcome = document.getElementById('gia-welcome');
  if (welcome) welcome.style.display = 'none';

  const div = document.createElement('div');
  div.className = `gia-msg ${role}`;
  div.innerHTML = `<div class="gia-bubble">${htmlContent}</div>`;
  container.appendChild(div);

  // Scroll al fondo
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function _renderMessages() {
  const container = document.getElementById('gia-messages');
  container.innerHTML = '';

  if (state.messages.length === 0) {
    // Restaurar welcome
    if (state.taxResult) {
      _sendWelcomeMessage(state.taxResult);
    } else {
      const welcome = document.createElement('div');
      welcome.id = 'gia-welcome';
      welcome.innerHTML = `
        <div class="gia-welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <h3>Conversación limpiada</h3>
        <p>Puedes hacerme cualquier pregunta sobre tu situación fiscal.</p>
      `;
      container.appendChild(welcome);
    }
    return;
  }

  state.messages.forEach(m => {
    const content = m.role === 'user'
      ? _escapeHTML(m.content)
      : _formatAssistantReply(m.content);
    _addMessage(m.role, content);
  });
}

function _showTyping() {
  const container = document.getElementById('gia-messages');
  const id = 'gia-typing-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'gia-typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function _removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* ══════════════════════════════════════════════════════════════════
   FORMAT / UTILS
══════════════════════════════════════════════════════════════════ */

function _formatAssistantReply(text) {
  // Convertir **texto** a <strong>
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  // Saltos de línea
  html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

  // Resaltar importes monetarios en naranja
  html = html.replace(
    /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*€)/g,
    '<span class="gia-amount">$1</span>'
  );

  return html;
}

function _escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
