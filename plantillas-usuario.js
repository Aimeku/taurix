/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js  — v4 DEFINITIVO
   ─ Logo se posiciona SOBRE la cabecera (position:absolute)
   ─ Ejes X/Y clampeados: nunca salen del preview
   ─ AbortController para cero listeners duplicados
   ─ Preview 100% fiel en tiempo real
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

/* ══════════════════════════════════════════════════════
   CARGA DE DATOS
══════════════════════════════════════════════════════ */
export async function loadPlantillas() {
  const { data, error } = await supabase
    .from("plantillas_usuario")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .order("nombre");
  if (error) { console.error("plantillas:", error.message); return []; }
  return data || [];
}

export async function refreshPlantillas() {
  PLANTILLAS = await loadPlantillas();
  _renderSidebar();
}

/* ══════════════════════════════════════════════════════
   ESTADO DEL MÓDULO
══════════════════════════════════════════════════════ */
let _epLogo           = "";
let _epIdioma         = "es";
let _epCurrentPrefill = null;
let _epAC             = null; // AbortController para limpiar listeners

const LABELS_ES = {
  tipo:"FACTURA", de:"EMISOR", para:"CLIENTE",
  cant:"Cant", precio:"Precio", iva:"IVA", total:"Total",
  base:"Base imponible", totalDoc:"TOTAL"
};
const LABELS_EN = {
  tipo:"INVOICE", de:"FROM", para:"BILL TO",
  cant:"Qty", precio:"Price", iva:"VAT", total:"Total",
  base:"Subtotal", totalDoc:"TOTAL"
};
const FONT_MAP = {
  "Helvetica":       "Helvetica,Arial,sans-serif",
  "Arial":           "Arial,sans-serif",
  "Courier New":     "'Courier New',monospace",
  "Times New Roman": "'Times New Roman',Times,serif",
  "Georgia":         "Georgia,serif",
  "Trebuchet MS":    "'Trebuchet MS',sans-serif",
  "Verdana":         "Verdana,sans-serif",
  "Garamond":        "Garamond,serif"
};
const ACCENT_COLS = [
  "#3b82f6","#f97316","#059669","#8b5cf6",
  "#ef4444","#0ea5e9","#ec4899","#14b8a6"
];

/* ══════════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════════ */
function _renderSidebar() {
  const wrap = document.getElementById("plantillasGrid");
  if (!wrap) return;

  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:28px 12px;color:var(--t3)">
        <div style="font-size:36px;margin-bottom:10px">📄</div>
        <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:4px">Sin plantillas</div>
        <div style="font-size:11px;line-height:1.5">Crea tu primera plantilla con el botón de arriba</div>
      </div>`;
    const editor = document.getElementById("plt-editor");
    if (editor && editor.style.display === "none") {
      const es = document.getElementById("plt-empty-state");
      if (es) es.style.display = "";
    }
    return;
  }

  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const color  = p.color_cabecera || ACCENT_COLS[i % ACCENT_COLS.length];
    const lineas = p.lineas ? JSON.parse(p.lineas) : [];
    const base   = lineas.reduce((a, l) => a + (l.cantidad||1)*(l.precio||0), 0);
    return `
      <div class="plt-sidebar-card" data-plt-id="${p.id}"
        style="border:1.5px solid var(--brd);border-left:4px solid ${color};border-radius:10px;
               padding:12px 14px;cursor:pointer;background:var(--srf);transition:all .15s"
        onclick="window._editPlantilla('${p.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
          <div style="font-size:13px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${p.nombre}</div>
          ${p.idioma==="en"
            ? `<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:#f0f9ff;color:#0369a1;font-weight:700;flex-shrink:0">EN</span>`
            : `<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:#fef9c3;color:#854d0e;font-weight:700;flex-shrink:0">ES</span>`}
        </div>
        <div style="font-size:11px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">${p.concepto||"Sin concepto"}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:${color}15;color:${color};font-weight:600">${lineas.length} línea${lineas.length!==1?"s":""}</span>
            ${p.fuente ? `<span style="font-size:10px;padding:1px 7px;border-radius:4px;background:var(--bg2);color:var(--t3)">${p.fuente}</span>` : ""}
          </div>
          ${base > 0 ? `<div style="font-family:monospace;font-size:11px;font-weight:700;color:var(--t1);flex-shrink:0">${fmt(base)}</div>` : ""}
        </div>
        <div style="display:flex;gap:4px;margin-top:8px">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')"
            style="font-size:10px;flex:1;text-align:center" title="Usar en factura">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')"
            style="font-size:10px;flex:1;text-align:center" title="Usar en presupuesto">📋 Presup.</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')"
            style="font-size:10px" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join("");

  if (_epCurrentPrefill?.id) _highlightSidebarCard(_epCurrentPrefill.id);
}

function _highlightSidebarCard(id) {
  document.querySelectorAll(".plt-sidebar-card").forEach(card => {
    const active = card.dataset.pltId === String(id);
    card.style.background    = active ? "rgba(26,86,219,.06)" : "var(--srf)";
    card.style.outline       = active ? "2px solid var(--accent)" : "none";
    card.style.outlineOffset = "0px";
  });
}

/* ══════════════════════════════════════════════════════
   MOSTRAR / OCULTAR EDITOR
══════════════════════════════════════════════════════ */
function _showEditor() {
  document.getElementById("plt-empty-state")?.style.setProperty("display","none");
  const ed = document.getElementById("plt-editor");
  if (ed) ed.style.display = "";
}

function _hideEditor() {
  const ed = document.getElementById("plt-editor");
  if (ed) ed.style.display = "none";
  const es = document.getElementById("plt-empty-state");
  if (es) es.style.display = "";
  document.querySelectorAll(".plt-sidebar-card").forEach(c => {
    c.style.background = "var(--srf)"; c.style.outline = "none";
  });
  _epCurrentPrefill = null;
  _epAC?.abort();
  _epAC = null;
}

/* ══════════════════════════════════════════════════════
   HELPERS DE LECTURA
══════════════════════════════════════════════════════ */
const _g  = id => document.getElementById(id);
const _gv = (id, fb="") => { const e=_g(id); return (e && e.value!=="") ? e.value : fb; };
const _gc = (id, fb=false) => { const e=_g(id); return e ? e.checked : fb; };
const _gi = (id, fb=0) => parseInt(_gv(id, String(fb))) || fb;

/* ══════════════════════════════════════════════════════
   PREVIEW EN TIEMPO REAL

   Estructura del preview HTML (definida en index.html):
   ┌─ ep_pv_cab_wrap (position:relative) ────────────────┐
   │  ┌─ ep_pv_cab (fondo color) ──────────────────────┐ │
   │  │  tipo · concepto · fecha                        │ │
   │  └────────────────────────────────────────────────┘ │
   │  [ep_pv_logo_row] position:absolute top/right       │ ← SOBRE la cabecera
   └─────────────────────────────────────────────────────┘
   ┌─ ep_pv_emisor_row ──────────────────────────────────┐
   │  ep_pv_emisor_bloque  │  ep_pv_cliente_bloque        │
   └─────────────────────────────────────────────────────┘
   ... tabla, totales, pie ...
══════════════════════════════════════════════════════ */
function _runPreview() {
  const L = _epIdioma === "en" ? LABELS_EN : LABELS_ES;

  const colorCab   = _gv("ep_color_cab",      "#1a56db");
  const colorTxtC  = _gv("ep_color_txt_cab",  "#ffffff");
  const colorAcc   = _gv("ep_color_acento",   "#1a56db");
  const colorLetra = _gv("ep_color_letra",    "#0f172a");
  const colorFdo   = _gv("ep_color_fondo",    "#ffffff");
  const colorFdoT  = _gv("ep_color_fondo_tab","#f8fafc");
  const colorLin   = _gv("ep_color_lineas",   "#e2e8f0");
  const estCab     = _gv("ep_estilo_cab",     "solido");
  const fuente     = _gv("ep_fuente",         "Helvetica");
  const tamF       = _gi("ep_tam_fuente",     9);
  const concepto   = _gv("ep_concepto",       "") || "Concepto del documento";
  const notas      = _gv("ep_notas",          "");
  const desc       = _gv("ep_descripcion",    "");
  const pie        = _gv("ep_pie",            "");
  const mostLogo   = _gc("ep_mostrar_logo",   true);
  const mostCab    = _gc("ep_mostrar_cab",    true);
  const mostPie    = _gc("ep_mostrar_pie",    true);
  const mostEmisor = _gc("ep_mostrar_emisor", true);
  const alin       = _gv("ep_alin_val",       "izq");
  const alinCSS    = alin==="centro"?"center":alin==="der"?"right":"left";

  // Logo: sliders van de 0 a 100 para X (offset desde borde der) y 0 a 60 para Y (offset desde arriba)
  // Guardamos como porcentaje relativo al ancho/alto de la cabecera
  const logoX    = _gi("ep_logo_x",    0);  // offset px desde la derecha de la cabecera
  const logoY    = _gi("ep_logo_y",    6);  // offset px desde la parte superior de la cabecera
  const logoSize = _gi("ep_logo_size", 30); // altura máxima en px

  // Emisor/cliente: offsets de posición dentro de sus celdas
  const emisorX  = _gi("ep_emisor_x",  0);
  const emisorY  = _gi("ep_emisor_y",  0);
  const clienteX = _gi("ep_cliente_x", 0);
  const clienteY = _gi("ep_cliente_y", 0);

  /* ── Documento base ── */
  const doc = _g("ep_pv_doc");
  if (doc) {
    doc.style.fontFamily = FONT_MAP[fuente] || FONT_MAP["Helvetica"];
    doc.style.background = colorFdo;
    doc.style.color      = colorLetra;
    doc.style.fontSize   = (tamF + 2) + "px";
    doc.style.textAlign  = alinCSS;
  }

  /* ── Logo: position:absolute DENTRO del ep_pv_cab_wrap ──
     - right = logoX px (0 = pegado al borde derecho, más grande = más hacia el centro)
     - top   = logoY px (0 = arriba del todo, más grande = más abajo)
     Clampeamos para que no se salga nunca del contenedor.
  ── */
  const logoRow = _g("ep_pv_logo_row");
  const logoImg = _g("ep_pv_logo_img");
  const hasLogo = mostLogo && !!_epLogo;

  if (logoRow) {
    if (hasLogo) {
      logoRow.style.display  = "block";
      // Clamp: right entre 4px y 260px, top entre 0px y 50px
      logoRow.style.right    = Math.max(4, Math.min(260, logoX)) + "px";
      logoRow.style.top      = Math.max(0, Math.min(50, logoY))  + "px";
    } else {
      logoRow.style.display  = "none";
    }
  }

  if (logoImg) {
    if (hasLogo && _epLogo) {
      logoImg.src             = _epLogo;
      logoImg.style.maxHeight = logoSize + "px";
      logoImg.style.maxWidth  = (logoSize * 3) + "px";
      logoImg.style.display   = "block";
    } else {
      logoImg.style.display   = "none";
    }
  }

  /* ── Cabecera ── */
  const cab = _g("ep_pv_cab");
  if (cab) {
    if (!mostCab || estCab === "sin") {
      cab.style.display = "none";
    } else {
      cab.style.display = "";
      // Dejamos hueco a la derecha si hay logo, para que el texto no quede tapado
      cab.style.paddingRight = hasLogo ? Math.max(logoSize * 2.5 + 16, 60) + "px" : "18px";

      if (estCab === "solido") {
        cab.style.background   = colorCab;
        cab.style.borderBottom = "none";
        // Texto con color sobre fondo sólido
        cab.querySelectorAll("*").forEach(el => el.style.removeProperty("color"));
      } else if (estCab === "gradiente") {
        cab.style.background   = `linear-gradient(135deg,${colorCab},${colorAcc})`;
        cab.style.borderBottom = "none";
      } else if (estCab === "linea") {
        cab.style.background   = colorFdo;
        cab.style.borderBottom = `3px solid ${colorCab}`;
      }
    }
  }

  const pvC = _g("ep_pv_concepto"), pvT = _g("ep_pv_tipo");
  if (pvC) { pvC.textContent = concepto; pvC.style.color = colorTxtC; }
  if (pvT) { pvT.textContent = L.tipo;   pvT.style.color = colorTxtC; }
  // Si estilo "linea" (fondo transparente), el texto debe ser el color de letra del doc
  if (estCab === "linea") {
    if (pvC) pvC.style.color = colorLetra;
    if (pvT) pvT.style.color = colorLetra;
    const fe = _g("ep_pv_fecha"); if (fe) fe.style.color = colorLetra;
  }

  // Fecha
  const fe = _g("ep_pv_fecha");
  if (fe && !fe.textContent) fe.textContent = new Date().toLocaleDateString("es-ES");

  /* ── Emisor / Cliente ── */
  const er = _g("ep_pv_emisor_row");
  if (er) er.style.display = mostEmisor ? "grid" : "none";

  const eb = _g("ep_pv_emisor_bloque");
  if (eb) eb.style.transform = `translate(${Math.max(-60,Math.min(60,emisorX))}px,${Math.max(-20,Math.min(20,emisorY))}px)`;

  const cb = _g("ep_pv_cliente_bloque");
  if (cb) cb.style.transform = `translate(${Math.max(-60,Math.min(60,clienteX))}px,${Math.max(-20,Math.min(20,clienteY))}px)`;

  const st = (id,v) => { const e=_g(id); if(e) e.textContent=v; };
  st("ep_pv_lbl_de",   L.de);
  st("ep_pv_lbl_para", L.para);

  /* ── Tabla cabecera ── */
  const th = _g("ep_pv_tabla_head");
  if (th) th.style.background = colorAcc;
  st("ep_pv_h_desc",   _epIdioma==="en"?"Description":"Descripción");
  st("ep_pv_h_cant",   L.cant);
  st("ep_pv_h_precio", L.precio);
  st("ep_pv_h_iva",    L.iva);
  st("ep_pv_h_total",  L.total);

  /* ── Líneas ── */
  const rows = document.querySelectorAll("#ep_lineasContainer .linea-row");
  const larr = [...rows].map(r => ({
    d: r.querySelector("[data-field='descripcion']")?.value || "",
    c: parseFloat(r.querySelector("[data-field='cantidad']")?.value)  || 1,
    p: parseFloat(r.querySelector("[data-field='precio']")?.value)    || 0,
    i: parseInt(r.querySelector("[data-field='iva']")?.value)         || 21,
  })).filter(l => l.d || l.p > 0);

  const pvLin = _g("ep_pv_lineas");
  if (pvLin) {
    if (!larr.length) {
      pvLin.innerHTML = `<div style="padding:12px 0;font-size:10px;color:#9ca3af;text-align:center">Sin líneas definidas</div>`;
    } else {
      pvLin.innerHTML = larr.map((l, ri) => {
        const tot = l.c * l.p;
        const bg  = ri % 2 === 0 ? colorFdoT : "#fff";
        return `<div style="display:grid;grid-template-columns:1fr 40px 70px 40px 70px;
          padding:5px 0;background:${bg};border-bottom:1px solid ${colorLin}">
          <span style="font-size:${tamF+1}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:4px">${l.d}</span>
          <span style="font-size:${tamF+1}px;text-align:right">${l.c}</span>
          <span style="font-size:${tamF+1}px;text-align:right">${l.p.toFixed(2)}€</span>
          <span style="font-size:${tamF+1}px;text-align:right">${l.i}%</span>
          <span style="font-size:${tamF+1}px;text-align:right;font-weight:700;font-family:monospace">${tot.toFixed(2)}€</span>
        </div>`;
      }).join("");
    }
  }

  /* ── Totales ── */
  const base  = larr.reduce((a,l)=>a+l.c*l.p, 0);
  const iva   = larr.reduce((a,l)=>a+l.c*l.p*l.i/100, 0);
  const pvTot = _g("ep_pv_totales");
  if (pvTot) pvTot.innerHTML = `
    <table style="border-collapse:collapse;font-size:10px;min-width:160px">
      <tr><td style="color:#6b7280;padding:2px 12px 2px 0">${L.base}</td>
          <td style="text-align:right;font-family:monospace">${base.toFixed(2)} €</td></tr>
      <tr><td style="color:#6b7280;padding:2px 12px 2px 0">IVA</td>
          <td style="text-align:right;font-family:monospace">${iva.toFixed(2)} €</td></tr>
      <tr style="border-top:2px solid ${colorAcc}">
          <td style="font-weight:800;color:#111;padding:4px 12px 2px 0">${L.totalDoc}</td>
          <td style="text-align:right;font-family:monospace;font-weight:800;color:${colorAcc}">${(base+iva).toFixed(2)} €</td>
      </tr>
    </table>`;

  /* ── Descripción ── */
  const dw=_g("ep_pv_desc_wrap"), dd=_g("ep_pv_desc");
  if(dw&&dd){ dw.style.display=desc?"":"none"; dd.textContent=desc; }

  /* ── Notas ── */
  const pvN=_g("ep_pv_notas");
  if(pvN){ pvN.textContent=notas; pvN.style.display=notas?"":"none"; }

  /* ── Pie ── */
  const pvP=_g("ep_pv_pie"), pvPT=_g("ep_pv_pie_txt");
  if(pvP)  pvP.style.display  = mostPie?"flex":"none";
  if(pvPT) pvPT.textContent   = pie || "Texto legal del pie";

  /* ── Font preview (tab tipografía) ── */
  const fp=_g("ep_font_preview");
  if(fp){ fp.style.fontFamily=FONT_MAP[fuente]||FONT_MAP["Helvetica"]; fp.style.fontSize=(tamF+3)+"px"; }
}

// Ambos nombres que usa el HTML inline (oninput en los sliders del HTML)
window._epRunPreview = _runPreview;
window._epPreview    = _runPreview;

/* ══════════════════════════════════════════════════════
   GLOBALS DE TABS / IDIOMA / ALINEACIÓN
   (llamados desde onclick en el HTML)
══════════════════════════════════════════════════════ */
window._epTab = function(tab) {
  document.querySelectorAll(".ep-tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.style.borderBottom = on ? "3px solid var(--accent)" : "3px solid transparent";
    b.style.color        = on ? "var(--accent)"           : "var(--t3)";
    b.style.background   = on ? "var(--bg)"               : "transparent";
    b.style.fontWeight   = on ? "700"                     : "600";
  });
  document.querySelectorAll(".ep-sec").forEach(s => {
    s.style.display = s.id === "ep-tab-"+tab ? "" : "none";
  });
};

window._epSetAlin = function(v) {
  const inp = _g("ep_alin_val"); if(inp) inp.value=v;
  document.querySelectorAll("#ep_alin_group button").forEach(b => {
    const on = b.dataset.alin === v;
    b.style.borderColor = on?"#f97316":"var(--brd)";
    b.style.color       = on?"#f97316":"var(--t2)";
    b.style.fontWeight  = on?"700":"500";
    b.style.boxShadow   = on?"0 0 0 2px #f9731622":"none";
  });
  _runPreview();
};

window._epLang = function(lang) {
  _epIdioma = lang;
  ["es","en"].forEach(l => {
    const btn=_g("ep_lang_"+l); if(!btn) return;
    const on=l===lang;
    btn.style.borderColor = on?"#f97316":"var(--brd)";
    btn.style.color       = on?"#f97316":"var(--t2)";
    btn.style.fontWeight  = on?"700":"500";
    btn.style.background  = "var(--bg2)";
    btn.style.boxShadow   = on?"0 0 0 2px #f9731622":"none";
  });
  _runPreview();
};

/* ══════════════════════════════════════════════════════
   _epInit — inicializa formulario y conecta todos los eventos
══════════════════════════════════════════════════════ */
window._epInit = function() {
  const prefill = _epCurrentPrefill || {};
  const isEdit  = !!prefill.id;

  // Matar listeners anteriores sin dejar rastro
  _epAC?.abort();
  _epAC = new AbortController();
  const sig = _epAC.signal;

  const lineas = prefill.lineas
    ? (typeof prefill.lineas==="string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{ descripcion:"", cantidad:1, precio:0, iva:21 }];

  _epLogo   = prefill.logo_b64 || "";
  _epIdioma = prefill.idioma   || "es";

  /* ── Helpers de rellenado ── */
  const sv = (id,v) => { const e=_g(id); if(e) e.value=v??""; };
  const sc = (id,v) => { const e=_g(id); if(e) e.checked=v!==false; };
  // Rellena slider y su label a la vez
  const ss = (id, v, def) => {
    const val = (v!==undefined && v!==null) ? v : def;
    const e=_g(id), lbl=_g(id+"_val");
    if(e)   e.value        = val;
    if(lbl) lbl.textContent= val;
  };

  sv("ep_nombre",      prefill.nombre);
  sv("ep_concepto",    prefill.concepto);
  sv("ep_descripcion", prefill.descripcion);
  sv("ep_notas",       prefill.notas);
  sv("ep_pie",         prefill.texto_pie);
  sv("ep_iban",        prefill.iban_visible);
  sv("ep_estilo_cab",  prefill.estilo_cab  || "solido");
  sv("ep_tamano_hoja", prefill.tamano_hoja || "A4");
  sv("ep_fuente",      prefill.fuente      || "Helvetica");
  sv("ep_tam_fuente",  prefill.tam_fuente  || 9);
  sv("ep_alin_val",    prefill.alin_texto  || "izq");

  ss("ep_margen",     prefill.margen,    18);
  ss("ep_pie_altura", prefill.pie_altura,14);
  ss("ep_logo_x",     prefill.logo_x,    0);
  ss("ep_logo_y",     prefill.logo_y,    6);
  ss("ep_logo_size",  prefill.logo_size, 30);
  ss("ep_emisor_x",   prefill.emisor_x,  0);
  ss("ep_emisor_y",   prefill.emisor_y,  0);
  ss("ep_cliente_x",  prefill.cliente_x, 0);
  ss("ep_cliente_y",  prefill.cliente_y, 0);

  /* ── Colores: picker ↔ hex sincronizados ── */
  const COLS = {
    ep_color_cab:       prefill.color_cabecera  || "#1a56db",
    ep_color_txt_cab:   prefill.color_txt_cab   || "#ffffff",
    ep_color_acento:    prefill.color_acento    || "#1a56db",
    ep_color_letra:     prefill.color_letra     || "#0f172a",
    ep_color_fondo:     prefill.color_fondo     || "#ffffff",
    ep_color_fondo_tab: prefill.color_fondo_tab || "#f8fafc",
    ep_color_lineas:    prefill.color_lineas    || "#e2e8f0",
  };
  Object.entries(COLS).forEach(([id,val]) => {
    const pick=_g(id), hex=_g(id+"_hex");
    if(pick) pick.value=val;
    if(hex)  hex.value=val;
    if(pick) pick.addEventListener("input", ()=>{ if(hex) hex.value=pick.value; _runPreview(); }, {signal:sig});
    if(hex){
      const syncHex=()=>{ if(/^#[0-9a-f]{6}$/i.test(hex.value)){ if(pick) pick.value=hex.value; _runPreview(); } };
      hex.addEventListener("input",  syncHex, {signal:sig});
      hex.addEventListener("change", syncHex, {signal:sig});
    }
  });

  /* ── Checkboxes ── */
  sc("ep_mostrar_logo",    prefill.mostrar_logo    !== false);
  sc("ep_mostrar_cab",     prefill.mostrar_cab     !== false);
  sc("ep_mostrar_pie",     prefill.mostrar_pie     !== false);
  sc("ep_mostrar_emisor",  prefill.mostrar_emisor  !== false);
  sc("ep_mostrar_email",   prefill.mostrar_email   !== false);
  sc("ep_mostrar_num_pag", prefill.mostrar_num_pag !== false);
  sc("ep_cab_todas_pags",  !!prefill.cab_todas_pags);

  // Estética del label "mostrar logo"
  const mlLbl=_g("ep_mostrar_logo_lbl"), mlChk=_g("ep_mostrar_logo");
  if(mlLbl&&mlChk){
    const updML=()=>{
      mlLbl.style.borderColor = mlChk.checked?"var(--accent)":"var(--brd)";
      mlLbl.style.background  = mlChk.checked?"rgba(26,86,219,.05)":"var(--bg2)";
    };
    updML();
    mlChk.addEventListener("change", ()=>{ updML(); _runPreview(); }, {signal:sig});
  }
  ["ep_mostrar_cab","ep_mostrar_pie","ep_mostrar_emisor",
   "ep_mostrar_email","ep_mostrar_num_pag","ep_cab_todas_pags"].forEach(id=>{
    _g(id)?.addEventListener("change", _runPreview, {signal:sig});
  });

  /* ── Logo upload ── */
  const _updLogoUI = () => {
    const prev=_g("ep_logo_prev"), btn=_g("ep_logo_btn"), rm=_g("ep_logo_rm");
    if(prev) prev.innerHTML = _epLogo
      ? `<img src="${_epLogo}" style="max-width:96px;max-height:60px;object-fit:contain"/>`
      : `<span style="font-size:11px;color:var(--t4);text-align:center;line-height:1.4">Click para<br>subir logo</span>`;
    if(btn) btn.textContent = _epLogo?"📁 Cambiar logo":"📁 Subir logo";
    if(rm)  rm.style.display = _epLogo?"":"none";
  };
  _updLogoUI();

  _g("ep_logo_btn")?.addEventListener("click", ()=>_g("ep_logo_inp")?.click(), {signal:sig});

  const inp=_g("ep_logo_inp");
  if(inp){
    inp.value="";
    inp.addEventListener("change", e=>{
      const f=e.target.files[0]; if(!f) return;
      if(f.size>500*1024){ toast("Logo máx. 500KB","error"); return; }
      const r=new FileReader();
      r.onload=ev=>{ _epLogo=ev.target.result; _updLogoUI(); _runPreview(); };
      r.readAsDataURL(f);
    }, {signal:sig});
  }
  _g("ep_logo_rm")?.addEventListener("click", ()=>{ _epLogo=""; _updLogoUI(); _runPreview(); }, {signal:sig});

  /* ── Fecha del preview ── */
  const fe=_g("ep_pv_fecha");
  if(fe) fe.textContent = new Date().toLocaleDateString("es-ES");

  /* ── Líneas predefinidas ── */
  const _lineaHTML = (l={}) => `
    <div class="linea-row" style="grid-template-columns:1fr 58px 96px 56px 30px">
      <input autocomplete="off" class="ff-input" data-field="descripcion"
        value="${(l.descripcion||"").replace(/"/g,"&quot;")}" placeholder="Descripción"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="cantidad"
        value="${l.cantidad||1}" min="0.01" step="0.01"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="precio"
        value="${l.precio||""}" step="0.01" placeholder="0.00"/>
      <select class="ff-select" data-field="iva">
        <option value="21" ${(l.iva===undefined||l.iva===21)?"selected":""}>21%</option>
        <option value="10" ${l.iva===10?"selected":""}>10%</option>
        <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
        <option value="0"  ${l.iva===0 ?"selected":""}>0%</option>
      </select>
      <button type="button" class="linea-del ep-del-linea" title="Eliminar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;

  const cont=_g("ep_lineasContainer");
  if(cont){
    cont.innerHTML="";
    lineas.forEach(l=>cont.insertAdjacentHTML("beforeend",_lineaHTML(l)));
    if(!lineas.length) cont.insertAdjacentHTML("beforeend",_lineaHTML({}));
    cont.addEventListener("click", e=>{
      if(e.target.closest(".ep-del-linea")){ e.target.closest(".linea-row")?.remove(); _runPreview(); }
    }, {signal:sig});
    cont.addEventListener("input",  _runPreview, {signal:sig});
    cont.addEventListener("change", _runPreview, {signal:sig});
  }
  _g("ep_addLinea")?.addEventListener("click", ()=>{ cont?.insertAdjacentHTML("beforeend",_lineaHTML({})); _runPreview(); }, {signal:sig});

  /* ── Sliders con label ── */
  [
    "ep_margen","ep_pie_altura",
    "ep_logo_x","ep_logo_y","ep_logo_size",
    "ep_emisor_x","ep_emisor_y","ep_cliente_x","ep_cliente_y"
  ].forEach(id=>{
    const el=_g(id), lbl=_g(id+"_val");
    if(el) el.addEventListener("input", ()=>{ if(lbl) lbl.textContent=el.value; _runPreview(); }, {signal:sig});
  });

  /* ── Inputs/selects/textareas genéricos → preview ── */
  document.querySelectorAll(
    "#plt-editor input:not([type=file]):not([type=hidden]):not([type=color]):not([type=range]):not([type=checkbox])," +
    "#plt-editor select, #plt-editor textarea"
  ).forEach(el=>{
    el.addEventListener("input",  _runPreview, {signal:sig});
    el.addEventListener("change", _runPreview, {signal:sig});
  });

  /* ── Estado inicial: tab, idioma, alineación, preview ── */
  window._epTab("diseno");
  window._epLang(_epIdioma);
  window._epSetAlin(prefill.alin_texto || "izq");
  _runPreview();

  /* ── Botón eliminar ── */
  const delBtn=_g("epEliminarBtnBottom");
  if(delBtn){
    delBtn.style.display=isEdit?"":"none";
    if(isEdit) delBtn.addEventListener("click", ()=>{
      openModal(`<div class="modal" style="max-width:380px">
        <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span>
          <button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div>
        <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button></div>
      </div>`);
      _g("_dpltOk")?.addEventListener("click", async ()=>{
        await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
        closeModal(); toast("Plantilla eliminada","success");
        _hideEditor(); await refreshPlantillas();
      });
    }, {signal:sig});
  }

  /* ── Función guardar (closure para capturar prefill/isEdit) ── */
  async function _save() {
    const nombre=_g("ep_nombre")?.value.trim();
    if(!nombre){ window._epTab("diseno"); toast("El nombre es obligatorio","error"); return; }

    const rows=document.querySelectorAll("#ep_lineasContainer .linea-row");
    const lineasArr=[...rows].map(r=>({
      descripcion: r.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:    parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      precio:      parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      iva:         parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.descripcion||l.precio>0);

    const gv=id=>_g(id)?.value?.trim()||null;
    const gb=id=>_g(id)?.checked||false;
    const gi=(id,d)=>parseInt(_g(id)?.value)||d;

    const payload={
      user_id:         SESSION.user.id, nombre,
      concepto:        gv("ep_concepto"),
      descripcion:     gv("ep_descripcion"),
      notas:           gv("ep_notas"),
      texto_pie:       gv("ep_pie"),
      iban_visible:    gv("ep_iban"),
      idioma:          _epIdioma,
      lineas:          JSON.stringify(lineasArr),
      color_principal: gv("ep_color_cab")       || "#1a56db",
      color_cabecera:  gv("ep_color_cab")       || "#1a56db",
      color_txt_cab:   gv("ep_color_txt_cab")   || "#ffffff",
      color_acento:    gv("ep_color_acento")    || "#1a56db",
      color_letra:     gv("ep_color_letra")     || "#0f172a",
      color_fondo:     gv("ep_color_fondo")     || "#ffffff",
      color_fondo_tab: gv("ep_color_fondo_tab") || "#f8fafc",
      color_lineas:    gv("ep_color_lineas")    || "#e2e8f0",
      fuente:          gv("ep_fuente")          || "Helvetica",
      tam_fuente:      gi("ep_tam_fuente",9),
      tamano_hoja:     gv("ep_tamano_hoja")     || "A4",
      margen:          gi("ep_margen",18),
      pie_altura:      gi("ep_pie_altura",14),
      alin_texto:      _g("ep_alin_val")?.value || "izq",
      estilo_cab:      gv("ep_estilo_cab")      || "solido",
      mostrar_logo:    gb("ep_mostrar_logo"),
      mostrar_cab:     gb("ep_mostrar_cab"),
      mostrar_pie:     gb("ep_mostrar_pie"),
      mostrar_emisor:  gb("ep_mostrar_emisor"),
      mostrar_email:   gb("ep_mostrar_email"),
      mostrar_num_pag: gb("ep_mostrar_num_pag"),
      cab_todas_pags:  gb("ep_cab_todas_pags"),
      logo_b64:        _epLogo || null,
      logo_x:          gi("ep_logo_x",0),
      logo_y:          gi("ep_logo_y",6),
      logo_size:       gi("ep_logo_size",30),
      sp_cab:          gi("ep_margen",12),
      sp_emisor:5, sp_entre_bloques:0, sp_tabla:6, sp_pie:5,
      emisor_x:        gi("ep_emisor_x",0),
      emisor_y:        gi("ep_emisor_y",0),
      cliente_x:       gi("ep_cliente_x",0),
      cliente_y:       gi("ep_cliente_y",0),
    };

    const saveBtn=_g("epGuardarBtnBottom");
    if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent="Guardando…"; }

    let err, savedData;
    if(isEdit){
      const res=await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id).select().single();
      err=res.error; savedData=res.data;
    } else {
      const res=await supabase.from("plantillas_usuario").insert(payload).select().single();
      err=res.error; savedData=res.data;
    }

    if(saveBtn){
      saveBtn.disabled=false;
      saveBtn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar plantilla`;
    }

    if(err){ toast("Error: "+err.message,"error"); return; }
    toast(isEdit?"Plantilla actualizada ✅":"Plantilla creada ✅","success");
    await refreshPlantillas();

    if(!isEdit&&savedData){
      _epCurrentPrefill=savedData; window._epInit(); _highlightSidebarCard(savedData.id);
    } else if(isEdit){
      _highlightSidebarCard(prefill.id);
    }
  }

  _g("epGuardarBtnBottom")?.addEventListener("click",  _save,             {signal:sig});
  _g("epCancelarBtnBottom")?.addEventListener("click", ()=>_hideEditor(), {signal:sig});
};

/* ══════════════════════════════════════════════════════
   showPlantillaModal
══════════════════════════════════════════════════════ */
export function showPlantillaModal(prefill) {
  prefill = prefill || {};
  _epCurrentPrefill = prefill;
  if(typeof window._switchView==="function"){
    const el=document.getElementById("view-plantillas");
    if(el&&!el.classList.contains("active")) window._switchView("plantillas");
  }
  setTimeout(()=>{
    _showEditor();
    window._epInit();
    if(prefill.id) _highlightSidebarCard(prefill.id);
  }, 30);
}

/* ══════════════════════════════════════════════════════
   DATOS PARA OTROS MÓDULOS
══════════════════════════════════════════════════════ */
export function getPlantillaData(plantillaId){
  const p=PLANTILLAS.find(x=>x.id===plantillaId);
  if(!p) return null;
  return {
    concepto:        p.concepto,
    descripcion:     p.descripcion,
    notas:           p.notas,
    lineas:          p.lineas?JSON.parse(p.lineas):[],
    color_principal: p.color_cabecera||p.color_principal,
    texto_pie:       p.texto_pie,
    iban_visible:    p.iban_visible,
    logo_b64:        p.logo_b64
  };
}

export function renderPlantillaSelector(containerId, onSelect){
  const container=document.getElementById(containerId);
  if(!container||!PLANTILLAS.length) return;
  container.innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;
      background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
      <span style="font-size:11px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
      ${PLANTILLAS.map(p=>`
        <button class="btn-outline plt-selector-btn" data-plt-id="${p.id}"
          style="font-size:12px;padding:4px 12px">${p.nombre}</button>`).join("")}
      <button class="btn-outline plt-selector-btn" data-plt-id=""
        style="font-size:12px;padding:4px 12px;color:var(--t4)">✕ En blanco</button>
    </div>`;
  container.querySelectorAll(".plt-selector-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      container.querySelectorAll(".plt-selector-btn").forEach(b=>{
        b.style.background=""; b.style.color=""; b.style.borderColor="";
      });
      if(btn.dataset.pltId){
        btn.style.background="var(--accent)"; btn.style.color="#fff"; btn.style.borderColor="var(--accent)";
      }
      if(onSelect) onSelect(btn.dataset.pltId?getPlantillaData(btn.dataset.pltId):null);
    });
  });
}
export const renderSelectorPlantillas = renderPlantillaSelector;

/* ══════════════════════════════════════════════════════
   WINDOW GLOBALS
══════════════════════════════════════════════════════ */
window._nuevaPlantilla = ()=> showPlantillaModal();
window._editPlantilla  = id=>{ const p=PLANTILLAS.find(x=>x.id===id); if(p) showPlantillaModal(p); };

window._delPlantilla = id=>{
  openModal(`<div class="modal" style="max-width:380px">
    <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span>
      <button class="modal-x" onclick="window._cm()">×</button></div>
    <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div>
    <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
      <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button></div>
  </div>`);
  _g("_dpltOk")?.addEventListener("click", async()=>{
    await supabase.from("plantillas_usuario").delete().eq("id",id);
    closeModal(); toast("Plantilla eliminada","success");
    if(_epCurrentPrefill?.id===id) _hideEditor();
    await refreshPlantillas();
  });
};

window._usarPlantillaFactura = id=>{
  const data=getPlantillaData(id); if(!data) return;
  window._switchView?.("nueva-factura");
  setTimeout(()=>window._applyPlantillaToFactura?.(data),200);
};
window._usarPlantillaPres = id=>{
  const data=getPlantillaData(id); if(!data) return;
  window._switchView?.("nuevo-presupuesto");
  setTimeout(()=>window._applyPlantillaToPresupuesto?.(data),200);
};

/* ══════════════════════════════════════════════════════
   initPlantillasView
══════════════════════════════════════════════════════ */
export function initPlantillasView(){
  _g("nuevaPlantillaBtn")?.addEventListener("click",()=>showPlantillaModal());
  const _orig=window._switchView;
  if(_orig&&!window._switchView._patchedForPlantillas){
    window._switchView=function(view,...args){
      if(view==="editar-plantilla"){
        _orig("plantillas",...args);
        setTimeout(()=>{ _showEditor(); window._epInit(); },60);
        return;
      }
      return _orig(view,...args);
    };
    window._switchView._patchedForPlantillas=true;
  }
  refreshPlantillas();
}

export { showPlantillaModal as showPlantillaView };
