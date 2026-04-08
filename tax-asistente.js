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
  },
  {
    name: "preparar_documentos",
    description: "Genera y empaqueta documentos fiscales descargables (PDFs de modelos, libros, Excel). Úsala cuando el usuario pida preparar documentos, quiera descargar modelos o su gestor/asesor le haya pedido documentación fiscal.",
    input_schema: {
      type: "object",
      properties: {
        documentos: {
          type: "array",
          description: "Lista de documentos a generar",
          items: {
            type: "string",
            enum: [
              "modelo_303",
              "modelo_130",
              "modelo_200_IS",
              "modelo_111",
              "modelo_115",
              "modelo_347",
              "modelo_349",
              "modelo_390",
              "modelo_190",
              "libro_ingresos_pdf",
              "libro_gastos_pdf",
              "facturas_excel"
            ]
          }
        },
        formato: {
          type: "string",
          enum: ["zip", "individual"],
          description: "zip = todos en un ZIP descargable, individual = botones separados por documento"
        },
        motivo: {
          type: "string",
          description: "Para qué son los documentos (ej: 'presentación trimestral T2', 'envío al gestor')"
        }
      },
      required: ["documentos", "formato", "motivo"]
    }
  },
  {
    name: "registrar_factura_recibida",
    description: "Registra una factura recibida (de proveedor) en Supabase con todos sus datos. Úsalo después de analizar un PDF para registrar la factura automáticamente.",
    input_schema: {
      type: "object",
      properties: {
        concepto:       { type: "string",  description: "Descripción del servicio o producto" },
        proveedor:      { type: "string",  description: "Nombre o razón social del proveedor" },
        nif_proveedor:  { type: "string",  description: "NIF/CIF del proveedor (si aparece)" },
        base_imponible: { type: "number",  description: "Base imponible en €" },
        iva_pct:        { type: "number",  enum: [0,4,10,21], description: "% de IVA" },
        irpf_pct:       { type: "number",  description: "% retención IRPF (0 si no aplica)" },
        fecha:          { type: "string",  description: "Fecha de la factura YYYY-MM-DD" },
        numero_factura: { type: "string",  description: "Número de factura del proveedor (si aparece)" },
        categoria:      { type: "string",  enum: ["dietas","transporte","parking","material","servicios","alquiler","suministros","marketing","software","otros"], description: "Categoría del gasto" }
      },
      required: ["concepto","proveedor","base_imponible","iva_pct","irpf_pct","fecha","categoria"]
    }
  }
];

const _s = { open: false, messages: [], loading: false, systemCtx: null, taxResult: null, pdfAdjunto: null }; // pdfAdjunto: { base64, name, size }

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
.ta-cursor{display:inline-block;width:2px;height:14px;background:var(--ox,#F97316);margin-left:1px;vertical-align:text-bottom;animation:ta-blink .7s step-end infinite}
@keyframes ta-blink{0%,100%{opacity:1}50%{opacity:0}}
.ta-streaming{min-height:20px}
.ta-descarga{display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:var(--srf,#fff);border:1px solid var(--brd,#E0E3EE);border-radius:14px 14px 14px 3px;align-self:flex-start;max-width:90%;animation:ta-in .18s ease;margin-top:2px}
.ta-descarga-title{font-size:11px;font-weight:700;color:var(--t2,#343A4F);text-transform:uppercase;letter-spacing:.02em}
.ta-descarga-items{display:flex;flex-direction:column;gap:5px}
.ta-descarga-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--ox);border:none;border-radius:8px;color:#fff;font-size:12.5px;font-weight:600;font-family:var(--font,system-ui);cursor:pointer;transition:background .12s,transform .1s;text-align:left}
.ta-descarga-btn:hover{background:var(--ox-d,#EA6700);transform:translateY(-1px)}
.ta-descarga-btn:active{transform:scale(.98)}
.ta-descarga-btn svg{width:14px;height:14px;flex-shrink:0}
.ta-descarga-btn.secondary{background:var(--srf2,#F7F8FC);color:var(--t1,#0D0F16);border:1px solid var(--brd,#E0E3EE)}
.ta-descarga-btn.secondary:hover{background:var(--bg2,#E8EAF0)}
.ta-descarga-nota{font-size:10.5px;color:var(--t4,#9BA3BC)}
#ta-pdf-btn{width:32px;height:32px;flex-shrink:0;border:none;border-radius:8px;background:var(--bg2,#E8EAF0);color:var(--t3,#6B7394);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s,color .12s}
#ta-pdf-btn:hover{background:var(--ox-lt,#FFF7ED);color:var(--ox,#F97316)}
#ta-pdf-btn svg{width:15px;height:15px}
#ta-pdf-preview{display:none;align-items:center;gap:8px;padding:7px 12px;background:var(--ox-lt,#FFF7ED);border:1px solid var(--ox-mid,#FED7AA);border-radius:8px;margin-bottom:6px}
#ta-pdf-preview.visible{display:flex}
.ta-pdf-name{flex:1;font-size:12px;color:var(--ox-dd,#C25500);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ta-pdf-size{font-size:11px;color:var(--t4,#9BA3BC);flex-shrink:0}
#ta-pdf-remove{background:none;border:none;cursor:pointer;color:var(--t4,#9BA3BC);padding:2px;line-height:1;font-size:14px;flex-shrink:0}
#ta-pdf-remove:hover{color:var(--red,#DC2626)}
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
      <div id="ta-pdf-preview">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ox,#F97316)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="ta-pdf-name" id="ta-pdf-name">—</span>
        <span class="ta-pdf-size" id="ta-pdf-size"></span>
        <button id="ta-pdf-remove" title="Quitar PDF">×</button>
      </div>
      <div id="ta-form">
        <button id="ta-pdf-btn" title="Adjuntar factura PDF">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <input type="file" id="ta-pdf-input" accept="application/pdf,image/jpeg,image/png,image/webp" style="display:none"/>
        <textarea id="ta-input" rows="1" placeholder="Ej: «analiza esta factura» · «muéstrame el 303» · «añade un gasto de gasolina 45€»" maxlength="1200"></textarea>
        <button id="ta-send" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </div>
      <div class="ta-foot-note">Adjunta facturas PDF · Navega, registra gastos y muestra modelos · Consulta siempre a tu asesor</div>
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

  // PDF: botón clip abre el selector de archivo
  document.getElementById('ta-pdf-btn').addEventListener('click', () => {
    document.getElementById('ta-pdf-input').click();
  });

  // PDF: archivo seleccionado
  document.getElementById('ta-pdf-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await _adjuntarPDF(file);
    e.target.value = ''; // reset para poder subir el mismo archivo dos veces
  });

  // PDF: quitar adjunto
  document.getElementById('ta-pdf-remove').addEventListener('click', () => {
    _s.pdfAdjunto = null;
    document.getElementById('ta-pdf-preview').classList.remove('visible');
  });

  // Drag & drop sobre el panel (panel ya declarado arriba)
  panel.addEventListener('dragover', e => { e.preventDefault(); panel.style.outline = '2px dashed var(--ox)'; });
  panel.addEventListener('dragleave', () => { panel.style.outline = ''; });
  panel.addEventListener('drop', async e => {
    e.preventDefault(); panel.style.outline = '';
    const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || f.type.startsWith('image/'));
    if (file) await _adjuntarPDF(file);
  });
}

/* ══════════════════════════════════════════════════════════════════
   PDF — leer archivo y guardarlo como base64 en estado
══════════════════════════════════════════════════════════════════ */
async function _adjuntarPDF(file) {
  const MAX_MB = 5;
  if (file.size > MAX_MB * 1024 * 1024) {
    _addMsg('ai', `El archivo pesa más de ${MAX_MB}MB. Intenta con uno más pequeño.`);
    return;
  }

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const mediaType = file.type || 'application/pdf';
  _s.pdfAdjunto = { base64, name: file.name, size: file.size, mediaType };

  // Mostrar preview
  const preview = document.getElementById('ta-pdf-preview');
  const nameEl  = document.getElementById('ta-pdf-name');
  const sizeEl  = document.getElementById('ta-pdf-size');
  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) sizeEl.textContent = (file.size / 1024).toFixed(0) + ' KB';
  preview.classList.add('visible');

  // Enfocar el input y sugerir texto
  const input = document.getElementById('ta-input');
  if (input && !input.value.trim()) {
    input.value = 'Analiza esta factura y regístrala';
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    document.getElementById('ta-send').disabled = false;
  }
  input?.focus();
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
  const pdf = _s.pdfAdjunto;
  // Limpiar preview inmediatamente
  if (pdf) {
    _s.pdfAdjunto = null;
    document.getElementById('ta-pdf-preview').classList.remove('visible');
  }
  _ask(text, pdf);
}

async function _ask(text, pdf=null) {
  if (_s.loading) return;
  if (!_s.systemCtx) await _loadCtx();
  document.getElementById('ta-welcome')?.remove();
  // Construir mensaje usuario — texto + documento si hay PDF
  if (pdf) {
    // Guardar en historial como texto (los PDFs no se guardan en historial)
    _s.messages.push({ role: 'user', content: text });
    // Mostrar en el chat con icono de documento
    _addMsg('user', `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11.5px;opacity:.8"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${_esc(pdf.name)}</div>${_esc(text)}`);
  } else {
    _s.messages.push({ role: 'user', content: text });
    _addMsg('user', _esc(text));
  }
  const typId=_showTyping(); _s.loading=true;
  document.getElementById('ta-send').disabled=true;
  try {
    const res=await _callAPI(pdf);
    _removeTyping(typId);  // quitar typing en cuanto llega el stream
    await _procesarStream(res);
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

async function _callAPI(pdf=null) {
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
8. Usa **negrita** para importes y conceptos clave.
9. Si el usuario adjunta una factura PDF o imagen, extrae TODOS los datos (proveedor, NIF, base, IVA, IRPF, fecha, número) y usa registrar_factura_recibida para guardarla. Si algún dato no está claro, indícalo pero registra con lo que tengas.
10. Cuando el usuario quiera descargar modelos fiscales, que su gestor le pida documentación, o que quiera enviar algo a su asesor — usa preparar_documentos. Pregunta el formato (zip o individual) si no está claro. Para el trimestre activo sugiere siempre los modelos que correspondan al régimen.`;
  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      model:IA_MODEL, max_tokens:IA_TOKENS, system, tools:IA_TOOLS,
      stream: true,  // ← streaming activado
      messages: (() => {
        const hist = _s.messages.slice(-IA_HIST_MAX);
        if (!pdf || !hist.length) return hist.map(m => ({ role: m.role, content: m.content }));
        // Añadir el PDF al último mensaje del usuario como content block
        const mensajes = hist.map((m, i) => {
          if (i === hist.length - 1 && m.role === 'user') {
            const docBlock = pdf.mediaType === 'application/pdf'
              ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 } }
              : { type: 'image',    source: { type: 'base64', media_type: pdf.mediaType,       data: pdf.base64 } };
            return { role: 'user', content: [docBlock, { type: 'text', text: m.content }] };
          }
          return { role: m.role, content: m.content };
        });
        return mensajes;
      })()
    })
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error?.message??`HTTP ${res.status}`); }
  return res; // devolvemos el Response, no el JSON
}

/* ══════════════════════════════════════════════════════════════════
   STREAMING — procesa Server-Sent Events de la API de Anthropic
   Eventos SSE relevantes:
     content_block_start  → inicio de bloque (text o tool_use)
     content_block_delta  → fragmento de texto o JSON de herramienta
     content_block_stop   → fin de bloque (ejecutar herramienta si aplica)
     message_stop         → fin de mensaje completo
══════════════════════════════════════════════════════════════════ */
async function _procesarStream(res) {
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();

  // Estado del bloque activo
  let bloqueActual = null;  // { type, index, name?, jsonAcum? }
  let nodoStream   = null;  // elemento <div class="ta-bubble"> en el DOM donde escribimos
  let textoAcum    = '';    // texto acumulado del bloque actual (para historial)
  let historialIA  = '';    // texto completo para _s.messages al final

  // Crear el contenedor de mensaje AI vacío donde irá apareciendo el texto
  const _crearNodoStream = () => {
    const msgs = document.getElementById('ta-msgs');
    document.getElementById('ta-welcome')?.remove();
    const d = document.createElement('div');
    d.className = 'ta-msg ai';
    d.innerHTML = '<div class="ta-bubble ta-streaming"></div>';
    msgs.appendChild(d);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
    return d.querySelector('.ta-bubble');
  };

  // Actualizar el nodo con el texto acumulado formateado
  const _actualizarNodo = () => {
    if (!nodoStream) return;
    const msgs = document.getElementById('ta-msgs');
    nodoStream.innerHTML = _fmt(textoAcum) + '<span class="ta-cursor">▋</span>';
    msgs.scrollTop = msgs.scrollHeight;
  };

  // Finalizar el nodo — quitar cursor y formatear definitivamente
  const _finalizarNodo = () => {
    if (!nodoStream) return;
    nodoStream.innerHTML = _fmt(textoAcum);
    nodoStream.classList.remove('ta-streaming');
    nodoStream = null;
  };

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // la última línea puede estar incompleta

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]' || !raw) continue;

        let evt;
        try { evt = JSON.parse(raw); } catch(_) { continue; }

        switch (evt.type) {

          case 'content_block_start':
            bloqueActual = { type: evt.content_block.type, index: evt.index };
            if (evt.content_block.type === 'tool_use') {
              // Si había texto previo, finalizarlo antes de la herramienta
              if (textoAcum.trim()) { _finalizarNodo(); historialIA += textoAcum; textoAcum = ''; }
              bloqueActual.name     = evt.content_block.name;
              bloqueActual.jsonAcum = '';
            } else if (evt.content_block.type === 'text') {
              textoAcum = '';
              // El nodo se crea al primer delta para no mostrar burbuja vacía
            }
            break;

          case 'content_block_delta':
            if (!bloqueActual) break;
            if (bloqueActual.type === 'text' && evt.delta.type === 'text_delta') {
              if (!nodoStream) nodoStream = _crearNodoStream();
              textoAcum += evt.delta.text;
              _actualizarNodo();
            } else if (bloqueActual.type === 'tool_use' && evt.delta.type === 'input_json_delta') {
              bloqueActual.jsonAcum += evt.delta.partial_json;
            }
            break;

          case 'content_block_stop':
            if (!bloqueActual) break;
            if (bloqueActual.type === 'text') {
              _finalizarNodo();
              historialIA += textoAcum;
              textoAcum = '';
            } else if (bloqueActual.type === 'tool_use') {
              // Parsear el JSON acumulado y ejecutar la herramienta
              let input = {};
              try { input = JSON.parse(bloqueActual.jsonAcum || '{}'); } catch(_) {}
              historialIA += `[${bloqueActual.name}]`;
              await _ejecutarHerramienta(bloqueActual.name, input);
            }
            bloqueActual = null;
            break;

          case 'message_stop':
            // Fin del mensaje — guardar en historial
            if (historialIA.trim()) {
              _s.messages.push({ role: 'assistant', content: historialIA });
            }
            break;

          case 'error':
            throw new Error(evt.error?.message ?? 'Stream error');
        }
      }
    }
  } finally {
    // Garantizar que el cursor desaparece aunque haya error
    if (nodoStream) _finalizarNodo();
    reader.releaseLock();
  }
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
      case 'preparar_documentos': {
        const { documentos, formato, motivo } = input;
        await _generarPaqueteDocumentos(documentos, formato, motivo);
        break;
      }
      case 'registrar_factura_recibida': {
        const { concepto, proveedor, nif_proveedor, base_imponible, iva_pct, irpf_pct, fecha, numero_factura, categoria } = input;
        const uid = SESSION?.user?.id;
        if (!uid) throw new Error('Sin sesión');
        const ivaPct   = Number(iva_pct)   || 0;
        const irpfPct  = Number(irpf_pct)  || 0;
        const base     = Number(base_imponible);
        const total    = base * (1 + ivaPct/100) - base * irpfPct/100;

        // Generar número de factura interno si el proveedor no lo tiene
        const numInterno = numero_factura || (() => {
          const yyyy = (fecha || new Date().toISOString().slice(0,4)).slice(0,4);
          return `REC-${yyyy}-${Date.now().toString().slice(-4)}`;
        })();

        const { error } = await supabase.from('facturas').insert({
          user_id:        uid,
          concepto:       `[${categoria}] ${concepto}`,
          base,
          iva:            ivaPct,
          irpf_retencion: irpfPct,
          tipo:           'recibida',
          tipo_operacion: 'nacional',
          estado:         'emitida',
          fecha:          fecha || new Date().toISOString().slice(0,10),
          cliente_nombre: proveedor,
          cliente_nif:    nif_proveedor || null,
          numero_factura: numInterno,
          fecha_emision:  fecha || new Date().toISOString().slice(0,10),
          notas:          `Registrada desde PDF por Asesor IA · ${new Date().toLocaleDateString('es-ES')}`,
        });
        if (error) throw new Error(error.message);

        try {
          const { refreshDashboard } = await import('./dashboard.js');
          const { refreshFacturas }  = await import('./facturas.js');
          await Promise.all([refreshDashboard(), refreshFacturas()]);
        } catch(_) {}

        const totalFmt = fmt(base + base * ivaPct / 100);
        _addAccion(
          '✓ Factura registrada',
          `${proveedor} · Base ${fmt(base)} + IVA ${ivaPct}% = ${totalFmt} · ${numInterno}`,
          () => window._switchView?.('facturas')
        );
        break;
      }
    }
  } catch(err) {
    console.error('[tax-asistente] herramienta error:',nombre,err);
    _addAccionError('No pude completar la acción',err.message);
  }
}

/* ══════════════════════════════════════════════════════════════════
   GENERADOR DE PAQUETE DE DOCUMENTOS
   Llama a las funciones de exportación ya existentes en la app,
   captura los blobs y los empaqueta en un ZIP descargable.
══════════════════════════════════════════════════════════════════ */
async function _generarPaqueteDocumentos(documentos, formato, motivo) {
  // Mapa: clave → { label, fn, ext }
  const MAPA = {
    modelo_303:        { label: 'Modelo 303 · IVA',             ext: 'pdf', fn: async () => { const {exportarDatos303}   = await import('./fiscal.js');         return _capturarPDF(() => exportarDatos303()); } },
    modelo_130:        { label: 'Modelo 130 · IRPF',            ext: 'pdf', fn: async () => { const {exportarDatos130}   = await import('./fiscal.js');         return _capturarPDF(() => exportarDatos130()); } },
    modelo_200_IS:     { label: 'Modelo 200 · IS',              ext: 'pdf', fn: async () => { const {refreshIS}          = await import('./dashboard.js');      return _capturarPDF(async () => { await refreshIS(); if (window._switchView) window._switchView('is'); }); } },
    modelo_111:        { label: 'Modelo 111 · Retenciones',     ext: 'pdf', fn: async () => { const {exportModelo111PDF} = await import('./otros-modelos.js'); return _capturarPDF(() => exportModelo111PDF()); } },
    modelo_115:        { label: 'Modelo 115 · Alquiler',        ext: 'pdf', fn: async () => { const {exportModelo115PDF} = await import('./otros-modelos.js'); return _capturarPDF(() => exportModelo115PDF()); } },
    modelo_347:        { label: 'Modelo 347 · Terceros',        ext: 'pdf', fn: async () => { const {exportModelo347PDF} = await import('./otros-modelos.js'); return _capturarPDF(() => exportModelo347PDF()); } },
    modelo_349:        { label: 'Modelo 349 · Intracom.',       ext: 'pdf', fn: async () => { const {exportModelo349PDF} = await import('./otros-modelos.js'); return _capturarPDF(() => exportModelo349PDF()); } },
    modelo_390:        { label: 'Modelo 390 · Resumen IVA',     ext: 'pdf', fn: async () => { const {exportModelo390PDF} = await import('./otros-modelos.js'); return _capturarPDF(() => exportModelo390PDF()); } },
    modelo_190:        { label: 'Modelo 190 · Retenciones',     ext: 'pdf', fn: async () => { const {exportModelo190PDF} = await import('./otros-modelos.js'); return _capturarPDF(() => exportModelo190PDF()); } },
    libro_ingresos_pdf:{ label: 'Libro de Ingresos',            ext: 'pdf', fn: async () => { const {exportLibroIngPDF}  = await import('./exports.js');        return _capturarPDF(() => exportLibroIngPDF()); } },
    libro_gastos_pdf:  { label: 'Libro de Gastos',              ext: 'pdf', fn: async () => { const {exportLibroGstPDF}  = await import('./exports.js');        return _capturarPDF(() => exportLibroGstPDF()); } },
    facturas_excel:    { label: 'Facturas (Excel)',              ext: 'xlsx',fn: async () => { const {exportFacturasExcel}= await import('./exports.js');        return _capturarXLSX(() => exportFacturasExcel()); } },
  };

  const ctx = _s.taxResult;
  const trimLabel = { T1:'T1', T2:'T2', T3:'T3', T4:'T4' }[ctx?.trim] ?? '';
  const year = ctx?.year ?? new Date().getFullYear();

  // Mostrar mensaje de preparando
  _addAccion('⏳ Preparando documentos…', `${documentos.length} archivo${documentos.length>1?'s':''} · ${motivo}`, null);

  if (formato === 'individual') {
    // Modo individual: botones separados que descargan al pulsar
    const items = documentos.map(key => {
      const def = MAPA[key];
      if (!def) return null;
      return { label: def.label, ext: def.ext, fn: def.fn };
    }).filter(Boolean);
    _addDescarga(motivo, items, trimLabel, year);
    return;
  }

  // Modo ZIP: generar todos y empaquetar
  await _cargarJSZip();
  if (!window.JSZip) {
    // Fallback a individual si JSZip no carga
    const items = documentos.map(key => MAPA[key]).filter(Boolean);
    _addDescarga(motivo, items, trimLabel, year);
    return;
  }

  const zip = new window.JSZip();
  const carpeta = zip.folder(`Taurix_${trimLabel}_${year}`);
  const errores = [];

  for (const key of documentos) {
    const def = MAPA[key];
    if (!def) continue;
    try {
      const blob = await def.fn();
      if (blob) {
        carpeta.file(`${key}_${trimLabel}_${year}.${def.ext}`, blob);
      }
    } catch (e) {
      errores.push(def.label);
      console.warn('[tax-asistente] Error generando', key, e);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const nombre  = `Taurix_Documentos_${trimLabel}_${year}.zip`;
  _descargarBlob(zipBlob, nombre);

  // Mostrar resultado
  if (errores.length) {
    _addAccionError('Algunos documentos fallaron', errores.join(', ') + ' · El resto se descargó correctamente');
  } else {
    _addAccion(
      `✓ ${documentos.length} documento${documentos.length>1?'s':''} descargado${documentos.length>1?'s':''}`,
      `${nombre} · ${motivo}`,
      null
    );
  }
}

/* Muestra botones de descarga individuales en el chat */
function _addDescarga(motivo, items, trimLabel, year) {
  const msgs = document.getElementById('ta-msgs');
  const d = document.createElement('div');
  d.className = 'ta-descarga';

  const btnsSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  d.innerHTML = `
    <div class="ta-descarga-title">📁 ${motivo}</div>
    <div class="ta-descarga-items" id="ta-dl-items-${Date.now()}"></div>
    <div class="ta-descarga-nota">Los archivos se generan con tus datos reales del ${trimLabel} ${year}</div>`;

  msgs.appendChild(d);
  requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });

  const container = d.querySelector('.ta-descarga-items');
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'ta-descarga-btn';
    btn.innerHTML = `${btnsSVG} ${item.label}`;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Generando…`;
      try {
        const blob = await item.fn();
        if (blob) {
          _descargarBlob(blob, `${item.label.replace(/[^a-zA-Z0-9]/g,'_')}_${trimLabel}_${year}.${item.ext}`);
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> ✓ Descargado`;
          btn.style.background = 'var(--green,#059669)';
        } else {
          // la función ya disparó la descarga directamente (jsPDF.save)
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> ✓ Listo`;
          btn.style.background = 'var(--green,#059669)';
        }
      } catch(e) {
        btn.innerHTML = `❌ Error: ${e.message}`;
        btn.style.background = 'var(--red,#DC2626)';
        btn.disabled = false;
      }
    });
    container.appendChild(btn);
  });
}

/* Captura el blob de una función que usa jsPDF.save() */
async function _capturarPDF(fn) {
  // La mayoría de funciones llaman a doc.save() directamente.
  // Las interceptamos temporalmente para capturar el blob en lugar de descargar.
  let blobCapturado = null;
  const saveOriginal = window.jspdf?.jsPDF?.prototype?.save;

  if (window.jspdf?.jsPDF) {
    window.jspdf.jsPDF.prototype.save = function(nombre) {
      blobCapturado = this.output('blob');
      // No descargar — solo capturar
    };
  }

  try {
    await fn();
  } finally {
    if (saveOriginal && window.jspdf?.jsPDF) {
      window.jspdf.jsPDF.prototype.save = saveOriginal;
    }
  }

  return blobCapturado; // null si la función no usa jsPDF
}

/* Captura el blob de una función que usa XLSX.writeFile() */
async function _capturarXLSX(fn) {
  let blobCapturado = null;
  const writeFileOriginal = window.XLSX?.writeFile;

  if (window.XLSX) {
    window.XLSX.writeFile = function(wb, nombre) {
      const buffer = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      blobCapturado = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
  }

  try {
    await fn();
  } finally {
    if (writeFileOriginal && window.XLSX) {
      window.XLSX.writeFile = writeFileOriginal;
    }
  }

  return blobCapturado;
}

/* Descarga un blob como archivo */
function _descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* Cargar JSZip dinámicamente */
async function _cargarJSZip() {
  if (window.JSZip) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
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
