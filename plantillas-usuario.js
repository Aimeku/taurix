/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js
   ─ Editor profesional de plantillas de documentos
   ─ Diseño, logo, fuentes, colores, márgenes, visibilidad
   ─ Preview PDF en tiempo real
   ─ ES / EN (idioma del documento)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

export async function loadPlantillas() {
  const { data, error } = await supabase.from("plantillas_usuario")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("plantillas:", error.message); return []; }
  return data || [];
}

export async function refreshPlantillas() {
  PLANTILLAS = await loadPlantillas();
  _renderGrid();
}

function _renderGrid() {
  const wrap = document.getElementById("plantillasGrid");
  if (!wrap) return;
  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--t3)">
        <div style="font-size:52px;margin-bottom:14px">📄</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:var(--t1)">Sin plantillas todavía</div>
        <div style="font-size:13px;margin-bottom:24px;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto">
          Crea plantillas con tu logo, colores y estilo para que todos tus documentos tengan imagen de marca.
        </div>
        <button class="btn-primary" onclick="window._nuevaPlantilla()" style="padding:11px 28px">✨ Crear primera plantilla</button>
      </div>`;
    return;
  }
  const COLS = ["#3b82f6","#f97316","#059669","#8b5cf6","#ef4444","#0ea5e9","#ec4899","#14b8a6"];
  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const lineas = p.lineas ? JSON.parse(p.lineas) : [];
    const base   = lineas.reduce((a, l) => a + (l.cantidad||1)*(l.precio||0), 0);
    const color  = p.color_cabecera || COLS[i % COLS.length];
    return `
      <div class="doc-card" style="text-align:left;border-top:3px solid ${color};cursor:pointer" onclick="window._editPlantilla('${p.id}')">
        <div style="background:${color}18;border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
          ${p.logo_b64 ? `<img src="${p.logo_b64}" style="max-height:24px;max-width:60px;object-fit:contain"/>` : `<span style="font-size:11px;font-weight:700;color:${color}">${p.nombre}</span>`}
          <span style="font-size:10px;color:${color};font-weight:700">${p.fuente||"Helvetica"}</span>
        </div>
        <div class="doc-card-name" style="margin:0 0 4px">${p.nombre}</div>
        <div class="doc-card-desc" style="margin-bottom:8px">${p.concepto||"Sin concepto"}</div>
        ${base > 0 ? `<div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">${fmt(base)}</div>` : ""}
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:10px;padding:2px 7px;border-radius:5px;background:${color}15;color:${color};font-weight:600">${lineas.length} línea${lineas.length!==1?"s":""}</span>
          ${p.idioma==="en"?`<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:#f0f9ff;color:#0369a1;font-weight:600">EN</span>`:`<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:#fef9c3;color:#854d0e;font-weight:600">ES</span>`}
        </div>
        <div style="display:flex;gap:5px">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')" style="font-size:10px">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')" style="font-size:10px">📋 Presupuesto</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')" style="font-size:10px">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

function _lineaHTML(l) {
  l = l || {};
  return `<div class="linea-row" style="grid-template-columns:1fr 58px 96px 56px 30px">
    <input autocomplete="off" class="ff-input" data-field="descripcion" value="${(l.descripcion||"").replace(/"/g,'&quot;')}" placeholder="Descripción"/>
    <input autocomplete="off" type="number" class="ff-input" data-field="cantidad" value="${l.cantidad||1}" min="0.01" step="0.01"/>
    <input autocomplete="off" type="number" class="ff-input" data-field="precio" value="${l.precio||""}" step="0.01" placeholder="0.00"/>
    <select class="ff-select" data-field="iva">
      <option value="21" ${(l.iva||21)===21?"selected":""}>21%</option>
      <option value="10" ${l.iva===10?"selected":""}>10%</option>
      <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
      <option value="0"  ${l.iva===0 ?"selected":""}>0%</option>
    </select>
    <button class="linea-del plt-del-linea" title="Eliminar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

export function showPlantillaModal(prefill) {
  prefill = prefill || {};
  const isEdit = !!prefill.id;
  const lineas = prefill.lineas
    ? (typeof prefill.lineas==="string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{descripcion:"", cantidad:1, precio:0, iva:21}];

  const D = {
    nombre:          prefill.nombre          || "",
    concepto:        prefill.concepto        || "",
    descripcion:     prefill.descripcion     || "",
    notas:           prefill.notas           || "",
    texto_pie:       prefill.texto_pie       || "",
    iban:            prefill.iban_visible    || "",
    logo:            prefill.logo_b64        || "",
    idioma:          prefill.idioma          || "es",
    fuente:          prefill.fuente          || "Helvetica",
    tam_fuente:      prefill.tam_fuente      || 9,
    color_cabecera:  prefill.color_cabecera  || "#1a56db",
    color_txt_cab:   prefill.color_txt_cab   || "#ffffff",
    color_acento:    prefill.color_acento    || "#1a56db",
    color_letra:     prefill.color_letra     || "#0f172a",
    color_fondo:     prefill.color_fondo     || "#ffffff",
    color_fondo_tab: prefill.color_fondo_tab || "#f8fafc",
    color_lineas:    prefill.color_lineas    || "#e2e8f0",
    estilo_cab:      prefill.estilo_cab      || "solido",
    tamano_hoja:     prefill.tamano_hoja     || "A4",
    margen:          prefill.margen          || 18,
    pie_altura:      prefill.pie_altura      || 14,
    alin_texto:      prefill.alin_texto      || "izq",
    mostrar_logo:    prefill.mostrar_logo    !== false,
    mostrar_cab:     prefill.mostrar_cab     !== false,
    mostrar_pie:     prefill.mostrar_pie     !== false,
    mostrar_emisor:  prefill.mostrar_emisor  !== false,
    mostrar_email:   prefill.mostrar_email   !== false,
    mostrar_num_pag: prefill.mostrar_num_pag !== false,
    cab_todas_pags:  prefill.cab_todas_pags  || false,
  };

  if (!document.getElementById("_plt_css")) {
    const s = document.createElement("style"); s.id = "_plt_css";
    s.textContent = `.plt-tab{padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--t3);transition:all .15s}.plt-tab.on{border-bottom-color:var(--accent);color:var(--accent);background:var(--srf)}.plt-sec{display:none}.plt-sec.on{display:block}.plt-group{font-size:10.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--brd)}.plt-r2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.plt-cpair{display:flex;gap:5px;align-items:center;margin-top:4px}.plt-cpair input[type=color]{width:34px;height:34px;padding:2px;border:1.5px solid var(--brd);border-radius:6px;cursor:pointer;flex-shrink:0}.plt-cpair input[type=text]{flex:1;font-family:monospace;font-size:11px;padding:5px 7px;border:1.5px solid var(--brd);border-radius:6px;background:var(--bg2);min-width:0}.plt-tog{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--bg2);border:1px solid var(--brd);border-radius:8px;cursor:pointer;font-size:12px}.plt-tog input{width:15px;height:15px;accent-color:var(--accent)}.plt-togs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px}`;
    document.head.appendChild(s);
  }

  const col = (id, lbl, val) => `<div class="modal-field"><label style="font-size:11px">${lbl}</label><div class="plt-cpair"><input type="color" id="${id}" value="${val}"/><input type="text" id="${id}_hex" value="${val}" maxlength="7"/></div></div>`;
  const tog = (id, lbl, val) => `<label class="plt-tog"><span>${lbl}</span><input type="checkbox" id="${id}" ${val?"checked":""}/></label>`;

  const cabPvStyle = D.estilo_cab==="sin" ? "display:none" :
    D.estilo_cab==="linea" ? `background:transparent;border-bottom:3px solid ${D.color_cabecera}` :
    D.estilo_cab==="gradiente" ? `background:linear-gradient(135deg,${D.color_cabecera},${D.color_acento})` :
    `background:${D.color_cabecera}`;

  openModal(`<div class="modal" style="max-width:1080px;width:97vw;height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--brd);flex-shrink:0">
      <span class="modal-title" style="font-size:15px">✨ ${isEdit?"Editar":"Nueva"} plantilla</span>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="display:flex;border:1.5px solid var(--brd);border-radius:8px;overflow:hidden">
          <button id="plt_lang_es" style="padding:5px 14px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${D.idioma==="es"?"var(--accent)":"var(--bg2)"};color:${D.idioma==="es"?"#fff":"var(--t2)"}">ES</button>
          <button id="plt_lang_en" style="padding:5px 14px;font-size:12px;font-weight:700;border:none;cursor:pointer;background:${D.idioma==="en"?"var(--accent)":"var(--bg2)"};color:${D.idioma==="en"?"#fff":"var(--t2)"}">EN</button>
        </div>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
    </div>
    <div style="display:flex;border-bottom:1px solid var(--brd);background:var(--bg2);flex-shrink:0">
      <button class="plt-tab on"  data-tab="diseno"    onclick="window._pltTab('diseno')">🎨 Diseño</button>
      <button class="plt-tab"     data-tab="fuente"    onclick="window._pltTab('fuente')">🔤 Fuente</button>
      <button class="plt-tab"     data-tab="contenido" onclick="window._pltTab('contenido')">📝 Contenido</button>
      <button class="plt-tab"     data-tab="avanzado"  onclick="window._pltTab('avanzado')">⚙️ Avanzado</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 320px;flex:1;overflow:hidden;min-height:0">
      <div style="overflow-y:auto;padding:4px 22px 20px">
        <div style="padding:14px 0 0">
          <div class="plt-r2" style="margin-bottom:0">
            <div class="modal-field"><label>Nombre de la plantilla *</label><input autocomplete="off" id="plt_nombre" class="ff-input" value="${D.nombre.replace(/"/g,'&quot;')}" placeholder="Ej: Factura servicios mensuales"/></div>
            <div class="modal-field"><label>Concepto predeterminado</label><input autocomplete="off" id="plt_concepto" class="ff-input" value="${D.concepto.replace(/"/g,'&quot;')}" placeholder="Ej: Consultoría mensual"/></div>
          </div>
        </div>
        <div id="plt-tab-diseno" class="plt-sec on">
          <div class="plt-group">🖼️ Logo</div>
          <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px">
            <div id="plt_logo_prev" onclick="document.getElementById('plt_logo_inp').click()" style="width:92px;height:58px;border:2px dashed var(--brd);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--srf2);cursor:pointer;flex-shrink:0">
              ${D.logo?`<img src="${D.logo}" style="max-width:88px;max-height:54px;object-fit:contain"/>`:`<span style="font-size:10px;color:var(--t4);text-align:center;line-height:1.4">Click<br>subir</span>`}
            </div>
            <input type="file" id="plt_logo_inp" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none"/>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button type="button" class="btn-outline" id="plt_logo_btn" style="font-size:12px;padding:6px 14px">${D.logo?"📁 Cambiar":"📁 Subir logo"}</button>
              <button type="button" class="btn-outline" id="plt_logo_rm" style="font-size:12px;padding:6px 14px;color:#dc2626;border-color:#dc2626;${D.logo?"":"display:none"}">🗑️ Quitar</button>
              <span style="font-size:10px;color:var(--t4)">PNG/JPG/SVG · Máx 500KB</span>
            </div>
          </div>
          <label class="plt-tog" style="margin-bottom:16px">${tog("plt_mostrar_logo","Mostrar logo en el documento",D.mostrar_logo)}</label>
          <div class="plt-group">📋 Cabecera y hoja</div>
          <div class="plt-r2">
            <div class="modal-field"><label>Estilo de cabecera</label>
              <select id="plt_estilo_cab" class="ff-select">
                <option value="solido"    ${D.estilo_cab==="solido"   ?"selected":""}>Fondo sólido</option>
                <option value="gradiente" ${D.estilo_cab==="gradiente"?"selected":""}>Gradiente</option>
                <option value="linea"     ${D.estilo_cab==="linea"    ?"selected":""}>Solo línea inferior</option>
                <option value="sin"       ${D.estilo_cab==="sin"      ?"selected":""}>Sin cabecera</option>
              </select>
            </div>
            <div class="modal-field"><label>Tamaño de hoja</label>
              <select id="plt_tamano_hoja" class="ff-select">
                ${["A4","A3","Letter","Legal"].map(s=>`<option value="${s}" ${D.tamano_hoja===s?"selected":""}>${s}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="plt-group">🎨 Colores</div>
          <div class="plt-r2">
            ${col("plt_color_cabecera","Color de cabeceras",D.color_cabecera)}
            ${col("plt_color_txt_cab","Color letra en cabecera",D.color_txt_cab)}
            ${col("plt_color_acento","Color acento / tabla",D.color_acento)}
            ${col("plt_color_letra","Color de letra (texto)",D.color_letra)}
            ${col("plt_color_fondo","Color de fondo",D.color_fondo)}
            ${col("plt_color_fondo_tab","Color fondo de tablas",D.color_fondo_tab)}
            ${col("plt_color_lineas","Color líneas de tabla",D.color_lineas)}
          </div>
          <div class="plt-group">📐 Márgenes y pie</div>
          <div class="plt-r2">
            <div class="modal-field"><label>Margen general (mm)</label>
              <select id="plt_margen" class="ff-select">${[10,12,14,16,18,20,22,25].map(v=>`<option value="${v}" ${D.margen===v?"selected":""}>${v} mm</option>`).join("")}</select>
            </div>
            <div class="modal-field"><label>Altura pie de página (mm)</label>
              <select id="plt_pie_altura" class="ff-select">${[8,10,12,14,16,18,20].map(v=>`<option value="${v}" ${D.pie_altura===v?"selected":""}>${v} mm</option>`).join("")}</select>
            </div>
          </div>
          <div class="plt-group">👁️ Visibilidad</div>
          <div class="plt-togs">
            ${tog("plt_mostrar_cab",    "Mostrar cabecera",           D.mostrar_cab)}
            ${tog("plt_mostrar_pie",    "Mostrar pie de página",      D.mostrar_pie)}
            ${tog("plt_mostrar_emisor", "Mostrar datos del emisor",   D.mostrar_emisor)}
            ${tog("plt_mostrar_email",  "Mostrar email del emisor",   D.mostrar_email)}
            ${tog("plt_mostrar_num_pag","Numeración de páginas",      D.mostrar_num_pag)}
            ${tog("plt_cab_todas_pags", "Cabecera en todas las págs.",D.cab_todas_pags)}
          </div>
        </div>
        <div id="plt-tab-fuente" class="plt-sec">
          <div class="plt-group" style="margin-top:20px">🔤 Tipografía</div>
          <div class="plt-r2">
            <div class="modal-field"><label>Fuente del documento</label>
              <select id="plt_fuente" class="ff-select">
                ${["Helvetica","Arial","Courier New","Times New Roman","Georgia","Trebuchet MS","Verdana","Garamond"].map(f=>`<option value="${f}" ${D.fuente===f?"selected":""}>${f}</option>`).join("")}
              </select>
            </div>
            <div class="modal-field"><label>Tamaño de fuente (pt)</label>
              <select id="plt_tam_fuente" class="ff-select">${[7,8,9,10,11,12].map(s=>`<option value="${s}" ${D.tam_fuente===s?"selected":""}>${s} pt</option>`).join("")}</select>
            </div>
          </div>
          <div class="modal-field" style="margin-bottom:14px"><label>Alineación del texto</label>
            <div style="display:flex;gap:6px;margin-top:6px" id="plt_alin_group">
              ${[["izq","← Izq."],["centro","▬ Centro"],["der","→ Der."]].map(([v,lbl])=>`
                <button type="button" data-alin="${v}"
                  onclick="document.querySelectorAll('#plt_alin_group button').forEach(b=>{b.style.background=b.dataset.alin==='${v}'?'var(--accent)':'var(--bg2)';b.style.color=b.dataset.alin==='${v}'?'#fff':'var(--t2)';b.style.borderColor=b.dataset.alin==='${v}'?'var(--accent)':'var(--brd)';});window._pltAlin('${v}');"
                  style="padding:7px 13px;border:1.5px solid ${D.alin_texto===v?'var(--accent)':'var(--brd)'};border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;background:${D.alin_texto===v?'var(--accent)':'var(--bg2)'};color:${D.alin_texto===v?'#fff':'var(--t2)'};transition:all .15s">
                  ${lbl}
                </button>`).join("")}
            </div>
            <input type="hidden" id="plt_alin_val" value="${D.alin_texto}"/>
          </div>
          <div class="plt-group">Vista previa de tipografía</div>
          <div id="plt_font_preview" style="border:1px solid var(--brd);border-radius:10px;padding:16px;background:var(--srf2);line-height:1.8">
            <div style="font-weight:700;font-size:15px">FACTURA · FAC-2025-001</div>
            <div style="font-size:12px;color:var(--t3)">Concepto de ejemplo · 1.210,00 €</div>
            <div style="font-size:11px;color:var(--t4)">Descripción del servicio prestado</div>
          </div>
        </div>
        <div id="plt-tab-contenido" class="plt-sec">
          <div style="margin-top:20px"></div>
          <div class="modal-field" style="margin-bottom:12px"><label>Descripción / Alcance del servicio</label>
            <textarea autocomplete="off" id="plt_descripcion" class="ff-input ff-textarea" style="min-height:70px" placeholder="Aparece en el cuerpo del documento.">${D.descripcion}</textarea>
          </div>
          <div class="modal-field" style="margin-bottom:20px"><label>Notas / Condiciones de pago</label>
            <textarea autocomplete="off" id="plt_notas" class="ff-input ff-textarea" style="min-height:60px" placeholder="Forma de pago, plazo, garantías…">${D.notas}</textarea>
          </div>
          <div class="plt-group">📋 Líneas predefinidas</div>
          <div class="lineas-header" style="grid-template-columns:1fr 58px 96px 56px 30px;font-size:10px">
            <div>Descripción</div><div>Cantidad</div><div>Precio (€)</div><div>IVA</div><div></div>
          </div>
          <div id="plt_lineasContainer">${lineas.map(l=>_lineaHTML(l)).join("")}</div>
          <button class="btn-add-linea" id="plt_addLinea" style="margin-top:8px">+ Añadir línea</button>
        </div>
        <div id="plt-tab-avanzado" class="plt-sec">
          <div style="margin-top:20px"></div>
          <div class="plt-r2">
            <div class="modal-field"><label>Texto legal del pie</label><input autocomplete="off" id="plt_pie" class="ff-input" value="${D.texto_pie}" placeholder="Inscrita en el RM de Madrid…"/></div>
            <div class="modal-field"><label>IBAN visible en el PDF</label><input autocomplete="off" id="plt_iban" class="ff-input" value="${D.iban}" placeholder="ES00 0000 0000 00 0000 0000"/></div>
          </div>
        </div>
      </div>
      <div style="background:var(--bg2);border-left:1px solid var(--brd);overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em">👁 Vista previa</div>
        <div id="plt_pv_doc" style="background:#fff;border-radius:8px;box-shadow:0 2px 16px rgba(0,0,0,.12);overflow:hidden;font-size:10px">
          <!-- Fila logo+cabecera: siempre tienen la misma fila para que el logo no se mueva -->
          <div style="position:relative;min-height:${D.logo&&D.mostrar_logo?"46px":"0"}">
            <!-- Logo: siempre arriba derecha, independiente de la cabecera -->
            <div id="plt_pv_logo_row" style="position:absolute;top:6px;right:12px;z-index:2;display:${D.logo&&D.mostrar_logo?"block":"none"}">
              <img id="plt_pv_logo_img" src="${D.logo||''}" style="max-height:30px;max-width:66px;object-fit:contain;display:block"/>
            </div>
            <!-- Cabecera: puede ocultarse sin llevarse el logo -->
            <div id="plt_pv_cab" style="padding:12px 14px;${cabPvStyle}">
              <div id="plt_pv_tipo" style="font-size:8px;font-weight:800;letter-spacing:.12em;opacity:.65;color:${D.color_txt_cab}">FACTURA</div>
              <div id="plt_pv_concepto" style="font-size:13px;font-weight:700;color:${D.color_txt_cab};margin-top:2px;padding-right:${D.logo&&D.mostrar_logo?"72px":"0"}">${D.concepto||"Concepto del documento"}</div>
              <div style="font-size:9px;opacity:.6;color:${D.color_txt_cab};margin-top:1px">FAC-2025-001 · ${new Date().toLocaleDateString("es-ES")}</div>
            </div>
          </div>
          <div id="plt_pv_emisor_row" style="display:${D.mostrar_emisor?"grid":"none"};grid-template-columns:1fr 1fr;gap:2px;padding:5px 12px;border-bottom:1px solid #e5e7eb">
            <div>
              <div id="plt_pv_lbl_de" style="font-size:6px;font-weight:700;text-transform:uppercase;color:#9ca3af;letter-spacing:.06em">EMISOR</div>
              <div style="font-weight:700;font-size:8.5px;color:#111;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Tu empresa SL</div>
              <div style="font-size:7.5px;color:#6b7280">NIF: B12345678</div>
            </div>
            <div>
              <div id="plt_pv_lbl_para" style="font-size:6px;font-weight:700;text-transform:uppercase;color:#9ca3af;letter-spacing:.06em">CLIENTE</div>
              <div style="font-weight:700;font-size:8.5px;color:#111;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Empresa Cliente</div>
              <div style="font-size:7.5px;color:#6b7280">NIF: A98765432</div>
            </div>
          </div>
          <div id="plt_pv_desc_wrap" style="padding:7px 14px;border-bottom:1px solid #f3f4f6;display:none"><div id="plt_pv_desc" style="font-size:8.5px;color:#6b7280;line-height:1.5"></div></div>
          <div style="padding:0 14px">
            <div id="plt_pv_tabla_head" style="display:grid;grid-template-columns:1fr 28px 50px 28px 52px;padding:6px 14px 4px;font-size:7.5px;font-weight:700;text-transform:uppercase;color:#fff;background:${D.color_acento};margin:0 -14px;letter-spacing:.04em">
              <span id="plt_pv_h_desc">Descripción</span><span style="text-align:right" id="plt_pv_h_cant">Cant</span><span style="text-align:right" id="plt_pv_h_precio">Precio</span><span style="text-align:right" id="plt_pv_h_iva">IVA</span><span style="text-align:right" id="plt_pv_h_total">Total</span>
            </div>
            <div id="plt_pv_lineas"><div style="padding:8px 0;font-size:8.5px;color:#9ca3af;text-align:center">Sin líneas definidas</div></div>
          </div>
          <div id="plt_pv_totales" style="padding:10px 14px;background:#f9fafb;border-top:1px solid #e5e7eb"></div>
          <div id="plt_pv_notas" style="padding:7px 14px;font-size:8.5px;color:#6b7280;border-top:1px solid #e5e7eb;display:none;line-height:1.5"></div>
          <div id="plt_pv_pie" style="padding:5px 14px;font-size:8px;color:#9ca3af;border-top:1px solid #e5e7eb;display:${D.mostrar_pie?"flex":"none"};justify-content:space-between">
            <span id="plt_pv_pie_txt">${D.texto_pie||"Texto legal del pie"}</span><span>Pág. 1</span>
          </div>
        </div>
        <div style="font-size:10px;color:var(--t4);line-height:1.6;padding:8px 10px;background:var(--srf);border-radius:7px;border:1px solid var(--brd)">
          💡 Vista previa aproximada. El PDF final usará tus datos fiscales reales.
        </div>
      </div>
    </div>
    <div class="modal-ft" style="flex-shrink:0;padding:12px 20px;border-top:1px solid var(--brd)">
      ${isEdit?`<button class="btn-modal-danger" id="plt_del" style="margin-right:auto">🗑️ Eliminar</button>`:""}
      <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
      <button class="btn-modal-save" id="plt_save" style="padding:10px 26px">${isEdit?"💾 Actualizar":"✨ Guardar plantilla"}</button>
    </div>
  </div>`);

  // ── Estado interno ──
  let _logo   = D.logo;
  let _idioma = D.idioma;

  const LABELS_ES = {tipo:"FACTURA",de:"EMISOR",para:"CLIENTE",cant:"Cant",precio:"Precio",iva:"IVA",total:"Total",base:"Base imponible",totalDoc:"TOTAL"};
  const LABELS_EN = {tipo:"INVOICE",de:"FROM",para:"BILL TO",cant:"Qty",precio:"Price",iva:"VAT",total:"Total",base:"Subtotal",totalDoc:"TOTAL"};

  // Tabs
  window._pltTab = (tab) => {
    document.querySelectorAll(".plt-tab").forEach(b => b.classList.toggle("on", b.dataset.tab===tab));
    document.querySelectorAll(".plt-sec").forEach(s => s.classList.toggle("on", s.id===`plt-tab-${tab}`));
  };

  // Alineación: guardar valor en hidden input y actualizar preview
  window._pltAlin = (v) => {
    const inp = document.getElementById("plt_alin_val");
    if (inp) inp.value = v;
    _pv();
  };

  // Idioma
  const _setLang = (lang) => {
    _idioma = lang;
    const L = lang==="en" ? LABELS_EN : LABELS_ES;
    const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    s("plt_pv_tipo",L.tipo); s("plt_pv_lbl_de",L.de); s("plt_pv_lbl_para",L.para);
    s("plt_pv_h_desc",lang==="en"?"Description":"Descripción"); s("plt_pv_h_cant",L.cant);
    s("plt_pv_h_precio",L.precio); s("plt_pv_h_iva",L.iva); s("plt_pv_h_total",L.total);
    document.getElementById("plt_lang_es").style.background = lang==="es"?"var(--accent)":"var(--bg2)";
    document.getElementById("plt_lang_es").style.color      = lang==="es"?"#fff":"var(--t2)";
    document.getElementById("plt_lang_en").style.background = lang==="en"?"var(--accent)":"var(--bg2)";
    document.getElementById("plt_lang_en").style.color      = lang==="en"?"#fff":"var(--t2)";
    _pv();
  };
  document.getElementById("plt_lang_es").addEventListener("click", ()=>_setLang("es"));
  document.getElementById("plt_lang_en").addEventListener("click", ()=>_setLang("en"));

  // Logo
  const logoInp=document.getElementById("plt_logo_inp");
  const logoPrev=document.getElementById("plt_logo_prev");
  const logoBtn=document.getElementById("plt_logo_btn");
  const logoRm=document.getElementById("plt_logo_rm");
  logoBtn.addEventListener("click",()=>logoInp.click());
  logoInp.addEventListener("change",e=>{
    const f=e.target.files[0]; if(!f)return;
    if(f.size>500*1024){toast("Logo máx. 500KB","error");return;}
    const r=new FileReader();
    r.onload=ev=>{
      _logo=ev.target.result;
      logoPrev.innerHTML=`<img src="${_logo}" style="max-width:88px;max-height:54px;object-fit:contain"/>`;
      logoBtn.textContent="📁 Cambiar"; logoRm.style.display=""; _pv();
    };
    r.readAsDataURL(f);
  });
  logoRm.addEventListener("click",()=>{
    _logo="";
    logoPrev.innerHTML=`<span style="font-size:10px;color:var(--t4);text-align:center;line-height:1.4">Click<br>subir</span>`;
    logoBtn.textContent="📁 Subir logo"; logoRm.style.display="none"; _pv();
  });

  // Color pickers
  ["plt_color_cabecera","plt_color_txt_cab","plt_color_acento","plt_color_letra","plt_color_fondo","plt_color_fondo_tab","plt_color_lineas"].forEach(id=>{
    const pick=document.getElementById(id);
    const hex=document.getElementById(id+"_hex");
    if(!pick||!hex)return;
    pick.addEventListener("input",()=>{hex.value=pick.value;_pv();});
    hex.addEventListener("change",()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value.trim())){pick.value=hex.value.trim();}  _pv();});
  });

  const FONT_MAP={"Helvetica":"Helvetica,Arial,sans-serif","Arial":"Arial,sans-serif","Courier New":"'Courier New',monospace","Times New Roman":"'Times New Roman',Times,serif","Georgia":"Georgia,serif","Trebuchet MS":"'Trebuchet MS',sans-serif","Verdana":"Verdana,sans-serif","Garamond":"Garamond,serif"};

  function _pv() {
    const L=_idioma==="en"?LABELS_EN:LABELS_ES;
    const g=id=>document.getElementById(id);
    const gv=id=>g(id)?.value||"";
    const gc=id=>g(id)?.checked;

    // Leer valores de los inputs — si el input no existe en DOM, usar el valor guardado en D
    const _gv = (id, fallback) => { const el=g(id); return (el&&el.value) ? el.value : fallback; };
    const colorCab  = _gv("plt_color_cabecera", D.color_cabecera);
    const colorTxtC = _gv("plt_color_txt_cab",  D.color_txt_cab);
    const colorAcc  = _gv("plt_color_acento",   D.color_acento);
    const colorLetra= _gv("plt_color_letra",    D.color_letra);
    const colorFdo  = _gv("plt_color_fondo",    D.color_fondo);
    const colorFdoT = _gv("plt_color_fondo_tab",D.color_fondo_tab);
    const colorLin  = _gv("plt_color_lineas",   D.color_lineas);
    const estCab    = _gv("plt_estilo_cab",     D.estilo_cab);
    const fuente    = _gv("plt_fuente",         D.fuente);
    const tamFuente = parseInt(_gv("plt_tam_fuente", String(D.tam_fuente)))||9;
    // gc puede ser undefined si el elemento no está en el DOM visible — fallback al valor D.*
    const mostLogo   = g("plt_mostrar_logo")   ? gc("plt_mostrar_logo")   : D.mostrar_logo;
    const mostCab    = g("plt_mostrar_cab")     ? gc("plt_mostrar_cab")    : D.mostrar_cab;
    const mostPie    = g("plt_mostrar_pie")     ? gc("plt_mostrar_pie")    : D.mostrar_pie;
    const mostEmisor = g("plt_mostrar_emisor")  ? gc("plt_mostrar_emisor") : D.mostrar_emisor;
    const concepto=gv("plt_concepto")||"Concepto del documento";
    const notas=gv("plt_notas")||"";
    const desc=gv("plt_descripcion")||"";
    const pie=gv("plt_pie")||"";
    const alin=document.getElementById("plt_alin_val")?.value||"izq";
    const alinCSS=alin==="centro"?"center":alin==="der"?"right":"left";

    // Doc
    const doc=g("plt_pv_doc");
    if(doc){doc.style.fontFamily=FONT_MAP[fuente]||FONT_MAP["Helvetica"];doc.style.background=colorFdo;doc.style.color=colorLetra;doc.style.fontSize=(tamFuente+1)+"px";doc.style.textAlign=alinCSS;}

    // Logo: INDEPENDIENTE de la cabecera — siempre en su propio div absoluto
    const logoRow=g("plt_pv_logo_row");const logoImg=g("plt_pv_logo_img");
    if(logoRow){
      logoRow.style.display=(mostLogo&&_logo)?"block":"none";
      if(logoImg&&_logo) logoImg.src=_logo;
    }

    // Cabecera: se puede ocultar sin llevarse el logo
    const cab=g("plt_pv_cab");
    if(cab){
      if(!mostCab||estCab==="sin"){cab.style.display="none";}
      else{
        cab.style.display="";
        if(estCab==="solido")   {cab.style.background=colorCab;cab.style.borderBottom="none";}
        if(estCab==="gradiente"){cab.style.background=`linear-gradient(135deg,${colorCab},${colorAcc})`;cab.style.borderBottom="none";}
        if(estCab==="linea")    {cab.style.background="transparent";cab.style.borderBottom=`3px solid ${colorCab}`;}
      }
    }
    const pvC=g("plt_pv_concepto");const pvT=g("plt_pv_tipo");
    if(pvC){pvC.textContent=concepto;pvC.style.color=colorTxtC;pvC.style.paddingRight=(mostLogo&&_logo)?"72px":"0";}
    if(pvT){pvT.textContent=L.tipo;pvT.style.color=colorTxtC;}

    // Emisor
    const er=g("plt_pv_emisor_row");if(er)er.style.display=mostEmisor?"grid":"none";

    // Labels
    const s=(id,v)=>{const el=g(id);if(el)el.textContent=v;};
    s("plt_pv_lbl_de",L.de);s("plt_pv_lbl_para",L.para);
    s("plt_pv_h_desc",_idioma==="en"?"Description":"Descripción");
    s("plt_pv_h_cant",L.cant);s("plt_pv_h_precio",L.precio);s("plt_pv_h_iva",L.iva);s("plt_pv_h_total",L.total);

    // Tabla head color
    const th=g("plt_pv_tabla_head");if(th)th.style.background=colorAcc;

    // Descripción
    const dw=g("plt_pv_desc_wrap");const dd=g("plt_pv_desc");
    if(dw&&dd){dw.style.display=desc?"":"none";dd.textContent=desc;}

    // Líneas
    const rows=document.querySelectorAll("#plt_lineasContainer .linea-row");
    const larr=[...rows].map(r=>({
      d:r.querySelector("[data-field='descripcion']")?.value||"",
      c:parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      p:parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      i:parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.d||l.p>0);

    const pvLin=g("plt_pv_lineas");
    if(pvLin){
      if(!larr.length){pvLin.innerHTML=`<div style="padding:8px 0;font-size:8.5px;color:#9ca3af;text-align:center">Sin líneas definidas</div>`;}
      else{pvLin.innerHTML=larr.map((l,ri)=>{
        const tot=l.c*l.p;
        const bg=ri%2===0?colorFdoT:"#fff";
        return `<div style="display:grid;grid-template-columns:1fr 28px 50px 28px 52px;padding:5px 0;background:${bg};border-bottom:1px solid ${colorLin};font-size:9px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left">${l.d}</span>
          <span style="text-align:right">${l.c}</span>
          <span style="text-align:right">${l.p.toFixed(2)}€</span>
          <span style="text-align:right">${l.i}%</span>
          <span style="text-align:right;font-weight:700;font-family:monospace">${tot.toFixed(2)}€</span>
        </div>`;
      }).join("");}
    }

    // Totales
    const base=larr.reduce((a,l)=>a+l.c*l.p,0);
    const iva=larr.reduce((a,l)=>a+l.c*l.p*l.i/100,0);
    const pvTot=g("plt_pv_totales");
    if(pvTot)pvTot.innerHTML=`
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:2px"><span>${L.base}</span><span style="font-family:monospace">${base.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:5px"><span>IVA</span><span style="font-family:monospace">${iva.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:#111;border-top:2px solid ${colorAcc};padding-top:6px">
        <span>${L.totalDoc}</span><span style="font-family:monospace;color:${colorAcc}">${(base+iva).toFixed(2)} €</span>
      </div>`;

    // Notas
    const pvN=g("plt_pv_notas");if(pvN){pvN.textContent=notas;pvN.style.display=notas?"":"none";}

    // Pie
    const pvP=g("plt_pv_pie");const pvPT=g("plt_pv_pie_txt");
    if(pvP)pvP.style.display=mostPie?"flex":"none";
    if(pvPT)pvPT.textContent=pie||"Texto legal del pie";

    // Font preview
    const fp=g("plt_font_preview");
    if(fp){fp.style.fontFamily=FONT_MAP[fuente]||FONT_MAP["Helvetica"];fp.style.fontSize=(tamFuente+2)+"px";}
  }

  // Conectar inputs
  ["plt_nombre","plt_concepto","plt_notas","plt_descripcion","plt_pie",
   "plt_estilo_cab","plt_tamano_hoja","plt_fuente","plt_tam_fuente","plt_margen","plt_pie_altura",
   "plt_mostrar_logo","plt_mostrar_cab","plt_mostrar_pie","plt_mostrar_emisor","plt_mostrar_email","plt_mostrar_num_pag","plt_cab_todas_pags"
  ].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.addEventListener("input",_pv);el.addEventListener("change",_pv);});
  // Alineación controlada por window._pltAlin (botones toggle, sin radio)
  document.getElementById("plt_lineasContainer")?.addEventListener("input",_pv);
  document.getElementById("plt_lineasContainer")?.addEventListener("change",_pv);
  _pv();

  // Líneas
  let lineaCount=lineas.length;
  document.getElementById("plt_addLinea").addEventListener("click",()=>{
    document.getElementById("plt_lineasContainer").insertAdjacentHTML("beforeend",_lineaHTML({}));
    lineaCount++; _pv();
  });
  document.addEventListener("click",e=>{if(e.target.closest(".plt-del-linea")){e.target.closest(".linea-row")?.remove();_pv();}});

  // Guardar
  document.getElementById("plt_save").addEventListener("click",async()=>{
    const nombre=document.getElementById("plt_nombre")?.value.trim();
    if(!nombre){window._pltTab("diseno");toast("El nombre es obligatorio","error");return;}
    const rows=document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr=[...rows].map(r=>({
      descripcion:r.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      precio:parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      iva:parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.descripcion||l.precio>0);
    const g=id=>document.getElementById(id)?.value?.trim()||null;
    const gb=id=>document.getElementById(id)?.checked||false;
    const gi=(id,def)=>parseInt(document.getElementById(id)?.value)||def;
    const payload={
      user_id:SESSION.user.id,nombre,
      concepto:g("plt_concepto"),descripcion:g("plt_descripcion"),notas:g("plt_notas"),
      texto_pie:g("plt_pie"),iban_visible:g("plt_iban"),idioma:_idioma,
      lineas:JSON.stringify(lineasArr),
      color_principal:g("plt_color_cabecera")||D.color_cabecera,
      color_cabecera:g("plt_color_cabecera")||D.color_cabecera,
      color_txt_cab:g("plt_color_txt_cab")||D.color_txt_cab,
      color_acento:g("plt_color_acento")||D.color_acento,
      color_letra:g("plt_color_letra")||D.color_letra,
      color_fondo:g("plt_color_fondo")||D.color_fondo,
      color_fondo_tab:g("plt_color_fondo_tab")||D.color_fondo_tab,
      color_lineas:g("plt_color_lineas")||D.color_lineas,
      fuente:g("plt_fuente")||"Helvetica",
      tam_fuente:gi("plt_tam_fuente",9),
      tamano_hoja:g("plt_tamano_hoja")||"A4",
      margen:gi("plt_margen",18),
      pie_altura:gi("plt_pie_altura",14),
      alin_texto:document.getElementById("plt_alin_val")?.value||"izq",
      estilo_cab:g("plt_estilo_cab")||"solido",
      mostrar_logo:gb("plt_mostrar_logo"),mostrar_cab:gb("plt_mostrar_cab"),
      mostrar_pie:gb("plt_mostrar_pie"),mostrar_emisor:gb("plt_mostrar_emisor"),
      mostrar_email:gb("plt_mostrar_email"),mostrar_num_pag:gb("plt_mostrar_num_pag"),
      cab_todas_pags:gb("plt_cab_todas_pags"),logo_b64:_logo||null,
    };
    const btn=document.getElementById("plt_save");
    btn.disabled=true;btn.textContent="Guardando…";
    let err;
    if(isEdit){({error:err}=await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id));}
    else      {({error:err}=await supabase.from("plantillas_usuario").insert(payload));}
    if(err){toast("Error: "+err.message,"error");btn.disabled=false;btn.textContent=isEdit?"💾 Actualizar":"✨ Guardar plantilla";return;}
    toast(isEdit?"Plantilla actualizada ✅":"Plantilla creada ✅","success");
    closeModal();await refreshPlantillas();
  });

  if(isEdit){
    document.getElementById("plt_del")?.addEventListener("click",async()=>{
      if(!confirm("¿Eliminar esta plantilla?"))return;
      await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
      closeModal();toast("Plantilla eliminada","success");await refreshPlantillas();
    });
  }
}

export function getPlantillaData(plantillaId) {
  const p=PLANTILLAS.find(x=>x.id===plantillaId);
  if(!p)return null;
  return {concepto:p.concepto,descripcion:p.descripcion,notas:p.notas,lineas:p.lineas?JSON.parse(p.lineas):[],color_principal:p.color_cabecera||p.color_principal,texto_pie:p.texto_pie,iban_visible:p.iban_visible,logo_b64:p.logo_b64};
}

export function renderPlantillaSelector(containerId,onSelect) {
  const container=document.getElementById(containerId);
  if(!container||!PLANTILLAS.length)return;
  container.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
    <span style="font-size:11px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
    ${PLANTILLAS.map(p=>`<button class="btn-outline plt-selector-btn" data-plt-id="${p.id}" style="font-size:12px;padding:4px 12px">${p.nombre}</button>`).join("")}
    <button class="btn-outline plt-selector-btn" data-plt-id="" style="font-size:12px;padding:4px 12px;color:var(--t4)">✕ En blanco</button>
  </div>`;
  container.querySelectorAll(".plt-selector-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      container.querySelectorAll(".plt-selector-btn").forEach(b=>{b.style.background="";b.style.color="";b.style.borderColor="";});
      if(btn.dataset.pltId){btn.style.background="var(--accent)";btn.style.color="#fff";btn.style.borderColor="var(--accent)";}
      if(onSelect)onSelect(btn.dataset.pltId?getPlantillaData(btn.dataset.pltId):null);
    });
  });
}
export const renderSelectorPlantillas=renderPlantillaSelector;

window._nuevaPlantilla=()=>showPlantillaModal();
window._editPlantilla=id=>{const p=PLANTILLAS.find(x=>x.id===id);if(p)showPlantillaModal(p);};
window._delPlantilla=id=>{
  openModal(`<div class="modal" style="max-width:380px"><div class="modal-hd"><span class="modal-title">Eliminar plantilla</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_dpltOk").addEventListener("click",async()=>{await supabase.from("plantillas_usuario").delete().eq("id",id);closeModal();toast("Plantilla eliminada","success");await refreshPlantillas();});
};
window._usarPlantillaFactura=id=>{const data=getPlantillaData(id);if(!data)return;window._switchView?.("nueva-factura");setTimeout(()=>window._applyPlantillaToFactura?.(data),200);};
window._usarPlantillaPres=id=>{const data=getPlantillaData(id);if(!data)return;window._switchView?.("nuevo-presupuesto");setTimeout(()=>window._applyPlantillaToPresupuesto?.(data),200);};

export function initPlantillasView() {
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click",()=>showPlantillaModal());
  refreshPlantillas();
}
