/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js  — v2 INTEGRADO
   ─ Editor completo inline en view-plantillas
   ─ Sidebar con lista · Formulario tabbed · Preview en vivo
   ─ Diseño, logo, fuentes, colores, márgenes, visibilidad
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
   CONSTANTES DE MÓDULO
══════════════════════════════════════════════════════ */
let _epLogo           = "";
let _epIdioma         = "es";
let _epCurrentPrefill = null;

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
  "Helvetica":      "Helvetica,Arial,sans-serif",
  "Arial":          "Arial,sans-serif",
  "Courier New":    "'Courier New',monospace",
  "Times New Roman":"'Times New Roman',Times,serif",
  "Georgia":        "Georgia,serif",
  "Trebuchet MS":   "'Trebuchet MS',sans-serif",
  "Verdana":        "Verdana,sans-serif",
  "Garamond":       "Garamond,serif"
};
const ACCENT_COLS = [
  "#3b82f6","#f97316","#059669","#8b5cf6",
  "#ef4444","#0ea5e9","#ec4899","#14b8a6"
];

/* ══════════════════════════════════════════════════════
   SIDEBAR: renderiza la lista lateral de plantillas
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
      const emptyState = document.getElementById("plt-empty-state");
      if (emptyState) emptyState.style.display = "";
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
    const isActive = card.dataset.pltId === id;
    card.style.background = isActive ? "rgba(26,86,219,.06)" : "var(--srf)";
    if (isActive) {
      card.style.outline = "2px solid var(--accent)";
      card.style.outlineOffset = "0px";
    } else {
      card.style.outline = "none";
    }
  });
}

/* ══════════════════════════════════════════════════════
   MOSTRAR / OCULTAR EDITOR
══════════════════════════════════════════════════════ */
function _showEditor() {
  const emptyState = document.getElementById("plt-empty-state");
  const editor     = document.getElementById("plt-editor");
  if (emptyState) emptyState.style.display = "none";
  if (editor)     editor.style.display     = "";
}

function _hideEditor() {
  const emptyState = document.getElementById("plt-empty-state");
  const editor     = document.getElementById("plt-editor");
  if (editor)     editor.style.display     = "none";
  if (emptyState) emptyState.style.display = "";
  document.querySelectorAll(".plt-sidebar-card").forEach(c => {
    c.style.background = "var(--srf)";
    c.style.outline    = "none";
  });
  _epCurrentPrefill = null;
}

/* ══════════════════════════════════════════════════════
   GLOBALS: _epTab / _epSetAlin / _epLang
   (llamados desde onclick en el HTML)
══════════════════════════════════════════════════════ */
window._epTab = function(tab) {
  document.querySelectorAll(".ep-tab").forEach(function(b) {
    const on = b.dataset.tab === tab;
    b.style.borderBottom = on ? "3px solid var(--accent)" : "3px solid transparent";
    b.style.color        = on ? "var(--accent)"           : "var(--t3)";
    b.style.background   = on ? "var(--bg)"               : "transparent";
    b.style.fontWeight   = on ? "700"                     : "600";
  });
  document.querySelectorAll(".ep-sec").forEach(function(s) {
    s.style.display = (s.id === "ep-tab-" + tab) ? "" : "none";
  });
};

window._epSetAlin = function(v) {
  const inp = document.getElementById("ep_alin_val");
  if (inp) inp.value = v;
  document.querySelectorAll("#ep_alin_group button").forEach(function(b) {
    const on = b.dataset.alin === v;
    b.style.borderColor = on ? "#f97316"         : "var(--brd)";
    b.style.color       = on ? "#f97316"         : "var(--t2)";
    b.style.fontWeight  = on ? "700"             : "500";
    b.style.boxShadow   = on ? "0 0 0 2px #f9731622" : "none";
  });
  window._epRunPreview?.();
};

window._epLang = function(lang) {
  _epIdioma = lang;
  ["es","en"].forEach(function(l) {
    const btn = document.getElementById("ep_lang_" + l);
    if (!btn) return;
    const on = l === lang;
    btn.style.borderColor = on ? "#f97316"         : "var(--brd)";
    btn.style.color       = on ? "#f97316"         : "var(--t2)";
    btn.style.fontWeight  = on ? "700"             : "500";
    btn.style.background  = "var(--bg2)";
    btn.style.boxShadow   = on ? "0 0 0 2px #f9731622" : "none";
  });
  window._epRunPreview?.();
};

/* ══════════════════════════════════════════════════════
   _epInit — inicializa el formulario con datos del prefill
══════════════════════════════════════════════════════ */
window._epInit = function() {
  const prefill = _epCurrentPrefill || {};
  const isEdit  = !!prefill.id;

  const lineas = prefill.lineas
    ? (typeof prefill.lineas === "string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{ descripcion:"", cantidad:1, precio:0, iva:21 }];

  _epLogo   = prefill.logo_b64 || "";
  _epIdioma = prefill.idioma   || "es";

  // Helpers de llenado
  const sv  = (id, v)    => { const el=document.getElementById(id); if(el) el.value = (v ?? ""); };
  const sc  = (id, v)    => { const el=document.getElementById(id); if(el) el.checked = (v !== false); };
  const sri = (id, v, d) => {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + "_val");
    if (el)  el.value       = (v !== undefined && v !== null) ? v : (el.value || d || 0);
    if (lbl) lbl.textContent = el ? el.value : (d || 0);
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

  sri("ep_margen",     prefill.margen,    18);
  sri("ep_pie_altura", prefill.pie_altura, 14);
  sri("ep_logo_x",     prefill.logo_x,    0);
  sri("ep_logo_y",     prefill.logo_y,    6);
  sri("ep_logo_size",  prefill.logo_size, 30);
  sri("ep_emisor_x",   prefill.emisor_x,  0);
  sri("ep_emisor_y",   prefill.emisor_y,  0);
  sri("ep_cliente_x",  prefill.cliente_x, 0);
  sri("ep_cliente_y",  prefill.cliente_y, 0);

  // Colores
  const COLS = {
    ep_color_cab:       prefill.color_cabecera  || "#1a56db",
    ep_color_txt_cab:   prefill.color_txt_cab   || "#ffffff",
    ep_color_acento:    prefill.color_acento    || "#1a56db",
    ep_color_letra:     prefill.color_letra     || "#0f172a",
    ep_color_fondo:     prefill.color_fondo     || "#ffffff",
    ep_color_fondo_tab: prefill.color_fondo_tab || "#f8fafc",
    ep_color_lineas:    prefill.color_lineas    || "#e2e8f0",
  };
  Object.entries(COLS).forEach(([id, val]) => {
    const pick = document.getElementById(id);
    const hex  = document.getElementById(id + "_hex");
    if (pick) pick.value = val;
    if (hex)  hex.value  = val;
  });

  // Checkboxes
  sc("ep_mostrar_logo",    prefill.mostrar_logo);
  sc("ep_mostrar_cab",     prefill.mostrar_cab);
  sc("ep_mostrar_pie",     prefill.mostrar_pie);
  sc("ep_mostrar_emisor",  prefill.mostrar_emisor);
  sc("ep_mostrar_email",   prefill.mostrar_email);
  sc("ep_mostrar_num_pag", prefill.mostrar_num_pag);
  sc("ep_cab_todas_pags",  prefill.cab_todas_pags || false);

  // Fecha del preview
  const fechaEl = document.getElementById("ep_pv_fecha");
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString("es-ES");

  // ── Logo UI ──
  const _updateLogoUI = function() {
    const prev = document.getElementById("ep_logo_prev");
    const btn  = document.getElementById("ep_logo_btn");
    const rm   = document.getElementById("ep_logo_rm");
    if (prev) prev.innerHTML = _epLogo
      ? `<img src="${_epLogo}" style="max-width:96px;max-height:60px;object-fit:contain"/>`
      : `<span style="font-size:11px;color:var(--t4);text-align:center;line-height:1.4">Click para<br>subir logo</span>`;
    if (btn) btn.textContent = _epLogo ? "📁 Cambiar logo" : "📁 Subir logo";
    if (rm)  rm.style.display = _epLogo ? "" : "none";
  };
  _updateLogoUI();

  // Clonar input de logo para limpiar listeners previos
  const logoInp = document.getElementById("ep_logo_inp");
  const logoBtn = document.getElementById("ep_logo_btn");
  if (logoBtn) {
    const newLogoBtn = logoBtn.cloneNode(true);
    logoBtn.parentNode.replaceChild(newLogoBtn, logoBtn);
    newLogoBtn.addEventListener("click", () => document.getElementById("ep_logo_inp")?.click());
  }
  if (logoInp) {
    const newInp = logoInp.cloneNode(true);
    logoInp.parentNode.replaceChild(newInp, logoInp);
    newInp.addEventListener("change", function(e) {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 500 * 1024) { toast("Logo máx. 500KB", "error"); return; }
      const r = new FileReader();
      r.onload = ev => { _epLogo = ev.target.result; _updateLogoUI(); window._epRunPreview?.(); };
      r.readAsDataURL(f);
    });
  }
  const logoRm = document.getElementById("ep_logo_rm");
  if (logoRm) {
    const newRm = logoRm.cloneNode(true);
    logoRm.parentNode.replaceChild(newRm, logoRm);
    newRm.addEventListener("click", () => { _epLogo = ""; _updateLogoUI(); window._epRunPreview?.(); });
  }

  // Checkbox "mostrar logo" — estética
  const mostLogoLbl = document.getElementById("ep_mostrar_logo_lbl");
  const mostLogoChk = document.getElementById("ep_mostrar_logo");
  if (mostLogoLbl && mostLogoChk) {
    const _upd = () => {
      mostLogoLbl.style.borderColor = mostLogoChk.checked ? "var(--accent)" : "var(--brd)";
      mostLogoLbl.style.background  = mostLogoChk.checked ? "rgba(26,86,219,.05)" : "var(--bg2)";
    };
    _upd();
    const newChk = mostLogoChk.cloneNode(true);
    mostLogoChk.parentNode.replaceChild(newChk, mostLogoChk);
    newChk.checked = prefill.mostrar_logo !== false;
    newChk.addEventListener("change", function() { _upd(); window._epRunPreview?.(); });
  }

  // Sync color pickers ↔ hex — clonar para limpiar handlers
  Object.keys(COLS).forEach(function(id) {
    const pick = document.getElementById(id);
    const hex  = document.getElementById(id + "_hex");
    if (!pick || !hex) return;
    const np = pick.cloneNode(true);
    const nh = hex.cloneNode(true);
    pick.parentNode.replaceChild(np, pick);
    hex.parentNode.replaceChild(nh, hex);
    np.value = COLS[id];
    nh.value = COLS[id];
    np.addEventListener("input",  () => { nh.value = np.value; window._epRunPreview?.(); });
    nh.addEventListener("change", () => {
      if (/^#[0-9a-f]{6}$/i.test(nh.value)) np.value = nh.value;
      window._epRunPreview?.();
    });
  });

  // ── Líneas predefinidas ──
  const _lineaHTML = function(l) {
    l = l || {};
    return `<div class="linea-row" style="grid-template-columns:1fr 58px 96px 56px 30px">
      <input autocomplete="off" class="ff-input" data-field="descripcion"
        value="${(l.descripcion||"").replace(/"/g,"&quot;")}" placeholder="Descripción"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="cantidad"
        value="${l.cantidad||1}" min="0.01" step="0.01"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="precio"
        value="${l.precio||""}" step="0.01" placeholder="0.00"/>
      <select class="ff-select" data-field="iva">
        <option value="21" ${(l.iva||21)===21?"selected":""}>21%</option>
        <option value="10" ${l.iva===10?"selected":""}>10%</option>
        <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
        <option value="0"  ${l.iva===0 ?"selected":""}>0%</option>
      </select>
      <button class="linea-del ep-del-linea" title="Eliminar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
  };

  const cont = document.getElementById("ep_lineasContainer");
  if (cont) {
    cont.innerHTML = "";
    lineas.forEach(l => cont.insertAdjacentHTML("beforeend", _lineaHTML(l)));
    if (!lineas.length) cont.insertAdjacentHTML("beforeend", _lineaHTML({}));
  }

  // Botón añadir línea — clonar para limpiar handlers
  const addBtn = document.getElementById("ep_addLinea");
  if (addBtn) {
    const newAdd = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAdd, addBtn);
    newAdd.addEventListener("click", () => {
      cont?.insertAdjacentHTML("beforeend", _lineaHTML({}));
      window._epRunPreview?.();
    });
  }
  cont?.addEventListener("click", function(e) {
    if (e.target.closest(".ep-del-linea")) {
      e.target.closest(".linea-row")?.remove();
      window._epRunPreview?.();
    }
  });
  cont?.addEventListener("input", () => window._epRunPreview?.());

  /* ─────────────────────────────────────
     FUNCIÓN PREVIEW EN TIEMPO REAL
  ───────────────────────────────────── */
  window._epRunPreview = function() {
    const L  = _epIdioma === "en" ? LABELS_EN : LABELS_ES;
    const g  = id => document.getElementById(id);
    const gv = (id, fb) => { const el=g(id); return (el && el.value) ? el.value : fb; };
    const gc = (id, fb) => { const el=g(id); return el ? el.checked : fb; };

    const colorCab  = gv("ep_color_cab",     "#1a56db");
    const colorTxtC = gv("ep_color_txt_cab", "#ffffff");
    const colorAcc  = gv("ep_color_acento",  "#1a56db");
    const colorLetra= gv("ep_color_letra",   "#0f172a");
    const colorFdo  = gv("ep_color_fondo",   "#ffffff");
    const colorFdoT = gv("ep_color_fondo_tab","#f8fafc");
    const colorLin  = gv("ep_color_lineas",  "#e2e8f0");
    const estCab    = gv("ep_estilo_cab",    "solido");
    const fuente    = gv("ep_fuente",        "Helvetica");
    const tamF      = parseInt(gv("ep_tam_fuente","9")) || 9;
    const concepto  = gv("ep_concepto","")   || "Concepto del documento";
    const notas     = gv("ep_notas","");
    const desc      = gv("ep_descripcion","");
    const pie       = gv("ep_pie","");
    const mostLogo  = gc("ep_mostrar_logo",  true);
    const mostCab   = gc("ep_mostrar_cab",   true);
    const mostPie   = gc("ep_mostrar_pie",   true);
    const mostEmisor= gc("ep_mostrar_emisor",true);
    const logoX     = parseInt(g("ep_logo_x")?.value)    || 0;
    const logoY     = parseInt(g("ep_logo_y")?.value)    || 6;
    const logoSize  = parseInt(g("ep_logo_size")?.value) || 30;
    const emisorX   = parseInt(g("ep_emisor_x")?.value)  || 0;
    const emisorY   = parseInt(g("ep_emisor_y")?.value)  || 0;
    const clienteX  = parseInt(g("ep_cliente_x")?.value) || 0;
    const clienteY  = parseInt(g("ep_cliente_y")?.value) || 0;
    const alin      = gv("ep_alin_val","izq");
    const alinCSS   = alin==="centro"?"center":alin==="der"?"right":"left";

    // Documento
    const doc = g("ep_pv_doc");
    if (doc) {
      doc.style.fontFamily = FONT_MAP[fuente] || FONT_MAP["Helvetica"];
      doc.style.background = colorFdo;
      doc.style.color      = colorLetra;
      doc.style.fontSize   = (tamF+2)+"px";
      doc.style.textAlign  = alinCSS;
    }

    // Logo
    const lr = g("ep_pv_logo_row"), li = g("ep_pv_logo_img");
    if (lr) {
      lr.style.display        = (mostLogo && _epLogo) ? "flex" : "none";
      lr.style.padding        = logoY+"px 18px 0";
      lr.style.justifyContent = "flex-end";
    }
    if (li && _epLogo) {
      li.src = _epLogo;
      li.style.maxHeight   = logoSize+"px";
      li.style.maxWidth    = (logoSize*2.5)+"px";
      li.style.marginRight = (logoX >= 0 ? 0 : Math.abs(logoX))+"px";
      li.style.marginLeft  = (logoX > 0 ? logoX : 0)+"px";
    }

    // Cabecera
    const cab = g("ep_pv_cab");
    if (cab) {
      if (!mostCab || estCab === "sin") {
        cab.style.display = "none";
      } else {
        cab.style.display = "";
        if (estCab === "solido")    { cab.style.background = colorCab; cab.style.borderBottom = "none"; }
        if (estCab === "gradiente") { cab.style.background = `linear-gradient(135deg,${colorCab},${colorAcc})`; cab.style.borderBottom = "none"; }
        if (estCab === "linea")     { cab.style.background = "transparent"; cab.style.borderBottom = `3px solid ${colorCab}`; }
      }
    }
    const pvC = g("ep_pv_concepto"), pvT = g("ep_pv_tipo");
    if (pvC) { pvC.textContent = concepto; pvC.style.color = colorTxtC; }
    if (pvT) { pvT.textContent = L.tipo;   pvT.style.color = colorTxtC; }

    // Emisor/cliente
    const er = g("ep_pv_emisor_row");
    if (er) er.style.display = mostEmisor ? "grid" : "none";
    const eb = g("ep_pv_emisor_bloque");  if (eb) eb.style.transform = `translate(${emisorX}px,${emisorY}px)`;
    const cb = g("ep_pv_cliente_bloque"); if (cb) cb.style.transform = `translate(${clienteX}px,${clienteY}px)`;
    const st = (id, v) => { const el=g(id); if(el) el.textContent=v; };
    st("ep_pv_lbl_de",   L.de);
    st("ep_pv_lbl_para", L.para);

    // Tabla
    const th = g("ep_pv_tabla_head"); if (th) th.style.background = colorAcc;
    st("ep_pv_h_desc",  _epIdioma==="en"?"Description":"Descripción");
    st("ep_pv_h_cant",  L.cant);
    st("ep_pv_h_precio",L.precio);
    st("ep_pv_h_iva",   L.iva);
    st("ep_pv_h_total", L.total);

    // Líneas
    const rows = document.querySelectorAll("#ep_lineasContainer .linea-row");
    const larr = [...rows].map(r => ({
      d: r.querySelector("[data-field='descripcion']")?.value || "",
      c: parseFloat(r.querySelector("[data-field='cantidad']")?.value)  || 1,
      p: parseFloat(r.querySelector("[data-field='precio']")?.value)    || 0,
      i: parseInt(r.querySelector("[data-field='iva']")?.value)         || 21,
    })).filter(l => l.d || l.p > 0);

    const pvLin = g("ep_pv_lineas");
    if (pvLin) {
      if (!larr.length) {
        pvLin.innerHTML = `<div style="padding:12px 0;font-size:10px;color:#9ca3af;text-align:center">Sin líneas definidas</div>`;
      } else {
        pvLin.innerHTML = larr.map((l, ri) => {
          const tot = l.c * l.p;
          const bg  = ri % 2 === 0 ? colorFdoT : "#fff";
          return `<div style="display:grid;grid-template-columns:1fr 40px 70px 40px 70px;
            padding:7px 0;background:${bg};border-bottom:1px solid ${colorLin};font-size:${tamF+2}px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left">${l.d}</span>
            <span style="text-align:right">${l.c}</span>
            <span style="text-align:right">${l.p.toFixed(2)}€</span>
            <span style="text-align:right">${l.i}%</span>
            <span style="text-align:right;font-weight:700;font-family:monospace">${tot.toFixed(2)}€</span>
          </div>`;
        }).join("");
      }
    }

    // Totales
    const base = larr.reduce((a,l) => a+l.c*l.p, 0);
    const iva  = larr.reduce((a,l) => a+l.c*l.p*l.i/100, 0);
    const pvTot = g("ep_pv_totales");
    if (pvTot) pvTot.innerHTML = `
      <table style="margin-left:auto;border-collapse:collapse;font-size:10px;min-width:160px">
        <tr>
          <td style="color:#6b7280;padding:2px 12px 2px 0">${L.base}</td>
          <td style="text-align:right;font-family:monospace;color:#374151">${base.toFixed(2)} €</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:2px 12px 2px 0">IVA</td>
          <td style="text-align:right;font-family:monospace;color:#374151">${iva.toFixed(2)} €</td>
        </tr>
        <tr style="border-top:2px solid ${colorAcc}">
          <td style="font-weight:800;color:#111;padding:4px 12px 2px 0">${L.totalDoc}</td>
          <td style="text-align:right;font-family:monospace;font-weight:800;color:${colorAcc}">${(base+iva).toFixed(2)} €</td>
        </tr>
      </table>`;

    // Descripción
    const dw = g("ep_pv_desc_wrap"), dd = g("ep_pv_desc");
    if (dw && dd) { dw.style.display = desc ? "" : "none"; dd.textContent = desc; }

    // Notas
    const pvN = g("ep_pv_notas");
    if (pvN) { pvN.textContent = notas; pvN.style.display = notas ? "" : "none"; }

    // Pie
    const pvP = g("ep_pv_pie"), pvPT = g("ep_pv_pie_txt");
    if (pvP)  pvP.style.display = mostPie ? "flex" : "none";
    if (pvPT) pvPT.textContent  = pie || "Texto legal del pie";

    // Font preview
    const fp = g("ep_font_preview");
    if (fp) { fp.style.fontFamily = FONT_MAP[fuente]; fp.style.fontSize = (tamF+3)+"px"; }
  };

  // Alias compatibilidad
  window._epPreview = window._epRunPreview;

  // Activar tab, idioma, alineación
  window._epTab("diseno");
  window._epLang(_epIdioma);
  window._epSetAlin(prefill.alin_texto || "izq");

  // Conectar inputs al preview
  document.querySelectorAll(
    "#plt-editor input:not([type=file]):not([type=hidden]), #plt-editor select, #plt-editor textarea"
  ).forEach(function(el) {
    if (el.id === "ep_mostrar_logo") return;
    el.addEventListener("input",  () => window._epRunPreview?.());
    el.addEventListener("change", () => window._epRunPreview?.());
  });

  // Preview inicial
  window._epRunPreview();

  /* ── Botón eliminar ── */
  const delBtnOrig = document.getElementById("epEliminarBtnBottom");
  if (delBtnOrig) {
    const newDel = delBtnOrig.cloneNode(true);
    delBtnOrig.parentNode.replaceChild(newDel, delBtnOrig);
    newDel.style.display = isEdit ? "" : "none";
    if (isEdit) {
      newDel.addEventListener("click", function() {
        openModal(`<div class="modal" style="max-width:380px">
          <div class="modal-hd">
            <span class="modal-title">Eliminar plantilla</span>
            <button class="modal-x" onclick="window._cm()">×</button>
          </div>
          <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div>
          <div class="modal-ft">
            <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
            <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button>
          </div>
        </div>`);
        document.getElementById("_dpltOk")?.addEventListener("click", async () => {
          await supabase.from("plantillas_usuario").delete().eq("id", prefill.id);
          closeModal();
          toast("Plantilla eliminada", "success");
          _hideEditor();
          await refreshPlantillas();
        });
      });
    }
  }

  /* ── Función guardar ── */
  async function _epGuardar() {
    const nombre = document.getElementById("ep_nombre")?.value.trim();
    if (!nombre) {
      window._epTab("diseno");
      toast("El nombre es obligatorio", "error");
      return;
    }

    const rows = document.querySelectorAll("#ep_lineasContainer .linea-row");
    const lineasArr = [...rows].map(r => ({
      descripcion: r.querySelector("[data-field='descripcion']")?.value || "",
      cantidad:    parseFloat(r.querySelector("[data-field='cantidad']")?.value) || 1,
      precio:      parseFloat(r.querySelector("[data-field='precio']")?.value)   || 0,
      iva:         parseInt(r.querySelector("[data-field='iva']")?.value)        || 21,
    })).filter(l => l.descripcion || l.precio > 0);

    const gv = id => document.getElementById(id)?.value?.trim() || null;
    const gb = id => document.getElementById(id)?.checked || false;
    const gi = (id, d) => parseInt(document.getElementById(id)?.value) || d;

    const payload = {
      user_id:         SESSION.user.id,
      nombre,
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
      tam_fuente:      gi("ep_tam_fuente", 9),
      tamano_hoja:     gv("ep_tamano_hoja")     || "A4",
      margen:          gi("ep_margen",    18),
      pie_altura:      gi("ep_pie_altura", 14),
      alin_texto:      document.getElementById("ep_alin_val")?.value || "izq",
      estilo_cab:      gv("ep_estilo_cab")      || "solido",
      mostrar_logo:    gb("ep_mostrar_logo"),
      mostrar_cab:     gb("ep_mostrar_cab"),
      mostrar_pie:     gb("ep_mostrar_pie"),
      mostrar_emisor:  gb("ep_mostrar_emisor"),
      mostrar_email:   gb("ep_mostrar_email"),
      mostrar_num_pag: gb("ep_mostrar_num_pag"),
      cab_todas_pags:  gb("ep_cab_todas_pags"),
      logo_b64:        _epLogo || null,
      logo_x:          gi("ep_logo_x",    0),
      logo_y:          gi("ep_logo_y",    6),
      logo_size:       gi("ep_logo_size", 30),
      sp_cab:          gi("ep_margen",   12),
      sp_emisor:       5, sp_entre_bloques:0, sp_tabla:6, sp_pie:5,
      emisor_x:        gi("ep_emisor_x", 0),
      emisor_y:        gi("ep_emisor_y", 0),
      cliente_x:       gi("ep_cliente_x",0),
      cliente_y:       gi("ep_cliente_y",0),
    };

    // Deshabilitar mientras guarda
    const saveBtnEl = document.getElementById("epGuardarBtnBottom");
    if (saveBtnEl) { saveBtnEl.disabled = true; saveBtnEl.textContent = "Guardando…"; }

    let err, savedData;
    if (isEdit) {
      const res = await supabase.from("plantillas_usuario").update(payload).eq("id", prefill.id).select().single();
      err = res.error; savedData = res.data;
    } else {
      const res = await supabase.from("plantillas_usuario").insert(payload).select().single();
      err = res.error; savedData = res.data;
    }

    if (saveBtnEl) {
      saveBtnEl.disabled = false;
      saveBtnEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
      </svg> Guardar plantilla`;
    }

    if (err) { toast("Error: " + err.message, "error"); return; }

    toast(isEdit ? "Plantilla actualizada ✅" : "Plantilla creada ✅", "success");
    await refreshPlantillas();

    // Si era nueva, pasar a modo edición
    if (!isEdit && savedData) {
      _epCurrentPrefill = savedData;
      window._epInit();
      _highlightSidebarCard(savedData.id);
    } else if (isEdit) {
      _highlightSidebarCard(prefill.id);
    }
  }

  // Conectar botón guardar (clonar para evitar duplicados)
  const saveBtnOrig = document.getElementById("epGuardarBtnBottom");
  if (saveBtnOrig) {
    const newSave = saveBtnOrig.cloneNode(true);
    saveBtnOrig.parentNode.replaceChild(newSave, saveBtnOrig);
    newSave.addEventListener("click", _epGuardar);
  }

  // Botón cancelar
  const cancelBtnOrig = document.getElementById("epCancelarBtnBottom");
  if (cancelBtnOrig) {
    const newCancel = cancelBtnOrig.cloneNode(true);
    cancelBtnOrig.parentNode.replaceChild(newCancel, cancelBtnOrig);
    newCancel.addEventListener("click", () => _hideEditor());
  }
};

/* ══════════════════════════════════════════════════════
   showPlantillaModal — punto de entrada principal
══════════════════════════════════════════════════════ */
export function showPlantillaModal(prefill) {
  prefill = prefill || {};
  _epCurrentPrefill = prefill;

  // Asegurar que estamos en la vista de plantillas
  if (typeof window._switchView === "function") {
    // Llamar directamente sin interceptar (evitamos loop)
    const el = document.getElementById("view-plantillas");
    if (el && !el.classList.contains("active")) {
      window._switchView("plantillas");
    }
  }

  setTimeout(function() {
    _showEditor();
    window._epInit();
    if (prefill.id) _highlightSidebarCard(prefill.id);
  }, 30);
}

/* ══════════════════════════════════════════════════════
   DATOS PARA OTROS MÓDULOS
══════════════════════════════════════════════════════ */
export function getPlantillaData(plantillaId) {
  const p = PLANTILLAS.find(x => x.id === plantillaId);
  if (!p) return null;
  return {
    concepto:        p.concepto,
    descripcion:     p.descripcion,
    notas:           p.notas,
    lineas:          p.lineas ? JSON.parse(p.lineas) : [],
    color_principal: p.color_cabecera || p.color_principal,
    texto_pie:       p.texto_pie,
    iban_visible:    p.iban_visible,
    logo_b64:        p.logo_b64
  };
}

export function renderPlantillaSelector(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container || !PLANTILLAS.length) return;
  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;
      background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
      <span style="font-size:11px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
      ${PLANTILLAS.map(p => `
        <button class="btn-outline plt-selector-btn" data-plt-id="${p.id}"
          style="font-size:12px;padding:4px 12px">${p.nombre}</button>`).join("")}
      <button class="btn-outline plt-selector-btn" data-plt-id=""
        style="font-size:12px;padding:4px 12px;color:var(--t4)">✕ En blanco</button>
    </div>`;
  container.querySelectorAll(".plt-selector-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".plt-selector-btn").forEach(b => {
        b.style.background = ""; b.style.color = ""; b.style.borderColor = "";
      });
      if (btn.dataset.pltId) {
        btn.style.background  = "var(--accent)";
        btn.style.color       = "#fff";
        btn.style.borderColor = "var(--accent)";
      }
      if (onSelect) onSelect(btn.dataset.pltId ? getPlantillaData(btn.dataset.pltId) : null);
    });
  });
}

export const renderSelectorPlantillas = renderPlantillaSelector;

/* ══════════════════════════════════════════════════════
   WINDOW GLOBALS
══════════════════════════════════════════════════════ */
window._nuevaPlantilla = () => showPlantillaModal();

window._editPlantilla = id => {
  const p = PLANTILLAS.find(x => x.id === id);
  if (p) showPlantillaModal(p);
};

window._delPlantilla = id => {
  openModal(`<div class="modal" style="max-width:380px">
    <div class="modal-hd">
      <span class="modal-title">Eliminar plantilla</span>
      <button class="modal-x" onclick="window._cm()">×</button>
    </div>
    <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div>
    <div class="modal-ft">
      <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
      <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button>
    </div>
  </div>`);
  document.getElementById("_dpltOk")?.addEventListener("click", async () => {
    await supabase.from("plantillas_usuario").delete().eq("id", id);
    closeModal();
    toast("Plantilla eliminada", "success");
    if (_epCurrentPrefill?.id === id) _hideEditor();
    await refreshPlantillas();
  });
};

window._usarPlantillaFactura = id => {
  const data = getPlantillaData(id);
  if (!data) return;
  window._switchView?.("nueva-factura");
  setTimeout(() => window._applyPlantillaToFactura?.(data), 200);
};

window._usarPlantillaPres = id => {
  const data = getPlantillaData(id);
  if (!data) return;
  window._switchView?.("nuevo-presupuesto");
  setTimeout(() => window._applyPlantillaToPresupuesto?.(data), 200);
};

/* ══════════════════════════════════════════════════════
   initPlantillasView — llamado desde main.js al iniciar
══════════════════════════════════════════════════════ */
export function initPlantillasView() {
  // Botón principal "Nueva plantilla"
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click", () => showPlantillaModal());

  // Redirigir cualquier intento de navegar a "editar-plantilla" a la vista integrada
  const _origSwitchView = window._switchView;
  if (_origSwitchView && !window._switchView._patchedForPlantillas) {
    window._switchView = function(view, ...args) {
      if (view === "editar-plantilla") {
        _origSwitchView("plantillas", ...args);
        setTimeout(function() {
          _showEditor();
          window._epInit();
        }, 60);
        return;
      }
      return _origSwitchView(view, ...args);
    };
    window._switchView._patchedForPlantillas = true;
  }

  refreshPlantillas();
}

// Alias de compatibilidad
export { showPlantillaModal as showPlantillaView };
