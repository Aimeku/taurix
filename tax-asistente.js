/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-asistente.js   v2.0
   Asistente Fiscal IA — powered by Claude + Tax Engine Taurix

   INTEGRACIÓN (ya está en main.js, no tocar):
     import { initTaxAsistente } from './tax-asistente.js';
     initTaxAsistente();   // tras setSession(session)

   DEPENDENCIAS:
     ./index.js  →  getContextoParaClaude(), getTaxContextResult()
     CSS vars de Taurix (--ox, --font-hd, etc.) — globales
   ═══════════════════════════════════════════════════════════════════ */

import { getContextoParaClaude, getTaxContextResult } from './index.js';

/* ══════════════════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════════════════ */
const IA_MODEL    = 'claude-sonnet-4-20250514';
const IA_TOKENS   = 1024;
const IA_HIST_MAX = 12;

/* ══════════════════════════════════════════════════════════════════
   ESTADO
══════════════════════════════════════════════════════════════════ */
const _s = {
  open:      false,
  messages:  [],
  loading:   false,
  systemCtx: null,
  taxResult: null,
};

/* ══════════════════════════════════════════════════════════════════
   PUNTO DE ENTRADA PÚBLICO
══════════════════════════════════════════════════════════════════ */
export function initTaxAsistente() {
  _css();
  _html();
  _events();
  // Reset global — utils.js lo llama al guardar el perfil fiscal
  window.__taxAsistenteReset = () => {
    _s.systemCtx = null;
    _s.taxResult = null;
    _s.messages  = [];
    if (_s.open) {
      _renderWelcome();
      _loadCtx();
    }
  };
}

/* ══════════════════════════════════════════════════════════════════
   CSS
══════════════════════════════════════════════════════════════════ */
function _css() {
  if (document.getElementById('ta-css')) return;
  const el = document.createElement('style');
  el.id = 'ta-css';
  el.textContent = `
#ta-fab{position:fixed;bottom:28px;right:28px;z-index:9000;width:56px;height:56px;border-radius:50%;background:var(--ox);border:none;box-shadow:0 4px 20px rgba(249,115,22,.5),0 2px 8px rgba(0,0,0,.15);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .18s;outline:none}
#ta-fab:hover{transform:scale(1.1) translateY(-2px);box-shadow:0 8px 32px rgba(249,115,22,.6)}
#ta-fab:active{transform:scale(.95)}
#ta-fab .ta-ico{width:24px;height:24px;color:#fff;display:block}
#ta-fab.open .ta-ico-chat{display:none}
#ta-fab:not(.open) .ta-ico-close{display:none}
#ta-fab-dot{position:absolute;top:-1px;right:-1px;width:13px;height:13px;background:var(--green,#059669);border:2px solid var(--bg,#F2F3F7);border-radius:50%;display:none}
#ta-fab-dot.on{display:block;animation:ta-pulse 2.4s infinite}
@keyframes ta-pulse{0%,100%{box-shadow:0 0 0 0 rgba(5,150,105,.5)}50%{box-shadow:0 0 0 5px rgba(5,150,105,0)}}

#ta-panel{position:fixed;bottom:96px;right:28px;z-index:8999;width:400px;max-width:calc(100vw - 40px);height:580px;max-height:calc(100vh - 110px);background:var(--srf,#fff);border:1px solid var(--brd,#E0E3EE);border-radius:20px;box-shadow:0 16px 56px rgba(0,0,0,.13),0 0 0 1px rgba(249,115,22,.05);display:flex;flex-direction:column;overflow:hidden;transform:translateY(20px) scale(.96);opacity:0;pointer-events:none;transition:transform .22s cubic-bezier(.34,1.2,.64,1),opacity .18s}
#ta-panel.open{transform:none;opacity:1;pointer-events:all}

#ta-header{display:flex;align-items:center;gap:10px;padding:14px 18px 13px;border-bottom:1px solid var(--brd,#E0E3EE);flex-shrink:0}
.ta-avatar{width:34px;height:34px;border-radius:9px;background:var(--ox);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ta-avatar svg{width:17px;height:17px;color:#fff}
.ta-hd-text{flex:1;min-width:0}
.ta-title{font-family:var(--font-hd,'Cabinet Grotesk',system-ui);font-size:13.5px;font-weight:800;color:var(--t1,#0D0F16);letter-spacing:-.02em;line-height:1.2}
.ta-subtitle{font-size:11px;color:var(--t3,#6B7394);line-height:1.3}
.ta-online{width:7px;height:7px;background:var(--green,#059669);border-radius:50%;animation:ta-pulse 2.4s infinite;flex-shrink:0}
#ta-clear{background:none;border:none;padding:5px 7px;border-radius:6px;font-size:11px;color:var(--t4,#9BA3BC);font-family:var(--font,system-ui);cursor:pointer;transition:background .1s,color .1s}
#ta-clear:hover{background:var(--bg2,#E8EAF0);color:var(--t2,#343A4F)}

#ta-chips{display:flex;gap:5px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid var(--brd,#E0E3EE);flex-shrink:0;background:var(--srf2,#F7F8FC)}
.ta-chip{padding:4px 10px;background:var(--srf,#fff);border:1px solid var(--brd,#E0E3EE);border-radius:100px;font-size:11px;font-weight:500;color:var(--t2,#343A4F);cursor:pointer;white-space:nowrap;font-family:var(--font,system-ui);transition:all .12s}
.ta-chip:hover{background:var(--ox-lt,#FFF7ED);border-color:var(--ox-mid,#FED7AA);color:var(--ox-dd,#C25500)}

#ta-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
#ta-msgs::-webkit-scrollbar{width:3px}
#ta-msgs::-webkit-scrollbar-thumb{background:var(--brd2,#C8CBD8);border-radius:3px}

#ta-welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px 14px;gap:8px;flex:1}
.ta-welcome-icon{width:48px;height:48px;border-radius:14px;background:var(--ox-lt,#FFF7ED);display:flex;align-items:center;justify-content:center;margin-bottom:4px}
.ta-welcome-icon svg{width:22px;height:22px;color:var(--ox,#F97316)}
#ta-welcome h3{font-family:var(--font-hd,system-ui);font-size:14.5px;font-weight:800;color:var(--t1,#0D0F16);letter-spacing:-.02em;margin:0}
#ta-welcome p{font-size:12px;color:var(--t3,#6B7394);line-height:1.6;margin:0;max-width:280px}

.ta-msg{display:flex;flex-direction:column;max-width:90%;animation:ta-in .18s ease}
@keyframes ta-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
.ta-msg.user{align-self:flex-end}
.ta-msg.ai{align-self:flex-start}
.ta-bubble{padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.65;word-wrap:break-word}
.ta-msg.user .ta-bubble{background:var(--t1,#0D0F16);color:#fff;border-radius:14px 14px 3px 14px}
.ta-msg.ai .ta-bubble{background:var(--srf2,#F7F8FC);color:var(--t1,#0D0F16);border:1px solid var(--brd,#E0E3EE);border-radius:14px 14px 14px 3px}
.ta-bubble strong{font-weight:700}
.ta-bubble code{font-family:var(--font-mono,monospace);font-size:11.5px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px}
.ta-msg.user .ta-bubble code{background:rgba(255,255,255,.15)}
.ta-num{font-family:var(--font-hd,system-ui);font-weight:900;color:var(--ox,#F97316);font-size:14px}
.ta-msg.user .ta-num{color:#FFD0A8}

.ta-card{background:var(--srf,#fff);border:1px solid var(--brd,#E0E3EE);border-radius:10px;overflow:hidden;margin-top:8px}
.ta-card-hd{padding:8px 12px;background:var(--srf2,#F7F8FC);border-bottom:1px solid var(--brd,#E0E3EE);font-size:11px;font-weight:700;color:var(--t2,#343A4F);letter-spacing:.02em;text-transform:uppercase}
.ta-card-row{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid var(--brd,#E0E3EE);font-size:12px}
.ta-card-row:last-child{border-bottom:none}
.ta-card-row .l{color:var(--t3,#6B7394)}
.ta-card-row .v{font-weight:700;color:var(--t1,#0D0F16);font-family:var(--font-hd,system-ui)}
.ta-card-row .v.pay{color:var(--red,#DC2626)}
.ta-card-row .v.save{color:var(--green,#059669)}
.ta-card-row .v.warn{color:var(--amber,#D97706)}

.ta-typing{display:flex;align-items:center;gap:4px;padding:9px 13px;align-self:flex-start;background:var(--srf2,#F7F8FC);border:1px solid var(--brd,#E0E3EE);border-radius:14px}
.ta-typing span{width:5px;height:5px;background:var(--t4,#9BA3BC);border-radius:50%;animation:ta-bounce .9s infinite ease-in-out}
.ta-typing span:nth-child(2){animation-delay:.15s}
.ta-typing span:nth-child(3){animation-delay:.3s}
@keyframes ta-bounce{0%,80%,100%{transform:none}40%{transform:translateY(-5px)}}

#ta-ctx-overlay{position:absolute;inset:0;z-index:10;background:rgba(255,255,255,.9);backdrop-filter:blur(3px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-radius:20px}
#ta-ctx-overlay.hidden{display:none}
.ta-spinner{width:26px;height:26px;border:3px solid var(--brd2,#C8CBD8);border-top-color:var(--ox,#F97316);border-radius:50%;animation:ta-spin .7s linear infinite}
@keyframes ta-spin{to{transform:rotate(360deg)}}
.ta-spin-label{font-size:12.5px;color:var(--t3,#6B7394)}

#ta-footer{padding:10px 14px 13px;border-top:1px solid var(--brd,#E0E3EE);flex-shrink:0;background:var(--srf,#fff)}
#ta-form{display:flex;gap:7px;align-items:flex-end}
#ta-input{flex:1;min-height:38px;max-height:110px;padding:9px 12px;background:var(--bg,#F2F3F7);border:1px solid var(--brd,#E0E3EE);border-radius:9px;font-size:13px;font-family:var(--font,system-ui);color:var(--t1,#0D0F16);resize:none;outline:none;line-height:1.5;overflow-y:hidden;transition:border-color .12s}
#ta-input::placeholder{color:var(--t4,#9BA3BC)}
#ta-input:focus{border-color:var(--ox,#F97316)}
#ta-send{width:38px;height:38px;flex-shrink:0;border:none;border-radius:9px;background:var(--ox,#F97316);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s,transform .1s}
#ta-send:hover:not(:disabled){background:var(--ox-d,#EA6700);transform:scale(1.06)}
#ta-send:disabled{background:var(--brd2,#C8CBD8);cursor:not-allowed}
#ta-send svg{width:14px;height:14px}
.ta-foot-note{font-size:10px;color:var(--t4,#9BA3BC);text-align:center;margin-top:6px}
`;
  document.head.appendChild(el);
}

/* ══════════════════════════════════════════════════════════════════
   HTML
══════════════════════════════════════════════════════════════════ */
function _html() {
  if (document.getElementById('ta-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'ta-fab';
  fab.title = 'Asesor Fiscal IA · Taurix';
  fab.innerHTML = `
    <svg class="ta-ico ta-ico-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <svg class="ta-ico ta-ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
    <div id="ta-fab-dot"></div>`;

  const panel = document.createElement('div');
  panel.id = 'ta-panel';
  panel.innerHTML = `
    <div id="ta-ctx-overlay">
      <div class="ta-spinner"></div>
      <span class="ta-spin-label">Cargando contexto fiscal…</span>
    </div>
    <div id="ta-header">
      <div class="ta-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="ta-hd-text">
        <div class="ta-title">Asesor Fiscal Taurix</div>
        <div class="ta-subtitle" id="ta-ctx-sub">Cargando contexto…</div>
      </div>
      <div class="ta-online"></div>
      <button id="ta-clear">Limpiar</button>
    </div>
    <div id="ta-chips">
      <button class="ta-chip" data-q="¿Qué modelos tengo que presentar este trimestre y cuándo es el plazo?">📋 ¿Qué presento?</button>
      <button class="ta-chip" data-q="Dame el resumen completo del Modelo 303 de IVA de este trimestre.">IVA · 303</button>
      <button class="ta-chip" id="ta-chip-impuesto" data-q="¿Cuánto sale el Modelo 130 de IRPF este trimestre?">IRPF · 130</button>
      <button class="ta-chip" data-q="¿Cuáles son mis alertas fiscales activas y qué debo hacer?">⚠ Alertas</button>
      <button class="ta-chip" id="ta-chip-proyeccion" data-q="¿Cuánto debería reservar cada mes para la Renta? ¿Cuál es mi tipo efectivo?">Proyección</button>
    </div>
    <div id="ta-msgs">
      <div id="ta-welcome">
        <div class="ta-welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h3>Tu asesor fiscal siempre disponible</h3>
        <p>Pregúntame sobre tus modelos, plazos, gastos o lo que necesites. Conozco tu situación fiscal real.</p>
      </div>
    </div>
    <div id="ta-footer">
      <div id="ta-form">
        <textarea id="ta-input" rows="1" placeholder="Pregunta sobre tus modelos, plazos, gastos…" maxlength="1200"></textarea>
        <button id="ta-send" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div class="ta-foot-note">Basado en tus datos fiscales reales · Consulta siempre a tu asesor</div>
    </div>`;

  document.body.appendChild(fab);
  document.body.appendChild(panel);
}

/* ══════════════════════════════════════════════════════════════════
   EVENTOS
══════════════════════════════════════════════════════════════════ */
function _events() {
  const fab   = document.getElementById('ta-fab');
  const panel = document.getElementById('ta-panel');
  const input = document.getElementById('ta-input');
  const send  = document.getElementById('ta-send');

  fab.addEventListener('click', () => {
    _s.open = !_s.open;
    fab.classList.toggle('open', _s.open);
    panel.classList.toggle('open', _s.open);
    if (_s.open && !_s.systemCtx) _loadCtx();
    if (_s.open) setTimeout(() => input.focus(), 260);
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    send.disabled = !input.value.trim() || _s.loading;
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!send.disabled) _send();
    }
  });

  send.addEventListener('click', _send);

  document.getElementById('ta-clear').addEventListener('click', () => {
    _s.messages = [];
    _renderWelcome();
  });

  document.getElementById('ta-chips').addEventListener('click', e => {
    const chip = e.target.closest('.ta-chip');
    if (chip?.dataset?.q) _ask(chip.dataset.q);
  });
}

/* ══════════════════════════════════════════════════════════════════
   CARGAR CONTEXTO FISCAL
══════════════════════════════════════════════════════════════════ */
async function _loadCtx() {
  const overlay = document.getElementById('ta-ctx-overlay');
  const sub     = document.getElementById('ta-ctx-sub');
  overlay.classList.remove('hidden');

  try {
    // Invalidar caché antes de cargar — garantiza datos frescos del trimestre activo
    try {
      const { invalidarCache } = await import('./index.js');
      invalidarCache();
    } catch(_) {}

    const [ctxStr, ctxObj] = await Promise.all([
      getContextoParaClaude(),
      getTaxContextResult(),
    ]);

    _s.systemCtx = ctxStr;
    _s.taxResult = ctxObj;

    const tl = { T1:'1er Trim', T2:'2º Trim', T3:'3er Trim', T4:'4º Trim' };
    sub.textContent = `${tl[ctxObj.trim] ?? ctxObj.trim} ${ctxObj.year} · Contexto cargado`;

    document.getElementById('ta-fab-dot').classList.add('on');
    _adaptarChips(ctxObj);
    if (_s.messages.length === 0) _msgBienvenida(ctxObj);

  } catch (err) {
    console.error('[tax-asistente] Error cargando contexto:', err);
    sub.textContent = 'Contexto no disponible';
    _s.systemCtx = `Eres el asesor fiscal de Taurix. El contexto no pudo cargarse. Ayuda con fiscalidad española general para autónomos y pymes. Responde en español.`;
  } finally {
    overlay.classList.add('hidden');
    document.getElementById('ta-send').disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   ADAPTAR CHIPS — 3 grupos fiscales
══════════════════════════════════════════════════════════════════ */
function _adaptarChips(ctx) {
  const chipImpuesto   = document.getElementById('ta-chip-impuesto');
  const chipProyeccion = document.getElementById('ta-chip-proyeccion');
  if (!chipImpuesto) return;

  const esSociedad = ctx.esSociedad ?? false;
  const esModulos  = ctx.esModulos  ?? false;

  if (esSociedad) {
    chipImpuesto.dataset.q   = '¿Cuánto sale el Impuesto de Sociedades este año? Dame la cuota íntegra, la cuota diferencial y el pago fraccionado del Modelo 202.';
    chipImpuesto.textContent = 'IS · Mod.200';
    chipProyeccion.dataset.q = '¿Cuánto tengo que pagar en el Modelo 202 (pago fraccionado IS) este trimestre y cuál es el plazo?';
    chipProyeccion.textContent = 'Mod.202 frac.';
  } else if (esModulos) {
    chipImpuesto.dataset.q   = '¿Cómo funciona el Modelo 131 de módulos? ¿Qué tengo que declarar este trimestre?';
    chipImpuesto.textContent = 'Módulos · 131';
    chipProyeccion.dataset.q = '¿Cuánto debería reservar para la declaración de la Renta siendo autónomo en módulos?';
    chipProyeccion.textContent = 'Proyección';
  } else {
    chipImpuesto.dataset.q   = '¿Cuánto sale el Modelo 130 de IRPF este trimestre? ¿Tengo que pagarlo?';
    chipImpuesto.textContent = 'IRPF · 130';
    chipProyeccion.dataset.q = '¿Cuánto debería reservar cada mes para la declaración de la Renta? ¿Cuál es mi tipo efectivo estimado?';
    chipProyeccion.textContent = 'Proyección';
  }
}

/* ══════════════════════════════════════════════════════════════════
   MENSAJE DE BIENVENIDA — 3 grupos fiscales
══════════════════════════════════════════════════════════════════ */
function _msgBienvenida(ctx) {
  const fmt = n => new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
  }).format(n || 0);

  const tl         = { T1:'1T', T2:'2T', T3:'3T', T4:'4T' };
  const trim       = tl[ctx.trim] ?? ctx.trim;
  const r303       = ctx.r303;
  const esSociedad = ctx.esSociedad ?? false;
  const esModulos  = ctx.esModulos  ?? false;
  const alertasUrgentes = (ctx.alertas ?? []).filter(a =>
    a.severidad === 'critica' || a.severidad === 'alta'
  );

  // Fila de impuesto directo según grupo
  let filaImpuesto = '';
  if (esSociedad) {
    const rIS   = ctx.rIS;
    const cuota = rIS?.cuota_diferencial ?? 0;
    const tipo  = rIS?.tipo_is_pct ?? 25;
    const frac  = rIS?.pago_fraccionado_202 ?? 0;
    filaImpuesto = `
      <div class="ta-card-row">
        <span class="l">IS · Mod.200 (tipo ${tipo}%)</span>
        <span class="v ${cuota > 0 ? 'pay' : 'save'}">${cuota > 0 ? fmt(cuota) + ' estimado' : 'Sin cuota estimada'}</span>
      </div>
      <div class="ta-card-row">
        <span class="l">Mod.202 pago fraccionado</span>
        <span class="v warn">${fmt(frac)} estimado</span>
      </div>`;
  } else if (esModulos) {
    filaImpuesto = `
      <div class="ta-card-row">
        <span class="l">IRPF · Módulos (Mod.131)</span>
        <span class="v warn">Cálculo por parámetros objetivos</span>
      </div>`;
  } else {
    const r130 = ctx.r130;
    filaImpuesto = `
      <div class="ta-card-row">
        <span class="l">Modelo 130 · IRPF</span>
        <span class="v ${r130.resultado > 0 ? 'pay' : 'save'}">${r130.resultado > 0 ? fmt(r130.resultado) + ' a ingresar' : 'Sin pago'}</span>
      </div>`;
  }

  // Badge de régimen
  const badge = esSociedad
    ? `<span style="font-size:10px;background:#EEF2FF;color:#4F46E5;padding:2px 7px;border-radius:100px;font-weight:700;margin-left:6px">SL · IS</span>`
    : esModulos
      ? `<span style="font-size:10px;background:var(--amber-lt,#FFFBEB);color:var(--amber,#D97706);padding:2px 7px;border-radius:100px;font-weight:700;margin-left:6px">Módulos</span>`
      : `<span style="font-size:10px;background:var(--ox-lt);color:var(--ox-dd);padding:2px 7px;border-radius:100px;font-weight:700;margin-left:6px">Autónomo · IRPF</span>`;

  const cardHTML = `
    <div class="ta-card">
      <div class="ta-card-hd">Resumen fiscal · ${trim} ${ctx.year} ${badge}</div>
      <div class="ta-card-row">
        <span class="l">Modelo 303 · IVA</span>
        <span class="v ${r303.resultado_final > 0 ? 'pay' : 'save'}">
          ${fmt(Math.abs(r303.resultado_final))}
          ${r303.resultado_final > 0 ? '↑ a ingresar' : '↓ a compensar'}
        </span>
      </div>
      ${filaImpuesto}
      ${alertasUrgentes.length ? `
      <div class="ta-card-row">
        <span class="l">Alertas urgentes</span>
        <span class="v warn">${alertasUrgentes.length} activa${alertasUrgentes.length > 1 ? 's' : ''}</span>
      </div>` : ''}
    </div>`;

  _addMsg('ai', `Contexto del <strong>${trim} ${ctx.year}</strong> cargado. Aquí tienes tu resumen:` + cardHTML);
}

/* ══════════════════════════════════════════════════════════════════
   ENVÍO DE MENSAJES
══════════════════════════════════════════════════════════════════ */
function _send() {
  const input = document.getElementById('ta-input');
  const text  = input.value.trim();
  if (!text || _s.loading) return;
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('ta-send').disabled = true;
  _ask(text);
}

async function _ask(text) {
  if (_s.loading) return;
  if (!_s.systemCtx) await _loadCtx();

  document.getElementById('ta-welcome')?.remove();
  _s.messages.push({ role: 'user', content: text });
  _addMsg('user', _esc(text));

  const typId = _showTyping();
  _s.loading  = true;
  document.getElementById('ta-send').disabled = true;

  try {
    const reply = await _callAPI(text);
    _removeTyping(typId);
    _s.messages.push({ role: 'assistant', content: reply });
    _addMsg('ai', _fmt(reply));
  } catch (e) {
    _removeTyping(typId);
    _addMsg('ai', `<span style="color:var(--red,#DC2626)">Error al contactar con la IA. Comprueba tu conexión.</span>`);
    console.error('[tax-asistente] API error:', e);
  } finally {
    _s.loading = false;
    const inp = document.getElementById('ta-input');
    document.getElementById('ta-send').disabled = !inp?.value.trim();
  }
}

/* ══════════════════════════════════════════════════════════════════
   API ANTHROPIC
══════════════════════════════════════════════════════════════════ */
async function _callAPI() {
  const ctx = _s.taxResult;
  const esSociedad = ctx?.esSociedad ?? false;
  const esModulos  = ctx?.esModulos  ?? false;

  const regimeInstr = esSociedad
    ? 'Esta entidad es una SOCIEDAD (SL/SA). Tributa por IS. NUNCA menciones el Modelo 130 ni IRPF fraccionado como obligaciones de esta entidad. Sus modelos son 303 (IVA), 202 (pagos fraccionados IS) y 200 (declaración anual IS).'
    : esModulos
      ? 'Este contribuyente es AUTÓNOMO EN MÓDULOS. Tributa por IRPF usando estimación objetiva (Modelo 131), NO el Modelo 130 estándar. El cálculo se basa en parámetros objetivos de la actividad, no en ingresos/gastos reales.'
      : 'Este contribuyente es AUTÓNOMO. Tributa por IRPF. Sus modelos son 303 (IVA) y 130 (pago fraccionado IRPF). NUNCA menciones IS ni Modelo 202 como obligaciones suyas.';

  const system = `Eres el Asesor Fiscal integrado en Taurix, aplicación profesional de gestión fiscal española.

RÉGIMEN ACTIVO:
${regimeInstr}

DATOS FISCALES REALES DEL CONTRIBUYENTE:
${_s.systemCtx}

REGLAS DE RESPUESTA:
1. Responde SIEMPRE en español.
2. Usa cifras REALES del contexto — nunca valores genéricos de ejemplo.
3. Si preguntan "¿cuánto pago?" da la cifra exacta del contexto.
4. Formatea importes como: 1.234,56 €
5. Cita la norma legal cuando sea relevante (LIS, LIVA, LIRPF, artículo concreto).
6. Si hay plazo inminente o alerta crítica, menciónalo al principio.
7. Respuestas concisas pero completas. Máximo 3-4 párrafos salvo complejidad real.
8. Usa **negrita** para destacar importes y conceptos clave.
9. No inventes datos que no estén en el contexto.
10. Diferencia claramente entre dato real y estimación.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      IA_MODEL,
      max_tokens: IA_TOKENS,
      system,
      messages:   _s.messages.slice(-IA_HIST_MAX).map(m => ({
        role: m.role, content: m.content,
      })),
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') ?? '';
}

/* ══════════════════════════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════════════════════════ */
function _addMsg(role, html) {
  const msgs = document.getElementById('ta-msgs');
  document.getElementById('ta-welcome')?.remove();
  const d = document.createElement('div');
  d.className = `ta-msg ${role === 'user' ? 'user' : 'ai'}`;
  d.innerHTML = `<div class="ta-bubble">${html}</div>`;
  msgs.appendChild(d);
  requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

function _renderWelcome() {
  const msgs = document.getElementById('ta-msgs');
  msgs.innerHTML = '';
  if (_s.taxResult) {
    _msgBienvenida(_s.taxResult);
  } else {
    const d = document.createElement('div');
    d.id = 'ta-welcome';
    d.innerHTML = `
      <div class="ta-welcome-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <h3>Conversación limpiada</h3>
      <p>Puedes hacerme cualquier pregunta sobre tu situación fiscal.</p>`;
    msgs.appendChild(d);
  }
}

function _showTyping() {
  const msgs = document.getElementById('ta-msgs');
  const id   = 'ta-typ-' + Date.now();
  const d    = document.createElement('div');
  d.id = id; d.className = 'ta-typing';
  d.innerHTML = '<span></span><span></span><span></span>';
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function _removeTyping(id) { document.getElementById(id)?.remove(); }

/* ══════════════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════════════ */
function _fmt(text) {
  let h = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
  // Resaltar importes monetarios
  h = h.replace(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*€)/g, '<span class="ta-num">$1</span>');
  return h;
}

function _esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
