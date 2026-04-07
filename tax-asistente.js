/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-asistente.js   v3.0
   Asesor Fiscal IA con acciones directas — powered by Claude

   INTEGRACIÓN (ya en main.js):
     import { initTaxAsistente } from './tax-asistente.js';
     initTaxAsistente();

   ACCIONES DISPONIBLES (tool use):
     navegar_vista      → cambia la sección activa de la app
     mostrar_modelo     → navega al modelo fiscal y lo refresca
     registrar_gasto    → inserta un gasto en Supabase directamente
     buscar_facturas    → consulta facturas con filtros
     refrescar_datos    → recalcula el dashboard
     abrir_perfil       → abre el modal de perfil fiscal
   ═══════════════════════════════════════════════════════════════════ */

import { getContextoParaClaude, getTaxContextResult } from './index.js';
import { supabase } from './supabase.js';
import { SESSION } from './utils.js';

const IA_MODEL    = 'claude-sonnet-4-20250514';
const IA_TOKENS   = 1536;
const IA_HIST_MAX = 12;

const IA_TOOLS = [
  {
    name: "navegar_vista",
    description: "Navega a una sección de la app. Úsala cuando el usuario quiera ir a una sección o cuando sea útil mostrarla.",
    input_schema: {
      type: "object",
      properties: {
        vista: { type: "string", enum: ["dashboard","facturas","gastos","clientes","iva","irpf","is","otros-modelos","libros","contabilidad","tesoreria","nominas","empleados","informes","historico","alertas","amortizaciones","pipeline","trabajos","agenda","documentos","plantillas","presupuestos","albaranes","proformas"], description: "Vista a la que navegar" },
        motivo: { type: "string", description: "Por qué navegas aquí" }
      },
      required: ["vista","motivo"]
    }
  },
  {
    name: "mostrar_modelo",
    description: "Navega al modelo fiscal, lo refresca y lo muestra. Úsalo cuando el usuario pida ver el 303, 130, IS u otro modelo.",
    input_schema: {
      type: "object",
      properties: {
        modelo: { type: "string", enum: ["303","130","200","202","otros"], description: "Número del modelo fiscal" }
      },
      required: ["modelo"]
    }
  },
  {
    name: "registrar_gasto",
    description: "Registra un gasto en Supabase. SOLO cuando el usuario pida explícitamente añadir o registrar un gasto.",
    input_schema: {
      type: "object",
      properties: {
        concepto:  { type: "string", description: "Descripción del gasto" },
        importe:   { type: "number", description: "Importe total con IVA (€)" },
        iva_pct:   { type: "number", enum: [0,4,10,21], description: "% de IVA" },
        categoria: { type: "string", enum: ["dietas","transporte","parking","material","servicios","alquiler","suministros","marketing","software","otros"] },
        fecha:     { type: "string", description: "YYYY-MM-DD. Si no se indica, usar hoy." },
        proveedor: { type: "string", description: "Nombre del proveedor (opcional)" }
      },
      required: ["concepto","importe","iva_pct","categoria","fecha"]
    }
  },
  {
    name: "buscar_facturas",
    description: "Busca facturas con filtros. Úsalo cuando el usuario pregunte por facturas, clientes o importes específicos.",
    input_schema: {
      type: "object",
      properties: {
        tipo:    { type: "string", enum: ["emitida","recibida","todas"] },
        limite:  { type: "number", description: "Máx resultados (default 5, max 10)" },
        cliente: { type: "string", description: "Filtrar por cliente (opcional)" },
        desde:   { type: "string", description: "Fecha inicio YYYY-MM-DD (opcional)" },
        hasta:   { type: "string", description: "Fecha fin YYYY-MM-DD (opcional)" }
      },
      required: ["tipo"]
    }
  },
  {
    name: "refrescar_datos",
    description: "Recalcula el dashboard y modelos fiscales. Úsalo después de registrar algo o cuando el usuario quiera ver datos frescos.",
    input_schema: { type: "object", properties: { motivo: { type: "string" } }, required: [] }
  },
  {
    name: "abrir_perfil",
    description: "Abre el modal de configuración del perfil fiscal.",
    input_schema: { type: "object", properties: {}, required: [] }
  }
];

const _s = { open: false, messages: [], loading: false, systemCtx: null, taxResult: null };

export function initTaxAsistente() {
  _css();
  _html();
  _events();
  window.__taxAsistenteReset = () => {
    _s.systemCtx = null; _s.taxResult = null; _s.messages = [];
    if (_s.open) { _renderWelcome(); _loadCtx(); }
  };
}

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
.ta-accion{display:flex;align-items:flex-start;gap:8px;padding:9px 13px;background:var(--green-lt,#ECFDF5);border:1px solid var(--green-mid,#6EE7B7);border-radius:14px 14px 14px 3px;align-self:flex-start;max-width:90%;animation:ta-in .18s ease;margin-top:2px}
.ta-accion-icon{width:18px;height:18px;background:var(--green,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.ta-accion-icon svg{width:10px;height:10px;color:#fff}
.ta-accion-body{flex:1;min-width:0}
.ta-accion-title{font-size:11px;font-weight:700;color:var(--green,#059669);text-transform:uppercase;letter-spacing:.02em;margin-bottom:2px}
.ta-accion-desc{font-size:12.5px;color:var(--t1,#0D0F16);line-height:1.5}
.ta-accion-link{display:inline-flex;align-items:center;gap:4px;margin-top:5px;font-size:11.5px;font-weight:600;color:var(--green,#059669);cursor:pointer;border:none;background:none;padding:0;font-family:var(--font,system-ui)}
.ta-accion-link:hover{text-decoration:underline}
.ta-accion.error{background:var(--red-lt,#FEF2F2);border-color:var(--red-mid,#FCA5A5)}
.ta-accion.error .ta-accion-icon{background:var(--red,#DC2626)}
.ta-accion.error .ta-accion-title{color:var(--red,#DC2626)}
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

function _html() {
  if (document.getElementById('ta-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'ta-fab'; fab.title = 'Asesor Fiscal IA · Taurix';
  fab.innerHTML = `
    <svg class="ta-ico ta-ico-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <svg class="ta-ico ta-ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    <div id="ta-fab-dot"></div>`;
  const panel = document.createElement('div');
  panel.id = 'ta-panel';
  panel.innerHTML = `
    <div id="ta-ctx-overlay"><div class="ta-spinner"></div><span class="ta-spin-label">Cargando contexto fiscal…</span></div>
    <div id="ta-header">
      <div class="ta-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <div class="ta-hd-text"><div class="ta-title">Asesor Fiscal Taurix</div><div class="ta-subtitle" id="ta-ctx-sub">Cargando…</div></div>
      <div class="ta-online"></div>
      <button id="ta-clear">Limpiar</button>
    </div>
    <div id="ta-chips">
      <button class="ta-chip" data-q="¿Qué tengo que presentar este trimestre?">📋 ¿Qué presento?</button>
      <button class="ta-chip" data-q="Muéstrame el Modelo 303 de IVA">IVA · 303</button>
      <button class="ta-chip" id="ta-chip-impuesto" data-q="Muéstrame el Modelo 130 de este trimestre">IRPF · 130</button>
      <button class="ta-chip" data-q="¿Cuáles son mis alertas fiscales activas?">⚠ Alertas</button>
      <button class="ta-chip" id="ta-chip-proyeccion" data-q="¿Cuánto debo reservar para la Renta?">Proyección</button>
    </div>
    <div id="ta-msgs">
      <div id="ta-welcome">
        <div class="ta-welcome-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <h3>Tu gestor fiscal con acceso directo</h3>
        <p>Pregunta y actúo. Puedo navegar a secciones, registrar gastos, mostrar modelos fiscales o buscar facturas — todo desde aquí.</p>
      </div>
    </div>
    <div id="ta-footer">
      <div id="ta-form">
        <textarea id="ta-input" rows="1" placeholder="Ej: «muéstrame el 303» · «añade un gasto de gasolina 45€» · «busca mis facturas de este mes»" maxlength="1200"></textarea>
        <button id="ta-send" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </div>
      <div class="ta-foot-note">Puede navegar, registrar gastos y mostrar modelos · Consulta siempre a tu asesor</div>
    </div>`;
  document.body.appendChild(fab);
  document.body.appendChild(panel);
}

function _events() {
  const fab=document.getElementById('ta-fab'), panel=document.getElementById('ta-panel');
  const input=document.getElementById('ta-input'), send=document.getElementById('ta-send');
  fab.addEventListener('click', () => {
    _s.open = !_s.open;
    fab.classList.toggle('open', _s.open); panel.classList.toggle('open', _s.open);
    if (_s.open && !_s.systemCtx) _loadCtx();
    if (_s.open) setTimeout(() => input.focus(), 260);
  });
  input.addEventListener('input', () => {
    input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,110)+'px';
    send.disabled = !input.value.trim() || _s.loading;
  });
  input.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); if (!send.disabled) _send(); } });
  send.addEventListener('click', _send);
  document.getElementById('ta-clear').addEventListener('click', () => { _s.messages=[]; _renderWelcome(); });
  document.getElementById('ta-chips').addEventListener('click', e => { const c=e.target.closest('.ta-chip'); if (c?.dataset?.q) _ask(c.dataset.q); });
}

async function _loadCtx() {
  const overlay=document.getElementById('ta-ctx-overlay'), sub=document.getElementById('ta-ctx-sub');
  overlay.classList.remove('hidden');
  try {
    try { const {invalidarCache}=await import('./index.js'); invalidarCache(); } catch(_){}
    const [ctxStr,ctxObj] = await Promise.all([getContextoParaClaude(), getTaxContextResult()]);
    _s.systemCtx=ctxStr; _s.taxResult=ctxObj;
    const tl={T1:'1er Trim',T2:'2º Trim',T3:'3er Trim',T4:'4º Trim'};
    sub.textContent=`${tl[ctxObj.trim]??ctxObj.trim} ${ctxObj.year} · Listo`;
    document.getElementById('ta-fab-dot').classList.add('on');
    _adaptarChips(ctxObj);
    if (_s.messages.length===0) _msgBienvenida(ctxObj);
  } catch(err) {
    console.error('[tax-asistente] _loadCtx:',err);
    sub.textContent='Contexto no disponible';
    _s.systemCtx='Eres el asesor fiscal de Taurix. Responde en español.';
  } finally {
    overlay.classList.add('hidden');
    document.getElementById('ta-send').disabled=false;
  }
}

function _adaptarChips(ctx) {
  const ci=document.getElementById('ta-chip-impuesto'), cp=document.getElementById('ta-chip-proyeccion');
  if (!ci) return;
  if (ctx.esSociedad) {
    ci.dataset.q='Muéstrame el Impuesto de Sociedades, cuota íntegra y diferencial'; ci.textContent='IS · Mod.200';
    cp.dataset.q='¿Cuánto es el pago fraccionado Modelo 202 este trimestre?'; cp.textContent='Mod.202 frac.';
  } else {
    ci.dataset.q='Muéstrame el Modelo 130 de IRPF de este trimestre'; ci.textContent='IRPF · 130';
    cp.dataset.q='¿Cuánto debo reservar para la Renta? ¿Cuál es mi tipo efectivo?'; cp.textContent='Proyección';
  }
}

function _msgBienvenida(ctx) {
  const fmt=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(n||0);
  const tl={T1:'1T',T2:'2T',T3:'3T',T4:'4T'}, trim=tl[ctx.trim]??ctx.trim;
  const r303=ctx.r303, al=(ctx.alertas??[]).filter(a=>a.severidad==='critica'||a.severidad==='alta');
  let filaImp='';
  if (ctx.esSociedad) {
    const rIS=ctx.rIS;
    filaImp=`<div class="ta-card-row"><span class="l">IS · Mod.200 (${rIS?.tipo_is_pct??25}%)</span><span class="v ${(rIS?.cuota_diferencial??0)>0?'pay':'save'}">${(rIS?.cuota_diferencial??0)>0?fmt(rIS.cuota_diferencial)+' est.':'Sin cuota'}</span></div><div class="ta-card-row"><span class="l">Mod.202 frac.</span><span class="v warn">${fmt(rIS?.pago_fraccionado_202??0)}</span></div>`;
  } else {
    const r130=ctx.r130;
    filaImp=`<div class="ta-card-row"><span class="l">Modelo 130 · IRPF</span><span class="v ${r130.resultado>0?'pay':'save'}">${r130.resultado>0?fmt(r130.resultado)+' a ingresar':'Sin pago'}</span></div>`;
  }
  const badge=ctx.esSociedad
    ?`<span style="font-size:10px;background:#EEF2FF;color:#4F46E5;padding:2px 7px;border-radius:100px;font-weight:700;margin-left:6px">SL·IS</span>`
    :`<span style="font-size:10px;background:var(--ox-lt);color:var(--ox-dd);padding:2px 7px;border-radius:100px;font-weight:700;margin-left:6px">Autónomo</span>`;
  _addMsg('ai',`Listo para actuar. ${trim} ${ctx.year}:<div class="ta-card"><div class="ta-card-hd">${trim} ${ctx.year} ${badge}</div><div class="ta-card-row"><span class="l">IVA · Mod.303</span><span class="v ${r303.resultado_final>0?'pay':'save'}">${fmt(Math.abs(r303.resultado_final))} ${r303.resultado_final>0?'↑ a ingresar':'↓ a compensar'}</span></div>${filaImp}${al.length?`<div class="ta-card-row"><span class="l">Alertas urgentes</span><span class="v warn">${al.length} activa${al.length>1?'s':''}</span></div>`:''}</div>`);
}

function _send() {
  const input=document.getElementById('ta-input'), text=input.value.trim();
  if (!text||_s.loading) return;
  input.value=''; input.style.height='auto';
  document.getElementById('ta-send').disabled=true;
  _ask(text);
}

async function _ask(text) {
  if (_s.loading) return;
  if (!_s.systemCtx) await _loadCtx();
  document.getElementById('ta-welcome')?.remove();
  _s.messages.push({role:'user',content:text});
  _addMsg('user',_esc(text));
  const typId=_showTyping(); _s.loading=true;
  document.getElementById('ta-send').disabled=true;
  try {
    const result=await _callAPI();
    _removeTyping(typId);
    await _procesarRespuesta(result);
  } catch(e) {
    _removeTyping(typId);
    _addMsg('ai',`<span style="color:var(--red,#DC2626)">Error al contactar con la IA.</span>`);
    console.error('[tax-asistente]',e);
  } finally {
    _s.loading=false;
    const inp=document.getElementById('ta-input');
    document.getElementById('ta-send').disabled=!inp?.value.trim();
  }
}

async function _callAPI() {
  const ctx=_s.taxResult, esSociedad=ctx?.esSociedad??false;
  const regimeInstr=esSociedad
    ?'SOCIEDAD (SL/SA): IS. Modelos: 303,202,200. Nunca menciones 130.'
    :'AUTÓNOMO: IRPF. Modelos: 303,130. Nunca menciones IS ni 202.';
  const system=`Eres el Asesor Fiscal de Taurix con capacidad de actuar en la app.
RÉGIMEN: ${regimeInstr}
DATOS FISCALES REALES:
${_s.systemCtx}
INSTRUCCIONES:
1. Responde en español.
2. Cuando el usuario pida ver un modelo, usa mostrar_modelo.
3. Cuando pida ir a una sección, usa navegar_vista.
4. Cuando pida registrar/añadir un gasto, usa registrar_gasto. Si faltan datos, pregunta primero.
5. Para buscar facturas, usa buscar_facturas.
6. Después de una acción, confirma con una frase corta.
7. Usa cifras REALES del contexto. Importes: 1.234,56 €
8. Usa **negrita** para importes y conceptos clave.`;
  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:IA_MODEL,max_tokens:IA_TOKENS,system,tools:IA_TOOLS,
      messages:_s.messages.slice(-IA_HIST_MAX).map(m=>({role:m.role,content:m.content}))})
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error?.message??`HTTP ${res.status}`); }
  return await res.json();
}

async function _procesarRespuesta(data) {
  const bloques=data.content??[];
  let textoAcum='';
  for (const b of bloques) {
    if (b.type==='text') {
      textoAcum+=b.text;
    } else if (b.type==='tool_use') {
      if (textoAcum.trim()) { _addMsg('ai',_fmt(textoAcum)); textoAcum=''; }
      await _ejecutarHerramienta(b.name, b.input);
    }
  }
  if (textoAcum.trim()) _addMsg('ai',_fmt(textoAcum));
  const resumen=bloques.map(b=>b.type==='text'?b.text:`[${b.name}]`).join('');
  if (resumen.trim()) _s.messages.push({role:'assistant',content:resumen});
}

async function _ejecutarHerramienta(nombre, input) {
  const fmt=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(n||0);
  try {
    switch(nombre) {
      case 'navegar_vista': {
        if (window._switchView) await window._switchView(input.vista);
        _addAccion('✓ Navegando a '+input.vista, input.motivo, ()=>window._switchView?.(input.vista));
        break;
      }
      case 'mostrar_modelo': {
        const vistas={'303':'iva','130':'irpf','200':'is','202':'is','otros':'otros-modelos'};
        const vista=vistas[input.modelo]??'otros-modelos';
        if (window._switchView) await window._switchView(vista);
        _addAccion('✓ Modelo '+input.modelo+' abierto','Datos actualizados con el trimestre activo',()=>window._switchView?.(vista));
        break;
      }
      case 'registrar_gasto': {
        const {concepto,importe,iva_pct,categoria,fecha,proveedor}=input;
        const uid=SESSION?.user?.id;
        if (!uid) throw new Error('Sin sesión');
        const ivaPct=Number(iva_pct)||0;
        const base=ivaPct>0?+(importe/(1+ivaPct/100)).toFixed(2):importe;
        const {data:last}=await supabase.from('facturas').select('numero_factura').eq('user_id',uid).like('numero_factura','TIQ-%').order('numero_factura',{ascending:false}).limit(1);
        const lastN=last?.[0]?.numero_factura;
        const nextN=lastN?(parseInt(lastN.split('-').pop()||'0')+1):1;
        const yyyy=(fecha||new Date().toISOString().slice(0,4)).slice(0,4);
        const numFact=`TIQ-${yyyy}-${String(nextN).padStart(3,'0')}`;
        const {error}=await supabase.from('facturas').insert({
          user_id:uid, concepto:`[${categoria}] ${concepto}`, base, iva:ivaPct,
          irpf_retencion:0, tipo:'recibida', tipo_operacion:'nacional', estado:'emitida',
          fecha:fecha||new Date().toISOString().slice(0,10),
          cliente_nombre:proveedor||'Sin proveedor', numero_factura:numFact,
          fecha_emision:fecha||new Date().toISOString().slice(0,10),
          notas:`Registrado por Asesor IA · ${new Date().toLocaleDateString('es-ES')}`
        });
        if (error) throw new Error(error.message);
        try { const {refreshDashboard}=await import('./dashboard.js'); const {refreshFacturas}=await import('./facturas.js'); await Promise.all([refreshDashboard(),refreshFacturas()]); } catch(_){}
        _addAccion('✓ Gasto registrado',`${concepto} · ${fmt(importe)} · ${numFact}`,()=>window._switchView?.('facturas'));
        break;
      }
      case 'buscar_facturas': {
        const {tipo,limite=5,cliente,desde,hasta}=input;
        const uid=SESSION?.user?.id;
        let q=supabase.from('facturas').select('numero_factura,concepto,base,iva,fecha,tipo,estado,cliente_nombre').eq('user_id',uid).order('fecha',{ascending:false}).limit(Math.min(limite,10));
        if (tipo!=='todas') q=q.eq('tipo',tipo);
        if (cliente) q=q.ilike('cliente_nombre',`%${cliente}%`);
        if (desde) q=q.gte('fecha',desde);
        if (hasta) q=q.lte('fecha',hasta);
        const {data:facs,error}=await q;
        if (error) throw new Error(error.message);
        if (!facs?.length) { _addMsg('ai','No encontré facturas con esos criterios.'); break; }
        let html=`<div class="ta-card"><div class="ta-card-hd">${facs.length} factura${facs.length>1?'s':''} encontrada${facs.length>1?'s':''}</div>`;
        facs.forEach(f=>{ const total=f.base*(1+(f.iva||0)/100); html+=`<div class="ta-card-row"><span class="l">${f.numero_factura||'—'} · ${f.fecha} · ${f.cliente_nombre||'—'}</span><span class="v">${fmt(total)}</span></div>`; });
        html+='</div>';
        _addMsg('ai',html);
        break;
      }
      case 'refrescar_datos': {
        try { if (window._refresh) await window._refresh(); } catch(_){}
        _addAccion('✓ Datos actualizados','Dashboard y modelos fiscales recalculados',null);
        break;
      }
      case 'abrir_perfil': {
        if (window.showPerfilModal) window.showPerfilModal();
        _addAccion('✓ Perfil fiscal abierto','Cambia tu régimen y datos fiscales',null);
        break;
      }
    }
  } catch(err) {
    console.error('[tax-asistente] herramienta error:',nombre,err);
    _addAccionError('No pude completar la acción',err.message);
  }
}

function _addMsg(role,html) {
  const msgs=document.getElementById('ta-msgs');
  document.getElementById('ta-welcome')?.remove();
  const d=document.createElement('div'); d.className=`ta-msg ${role==='user'?'user':'ai'}`;
  d.innerHTML=`<div class="ta-bubble">${html}</div>`;
  msgs.appendChild(d); requestAnimationFrame(()=>{msgs.scrollTop=msgs.scrollHeight;});
}

function _addAccion(titulo,descripcion,onClickFn) {
  const msgs=document.getElementById('ta-msgs');
  const d=document.createElement('div'); d.className='ta-accion';
  d.innerHTML=`<div class="ta-accion-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><div class="ta-accion-body"><div class="ta-accion-title">${titulo}</div><div class="ta-accion-desc">${descripcion}</div>${onClickFn?`<button class="ta-accion-link">Ver ahora →</button>`:''}</div>`;
  if (onClickFn) d.querySelector('.ta-accion-link')?.addEventListener('click',onClickFn);
  msgs.appendChild(d); requestAnimationFrame(()=>{msgs.scrollTop=msgs.scrollHeight;});
}

function _addAccionError(titulo,descripcion) {
  const msgs=document.getElementById('ta-msgs');
  const d=document.createElement('div'); d.className='ta-accion error';
  d.innerHTML=`<div class="ta-accion-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><div class="ta-accion-body"><div class="ta-accion-title">${titulo}</div><div class="ta-accion-desc">${descripcion}</div></div>`;
  msgs.appendChild(d); requestAnimationFrame(()=>{msgs.scrollTop=msgs.scrollHeight;});
}

function _renderWelcome() {
  const msgs=document.getElementById('ta-msgs'); msgs.innerHTML='';
  if (_s.taxResult) { _msgBienvenida(_s.taxResult); return; }
  const d=document.createElement('div'); d.id='ta-welcome';
  d.innerHTML=`<div class="ta-welcome-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><h3>Listo</h3><p>Puedes preguntarme lo que necesites.</p>`;
  msgs.appendChild(d);
}

function _showTyping() {
  const msgs=document.getElementById('ta-msgs'), id='ta-typ-'+Date.now();
  const d=document.createElement('div'); d.id=id; d.className='ta-typing';
  d.innerHTML='<span></span><span></span><span></span>';
  msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight; return id;
}

function _removeTyping(id) { document.getElementById(id)?.remove(); }

function _fmt(text) {
  let h=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
  return h.replace(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*€)/g,'<span class="ta-num">$1</span>');
}

function _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
