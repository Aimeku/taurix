/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js
   Plantillas de factura/presupuesto definidas por el usuario.
   ─ Crear, editar, eliminar plantillas con líneas predefinidas
   ─ Aplicar plantilla al crear factura o presupuesto
   ─ Generar PDFs con plantilla personalizada (logo, colores, textos legales)
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
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--t3)">
        <div style="font-size:48px;margin-bottom:12px">📄</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:6px">Sin plantillas personalizadas</div>
        <div style="font-size:12px;margin-bottom:20px">Crea plantillas con tus líneas, notas y estilo habitual para facturar más rápido.</div>
        <button class="btn-primary" onclick="window._nuevaPlantilla()">+ Crear mi primera plantilla</button>
      </div>`;
    return;
  }

  const colores = ["#3b82f6", "#f97316", "#059669", "#8b5cf6", "#ef4444", "#0ea5e9"];
  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const lineas = p.lineas ? JSON.parse(p.lineas) : [];
    const baseTotal = lineas.reduce((a, l) => a + (l.cantidad || 1) * (l.precio || 0), 0);
    return `
      <div class="doc-card" style="text-align:left;border-top:3px solid ${colores[i % 6]}" onclick="window._editPlantilla('${p.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div class="doc-card-icon" style="margin:0;font-size:22px">📋</div>
          <span style="font-size:10px;font-weight:700;color:${colores[i % 6]};background:${colores[i % 6]}15;padding:2px 8px;border-radius:6px">
            ${lineas.length} línea${lineas.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div class="doc-card-name" style="margin:0 0 4px">${p.nombre}</div>
        <div class="doc-card-desc" style="margin-bottom:8px">${p.concepto || "Sin concepto predefinido"}</div>
        ${baseTotal > 0 ? `<div style="font-family:monospace;font-size:14px;font-weight:700;color:var(--t1)">${fmt(baseTotal)}</div>` : ""}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')" style="font-size:10px">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')" style="font-size:10px">📋 Presupuesto</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')" style="font-size:10px">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   MODAL CREAR/EDITAR PLANTILLA
══════════════════════════ */
export function showPlantillaModal(prefill = {}) {
  const isEdit = !!prefill.id;
  const lineas = prefill.lineas
    ? (typeof prefill.lineas === "string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{ descripcion: "", cantidad: 1, precio: 0, iva: 21 }];

  // Defaults de diseño
  const D = {
    color_cab:      prefill.color_principal   || "#1a56db",
    color_txt_cab:  prefill.color_txt_cab     || "#ffffff",
    color_acento:   prefill.color_acento      || "#1a56db",
    color_fondo:    prefill.color_fondo       || "#ffffff",
    fuente:         prefill.fuente            || "helvetica",
    tam_fuente:     prefill.tam_fuente        || 9,
    margen:         prefill.margen            || 18,
    estilo_cab:     prefill.estilo_cab        || "solido",
    estilo_tabla:   prefill.estilo_tabla      || "rayas",
    logo:           prefill.logo_b64          || "",
    mostrar_logo:   prefill.mostrar_logo      !== false,
    mostrar_cab:    prefill.mostrar_cab       !== false,
    mostrar_pie:    prefill.mostrar_pie       !== false,
    idioma:         prefill.idioma            || "es",
  };

  const LABELS = {
    es: { tipo:"FACTURA", de:"EMISOR", para:"CLIENTE", desc:"Descripción", cant:"Cant.", precio:"Precio", iva:"IVA", total:"Total", base:"Base imponible", totalDoc:"TOTAL", notas:"Notas / Condiciones", pie:"Pie de página" },
    en: { tipo:"INVOICE", de:"FROM",   para:"BILL TO", desc:"Description", cant:"Qty.", precio:"Price",  iva:"VAT", total:"Total", base:"Subtotal",       totalDoc:"TOTAL", notas:"Notes / Terms",     pie:"Footer" },
  };

  openModal(`
    <div class="modal" style="max-width:1060px;width:97vw;height:88vh;display:flex;flex-direction:column;overflow:hidden">
      <div class="modal-hd" style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--brd)">
        <span class="modal-title" style="font-size:15px">📋 ${isEdit ? "Editar" : "Nueva"} plantilla de documento</span>
        <div style="display:flex;align-items:center;gap:10px">
          <!-- Toggle idioma -->
          <div style="display:flex;gap:0;border:1.5px solid var(--brd);border-radius:8px;overflow:hidden">
            <button id="plt_lang_es" onclick="window._pltLang('es')"
              style="padding:5px 14px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${D.idioma==='es'?'var(--accent)':'var(--bg2)'};color:${D.idioma==='es'?'#fff':'var(--t2)'}">
              🇪🇸 ES
            </button>
            <button id="plt_lang_en" onclick="window._pltLang('en')"
              style="padding:5px 14px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${D.idioma==='en'?'var(--accent)':'var(--bg2)'};color:${D.idioma==='en'?'#fff':'var(--t2)'}">
              🇬🇧 EN
            </button>
          </div>
          <button class="modal-x" onclick="window._cm()">×</button>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:0;border-bottom:1px solid var(--brd);background:var(--bg2);flex-shrink:0">
        <button class="plt-tab-btn plt-tab-active" data-tab="impresion" onclick="window._pltTab('impresion')"
          style="padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;border:none;border-bottom:2px solid var(--accent);background:var(--srf);color:var(--accent)">
          🖨️ Opciones de Impresión
        </button>
        <button class="plt-tab-btn" data-tab="documento" onclick="window._pltTab('documento')"
          style="padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--t3)">
          📄 Opciones del Documento
        </button>
      </div>

      <!-- Cuerpo: editor izquierda + preview derecha -->
      <div style="display:grid;grid-template-columns:1fr 320px;flex:1;overflow:hidden;min-height:0">

        <!-- ═══ Panel izquierdo ═══ -->
        <div style="overflow-y:auto;padding:20px 24px;border-right:1px solid var(--brd)">

          <!-- TAB IMPRESIÓN -->
          <div id="plt-tab-impresion">

            <!-- Nombre + Concepto siempre visibles -->
            <div class="plt-group">🏷️ Identificación</div>
            <div class="modal-grid2" style="margin-bottom:12px">
              <div class="modal-field">
                <label>Nombre de la plantilla *</label>
                <input autocomplete="off" id="plt_nombre" class="ff-input" value="${prefill.nombre||""}" placeholder="Ej: Factura servicios profesionales"/>
              </div>
              <div class="modal-field">
                <label>Concepto predeterminado</label>
                <input autocomplete="off" id="plt_concepto" class="ff-input" value="${prefill.concepto||""}" placeholder="Ej: Servicios de consultoría"/>
              </div>
            </div>

            <!-- Logo -->
            <div class="plt-group">🖼️ Logo</div>
            <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
              <div id="plt_logo_prev" onclick="document.getElementById('plt_logo_inp').click()"
                style="width:90px;height:56px;border:2px dashed var(--brd);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--srf2);cursor:pointer;flex-shrink:0">
                ${D.logo?`<img src="${D.logo}" style="max-width:86px;max-height:52px;object-fit:contain"/>`:`<span style="font-size:10px;color:var(--t4);text-align:center">Click<br>logo</span>`}
              </div>
              <input type="file" id="plt_logo_inp" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none"/>
              <div style="display:flex;flex-direction:column;gap:6px">
                <button type="button" class="btn-outline" id="plt_logo_btn" style="font-size:12px;padding:6px 14px">
                  ${D.logo?"📁 Cambiar logo":"📁 Subir logo"}
                </button>
                ${D.logo?`<button type="button" class="btn-outline" id="plt_logo_rm" style="font-size:12px;padding:6px 14px;color:#dc2626;border-color:#dc2626">🗑️ Quitar</button>`:""}
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                  <input type="checkbox" id="plt_mostrar_logo" ${D.mostrar_logo?"checked":""}/>
                  Mostrar logo
                </label>
              </div>
            </div>

            <!-- Cabecera -->
            <div class="plt-group">📋 Cabecera</div>
            <div class="modal-grid2" style="margin-bottom:12px">
              <div class="modal-field">
                <label>Estilo de cabecera</label>
                <select id="plt_estilo_cab" class="ff-select">
                  <option value="solido"    ${D.estilo_cab==="solido"   ?"selected":""}>Fondo sólido</option>
                  <option value="gradiente" ${D.estilo_cab==="gradiente"?"selected":""}>Gradiente</option>
                  <option value="linea"     ${D.estilo_cab==="linea"    ?"selected":""}>Solo línea</option>
                  <option value="sin"       ${D.estilo_cab==="sin"      ?"selected":""}>Sin cabecera</option>
                </select>
              </div>
              <div class="modal-field">
                <label>Fuente del documento</label>
                <select id="plt_fuente" class="ff-select">
                  <option value="helvetica" ${D.fuente==="helvetica"?"selected":""}>Helvetica (sans-serif)</option>
                  <option value="courier"   ${D.fuente==="courier"  ?"selected":""}>Courier (monospace)</option>
                  <option value="times"     ${D.fuente==="times"    ?"selected":""}>Times (serif)</option>
                </select>
              </div>
            </div>
            <div class="modal-grid2" style="margin-bottom:12px">
              <div class="modal-field">
                <label>Tamaño de fuente</label>
                <select id="plt_tam_fuente" class="ff-select">
                  ${[7,8,9,10,11,12].map(s=>`<option value="${s}" ${D.tam_fuente===s?"selected":""}>${s} pt</option>`).join("")}
                </select>
              </div>
              <div class="modal-field">
                <label>Estilo tabla de líneas</label>
                <select id="plt_estilo_tabla" class="ff-select">
                  <option value="rayas"  ${D.estilo_tabla==="rayas" ?"selected":""}>Filas alternadas</option>
                  <option value="limpio" ${D.estilo_tabla==="limpio"?"selected":""}>Sin rayas</option>
                  <option value="bordes" ${D.estilo_tabla==="bordes"?"selected":""}>Con bordes</option>
                </select>
              </div>
            </div>

            <!-- Colores -->
            <div class="plt-group">🎨 Colores</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
              ${[
                ["plt_color_cab",    "Color cabecera",  D.color_cab],
                ["plt_color_txtcab", "Texto cabecera",  D.color_txt_cab],
                ["plt_color_acento", "Color acento",    D.color_acento],
                ["plt_color_fondo",  "Fondo documento", D.color_fondo],
              ].map(([id,lbl,val])=>`
                <div class="modal-field">
                  <label style="font-size:11px">${lbl}</label>
                  <div style="display:flex;gap:5px;align-items:center;margin-top:3px">
                    <input type="color" id="${id}" value="${val}" style="width:32px;height:32px;padding:2px;border:1.5px solid var(--brd);border-radius:6px;cursor:pointer;flex-shrink:0"/>
                    <input type="text" id="${id}_hex" value="${val}" maxlength="7"
                      style="flex:1;font-family:monospace;font-size:11px;padding:4px 6px;border:1.5px solid var(--brd);border-radius:6px;background:var(--bg2)"/>
                  </div>
                </div>`).join("")}
            </div>

            <!-- Márgenes -->
            <div class="plt-group">📐 Márgenes y pie</div>
            <div class="modal-grid2" style="margin-bottom:8px">
              <div class="modal-field">
                <label>Margen general (mm)</label>
                <select id="plt_margen" class="ff-select">
                  ${[10,12,14,16,18,20,22,25].map(v=>`<option value="${v}" ${D.margen===v?"selected":""}>${v} mm</option>`).join("")}
                </select>
              </div>
            </div>

            <!-- Visibilidad -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:16px">
              ${[
                ["plt_mostrar_cab","Mostrar cabecera",      D.mostrar_cab],
                ["plt_mostrar_pie","Mostrar pie de página", D.mostrar_pie],
              ].map(([id,lbl,val])=>`
                <label style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd);cursor:pointer;font-size:13px">
                  <span>${lbl}</span>
                  <input type="checkbox" id="${id}" ${val?"checked":""} style="width:15px;height:15px;accent-color:var(--accent)"/>
                </label>`).join("")}
            </div>

            <!-- Pie y IBAN -->
            <div class="modal-grid2" style="margin-bottom:4px">
              <div class="modal-field">
                <label>Texto legal del pie</label>
                <input autocomplete="off" id="plt_pie" class="ff-input" value="${prefill.texto_pie||""}" placeholder="Inscrita en el RM…"/>
              </div>
              <div class="modal-field">
                <label>IBAN visible en el PDF</label>
                <input autocomplete="off" id="plt_iban" class="ff-input" value="${prefill.iban_visible||""}" placeholder="ES00 0000…"/>
              </div>
            </div>
          </div>

          <!-- TAB DOCUMENTO -->
          <div id="plt-tab-documento" style="display:none">

            <div class="plt-group">📝 Contenido del documento</div>
            <div class="modal-field" style="margin-bottom:12px">
              <label>Descripción / Alcance del servicio</label>
              <textarea autocomplete="off" id="plt_descripcion" class="ff-input ff-textarea" style="min-height:70px"
                placeholder="Describe qué incluye este servicio. Aparecerá bajo el encabezado del documento.">${prefill.descripcion||""}</textarea>
            </div>
            <div class="modal-field" style="margin-bottom:20px">
              <label>Notas / Condiciones de pago</label>
              <textarea autocomplete="off" id="plt_notas" class="ff-input ff-textarea" style="min-height:60px"
                placeholder="Forma de pago, plazo, penalizaciones, garantías…">${prefill.notas||""}</textarea>
            </div>

            <div class="plt-group">📋 Líneas predefinidas</div>
            <div class="lineas-header" style="grid-template-columns:1fr 58px 96px 56px 30px;font-size:10px">
              <div>Descripción</div><div>Cantidad</div><div>Precio (€)</div><div>IVA</div><div></div>
            </div>
            <div id="plt_lineasContainer">
              ${lineas.map((l,i)=>_renderLineaPlantilla(l,i)).join("")}
            </div>
            <button class="btn-add-linea" id="plt_addLinea" style="margin-top:8px">+ Añadir línea</button>
          </div>

        </div><!-- fin panel izquierdo -->

        <!-- ═══ Preview PDF en vivo ═══ -->
        <div id="plt_preview_col" style="background:var(--bg2);overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px">
          <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em">👁 Vista previa</div>

          <!-- Mini documento A4 -->
          <div id="plt_pv_doc" style="background:#fff;border-radius:8px;box-shadow:0 3px 20px rgba(0,0,0,.15);overflow:hidden;font-size:10px;min-height:400px">

            <!-- Logo independiente (siempre arriba derecha) -->
            <div id="plt_pv_logo_row" style="padding:8px 14px 0;display:flex;justify-content:flex-end;${D.logo&&D.mostrar_logo?'':'display:none'}">
              <img id="plt_pv_logo_img" src="${D.logo}" style="max-height:32px;max-width:70px;object-fit:contain"/>
            </div>

            <!-- Cabecera -->
            <div id="plt_pv_cab" style="padding:12px 14px;background:${D.color_cab}">
              <div id="plt_pv_tipo" style="font-size:8px;font-weight:800;letter-spacing:.12em;opacity:.65;color:${D.color_txt_cab}">FACTURA</div>
              <div id="plt_pv_concepto" style="font-size:13px;font-weight:700;color:${D.color_txt_cab};margin-top:2px">${prefill.concepto||"Sin concepto"}</div>
              <div style="font-size:9px;opacity:.6;color:${D.color_txt_cab};margin-top:1px">FAC-2025-001 · ${new Date().toLocaleDateString("es-ES")}</div>
            </div>

            <!-- Emisor/Cliente -->
            <div style="display:grid;grid-template-columns:1fr 1fr;padding:10px 14px;border-bottom:1px solid #e5e7eb;gap:8px">
              <div>
                <div id="plt_pv_lbl_de" style="font-size:7px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin-bottom:2px">EMISOR</div>
                <div style="font-weight:700;font-size:9.5px;color:#111">Tu empresa</div>
                <div style="font-size:8.5px;color:#6b7280">NIF: B12345678</div>
              </div>
              <div>
                <div id="plt_pv_lbl_para" style="font-size:7px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin-bottom:2px">CLIENTE</div>
                <div style="font-weight:700;font-size:9.5px;color:#111">Empresa Cliente SL</div>
                <div style="font-size:8.5px;color:#6b7280">NIF: A98765432</div>
              </div>
            </div>

            <!-- Descripción si la hay -->
            <div id="plt_pv_desc_wrap" style="padding:7px 14px;border-bottom:1px solid #f3f4f6;display:none">
              <div id="plt_pv_desc" style="font-size:8.5px;color:#6b7280;line-height:1.5"></div>
            </div>

            <!-- Tabla líneas -->
            <div style="padding:0 14px">
              <div id="plt_pv_tabla_head" style="display:grid;grid-template-columns:1fr 28px 50px 28px 52px;gap:2px;padding:6px 0 3px;font-size:7.5px;font-weight:700;text-transform:uppercase;color:#fff;background:${D.color_acento};margin:0 -14px;padding:6px 14px 4px">
                <span id="plt_pv_col_desc">Descripción</span>
                <span style="text-align:right" id="plt_pv_col_cant">Cant</span>
                <span style="text-align:right" id="plt_pv_col_precio">Precio</span>
                <span style="text-align:right" id="plt_pv_col_iva">IVA</span>
                <span style="text-align:right" id="plt_pv_col_total">Total</span>
              </div>
              <div id="plt_pv_lineas">
                <div style="padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:9px;color:#bbb;text-align:center">Sin líneas definidas</div>
              </div>
            </div>

            <!-- Totales -->
            <div id="plt_pv_totales" style="padding:10px 14px;background:#f9fafb;border-top:1px solid #e5e7eb"></div>

            <!-- Notas -->
            <div id="plt_pv_notas" style="padding:7px 14px;font-size:8.5px;color:#6b7280;border-top:1px solid #e5e7eb;display:none;line-height:1.5"></div>

            <!-- Pie -->
            <div id="plt_pv_pie_row" style="padding:5px 14px;font-size:8px;color:#9ca3af;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between">
              <span id="plt_pv_pie_txt">Texto legal del pie</span>
              <span>Pág. 1 / 1</span>
            </div>
          </div>

          <div style="font-size:10px;color:var(--t4);line-height:1.6;padding:8px 10px;background:var(--srf);border-radius:7px;border:1px solid var(--brd)">
            💡 Vista previa aproximada. El PDF final usará tus datos fiscales reales.
          </div>
        </div>

      </div><!-- fin grid -->

      <div class="modal-ft" style="flex-shrink:0;padding:12px 20px;border-top:1px solid var(--brd)">
        ${isEdit?`<button class="btn-modal-danger" id="plt_del" style="margin-right:auto">🗑️ Eliminar plantilla</button>`:""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="plt_save" style="padding:10px 24px">${isEdit?"💾 Actualizar":"✨ Guardar plantilla"}</button>
      </div>
    </div>
  `);

  // ── CSS inline una sola vez ──
  if (!document.getElementById("plt-modal-css")) {
    const s = document.createElement("style");
    s.id = "plt-modal-css";
    s.textContent = `.plt-group{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--brd)}.plt-group+*{margin-top:0}.plt-tab-btn{transition:all .15s}.plt-tab-active{border-bottom-color:var(--accent)!important;color:var(--accent)!important;background:var(--srf)!important}`;
    document.head.appendChild(s);
  }

  // ── Estado interno ──
  let _logo = D.logo;
  let _idioma = D.idioma;

  // ── Tabs ──
  window._pltTab = (tab) => {
    document.getElementById("plt-tab-impresion").style.display = tab==="impresion"?"":"none";
    document.getElementById("plt-tab-documento").style.display = tab==="documento" ?"":"none";
    document.querySelectorAll(".plt-tab-btn").forEach(b => {
      const active = b.dataset.tab===tab;
      b.classList.toggle("plt-tab-active", active);
      b.style.borderBottomColor = active?"var(--accent)":"transparent";
      b.style.color             = active?"var(--accent)":"var(--t3)";
      b.style.background        = active?"var(--srf)":"transparent";
    });
  };

  // ── Idioma ──
  window._pltLang = (lang) => {
    _idioma = lang;
    const L = LABELS[lang];
    const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set("plt_pv_tipo",       L.tipo);
    set("plt_pv_lbl_de",     L.de);
    set("plt_pv_lbl_para",   L.para);
    set("plt_pv_col_desc",   L.desc);
    set("plt_pv_col_cant",   L.cant);
    set("plt_pv_col_precio", L.precio);
    set("plt_pv_col_iva",    L.iva);
    set("plt_pv_col_total",  L.total);
    // Actualizar estilo botones
    document.getElementById("plt_lang_es").style.background = lang==="es"?"var(--accent)":"var(--bg2)";
    document.getElementById("plt_lang_es").style.color      = lang==="es"?"#fff":"var(--t2)";
    document.getElementById("plt_lang_en").style.background = lang==="en"?"var(--accent)":"var(--bg2)";
    document.getElementById("plt_lang_en").style.color      = lang==="en"?"#fff":"var(--t2)";
    _pv();
  };

  const LABELS = {
    es: { tipo:"FACTURA", de:"EMISOR", para:"CLIENTE", desc:"Descripción", cant:"Cant.", precio:"Precio", iva:"IVA", total:"Total", base:"Base imponible", totalDoc:"TOTAL", notas:"Notas / Condiciones", pie:"Pie de página" },
    en: { tipo:"INVOICE", de:"FROM",   para:"BILL TO", desc:"Description", cant:"Qty.", precio:"Price",  iva:"VAT", total:"Total", base:"Subtotal",       totalDoc:"TOTAL", notas:"Notes / Terms",     pie:"Footer" },
  };

  // ── Sync color picker ↔ hex ──
  ["plt_color_cab","plt_color_txtcab","plt_color_acento","plt_color_fondo"].forEach(id => {
    const pick = document.getElementById(id);
    const hex  = document.getElementById(id+"_hex");
    if (!pick||!hex) return;
    pick.addEventListener("input",  () => { hex.value=pick.value; _pv(); });
    hex.addEventListener("change",  () => { if(/^#[0-9a-f]{6}$/i.test(hex.value)){pick.value=hex.value;} _pv(); });
  });

  // ── Logo ──
  const logoInp  = document.getElementById("plt_logo_inp");
  const logoPrev = document.getElementById("plt_logo_prev");
  document.getElementById("plt_logo_btn")?.addEventListener("click", ()=>logoInp.click());
  logoInp.addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size>500*1024){toast("Logo máx. 500KB","error");return;}
    const r=new FileReader();
    r.onload=ev=>{
      _logo=ev.target.result;
      logoPrev.innerHTML=`<img src="${_logo}" style="max-width:86px;max-height:52px;object-fit:contain"/>`;
      document.getElementById("plt_logo_btn").textContent="📁 Cambiar logo";
      _pv();
    };
    r.readAsDataURL(f);
  });
  document.getElementById("plt_logo_rm")?.addEventListener("click", ()=>{
    _logo="";
    logoPrev.innerHTML=`<span style="font-size:10px;color:var(--t4);text-align:center">Click<br>logo</span>`;
    _pv();
  });

  // ── PREVIEW en vivo ──
  function _pv() {
    const L         = LABELS[_idioma];
    const colorCab  = document.getElementById("plt_color_cab")?.value    || D.color_cab;
    const colorTxtC = document.getElementById("plt_color_txtcab")?.value || D.color_txt_cab;
    const colorAcc  = document.getElementById("plt_color_acento")?.value || D.color_acento;
    const colorFdo  = document.getElementById("plt_color_fondo")?.value  || D.color_fondo;
    const estCab    = document.getElementById("plt_estilo_cab")?.value   || "solido";
    const fuente    = document.getElementById("plt_fuente")?.value       || "helvetica";
    const tamFuente = parseInt(document.getElementById("plt_tam_fuente")?.value)||9;
    const estTabla  = document.getElementById("plt_estilo_tabla")?.value || "rayas";
    const mostLogo  = document.getElementById("plt_mostrar_logo")?.checked;
    const mostCab   = document.getElementById("plt_mostrar_cab")?.checked;
    const mostPie   = document.getElementById("plt_mostrar_pie")?.checked;
    const concepto  = document.getElementById("plt_concepto")?.value || "Sin concepto";
    const notas     = document.getElementById("plt_notas")?.value    || "";
    const desc      = document.getElementById("plt_descripcion")?.value || "";
    const pie       = document.getElementById("plt_pie")?.value      || "";

    const FONT_MAP = { helvetica:"Helvetica,Arial,sans-serif", courier:"'Courier New',monospace", times:"'Times New Roman',Times,serif" };
    const doc = document.getElementById("plt_pv_doc");
    if (doc) { doc.style.fontFamily=FONT_MAP[fuente]||FONT_MAP.helvetica; doc.style.background=colorFdo; }

    // Logo
    const logoRow = document.getElementById("plt_pv_logo_row");
    const logoImg = document.getElementById("plt_pv_logo_img");
    if (logoRow) {
      logoRow.style.display = (mostLogo&&_logo) ? "flex" : "none";
      if (logoImg&&_logo) logoImg.src=_logo;
    }

    // Cabecera
    const cab = document.getElementById("plt_pv_cab");
    if (cab) {
      cab.style.display = mostCab ? "" : "none";
      if (estCab==="solido")    { cab.style.background=colorCab;    cab.style.borderBottom="none"; }
      if (estCab==="gradiente") { cab.style.background=`linear-gradient(135deg,${colorCab},${colorAcc})`; cab.style.borderBottom="none"; }
      if (estCab==="linea")     { cab.style.background="transparent"; cab.style.borderBottom=`3px solid ${colorCab}`; }
      if (estCab==="sin")       { cab.style.display="none"; }
    }
    const pvConc = document.getElementById("plt_pv_concepto");
    const pvTipo = document.getElementById("plt_pv_tipo");
    if (pvConc) { pvConc.textContent=concepto; pvConc.style.color=colorTxtC; }
    if (pvTipo) { pvTipo.textContent=L.tipo; pvTipo.style.color=colorTxtC; }

    // Tabla head
    const th = document.getElementById("plt_pv_tabla_head");
    if (th) th.style.background = colorAcc;
    const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
    set("plt_pv_col_desc",  L.desc);
    set("plt_pv_col_cant",  L.cant);
    set("plt_pv_col_precio",L.precio);
    set("plt_pv_col_iva",   L.iva);
    set("plt_pv_col_total", L.total);
    set("plt_pv_lbl_de",    L.de);
    set("plt_pv_lbl_para",  L.para);

    // Líneas
    const rows = document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr = [...rows].map(r=>({
      desc: r.querySelector("[data-field='descripcion']")?.value||"",
      cant: parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      prec: parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      iva:  parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.desc||l.prec>0);

    const pvLin = document.getElementById("plt_pv_lineas");
    if (pvLin) {
      if (!lineasArr.length) {
        pvLin.innerHTML=`<div style="padding:8px 0;color:#bbb;text-align:center;font-size:8.5px">${L.desc} vacía</div>`;
      } else {
        pvLin.innerHTML = lineasArr.map((l,ri)=>{
          const tot=l.cant*l.prec;
          const bg = estTabla==="rayas"?(ri%2===0?"#f9fafb":"#fff"):"#fff";
          const bdr= estTabla==="bordes"?"border:1px solid #e5e7eb;":"border-bottom:1px solid #f3f4f6;";
          return `<div style="display:grid;grid-template-columns:1fr 28px 50px 28px 52px;gap:2px;padding:5px 0;background:${bg};${bdr}font-size:9px;align-items:center">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.desc}</span>
            <span style="text-align:right;color:#6b7280">${l.cant}</span>
            <span style="text-align:right;color:#6b7280">${l.prec.toFixed(2)}€</span>
            <span style="text-align:right;color:#6b7280">${l.iva}%</span>
            <span style="text-align:right;font-weight:700;font-family:monospace">${tot.toFixed(2)}€</span>
          </div>`;
        }).join("");
      }
    }

    // Totales
    const base = lineasArr.reduce((a,l)=>a+l.cant*l.prec,0);
    const iva  = lineasArr.reduce((a,l)=>a+l.cant*l.prec*l.iva/100,0);
    const pvTot = document.getElementById("plt_pv_totales");
    if (pvTot) pvTot.innerHTML=`
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:2px"><span>${L.base}</span><span style="font-family:monospace">${base.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:5px"><span>IVA</span><span style="font-family:monospace">${iva.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:#111;border-top:2px solid ${colorAcc};padding-top:6px">
        <span>${L.totalDoc}</span><span style="font-family:monospace;color:${colorAcc}">${(base+iva).toFixed(2)} €</span>
      </div>`;

    // Descripción
    const dw = document.getElementById("plt_pv_desc_wrap");
    const dd = document.getElementById("plt_pv_desc");
    if(dw&&dd){ dw.style.display=desc?"":"none"; dd.textContent=desc; }

    // Notas
    const pvN = document.getElementById("plt_pv_notas");
    if(pvN){ pvN.textContent=notas; pvN.style.display=notas?"":"none"; }

    // Pie
    const pieRow = document.getElementById("plt_pv_pie_row");
    const pieTxt = document.getElementById("plt_pv_pie_txt");
    if(pieRow) pieRow.style.display=mostPie?"":"none";
    if(pieTxt) pieTxt.textContent=pie||L.pie;
  }

  // Conectar todos los campos
  const campos = ["plt_concepto","plt_notas","plt_descripcion","plt_pie",
    "plt_color_cab","plt_color_txtcab","plt_color_acento","plt_color_fondo",
    "plt_estilo_cab","plt_estilo_tabla","plt_fuente","plt_tam_fuente",
    "plt_mostrar_logo","plt_mostrar_cab","plt_mostrar_pie","plt_margen"];
  campos.forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.addEventListener("input",  _pv);
    el.addEventListener("change", _pv);
  });
  document.getElementById("plt_lineasContainer")?.addEventListener("input",  _pv);
  document.getElementById("plt_lineasContainer")?.addEventListener("change", _pv);
  _pv(); // preview inicial

  // ── Líneas ──
  let lineaCount = lineas.length;
  document.getElementById("plt_addLinea").addEventListener("click", ()=>{
    document.getElementById("plt_lineasContainer").insertAdjacentHTML("beforeend", _renderLineaPlantilla({}, lineaCount++));
    _pv();
  });
  document.addEventListener("click", e=>{
    if(e.target.closest(".plt-del-linea")){ e.target.closest(".linea-row")?.remove(); _pv(); }
  });

  // ── GUARDAR ──
  document.getElementById("plt_save").addEventListener("click", async ()=>{
    const nombre = document.getElementById("plt_nombre")?.value.trim();
    if (!nombre) {
      window._pltTab("impresion");
      toast("El nombre es obligatorio","error"); return;
    }
    const rows = document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr = [...rows].map(r=>({
      descripcion: r.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:    parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      precio:      parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      iva:         parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.descripcion||l.precio>0);

    const g = id => document.getElementById(id)?.value?.trim()||null;
    const gb= id => document.getElementById(id)?.checked||false;
    const gi= (id,d)=> parseInt(document.getElementById(id)?.value)||d;

    const payload = {
      user_id:          SESSION.user.id,
      nombre,
      concepto:         g("plt_concepto"),
      descripcion:      g("plt_descripcion"),
      notas:            g("plt_notas"),
      texto_pie:        g("plt_pie"),
      iban_visible:     g("plt_iban"),
      idioma:           _idioma,
      lineas:           JSON.stringify(lineasArr),
      color_principal:  g("plt_color_cab")||D.color_cab,
      color_cab:        g("plt_color_cab")||D.color_cab,
      color_txt_cab:    g("plt_color_txtcab")||D.color_txt_cab,
      color_acento:     g("plt_color_acento")||D.color_acento,
      color_fondo:      g("plt_color_fondo")||D.color_fondo,
      fuente:           g("plt_fuente")||"helvetica",
      tam_fuente:       gi("plt_tam_fuente",9),
      estilo_cab:       g("plt_estilo_cab")||"solido",
      estilo_tabla:     g("plt_estilo_tabla")||"rayas",
      margen:           gi("plt_margen",18),
      mostrar_logo:     gb("plt_mostrar_logo"),
      mostrar_cab:      gb("plt_mostrar_cab"),
      mostrar_pie:      gb("plt_mostrar_pie"),
      logo_b64:         _logo||null,
    };

    const btn=document.getElementById("plt_save");
    btn.disabled=true; btn.textContent="Guardando…";

    let err;
    if (isEdit) {
      ({error:err}=await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id));
    } else {
      ({error:err}=await supabase.from("plantillas_usuario").insert(payload));
    }
    if(err){toast("Error: "+err.message,"error");btn.disabled=false;btn.textContent=isEdit?"💾 Actualizar":"✨ Guardar plantilla";return;}

    toast(isEdit?"Plantilla actualizada ✅":"Plantilla creada ✅","success");
    closeModal();
    await refreshPlantillas();
  });

  if (isEdit) {
    document.getElementById("plt_del")?.addEventListener("click", async()=>{
      if(!confirm("¿Eliminar esta plantilla? No se puede deshacer."))return;
      await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
      closeModal(); toast("Plantilla eliminada","success");
      await refreshPlantillas();
    });
  }
}

function _renderLineaPlantilla(l = {}, idx = 0) {
  return `
    <div class="linea-row" style="grid-template-columns:1fr 60px 100px 60px 32px">
      <input autocomplete="off" class="ff-input" data-field="descripcion" value="${l.descripcion || ""}" placeholder="Descripción"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="cantidad" value="${l.cantidad || 1}" min="0.01" step="0.01"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="precio" value="${l.precio || ""}" step="0.01" placeholder="0.00"/>
      <select class="ff-select" data-field="iva">
        <option value="21" ${(l.iva || 21) === 21 ? "selected" : ""}>21%</option>
        <option value="10" ${l.iva === 10 ? "selected" : ""}>10%</option>
        <option value="4" ${l.iva === 4 ? "selected" : ""}>4%</option>
        <option value="0" ${l.iva === 0 ? "selected" : ""}>0%</option>
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
  const p = PLANTILLAS.find(x => x.id === plantillaId);
  if (!p) return null;
  return {
    concepto: p.concepto,
    notas: p.notas,
    lineas: p.lineas ? JSON.parse(p.lineas) : [],
    color_principal: p.color_principal,
    texto_pie: p.texto_pie,
    iban_visible: p.iban_visible,
  };
}

/* Selector de plantilla — se usa en nuevo presupuesto y nueva factura */
export function renderPlantillaSelector(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container || !PLANTILLAS.length) return;

  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span style="font-size:12px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
      ${PLANTILLAS.map(p => `
        <button class="btn-outline plt-selector-btn" data-plt-id="${p.id}" style="font-size:12px;padding:5px 12px">
          ${p.nombre}
        </button>`).join("")}
      <button class="btn-outline plt-selector-btn" data-plt-id="" style="font-size:12px;padding:5px 12px;color:var(--t4)">
        En blanco
      </button>
    </div>`;

  container.querySelectorAll(".plt-selector-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".plt-selector-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const data = btn.dataset.pltId ? getPlantillaData(btn.dataset.pltId) : null;
      if (onSelect) onSelect(data);
    });
  });
}

/* ══════════════════════════
   GLOBAL HANDLERS
══════════════════════════ */
window._nuevaPlantilla = () => showPlantillaModal();
window._editPlantilla = (id) => {
  const p = PLANTILLAS.find(x => x.id === id);
  if (p) showPlantillaModal(p);
};
window._delPlantilla = (id) => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla?</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpltOk").addEventListener("click", async () => {
    await supabase.from("plantillas_usuario").delete().eq("id", id);
    closeModal(); toast("Plantilla eliminada", "success");
    await refreshPlantillas();
  });
};
window._usarPlantillaFactura = (id) => {
  const data = getPlantillaData(id);
  if (!data) return;
  // Navegar a nueva factura y aplicar plantilla
  window._switchView?.("nueva-factura");
  // Dejar un tick para que la vista se renderice
  setTimeout(() => window._applyPlantillaToFactura?.(data), 200);
};
window._usarPlantillaPres = (id) => {
  const data = getPlantillaData(id);
  if (!data) return;
  window._switchView?.("presupuestos");
  setTimeout(() => window._editPres?.("new_from_template_" + id), 200);
};

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initPlantillasView() {
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click", () => showPlantillaModal());
  refreshPlantillas();
}
