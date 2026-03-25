/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js
   Plantillas avanzadas de factura/presupuesto
   ─ Opciones de impresión: diseño, fuente, colores, márgenes, logo
   ─ Opciones del documento: impuestos, retenciones, columnas
   ─ Aplicar plantilla al crear factura o presupuesto
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

/* ══════════════════════════
   LOAD
══════════════════════════ */
export async function loadPlantillas() {
  const { data, error } = await supabase.from("plantillas_usuario")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("plantillas:", error.message); return []; }
  return data || [];
}

export async function refreshPlantillas() {
  PLANTILLAS = await loadPlantillas();
  renderPlantillasGrid();
}

/* ══════════════════════════
   RENDER GRID
══════════════════════════ */
function renderPlantillasGrid() {
  const wrap = document.getElementById("plantillasGrid");
  if (!wrap) return;

  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--t3)">
        <div style="font-size:52px;margin-bottom:14px">📄</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:var(--t1)">Sin plantillas personalizadas</div>
        <div style="font-size:13px;margin-bottom:24px;line-height:1.6;max-width:400px;margin-left:auto;margin-right:auto">
          Crea plantillas con tu diseño, impuestos, columnas y estilo habitual para facturar más rápido y con coherencia.
        </div>
        <button class="btn-primary" onclick="window._nuevaPlantilla()">+ Crear mi primera plantilla</button>
      </div>`;
    return;
  }

  const colores = ["#3b82f6","#f97316","#059669","#8b5cf6","#ef4444","#0ea5e9"];
  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const lineas    = p.lineas    ? JSON.parse(p.lineas)    : [];
    const impuestos = p.impuestos ? JSON.parse(p.impuestos) : [];
    const columnas  = p.columnas  ? JSON.parse(p.columnas)  : ["Descripción","Cantidad","Precio","Subtotal"];
    const base      = lineas.reduce((a, l) => a + (l.cantidad||1)*(l.precio||0), 0);
    const color     = p.color_principal || colores[i % 6];
    return `
      <div class="doc-card" style="text-align:left;border-top:3px solid ${color}" onclick="window._editPlantilla('${p.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
          <div style="font-size:24px">📋</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
            ${impuestos.length ? `<span style="font-size:10px;font-weight:700;color:#059669;background:#f0fdf4;padding:2px 7px;border-radius:6px">${impuestos.length} imp.</span>` : ""}
            <span style="font-size:10px;font-weight:700;color:${color};background:${color}15;padding:2px 7px;border-radius:6px">
              ${lineas.length} línea${lineas.length!==1?"s":""}
            </span>
          </div>
        </div>
        <div class="doc-card-name" style="margin:0 0 3px;font-size:14px">${p.nombre}</div>
        <div class="doc-card-desc" style="margin-bottom:6px">${p.concepto||"Sin concepto predefinido"}</div>
        <div style="font-size:11px;color:var(--t4);margin-bottom:8px">
          Cols: ${columnas.slice(0,3).join(" · ")}${columnas.length>3?` +${columnas.length-3}`:""}
        </div>
        ${base>0?`<div style="font-family:monospace;font-size:14px;font-weight:700;color:var(--t1);margin-bottom:10px">${fmt(base)}</div>`:""}
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')" style="font-size:10px">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')" style="font-size:10px">📋 Presupuesto</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')" style="font-size:10px">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   MODAL AVANZADO
   Pestaña 1: Opciones de Impresión
   Pestaña 2: Opciones del Documento
══════════════════════════ */
const COL_FIJAS       = ["Descripción","Cantidad","Precio","Subtotal"];
const COL_DISPONIBLES = ["Código","Descuento","Coeficiente"];

export function showPlantillaModal(prefill = {}) {
  const isEdit      = !!prefill.id;
  const lineas      = prefill.lineas      ? (typeof prefill.lineas==="string"      ? JSON.parse(prefill.lineas)      : prefill.lineas)      : [{ descripcion:"", cantidad:1, precio:0, iva:21 }];
  const impuestos   = prefill.impuestos   ? (typeof prefill.impuestos==="string"   ? JSON.parse(prefill.impuestos)   : prefill.impuestos)   : [];
  const retenciones = prefill.retenciones ? (typeof prefill.retenciones==="string" ? JSON.parse(prefill.retenciones) : prefill.retenciones) : [];
  const colsGuardadas = prefill.columnas  ? (typeof prefill.columnas==="string"    ? JSON.parse(prefill.columnas)    : prefill.columnas)    : [];
  const colsOpcAdded  = colsGuardadas.filter(c => COL_DISPONIBLES.includes(c));

  openModal(`
    <div class="modal" style="max-width:840px">
      <div class="modal-hd">
        <span class="modal-title">📋 ${isEdit?"Editar":"Nueva"} plantilla</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>

      <div style="padding:14px 24px 0;border-bottom:1px solid var(--brd)">
        <div style="display:flex;gap:14px;flex-wrap:wrap;padding-bottom:14px">
          <div class="modal-field" style="flex:1;min-width:200px;margin:0">
            <label>Nombre de la plantilla *</label>
            <input autocomplete="off" id="plt_nombre" class="ff-input" value="${prefill.nombre||""}" placeholder="Ej: TULIPA S.A. (Descuento e impuestos en columnas)"/>
          </div>
          <div class="modal-field" style="flex:1;min-width:200px;margin:0">
            <label>Concepto predeterminado</label>
            <input autocomplete="off" id="plt_concepto" class="ff-input" value="${prefill.concepto||""}" placeholder="Ej: Servicio de mantenimiento"/>
          </div>
        </div>
        <div style="display:flex;gap:0">
          <button class="plt-tab plt-tab--active" id="tabImpresion" onclick="window._pltTab('impresion')">🖨️ Opciones de Impresión</button>
          <button class="plt-tab" id="tabDocumento" onclick="window._pltTab('documento')">📄 Opciones del Documento</button>
        </div>
      </div>

      <!-- ══ PANEL IMPRESIÓN ══ -->
      <div class="modal-bd plt-panel" id="panelImpresion">

        <div class="plt-section-label">🎨 Diseño general</div>
        <div class="modal-grid3">
          <div class="modal-field">
            <label>Selecciona un Diseño</label>
            <select id="plt_diseno" class="ff-select">
              ${["Afrodita","Clásico","Moderno","Minimalista","Corporate","Bold"].map(d=>
                `<option value="${d.toLowerCase()}" ${(prefill.diseno||"afrodita")===d.toLowerCase()?"selected":""}>${d}</option>`
              ).join("")}
            </select>
          </div>
          <div class="modal-field">
            <label>Tamaño Hoja</label>
            <select id="plt_hoja" class="ff-select">
              ${["A4","A3","Letter"].map(h=>`<option value="${h}" ${(prefill.tamano_hoja||"A4")===h?"selected":""}>${h}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field">
            <label>Fuente</label>
            <select id="plt_fuente" class="ff-select">
              ${["Lato","Helvetica","Roboto","Open Sans","Montserrat","Georgia"].map(f=>
                `<option value="${f}" ${(prefill.fuente||"Lato")===f?"selected":""}>${f}</option>`
              ).join("")}
            </select>
          </div>
        </div>

        <div class="modal-field" style="margin-top:4px">
          <label>Tamaño Fuente</label>
          <div style="display:flex;gap:8px;margin-top:6px">
            ${[8,9,10,11,12].map((s,i)=>`
              <button class="plt-font-btn ${(prefill.tamano_fuente||10)===s?"plt-font-btn--active":""}"
                      data-size="${s}" onclick="window._pltFontSize(${s})" style="font-size:${9+i*2}px;font-weight:800">A</button>`
            ).join("")}
          </div>
          <input type="hidden" id="plt_tamano_fuente" value="${prefill.tamano_fuente||10}"/>
        </div>

        <div class="plt-section-label" style="margin-top:18px">🎨 Colores</div>
        <div class="modal-grid2">
          ${[
            ["plt_color_letra",    "Color de letra",              prefill.color_letra||"#1e293b"],
            ["plt_color_letra_cab","Color de letra en cabeceras", prefill.color_letra_cabeceras||"#ffffff"],
            ["plt_color_cab",      "Color de cabeceras",          prefill.color_principal||"#1a56db"],
            ["plt_color_tabla",    "Color de fondo de tablas",    prefill.color_fondo_tabla||"#f8fafc"],
            ["plt_color_fondo",    "Color de fondo",              prefill.color_fondo||"#ffffff"],
            ["plt_color_lineas",   "Color líneas de tablas",      prefill.color_lineas_tabla||"#e2e8f0"],
          ].map(([id,label,val])=>`
            <div class="modal-field">
              <label>${label}</label>
              <div style="display:flex;gap:10px;align-items:center;margin-top:4px">
                <input type="color" id="${id}" value="${val}" style="width:80px;height:38px;padding:3px 5px;border:1.5px solid var(--brd);border-radius:8px;cursor:pointer"/>
                <div style="flex:1;height:38px;border-radius:8px;border:1px solid var(--brd);background:${val}"></div>
              </div>
            </div>`
          ).join("")}
        </div>

        <div class="plt-section-label" style="margin-top:18px">📐 Pie de página y márgenes</div>
        <div class="modal-grid2">
          <div class="modal-field">
            <label>Altura pie página</label>
            <div style="display:flex;gap:8px;align-items:flex-end;margin-top:6px">
              ${[0,10,20,30,40].map((v,i)=>`
                <div onclick="window._pltPieHeight(${v})" data-ph="${v}" title="${v}mm"
                     style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px">
                  <div style="width:20px;background:${(prefill.altura_pie||20)===v?"var(--accent)":"var(--brd)"};border-radius:3px 3px 0 0;height:${8+i*5}px;transition:all .2s"></div>
                  <div style="width:20px;height:4px;background:${(prefill.altura_pie||20)===v?"var(--accent)":"var(--bg2)"};border:1.5px solid var(--brd);border-radius:2px"></div>
                </div>`).join("")}
            </div>
            <input type="hidden" id="plt_altura_pie" value="${prefill.altura_pie||20}"/>
          </div>
          <div class="modal-field">
            <label>Alineación texto</label>
            <div style="display:flex;gap:6px;margin-top:6px">
              ${[["left","⬅ Izquierda"],["center","↔ Centro"],["justify","⇔ Justificado"]].map(([v,l])=>`
                <button onclick="window._pltAlign('${v}')" data-align="${v}"
                        style="flex:1;padding:8px 6px;font-size:11px;font-weight:600;border:1.5px solid var(--brd);border-radius:8px;cursor:pointer;
                               background:${(prefill.alineacion_texto||"left")===v?"var(--accent)":"var(--bg2)"};
                               color:${(prefill.alineacion_texto||"left")===v?"#fff":"var(--t2)"};
                               transition:all .15s">${l}</button>`).join("")}
            </div>
            <input type="hidden" id="plt_alineacion" value="${prefill.alineacion_texto||"left"}"/>
          </div>
        </div>

        <div class="modal-grid2" style="margin-top:8px">
          <div class="modal-field">
            <label>Imagen de fondo</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="file" id="plt_fondo_file" accept="image/*" class="ff-input" style="padding:6px;flex:1"/>
              ${prefill.imagen_fondo?`<button class="ta-btn ta-del" onclick="window._pltQuitarFondo()" style="white-space:nowrap">🗑️ Quitar</button>`:""}
            </div>
          </div>
          <div></div>
        </div>

        <div class="modal-grid2" style="margin-top:4px">
          ${[["plt_margen_izq","Margen izquierdo",prefill.margen_izq||20],["plt_margen_der","Margen derecho",prefill.margen_der||20],["plt_margen_sup","Margen superior",prefill.margen_sup||20],["plt_margen_inf","Margen inferior",prefill.margen_inf||20]].map(([id,label,val])=>`
            <div class="modal-field">
              <label>${label}</label>
              <select id="${id}" class="ff-select">
                ${[10,15,20,25,30].map(v=>`<option value="${v}" ${val===v?"selected":""}>${v} mm</option>`).join("")}
              </select>
            </div>`).join("")}
        </div>

        <div class="plt-section-label" style="margin-top:18px">👁 Visibilidad</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[
            ["plt_show_empresa","Mostrar datos de empresa",     prefill.show_empresa!==false],
            ["plt_show_email",  "Mostrar tu email",             prefill.show_email!==false],
            ["plt_show_logo",   "Visualizar logotipo",          prefill.show_logo!==false],
            ["plt_show_totales","Mostrar tabla de totales",     prefill.show_totales!==false],
            ["plt_show_nombre_com","Mostrar nombre comercial cliente", prefill.show_nombre_com!==false],
            ["plt_show_cabecera","Mostrar cabecera todas páginas",    !!prefill.show_cabecera],
            ["plt_show_pagina", "Mostrar núm. página",          prefill.show_pagina!==false],
          ].map(([id,label,val])=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd)">
              <span style="font-size:13px">${label}</span>
              <label class="irpf-toggle"><input type="checkbox" id="${id}" ${val?"checked":""}/>
                <span class="irpf-toggle-slider"></span>
              </label>
            </div>`
          ).join("")}
        </div>

        <div class="modal-grid2" style="margin-top:14px">
          <div class="modal-field">
            <label>Texto legal pie de página</label>
            <input autocomplete="off" id="plt_pie" class="ff-input" value="${prefill.texto_pie||""}" placeholder="Ej: Inscrita en el RM de Madrid…"/>
          </div>
          <div class="modal-field">
            <label>Cuenta bancaria (IBAN visible en PDF)</label>
            <input autocomplete="off" id="plt_iban" class="ff-input" value="${prefill.iban_visible||""}" placeholder="ES00 0000 0000 00 0000 0000"/>
          </div>
        </div>

        <div class="modal-field" style="margin-top:4px">
          <label>Notas / Condiciones predeterminadas</label>
          <textarea autocomplete="off" id="plt_notas" class="ff-input ff-textarea" style="min-height:60px" placeholder="Forma de pago, plazos, condiciones…">${prefill.notas||""}</textarea>
        </div>
      </div>

      <!-- ══ PANEL DOCUMENTO ══ -->
      <div class="modal-bd plt-panel" id="panelDocumento" style="display:none">
        <p style="font-size:13px;color:var(--t2);line-height:1.65;margin-bottom:20px;padding:12px 14px;background:var(--bg2);border-radius:10px;border-left:3px solid var(--accent)">
          Puedes añadir impuestos y retenciones. Los impuestos marcados como <strong>"Añadir como columna"</strong> aparecerán en cada línea del detalle;
          los demás se incluirán de forma global. Las retenciones siempre se aplican de forma global.
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:24px">
          <div>
            <div class="plt-section-label">💰 Impuestos</div>
            <div id="plt_impuestos_list" style="margin-bottom:10px">
              ${impuestos.length
                ? impuestos.map((imp,i)=>_renderImpuestoRow(imp,i)).join("")
                : `<div class="plt-empty-msg" style="color:#f97316">No hay ningún impuesto añadido</div>`}
            </div>
            <button class="btn-outline" style="font-size:12px" onclick="window._pltAddImpuesto()">+ Añadir Impuesto</button>
          </div>
          <div>
            <div class="plt-section-label">✂️ Retenciones</div>
            <div id="plt_retenciones_list" style="margin-bottom:10px">
              ${retenciones.length
                ? retenciones.map((ret,i)=>_renderRetencionRow(ret,i)).join("")
                : `<div class="plt-empty-msg" style="color:#f97316">No hay ninguna retención añadida</div>`}
            </div>
            <button class="btn-outline" style="font-size:12px" onclick="window._pltAddRetencion()">+ Añadir Retención</button>
          </div>
        </div>

        <div class="plt-section-label">📊 Columnas de líneas de detalle</div>
        <p style="font-size:12px;color:var(--t3);margin-bottom:16px;line-height:1.6">
          "Descripción" es obligatoria. "Cantidad", "Precio" y "Subtotal" también están siempre presentes.
          Puedes añadir columnas opcionales y definir su % de anchura.
        </p>
        <div style="display:grid;grid-template-columns:240px 1fr;gap:24px">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">Columnas no añadidas</div>
            <div id="plt_cols_disponibles">
              ${COL_DISPONIBLES.filter(c=>!colsOpcAdded.includes(c)).map(c=>`
                <div class="plt-col-disp" data-col="${c}">
                  <span style="font-size:13px">${c}</span>
                  <button class="btn-outline" style="font-size:11px;padding:3px 10px" onclick="window._pltAddColumna('${c}')">Añadir &gt;&gt;</button>
                </div>`).join("")
                || `<div style="font-size:12px;color:var(--t4);padding:8px 0">Todas las columnas opcionales están añadidas</div>`}
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">Columnas añadidas y % de anchura</div>
            <div style="border:1px solid var(--brd);border-radius:10px;overflow:hidden">
              <!-- Header -->
              <div style="display:grid;grid-template-columns:1fr 80px 36px;background:var(--accent);color:#fff;padding:8px 12px;gap:8px;font-size:12px;font-weight:700">
                <span>Columna</span><span>% anchura</span><span></span>
              </div>
              <!-- Fijas -->
              ${COL_FIJAS.map(c=>`
                <div style="display:grid;grid-template-columns:1fr 80px 36px;padding:8px 12px;gap:8px;border-bottom:1px solid var(--brd);background:var(--bg2);align-items:center">
                  <span style="font-size:13px;font-weight:500;color:var(--accent)">${c}</span>
                  <input type="number" placeholder="%" class="ff-input" style="padding:3px 7px;font-size:11px;height:28px"/>
                  <div></div>
                </div>`).join("")}
              <!-- Opcionales añadidas -->
              <div id="plt_cols_añadidas">
                ${colsOpcAdded.map(c=>_renderColumnaAdd(c)).join("")}
              </div>
            </div>
          </div>
        </div>

        <div class="plt-section-label" style="margin-top:24px">📝 Líneas predefinidas</div>
        <div class="lineas-header" style="grid-template-columns:1fr 60px 100px 60px 32px">
          <div>Descripción</div><div>Cantidad</div><div>Precio (€)</div><div>IVA</div><div></div>
        </div>
        <div id="plt_lineasContainer">
          ${lineas.map((l,i)=>_renderLineaPlantilla(l,i)).join("")}
        </div>
        <button class="btn-add-linea" id="plt_addLinea" style="margin-top:8px">+ Añadir línea</button>
      </div>

      <div class="modal-ft">
        ${isEdit?`<button class="btn-modal-danger" id="plt_del" style="margin-right:auto">🗑️ Eliminar plantilla</button>`:""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="plt_save">${isEdit?"Actualizar plantilla":"Guardar plantilla"}</button>
      </div>
    </div>
  `);

  // ─ Inyectar CSS de tabs ─
  if (!document.getElementById("plt-modal-styles")) {
    const st = document.createElement("style");
    st.id = "plt-modal-styles";
    st.textContent = `
      .plt-tab { padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;border:none;border-bottom:2px solid transparent;background:none;color:var(--t3);transition:all .15s; }
      .plt-tab--active { color:var(--accent);border-bottom-color:var(--accent); }
      .plt-tab:hover:not(.plt-tab--active) { color:var(--t1); }
      .plt-section-label { font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px; }
      .plt-font-btn { width:38px;height:38px;border:1.5px solid var(--brd);border-radius:8px;background:var(--bg2);cursor:pointer;font-weight:800;color:var(--t2);display:flex;align-items:center;justify-content:center;transition:all .15s; }
      .plt-font-btn--active { border-color:var(--accent);color:var(--accent);background:rgba(26,86,219,.07); }
      .plt-imp-row { display:grid;grid-template-columns:1fr 70px 1fr 32px;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--brd);border-radius:8px;margin-bottom:6px;align-items:center; }
      .plt-empty-msg { font-size:13px;font-weight:500;padding:4px 0; }
      .plt-col-disp { display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg2);border:1px solid var(--brd);border-radius:7px;margin-bottom:6px; }
      .plt-col-added-row { display:grid;grid-template-columns:1fr 80px 36px;padding:8px 12px;gap:8px;border-bottom:1px solid var(--brd);align-items:center; }
    `;
    document.head.appendChild(st);
  }

  // ── Tab switch ──
  window._pltTab = (tab) => {
    document.getElementById("panelImpresion").style.display = tab==="impresion"?"":"none";
    document.getElementById("panelDocumento").style.display = tab==="documento"?"":"none";
    document.getElementById("tabImpresion").classList.toggle("plt-tab--active", tab==="impresion");
    document.getElementById("tabDocumento").classList.toggle("plt-tab--active",  tab==="documento");
  };

  // ── Tamaño fuente ──
  window._pltFontSize = (s) => {
    document.getElementById("plt_tamano_fuente").value = s;
    document.querySelectorAll(".plt-font-btn").forEach(b=>b.classList.toggle("plt-font-btn--active", parseInt(b.dataset.size)===s));
  };

  // ── Altura pie ──
  window._pltPieHeight = (h) => {
    document.getElementById("plt_altura_pie").value = h;
    document.querySelectorAll("[data-ph]").forEach(el=>{
      const active = parseInt(el.dataset.ph)===h;
      el.querySelector("div").style.background = active?"var(--accent)":"var(--brd)";
      el.querySelectorAll("div")[1].style.background = active?"var(--accent)":"var(--bg2)";
    });
  };

  // ── Alineación ──
  window._pltAlign = (v) => {
    document.getElementById("plt_alineacion").value = v;
    document.querySelectorAll("[data-align]").forEach(btn=>{
      const active = btn.dataset.align===v;
      btn.style.background = active?"var(--accent)":"var(--bg2)";
      btn.style.color      = active?"#fff":"var(--t2)";
      btn.style.borderColor = active?"var(--accent)":"var(--brd)";
    });
  };

  // ── Quitar fondo ──
  window._pltQuitarFondo = () => { toast("Imagen de fondo eliminada","success"); };

  // ── Impuesto / Retención ──
  window._pltAddImpuesto = () => {
    const list = document.getElementById("plt_impuestos_list");
    list.querySelector(".plt-empty-msg")?.remove();
    list.insertAdjacentHTML("beforeend", _renderImpuestoRow({}, list.querySelectorAll(".plt-imp-row").length));
  };
  window._pltAddRetencion = () => {
    const list = document.getElementById("plt_retenciones_list");
    list.querySelector(".plt-empty-msg")?.remove();
    list.insertAdjacentHTML("beforeend", _renderRetencionRow({}, list.querySelectorAll(".plt-imp-row").length));
  };

  // ── Eliminar imp/ret/linea via delegación ──
  document.addEventListener("click", function pltDelDelegate(e) {
    if (e.target.closest(".plt-del-imp")) e.target.closest(".plt-imp-row")?.remove();
    if (e.target.closest(".plt-del-linea")) e.target.closest(".linea-row")?.remove();
  });

  // ── Columnas ──
  window._pltAddColumna = (nombre) => {
    document.querySelector(`.plt-col-disp[data-col="${nombre}"]`)?.remove();
    const disps = document.getElementById("plt_cols_disponibles");
    if (!disps.querySelectorAll(".plt-col-disp").length) disps.innerHTML = `<div style="font-size:12px;color:var(--t4);padding:8px 0">Todas las columnas opcionales están añadidas</div>`;
    document.getElementById("plt_cols_añadidas").insertAdjacentHTML("beforeend", _renderColumnaAdd(nombre));
  };
  window._pltDelColumna = (nombre) => {
    document.querySelector(`.plt-col-added-row[data-col-name="${nombre}"]`)?.remove();
    const disps = document.getElementById("plt_cols_disponibles");
    disps.querySelector("div:not(.plt-col-disp)")?.remove();
    disps.insertAdjacentHTML("beforeend",
      `<div class="plt-col-disp" data-col="${nombre}">
        <span style="font-size:13px">${nombre}</span>
        <button class="btn-outline" style="font-size:11px;padding:3px 10px" onclick="window._pltAddColumna('${nombre}')">Añadir &gt;&gt;</button>
      </div>`);
  };

  // ── Líneas ──
  let lineaCount = lineas.length;
  document.getElementById("plt_addLinea").addEventListener("click", ()=>{
    document.getElementById("plt_lineasContainer").insertAdjacentHTML("beforeend", _renderLineaPlantilla({}, lineaCount++));
  });

  // ── GUARDAR ──
  document.getElementById("plt_save").addEventListener("click", async () => {
    const nombre = document.getElementById("plt_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio","error"); return; }

    const lineasArr = [...document.querySelectorAll("#plt_lineasContainer .linea-row")].map(row=>({
      descripcion: row.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:    parseFloat(row.querySelector("[data-field='cantidad']")?.value)||1,
      precio:      parseFloat(row.querySelector("[data-field='precio']")?.value)||0,
      iva:         parseInt(row.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.descripcion||l.precio>0);

    const impuestosArr = [...document.querySelectorAll("#plt_impuestos_list .plt-imp-row")].map(r=>({
      nombre:   r.querySelector("[data-imp='nombre']")?.value||"",
      valor:    parseFloat(r.querySelector("[data-imp='valor']")?.value)||0,
      como_col: r.querySelector("[data-imp='col']")?.checked||false,
    })).filter(i=>i.nombre);

    const retencionesArr = [...document.querySelectorAll("#plt_retenciones_list .plt-imp-row")].map(r=>({
      nombre: r.querySelector("[data-ret='nombre']")?.value||"",
      valor:  parseFloat(r.querySelector("[data-ret='valor']")?.value)||0,
    })).filter(r=>r.nombre);

    const colsOpc   = [...document.querySelectorAll("#plt_cols_añadidas .plt-col-added-row")].map(el=>el.dataset.colName);
    const columnas  = [...COL_FIJAS, ...colsOpc];

    const payload = {
      user_id:               SESSION.user.id,
      nombre,
      concepto:              document.getElementById("plt_concepto").value.trim()||null,
      notas:                 document.getElementById("plt_notas").value.trim()||null,
      lineas:                JSON.stringify(lineasArr),
      impuestos:             JSON.stringify(impuestosArr),
      retenciones:           JSON.stringify(retencionesArr),
      columnas:              JSON.stringify(columnas),
      diseno:                document.getElementById("plt_diseno").value,
      tamano_hoja:           document.getElementById("plt_hoja").value,
      fuente:                document.getElementById("plt_fuente").value,
      tamano_fuente:         parseInt(document.getElementById("plt_tamano_fuente").value)||10,
      color_principal:       document.getElementById("plt_color_cab").value,
      color_letra:           document.getElementById("plt_color_letra").value,
      color_letra_cabeceras: document.getElementById("plt_color_letra_cab").value,
      color_fondo_tabla:     document.getElementById("plt_color_tabla").value,
      color_fondo:           document.getElementById("plt_color_fondo").value,
      color_lineas_tabla:    document.getElementById("plt_color_lineas").value,
      altura_pie:            parseInt(document.getElementById("plt_altura_pie").value)||20,
      alineacion_texto:      document.getElementById("plt_alineacion").value,
      margen_izq:            parseInt(document.getElementById("plt_margen_izq").value)||20,
      margen_der:            parseInt(document.getElementById("plt_margen_der").value)||20,
      margen_sup:            parseInt(document.getElementById("plt_margen_sup").value)||20,
      margen_inf:            parseInt(document.getElementById("plt_margen_inf").value)||20,
      texto_pie:             document.getElementById("plt_pie").value.trim()||null,
      iban_visible:          document.getElementById("plt_iban").value.trim()||null,
      show_empresa:          document.getElementById("plt_show_empresa").checked,
      show_email:            document.getElementById("plt_show_email").checked,
      show_logo:             document.getElementById("plt_show_logo").checked,
      show_totales:          document.getElementById("plt_show_totales").checked,
      show_nombre_com:       document.getElementById("plt_show_nombre_com").checked,
      show_cabecera:         document.getElementById("plt_show_cabecera").checked,
      show_pagina:           document.getElementById("plt_show_pagina").checked,
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id));
    } else {
      ({ error: err } = await supabase.from("plantillas_usuario").insert(payload));
    }
    if (err) { toast("Error: "+err.message,"error"); return; }
    toast(isEdit?"Plantilla actualizada ✅":"Plantilla creada ✅","success");
    closeModal();
    await refreshPlantillas();
  });

  if (isEdit) {
    document.getElementById("plt_del")?.addEventListener("click", async ()=>{
      await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
      closeModal(); toast("Plantilla eliminada","success");
      await refreshPlantillas();
    });
  }
}

/* ── Helpers ── */
function _renderImpuestoRow(imp={}) {
  return `<div class="plt-imp-row">
    <input class="ff-input" data-imp="nombre" placeholder="Ej: IVA 21%" value="${imp.nombre||""}"/>
    <input type="number" class="ff-input" data-imp="valor" placeholder="%" value="${imp.valor||""}" min="0" max="100" step="0.01"/>
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" data-imp="col" ${imp.como_col?"checked":""}/>Añadir como columna
    </label>
    <button class="linea-del plt-del-imp" title="Eliminar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

function _renderRetencionRow(ret={}) {
  return `<div class="plt-imp-row">
    <input class="ff-input" data-ret="nombre" placeholder="Ej: IRPF 15%" value="${ret.nombre||""}"/>
    <input type="number" class="ff-input" data-ret="valor" placeholder="%" value="${ret.valor||""}" min="0" max="100" step="0.01"/>
    <span style="font-size:11px;color:var(--t3)">Siempre global</span>
    <button class="linea-del plt-del-imp" title="Eliminar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

function _renderColumnaAdd(nombre) {
  return `<div class="plt-col-added-row" data-col-name="${nombre}">
    <span style="font-size:13px;font-weight:600;color:var(--accent)">${nombre}</span>
    <input type="number" placeholder="%" class="ff-input" style="padding:3px 7px;font-size:11px;height:28px"/>
    <button onclick="window._pltDelColumna('${nombre}')" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:16px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .15s" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='none'" title="Quitar">✕</button>
  </div>`;
}

function _renderLineaPlantilla(l={}) {
  return `
    <div class="linea-row" style="grid-template-columns:1fr 60px 100px 60px 32px">
      <input autocomplete="off" class="ff-input" data-field="descripcion" value="${l.descripcion||""}" placeholder="Descripción"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="cantidad" value="${l.cantidad||1}" min="0.01" step="0.01"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="precio" value="${l.precio||""}" step="0.01" placeholder="0.00"/>
      <select class="ff-select" data-field="iva">
        <option value="21" ${(l.iva||21)===21?"selected":""}>21%</option>
        <option value="10" ${l.iva===10?"selected":""}>10%</option>
        <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
        <option value="0"  ${l.iva===0 ?"selected":""}>0%</option>
      </select>
      <button class="linea-del plt-del-linea" title="Eliminar línea">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
}

/* ══════════════════════════
   APLICAR PLANTILLA
══════════════════════════ */
export function getPlantillaData(plantillaId) {
  const p = PLANTILLAS.find(x=>x.id===plantillaId);
  if (!p) return null;
  return {
    concepto:    p.concepto,
    notas:       p.notas,
    lineas:      p.lineas      ? JSON.parse(p.lineas)      : [],
    impuestos:   p.impuestos   ? JSON.parse(p.impuestos)   : [],
    retenciones: p.retenciones ? JSON.parse(p.retenciones) : [],
    columnas:    p.columnas    ? JSON.parse(p.columnas)    : [],
    color_principal: p.color_principal,
    texto_pie:   p.texto_pie,
    iban_visible: p.iban_visible,
  };
}

export function renderPlantillaSelector(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container || !PLANTILLAS.length) return;
  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span style="font-size:12px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
      ${PLANTILLAS.map(p=>`<button class="btn-outline plt-selector-btn" data-plt-id="${p.id}" style="font-size:12px;padding:5px 12px">${p.nombre}</button>`).join("")}
      <button class="btn-outline plt-selector-btn" data-plt-id="" style="font-size:12px;padding:5px 12px;color:var(--t4)">En blanco</button>
    </div>`;
  container.querySelectorAll(".plt-selector-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      container.querySelectorAll(".plt-selector-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      if (onSelect) onSelect(btn.dataset.pltId ? getPlantillaData(btn.dataset.pltId) : null);
    });
  });
}

/* ══════════════════════════
   GLOBAL HANDLERS
══════════════════════════ */
window._nuevaPlantilla  = ()  => showPlantillaModal();
window._editPlantilla   = id  => { const p=PLANTILLAS.find(x=>x.id===id); if(p) showPlantillaModal(p); };
window._delPlantilla    = id  => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? Esta acción no se puede deshacer.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpltOk").addEventListener("click", async()=>{
    await supabase.from("plantillas_usuario").delete().eq("id",id);
    closeModal(); toast("Plantilla eliminada","success");
    await refreshPlantillas();
  });
};
window._usarPlantillaFactura = id => {
  const data = getPlantillaData(id);
  if (!data) return;
  window._switchView?.("nueva-factura");
  setTimeout(()=>window._applyPlantillaToFactura?.(data),200);
};
window._usarPlantillaPres = id => {
  const data = getPlantillaData(id);
  if (!data) return;
  window._switchView?.("presupuestos");
  setTimeout(()=>window._editPres?.("new_from_template_"+id),200);
};

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initPlantillasView() {
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click",()=>showPlantillaModal());
  refreshPlantillas();
}
