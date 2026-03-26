/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js  — v6
   ─ Tab Columnas: panel izq/der, añadir/quitar, % anchura
   ─ Preview tabla dinámica según columnas activas
   ─ Logo position:absolute sobre cabecera
   ─ AbortController: cero listeners duplicados
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

/* ══════════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════════ */
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
const ACCENT_COLS = ["#3b82f6","#f97316","#059669","#8b5cf6","#ef4444","#0ea5e9","#ec4899","#14b8a6"];

/* ── Catálogo completo de columnas disponibles ── */
const COLUMNAS_CATALOGO = [
  { id:"descripcion", label:"Descripción",  labelEn:"Description", obligatoria:true  },
  { id:"cantidad",    label:"Cantidad",     labelEn:"Qty",          obligatoria:false },
  { id:"precio",      label:"Precio",       labelEn:"Price",        obligatoria:false },
  { id:"subtotal",    label:"Subtotal",     labelEn:"Subtotal",     obligatoria:false },
  { id:"descuento",   label:"Descuento",    labelEn:"Discount",     obligatoria:false },
  { id:"codigo",      label:"Código",       labelEn:"Code",         obligatoria:false },
  { id:"coeficiente", label:"Coeficiente",  labelEn:"Coef.",        obligatoria:false },
  { id:"total",       label:"Total",        labelEn:"Total",        obligatoria:false },
];

// Columnas activas por defecto al crear plantilla nueva
const COLS_DEFAULT = ["descripcion","cantidad","precio","total"];

/* ══════════════════════════════════════════════════════
   ESTADO DEL MÓDULO
══════════════════════════════════════════════════════ */
let _epLogo           = "";
let _epIdioma         = "es";
let _epCurrentPrefill = null;
let _epAC             = null;

// Config de columnas — se resetea en cada _epInit
let _colsActivas = [...COLS_DEFAULT]; // array de IDs en orden
let _colsPct     = {};               // { id: "25" } → % anchura

/* ══════════════════════════════════════════════════════
   CARGA Y REFRESCO
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
    const ed = document.getElementById("plt-editor");
    if (ed && ed.style.display === "none") {
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
    const on = card.dataset.pltId === String(id);
    card.style.background    = on ? "rgba(26,86,219,.06)" : "var(--srf)";
    card.style.outline       = on ? "2px solid var(--accent)" : "none";
    card.style.outlineOffset = "0px";
  });
}

/* ══════════════════════════════════════════════════════
   EDITOR SHOW / HIDE
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
  _epAC?.abort(); _epAC = null;
}

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
const _g  = id => document.getElementById(id);
const _gv = (id, fb="") => { const e=_g(id); return (e && e.value!=="") ? e.value : fb; };
const _gc = (id, fb=false) => { const e=_g(id); return e ? e.checked : fb; };
const _gi = (id, fb=0) => parseInt(_gv(id, String(fb))) || fb;

/* ══════════════════════════════════════════════════════
   TAB COLUMNAS — render del panel configurador
══════════════════════════════════════════════════════ */
function _renderColsPanel() {
  const colorAcc = _gv("ep_color_acento","#1a56db");
  const L        = _epIdioma === "en" ? LABELS_EN : LABELS_ES;

  /* ── Panel izquierdo: columnas NO añadidas ── */
  const noAñ = _g("ep_cols_noañadidas");
  if (noAñ) {
    const disponibles = COLUMNAS_CATALOGO.filter(c => !_colsActivas.includes(c.id));
    if (!disponibles.length) {
      noAñ.innerHTML = `<div style="font-size:11px;color:var(--t4);font-style:italic;padding:8px 0">
        Todas las columnas están añadidas</div>`;
    } else {
      noAñ.innerHTML = disponibles.map(col => {
        const lbl = _epIdioma === "en" ? (col.labelEn||col.label) : col.label;
        return `
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;background:var(--bg2);border:1.5px solid var(--brd);border-radius:7px;
              padding:8px 12px;font-size:12px;font-weight:500;color:var(--t2)">${lbl}</div>
            <button type="button" class="btn-outline ep-col-add" data-col-id="${col.id}"
              style="font-size:11px;padding:6px 12px;flex-shrink:0;white-space:nowrap">
              Añadir &raquo;
            </button>
          </div>`;
      }).join("");
    }
  }

  /* ── Panel derecho: columnas AÑADIDAS ── */
  const n = _colsActivas.length;

  // Cabecera (celdas con nombre de columna)
  const cabEl = _g("ep_cols_cab");
  if (cabEl) {
    cabEl.style.display              = "grid";
    cabEl.style.gridTemplateColumns  = `repeat(${n},1fr)`;
    cabEl.innerHTML = _colsActivas.map(id => {
      const col = COLUMNAS_CATALOGO.find(c=>c.id===id) || {label:id};
      const lbl = _epIdioma==="en" ? (col.labelEn||col.label) : col.label;
      return `<div style="background:${colorAcc};color:#fff;font-size:10px;font-weight:700;
        text-transform:uppercase;letter-spacing:.05em;padding:7px 5px;text-align:center;
        border-right:1px solid rgba(255,255,255,.15)">${lbl}</div>`;
    }).join("");
  }

  // Fila de % anchura
  const pctEl = _g("ep_cols_pct_row");
  if (pctEl) {
    pctEl.style.display             = "grid";
    pctEl.style.gridTemplateColumns = `repeat(${n},1fr)`;
    pctEl.innerHTML = _colsActivas.map(id => {
      const pct = _colsPct[id] || "";
      return `<div style="border-right:1px solid var(--brd);padding:5px 6px;
        display:flex;align-items:center;gap:2px">
        <input type="number" class="ep-col-pct-inp" data-col-id="${id}"
          value="${pct}" min="1" max="100" placeholder="%"
          title="% de anchura (vacío = automático)"
          style="width:100%;font-size:11px;padding:3px 4px;text-align:center;
                 border:1.5px solid var(--brd);border-radius:5px;background:var(--bg2);
                 color:var(--t1);outline:none"/>
        <span style="font-size:10px;color:var(--t4);flex-shrink:0">%</span>
      </div>`;
    }).join("");
  }

  // Fila de botones eliminar
  const delEl = _g("ep_cols_del_row");
  if (delEl) {
    delEl.style.display             = "grid";
    delEl.style.gridTemplateColumns = `repeat(${n},1fr)`;
    delEl.innerHTML = _colsActivas.map(id => {
      const col = COLUMNAS_CATALOGO.find(c=>c.id===id) || {obligatoria:false};
      return `<div style="display:flex;justify-content:center;align-items:center;
        border-right:1px solid var(--brd);padding:5px 2px">
        ${col.obligatoria
          ? `<span style="font-size:10px;color:var(--t4)">—</span>`
          : `<button type="button" class="ep-col-del" data-col-id="${id}"
              title="Quitar columna"
              style="background:none;border:1.5px solid #fecaca;color:#dc2626;
                     border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;
                     font-weight:600;display:flex;align-items:center;gap:3px;transition:all .15s">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Quitar
            </button>`}
      </div>`;
    }).join("");
  }
}

/* ══════════════════════════════════════════════════════
   PREVIEW EN TIEMPO REAL
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
  const concepto   = _gv("ep_concepto","") || "Concepto del documento";
  const notas      = _gv("ep_notas","");
  const desc       = _gv("ep_descripcion","");
  const pie        = _gv("ep_pie","");
  const mostLogo   = _gc("ep_mostrar_logo",   true);
  const mostCab    = _gc("ep_mostrar_cab",    true);
  const mostPie    = _gc("ep_mostrar_pie",    true);
  const mostEmisor = _gc("ep_mostrar_emisor", true);
  const alin       = _gv("ep_alin_val","izq");
  const alinCSS    = alin==="centro"?"center":alin==="der"?"right":"left";
  const logoX    = _gi("ep_logo_x",    0);
  const logoY    = _gi("ep_logo_y",    6);
  const logoSize = _gi("ep_logo_size", 30);
  const emisorX  = _gi("ep_emisor_x",  0);
  const emisorY  = _gi("ep_emisor_y",  0);
  const clienteX = _gi("ep_cliente_x", 0);
  const clienteY = _gi("ep_cliente_y", 0);

  /* ── Documento ── */
  const doc = _g("ep_pv_doc");
  if (doc) {
    doc.style.fontFamily = FONT_MAP[fuente] || FONT_MAP["Helvetica"];
    doc.style.background = colorFdo;
    doc.style.color      = colorLetra;
    doc.style.fontSize   = (tamF + 2) + "px";
    doc.style.textAlign  = alinCSS;
  }

  /* ── Logo ── */
  const hasLogo = mostLogo && !!_epLogo;
  const logoRow = _g("ep_pv_logo_row");
  const logoImg = _g("ep_pv_logo_img");
  if (logoRow) {
    if (hasLogo) {
      logoRow.style.display = "block";
      logoRow.style.right   = Math.max(4, Math.min(260, logoX)) + "px";
      logoRow.style.top     = Math.max(0, Math.min(50,  logoY)) + "px";
    } else {
      logoRow.style.display = "none";
    }
  }
  if (logoImg) {
    if (hasLogo) {
      logoImg.src             = _epLogo;
      logoImg.style.maxHeight = logoSize + "px";
      logoImg.style.maxWidth  = (logoSize * 3) + "px";
      logoImg.style.display   = "block";
    } else {
      logoImg.style.display = "none";
    }
  }

  /* ── Cabecera ── */
  const cab = _g("ep_pv_cab");
  if (cab) {
    if (!mostCab || estCab === "sin") {
      cab.style.display = "none";
    } else {
      cab.style.display      = "";
      cab.style.paddingRight = hasLogo ? Math.max(logoSize * 2.5 + 16, 60) + "px" : "18px";
      if (estCab === "solido")    { cab.style.background = colorCab; cab.style.borderBottom = "none"; }
      if (estCab === "gradiente") { cab.style.background = `linear-gradient(135deg,${colorCab},${colorAcc})`; cab.style.borderBottom = "none"; }
      if (estCab === "linea")     { cab.style.background = colorFdo;  cab.style.borderBottom = `3px solid ${colorCab}`; }
    }
  }
  const pvC = _g("ep_pv_concepto"), pvT = _g("ep_pv_tipo");
  const txtColor = estCab === "linea" ? colorLetra : colorTxtC;
  if (pvC) { pvC.textContent = concepto; pvC.style.color = txtColor; }
  if (pvT) { pvT.textContent = L.tipo;   pvT.style.color = txtColor; }
  const feEl = _g("ep_pv_fecha");
  if (feEl) { feEl.style.color = txtColor; if (!feEl.textContent) feEl.textContent = new Date().toLocaleDateString("es-ES"); }

  /* ── Emisor / Cliente ── */
  const er = _g("ep_pv_emisor_row");
  if (er) er.style.display = mostEmisor ? "grid" : "none";
  const eb = _g("ep_pv_emisor_bloque");
  if (eb) eb.style.transform = `translate(${Math.max(-60,Math.min(60,emisorX))}px,${Math.max(-20,Math.min(20,emisorY))}px)`;
  const cb = _g("ep_pv_cliente_bloque");
  if (cb) cb.style.transform = `translate(${Math.max(-60,Math.min(60,clienteX))}px,${Math.max(-20,Math.min(20,clienteY))}px)`;
  const st = (id,v) => { const e=_g(id); if(e) e.textContent=v; };
  st("ep_pv_lbl_de", L.de); st("ep_pv_lbl_para", L.para);

  /* ── Tabla: cabecera dinámica según _colsActivas ──
     Construimos grid-template-columns respetando los % configurados.
     Columnas sin % asignado usan "1fr"; descripcion usa "2fr" por defecto.
  ── */
  const gridStr = _colsActivas.map(id => {
    const pct = _colsPct[id];
    if (pct && parseInt(pct) > 0) return `${pct}fr`;
    return id === "descripcion" ? "2.5fr" : "1fr";
  }).join(" ");

  const th = _g("ep_pv_tabla_head");
  if (th) {
    th.style.background          = colorAcc;
    th.style.gridTemplateColumns = gridStr;
    th.innerHTML = _colsActivas.map(id => {
      const col = COLUMNAS_CATALOGO.find(c=>c.id===id) || {label:id};
      const lbl = _epIdioma==="en" ? (col.labelEn||col.label) : col.label;
      const right = id !== "descripcion";
      return `<span style="padding:6px 4px;text-align:${right?"right":"left"};font-size:9px;
        font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#fff;
        border-right:1px solid rgba(255,255,255,.15)">${lbl}</span>`;
    }).join("");
  }

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
        const bg  = ri % 2 === 0 ? colorFdoT : "#fff";
        const tot = l.c * l.p;
        const sub = l.c * l.p;
        return `<div style="display:grid;grid-template-columns:${gridStr};
          padding:5px 0;background:${bg};border-bottom:1px solid ${colorLin}">
          ${_colsActivas.map(id => {
            let v = "", fw = "400";
            const right = id !== "descripcion";
            if (id==="descripcion")  { v=l.d; }
            else if (id==="cantidad")    { v=String(l.c); }
            else if (id==="precio")      { v=l.p.toFixed(2)+"€"; }
            else if (id==="subtotal")    { v=sub.toFixed(2)+"€"; }
            else if (id==="descuento")   { v="0.00€"; }
            else if (id==="codigo")      { v="—"; }
            else if (id==="coeficiente") { v="1.00"; }
            else if (id==="total")       { v=tot.toFixed(2)+"€"; fw="700"; }
            return `<span style="font-size:${tamF+1}px;text-align:${right?"right":"left"};
              padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              font-weight:${fw};${fw==="700"?"font-family:monospace;":""}">${v}</span>`;
          }).join("")}
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

  const dw=_g("ep_pv_desc_wrap"), dd=_g("ep_pv_desc");
  if(dw&&dd){ dw.style.display=desc?"":"none"; dd.textContent=desc; }
  const pvN=_g("ep_pv_notas");
  if(pvN){ pvN.textContent=notas; pvN.style.display=notas?"":"none"; }
  const pvP=_g("ep_pv_pie"), pvPT=_g("ep_pv_pie_txt");
  if(pvP)  pvP.style.display  = mostPie?"flex":"none";
  if(pvPT) pvPT.textContent   = pie || "Texto legal del pie";
  const fp=_g("ep_font_preview");
  if(fp){ fp.style.fontFamily=FONT_MAP[fuente]||FONT_MAP["Helvetica"]; fp.style.fontSize=(tamF+3)+"px"; }
}

window._epRunPreview = _runPreview;
window._epPreview    = _runPreview;

/* ══════════════════════════════════════════════════════
   GLOBALS TABS / IDIOMA / ALINEACIÓN
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
  if (tab === "columnas") _renderColsPanel();
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
    const btn = _g("ep_lang_"+l); if(!btn) return;
    const on  = l === lang;
    btn.style.borderColor = on?"#f97316":"var(--brd)";
    btn.style.color       = on?"#f97316":"var(--t2)";
    btn.style.fontWeight  = on?"700":"500";
    btn.style.background  = "var(--bg2)";
    btn.style.boxShadow   = on?"0 0 0 2px #f9731622":"none";
  });
  _renderColsPanel();
  _runPreview();
};

/* ══════════════════════════════════════════════════════
   _epInit — inicializa el editor completo
══════════════════════════════════════════════════════ */
window._epInit = function() {
  const prefill = _epCurrentPrefill || {};
  const isEdit  = !!prefill.id;

  _epAC?.abort();
  _epAC = new AbortController();
  const sig = _epAC.signal;

  const lineas = prefill.lineas
    ? (typeof prefill.lineas==="string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{descripcion:"",cantidad:1,precio:0,iva:21}];

  _epLogo   = prefill.logo_b64 || "";
  _epIdioma = prefill.idioma   || "es";

  // Restaurar config de columnas
  try { _colsActivas = prefill.cols_activas ? JSON.parse(prefill.cols_activas) : [...COLS_DEFAULT]; }
  catch(e) { _colsActivas = [...COLS_DEFAULT]; }
  try { _colsPct = prefill.cols_pct ? JSON.parse(prefill.cols_pct) : {}; }
  catch(e) { _colsPct = {}; }

  /* ── Helpers ── */
  const sv = (id,v) => { const e=_g(id); if(e) e.value=v??""; };
  const sc = (id,v) => { const e=_g(id); if(e) e.checked=v!==false; };
  const ss = (id,v,def) => {
    const val=(v!==undefined&&v!==null)?v:def;
    const e=_g(id),lbl=_g(id+"_val");
    if(e)   e.value=val;
    if(lbl) lbl.textContent=val;
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
  ss("ep_margen",      prefill.margen,    18);
  ss("ep_pie_altura",  prefill.pie_altura,14);
  ss("ep_logo_x",      prefill.logo_x,    0);
  ss("ep_logo_y",      prefill.logo_y,    6);
  ss("ep_logo_size",   prefill.logo_size, 30);
  ss("ep_emisor_x",    prefill.emisor_x,  0);
  ss("ep_emisor_y",    prefill.emisor_y,  0);
  ss("ep_cliente_x",   prefill.cliente_x, 0);
  ss("ep_cliente_y",   prefill.cliente_y, 0);

  /* ── Colores ── */
  const COLS_DEF = {
    ep_color_cab:       prefill.color_cabecera  || "#1a56db",
    ep_color_txt_cab:   prefill.color_txt_cab   || "#ffffff",
    ep_color_acento:    prefill.color_acento    || "#1a56db",
    ep_color_letra:     prefill.color_letra     || "#0f172a",
    ep_color_fondo:     prefill.color_fondo     || "#ffffff",
    ep_color_fondo_tab: prefill.color_fondo_tab || "#f8fafc",
    ep_color_lineas:    prefill.color_lineas    || "#e2e8f0",
  };
  Object.entries(COLS_DEF).forEach(([id,val]) => {
    const pick=_g(id), hex=_g(id+"_hex");
    if(pick) pick.value=val;
    if(hex)  hex.value=val;
    if(pick) pick.addEventListener("input", ()=>{ if(hex) hex.value=pick.value; _runPreview(); }, {signal:sig});
    if(hex){
      const sh=()=>{ if(/^#[0-9a-f]{6}$/i.test(hex.value)){ if(pick) pick.value=hex.value; _runPreview(); } };
      hex.addEventListener("input",  sh, {signal:sig});
      hex.addEventListener("change", sh, {signal:sig});
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

  const mlLbl=_g("ep_mostrar_logo_lbl"), mlChk=_g("ep_mostrar_logo");
  if(mlLbl&&mlChk){
    const upd=()=>{
      mlLbl.style.borderColor=mlChk.checked?"var(--accent)":"var(--brd)";
      mlLbl.style.background=mlChk.checked?"rgba(26,86,219,.05)":"var(--bg2)";
    };
    upd();
    mlChk.addEventListener("change",()=>{ upd(); _runPreview(); },{signal:sig});
  }
  ["ep_mostrar_cab","ep_mostrar_pie","ep_mostrar_emisor","ep_mostrar_email","ep_mostrar_num_pag","ep_cab_todas_pags"].forEach(id=>{
    _g(id)?.addEventListener("change", _runPreview, {signal:sig});
  });

  /* ── Logo upload ── */
  const _updLogoUI=()=>{
    const prev=_g("ep_logo_prev"), btn=_g("ep_logo_btn"), rm=_g("ep_logo_rm");
    if(prev) prev.innerHTML=_epLogo
      ? `<img src="${_epLogo}" style="max-width:96px;max-height:60px;object-fit:contain"/>`
      : `<span style="font-size:11px;color:var(--t4);text-align:center;line-height:1.4">Click para<br>subir logo</span>`;
    if(btn) btn.textContent=_epLogo?"📁 Cambiar logo":"📁 Subir logo";
    if(rm)  rm.style.display=_epLogo?"":"none";
  };
  _updLogoUI();
  _g("ep_logo_btn")?.addEventListener("click",()=>_g("ep_logo_inp")?.click(),{signal:sig});
  const logInp=_g("ep_logo_inp");
  if(logInp){
    logInp.value="";
    logInp.addEventListener("change",e=>{
      const f=e.target.files[0]; if(!f) return;
      if(f.size>500*1024){ toast("Logo máx. 500KB","error"); return; }
      const r=new FileReader();
      r.onload=ev=>{ _epLogo=ev.target.result; _updLogoUI(); _runPreview(); };
      r.readAsDataURL(f);
    },{signal:sig});
  }
  _g("ep_logo_rm")?.addEventListener("click",()=>{ _epLogo=""; _updLogoUI(); _runPreview(); },{signal:sig});

  /* ── Fecha preview ── */
  const feEl=_g("ep_pv_fecha");
  if(feEl) feEl.textContent=new Date().toLocaleDateString("es-ES");

  /* ── Líneas predefinidas ── */
  const _lineaHTML=(l={})=>`
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
    cont.addEventListener("click",e=>{
      if(e.target.closest(".ep-del-linea")){ e.target.closest(".linea-row")?.remove(); _runPreview(); }
    },{signal:sig});
    cont.addEventListener("input",  _runPreview, {signal:sig});
    cont.addEventListener("change", _runPreview, {signal:sig});
  }
  _g("ep_addLinea")?.addEventListener("click",()=>{ cont?.insertAdjacentHTML("beforeend",_lineaHTML({})); _runPreview(); },{signal:sig});

  /* ── Sliders ── */
  ["ep_margen","ep_pie_altura","ep_logo_x","ep_logo_y","ep_logo_size",
   "ep_emisor_x","ep_emisor_y","ep_cliente_x","ep_cliente_y"].forEach(id=>{
    const el=_g(id), lbl=_g(id+"_val");
    if(el) el.addEventListener("input",()=>{ if(lbl) lbl.textContent=el.value; _runPreview(); },{signal:sig});
  });

  /* ── Inputs genéricos ── */
  document.querySelectorAll(
    "#plt-editor input:not([type=file]):not([type=hidden]):not([type=color]):not([type=range]):not([type=checkbox])," +
    "#plt-editor select, #plt-editor textarea"
  ).forEach(el=>{
    el.addEventListener("input",  _runPreview, {signal:sig});
    el.addEventListener("change", _runPreview, {signal:sig});
  });

  /* ── Tab Columnas: eventos delegados con signal ── */

  // Añadir columna (panel izq → panel der)
  _g("ep_cols_noañadidas")?.addEventListener("click",e=>{
    const btn=e.target.closest(".ep-col-add"); if(!btn) return;
    const id=btn.dataset.colId;
    if(!_colsActivas.includes(id)){
      _colsActivas.push(id);
      _renderColsPanel();
      _runPreview();
    }
  },{signal:sig});

  // Quitar columna (panel der)
  _g("ep_cols_del_row")?.addEventListener("click",e=>{
    const btn=e.target.closest(".ep-col-del"); if(!btn) return;
    const id=btn.dataset.colId;
    _colsActivas=_colsActivas.filter(c=>c!==id);
    delete _colsPct[id];
    _renderColsPanel();
    _runPreview();
  },{signal:sig});

  // Cambiar % anchura
  _g("ep_cols_pct_row")?.addEventListener("input",e=>{
    const inp=e.target; if(!inp.classList.contains("ep-col-pct-inp")) return;
    const id=inp.dataset.colId;
    const v=parseInt(inp.value);
    if(v>0 && v<=100) _colsPct[id]=String(v);
    else delete _colsPct[id];
    _runPreview();
  },{signal:sig});

  /* ── Estado inicial ── */
  window._epTab("diseno");
  window._epLang(_epIdioma);
  window._epSetAlin(prefill.alin_texto||"izq");
  _renderColsPanel();
  _runPreview();

  /* ── Botón eliminar ── */
  const delBtn=_g("epEliminarBtnBottom");
  if(delBtn){
    delBtn.style.display=isEdit?"":"none";
    if(isEdit) delBtn.addEventListener("click",()=>{
      openModal(`<div class="modal" style="max-width:380px">
        <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span>
          <button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div>
        <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button></div>
      </div>`);
      _g("_dpltOk")?.addEventListener("click",async()=>{
        await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
        closeModal(); toast("Plantilla eliminada","success");
        _hideEditor(); await refreshPlantillas();
      });
    },{signal:sig});
  }

  /* ── Guardar ── */
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
      logo_b64:        _epLogo||null,
      logo_x:          gi("ep_logo_x",0),
      logo_y:          gi("ep_logo_y",6),
      logo_size:       gi("ep_logo_size",30),
      sp_cab:          gi("ep_margen",12),
      sp_emisor:5, sp_entre_bloques:0, sp_tabla:6, sp_pie:5,
      emisor_x:        gi("ep_emisor_x",0),
      emisor_y:        gi("ep_emisor_y",0),
      cliente_x:       gi("ep_cliente_x",0),
      cliente_y:       gi("ep_cliente_y",0),
      // Config columnas
      cols_activas:    JSON.stringify(_colsActivas),
      cols_pct:        JSON.stringify(_colsPct),
    };

    const saveBtn=_g("epGuardarBtnBottom");
    if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent="Guardando…"; }

    let err, savedData;
    if(isEdit){
      const res=await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id).select().single();
      err=res.error; savedData=res.data;
    }else{
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
    }else if(isEdit){
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
  prefill=prefill||{};
  _epCurrentPrefill=prefill;
  if(typeof window._switchView==="function"){
    const el=document.getElementById("view-plantillas");
    if(el&&!el.classList.contains("active")) window._switchView("plantillas");
  }
  setTimeout(()=>{
    _showEditor();
    window._epInit();
    if(prefill.id) _highlightSidebarCard(prefill.id);
  },30);
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
    logo_b64:        p.logo_b64,
    cols_activas:    p.cols_activas,
    cols_pct:        p.cols_pct,
  };
}

export function renderPlantillaSelector(containerId,onSelect){
  const container=document.getElementById(containerId);
  if(!container||!PLANTILLAS.length) return;
  container.innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;
      background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
      <span style="font-size:11px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
      ${PLANTILLAS.map(p=>`<button class="btn-outline plt-selector-btn" data-plt-id="${p.id}"
        style="font-size:12px;padding:4px 12px">${p.nombre}</button>`).join("")}
      <button class="btn-outline plt-selector-btn" data-plt-id=""
        style="font-size:12px;padding:4px 12px;color:var(--t4)">✕ En blanco</button>
    </div>`;
  container.querySelectorAll(".plt-selector-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      container.querySelectorAll(".plt-selector-btn").forEach(b=>{
        b.style.background="";b.style.color="";b.style.borderColor="";
      });
      if(btn.dataset.pltId){ btn.style.background="var(--accent)";btn.style.color="#fff";btn.style.borderColor="var(--accent)"; }
      if(onSelect) onSelect(btn.dataset.pltId?getPlantillaData(btn.dataset.pltId):null);
    });
  });
}
export const renderSelectorPlantillas=renderPlantillaSelector;

/* ══════════════════════════════════════════════════════
   WINDOW GLOBALS
══════════════════════════════════════════════════════ */
window._nuevaPlantilla = ()=>showPlantillaModal();
window._editPlantilla  = id=>{const p=PLANTILLAS.find(x=>x.id===id);if(p)showPlantillaModal(p);};
window._delPlantilla   = id=>{
  openModal(`<div class="modal" style="max-width:380px">
    <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span>
      <button class="modal-x" onclick="window._cm()">×</button></div>
    <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div>
    <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
      <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button></div>
  </div>`);
  _g("_dpltOk")?.addEventListener("click",async()=>{
    await supabase.from("plantillas_usuario").delete().eq("id",id);
    closeModal();toast("Plantilla eliminada","success");
    if(_epCurrentPrefill?.id===id)_hideEditor();
    await refreshPlantillas();
  });
};
window._usarPlantillaFactura=id=>{
  const data=getPlantillaData(id);if(!data)return;
  window._switchView?.("nueva-factura");
  setTimeout(()=>window._applyPlantillaToFactura?.(data),200);
};
window._usarPlantillaPres=id=>{
  const data=getPlantillaData(id);if(!data)return;
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
        setTimeout(()=>{_showEditor();window._epInit();},60);
        return;
      }
      return _orig(view,...args);
    };
    window._switchView._patchedForPlantillas=true;
  }
  refreshPlantillas();
}

export {showPlantillaModal as showPlantillaView};
