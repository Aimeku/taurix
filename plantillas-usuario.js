/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js
   Editor profesional de plantillas de documentos
   ─ Diseño completo: cabecera, logo, fuentes, colores, márgenes
   ─ Contenido: concepto, descripción, líneas, notas, condiciones
   ─ Preview PDF en tiempo real (columna derecha)
   ─ Generar PDF con la plantilla guardada
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

/* ══════════════════════════
   LOAD / REFRESH
══════════════════════════ */
export async function loadPlantillas() {
  const { data, error } = await supabase
    .from("plantillas_usuario")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .order("nombre");
  if (error) { console.error("plantillas:", error.message); return []; }
  PLANTILLAS = data || [];
  return PLANTILLAS;
}

export async function refreshPlantillas() {
  await loadPlantillas();
  renderPlantillasGrid();
}

/* ══════════════════════════
   GRID DE PLANTILLAS
══════════════════════════ */
function renderPlantillasGrid() {
  const wrap = document.getElementById("plantillasGrid");
  if (!wrap) return;

  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--t3)">
        <div style="font-size:56px;margin-bottom:16px">📄</div>
        <div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px">Sin plantillas personalizadas</div>
        <div style="font-size:13px;margin-bottom:28px;line-height:1.7;max-width:420px;margin-left:auto;margin-right:auto">
          Crea plantillas con tu diseño, logo, colores y líneas habituales para facturar en segundos con tu imagen de marca.
        </div>
        <button class="btn-primary" onclick="window._nuevaPlantilla()" style="padding:12px 28px;font-size:14px">
          ✨ Crear mi primera plantilla
        </button>
      </div>`;
    return;
  }

  const COLORES = ["#3b82f6","#f97316","#059669","#8b5cf6","#ef4444","#0ea5e9","#ec4899","#14b8a6"];
  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const lineas   = p.lineas ? JSON.parse(p.lineas) : [];
    const base     = lineas.reduce((a, l) => a + (l.cantidad||1)*(l.precio||0), 0);
    const color    = p.color_cabecera || COLORES[i % COLORES.length];
    const tieneLog = !!p.logo_b64;
    return `
      <div class="doc-card" style="text-align:left;border-top:3px solid ${color};cursor:pointer" onclick="window._editPlantilla('${p.id}')">
        <!-- Mini preview del header -->
        <div style="background:${color};border-radius:6px;padding:8px 10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:8px;font-weight:800;color:rgba(255,255,255,.6);letter-spacing:.1em;text-transform:uppercase">DOCUMENTO</div>
            <div style="font-size:11px;font-weight:700;color:#fff;margin-top:1px">${p.nombre}</div>
          </div>
          ${tieneLog ? `<div style="width:28px;height:18px;background:rgba(255,255,255,.2);border-radius:3px;display:flex;align-items:center;justify-content:center"><img src="${p.logo_b64}" style="max-width:26px;max-height:16px;object-fit:contain"/></div>` : ""}
        </div>
        <div class="doc-card-desc" style="margin-bottom:6px;font-size:12px">${p.concepto || "Sin concepto predefinido"}</div>
        ${p.descripcion ? `<div style="font-size:11px;color:var(--t4);margin-bottom:6px;line-height:1.4">${p.descripcion.substring(0,60)}${p.descripcion.length>60?"…":""}</div>` : ""}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <span style="font-size:10px;font-weight:600;color:${color};background:${color}18;padding:2px 7px;border-radius:5px">${lineas.length} línea${lineas.length!==1?"s":""}</span>
          ${p.fuente ? `<span style="font-size:10px;color:var(--t4);background:var(--bg2);padding:2px 7px;border-radius:5px">${p.fuente}</span>` : ""}
          ${p.mostrar_logo && tieneLog ? `<span style="font-size:10px;color:var(--t4);background:var(--bg2);padding:2px 7px;border-radius:5px">Logo ✓</span>` : ""}
        </div>
        ${base > 0 ? `<div style="font-family:monospace;font-size:14px;font-weight:700;color:var(--t1);margin-bottom:10px">${fmt(base)}</div>` : ""}
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')" style="font-size:10px">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')" style="font-size:10px">📋 Presupuesto</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')" style="font-size:10px">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════════════════════════════
   MODAL EDITOR DE PLANTILLA — profesional completo
══════════════════════════════════════════════════ */
export function showPlantillaModal(prefill = {}) {
  const isEdit  = !!prefill.id;
  const lineas  = prefill.lineas
    ? (typeof prefill.lineas === "string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{ descripcion: "", cantidad: 1, precio: 0, iva: 21 }];

  // Valores por defecto
  const D = {
    color_cabecera:    prefill.color_cabecera    || "#1a56db",
    color_texto_cab:   prefill.color_texto_cab   || "#ffffff",
    color_acento:      prefill.color_acento      || "#1a56db",
    color_fondo:       prefill.color_fondo       || "#ffffff",
    color_texto:       prefill.color_texto       || "#0f172a",
    fuente:            prefill.fuente            || "helvetica",
    tamano_fuente:     prefill.tamano_fuente     || 9,
    margen_sup:        prefill.margen_sup        || 18,
    margen_inf:        prefill.margen_inf        || 18,
    margen_izq:        prefill.margen_izq        || 18,
    margen_der:        prefill.margen_der        || 18,
    mostrar_cabecera:  prefill.mostrar_cabecera  !== false,
    mostrar_logo:      prefill.mostrar_logo      !== false,
    mostrar_num_pag:   prefill.mostrar_num_pag   !== false,
    mostrar_emisor:    prefill.mostrar_emisor    !== false,
    mostrar_pie:       prefill.mostrar_pie       !== false,
    estilo_cabecera:   prefill.estilo_cabecera   || "solido",   // solido | gradiente | linea | sin_fondo
    estilo_tabla:      prefill.estilo_tabla      || "rayas",    // rayas | limpio | bordes
    logo_b64:          prefill.logo_b64          || "",
    texto_pie:         prefill.texto_pie         || "",
    iban_visible:      prefill.iban_visible      || "",
  };

  openModal(`
    <div class="modal" style="max-width:1100px;width:98vw;height:90vh;display:flex;flex-direction:column">
      <div class="modal-hd" style="flex-shrink:0">
        <span class="modal-title">✨ ${isEdit?"Editar":"Nueva"} plantilla de documento</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>

      <!-- Tabs de sección -->
      <div style="display:flex;gap:0;border-bottom:1px solid var(--brd);background:var(--bg2);flex-shrink:0">
        ${[["diseno","🎨 Diseño"],["contenido","📝 Contenido"],["avanzado","⚙️ Avanzado"]].map(([id,label],i)=>`
          <button class="plt-section-tab ${i===0?"plt-tab-active":""}" data-section="${id}"
            style="padding:11px 20px;font-size:13px;font-weight:600;cursor:pointer;border:none;
              background:${i===0?"var(--srf)":"transparent"};color:${i===0?"var(--accent)":"var(--t3)"};
              border-bottom:2px solid ${i===0?"var(--accent)":"transparent"};transition:all .15s">
            ${label}
          </button>`).join("")}
      </div>

      <!-- Cuerpo: editor + preview -->
      <div style="display:grid;grid-template-columns:1fr 340px;flex:1;overflow:hidden">

        <!-- ═══ COLUMNA IZQUIERDA: editor ═══ -->
        <div style="overflow-y:auto;padding:0">

          <!-- ── SECCIÓN DISEÑO ── -->
          <div class="plt-section" id="plt-sec-diseno" style="padding:20px 24px">

            <!-- Logo -->
            <div class="plt-group-title">🖼️ Logo</div>
            <div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">
              <div id="plt_logo_preview" style="width:100px;height:64px;border:2px dashed var(--brd);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--srf2);flex-shrink:0;cursor:pointer" onclick="document.getElementById('plt_logo_input').click()">
                ${D.logo_b64 ? `<img src="${D.logo_b64}" style="max-width:96px;max-height:60px;object-fit:contain"/>` : `<span style="font-size:11px;color:var(--t4);text-align:center;padding:6px">Click para<br>subir logo</span>`}
              </div>
              <input type="file" id="plt_logo_input" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none"/>
              <div>
                <button type="button" class="btn-outline" id="plt_logo_btn" style="font-size:12px;padding:7px 14px;display:block;margin-bottom:6px">
                  📁 ${D.logo_b64?"Cambiar logo":"Subir logo"}
                </button>
                ${D.logo_b64?`<button type="button" class="btn-outline" id="plt_logo_remove" style="font-size:12px;padding:7px 14px;color:#dc2626;border-color:#dc2626">🗑️ Quitar logo</button>`:"<span style='font-size:11px;color:var(--t4)'>PNG, JPG, SVG · Máx. 500KB</span>"}
                <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;cursor:pointer">
                  <input type="checkbox" id="plt_mostrar_logo" ${D.mostrar_logo?"checked":""}/>
                  Mostrar logo en el documento
                </label>
              </div>
            </div>

            <!-- Cabecera -->
            <div class="plt-group-title">📋 Cabecera del documento</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div class="modal-field">
                <label>Estilo de cabecera</label>
                <select id="plt_estilo_cab" class="ff-select">
                  <option value="solido"    ${D.estilo_cabecera==="solido"   ?"selected":""}>Fondo sólido</option>
                  <option value="gradiente" ${D.estilo_cabecera==="gradiente"?"selected":""}>Gradiente</option>
                  <option value="linea"     ${D.estilo_cabecera==="linea"    ?"selected":""}>Solo línea inferior</option>
                  <option value="sin_fondo" ${D.estilo_cabecera==="sin_fondo"?"selected":""}>Sin fondo</option>
                </select>
              </div>
              <div class="modal-field">
                <label>Fuente del documento</label>
                <select id="plt_fuente" class="ff-select">
                  ${["helvetica","courier","times"].map(f=>`<option value="${f}" ${D.fuente===f?"selected":""}>${f.charAt(0).toUpperCase()+f.slice(1)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
              ${[
                ["plt_color_cabecera","Color cabecera",D.color_cabecera],
                ["plt_color_texto_cab","Texto cabecera",D.color_texto_cab],
                ["plt_color_acento","Color acento",D.color_acento],
                ["plt_color_fondo","Fondo documento",D.color_fondo],
              ].map(([id,lbl,val])=>`
                <div class="modal-field">
                  <label style="font-size:11px">${lbl}</label>
                  <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
                    <input type="color" id="${id}" value="${val}" style="width:36px;height:36px;padding:2px;border:1.5px solid var(--brd);border-radius:6px;cursor:pointer"/>
                    <input type="text" id="${id}_hex" value="${val}" style="flex:1;font-family:monospace;font-size:11px;padding:4px 6px;border:1.5px solid var(--brd);border-radius:6px;background:var(--bg2)"/>
                  </div>
                </div>`).join("")}
            </div>

            <!-- Tabla -->
            <div class="plt-group-title">📊 Tabla de líneas</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
              <div class="modal-field">
                <label>Estilo de tabla</label>
                <select id="plt_estilo_tabla" class="ff-select">
                  <option value="rayas"   ${D.estilo_tabla==="rayas"  ?"selected":""}>Filas alternadas</option>
                  <option value="limpio"  ${D.estilo_tabla==="limpio" ?"selected":""}>Limpio sin rayas</option>
                  <option value="bordes"  ${D.estilo_tabla==="bordes" ?"selected":""}>Con bordes</option>
                </select>
              </div>
              <div class="modal-field">
                <label>Tamaño de fuente (pt)</label>
                <select id="plt_tamano_fuente" class="ff-select">
                  ${[7,8,9,10,11,12].map(s=>`<option value="${s}" ${D.tamano_fuente===s?"selected":""}>${s} pt</option>`).join("")}
                </select>
              </div>
            </div>

            <!-- Márgenes -->
            <div class="plt-group-title">📐 Márgenes (mm)</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
              ${[["plt_margen_sup","Superior",D.margen_sup],["plt_margen_inf","Inferior",D.margen_inf],["plt_margen_izq","Izquierdo",D.margen_izq],["plt_margen_der","Derecho",D.margen_der]].map(([id,lbl,val])=>`
                <div class="modal-field">
                  <label style="font-size:11px">${lbl}</label>
                  <select id="${id}" class="ff-select">
                    ${[10,12,14,16,18,20,22,25].map(v=>`<option value="${v}" ${val===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>`).join("")}
            </div>

            <!-- Visibilidad -->
            <div class="plt-group-title">👁 Elementos del documento</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${[
                ["plt_mostrar_cabecera","Mostrar cabecera",D.mostrar_cabecera],
                ["plt_mostrar_emisor","Mostrar datos emisor",D.mostrar_emisor],
                ["plt_mostrar_num_pag","Numeración de páginas",D.mostrar_num_pag],
                ["plt_mostrar_pie","Mostrar pie de página",D.mostrar_pie],
              ].map(([id,lbl,val])=>`
                <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg2);border-radius:8px;border:1px solid var(--brd);cursor:pointer;font-size:13px">
                  <span>${lbl}</span>
                  <input type="checkbox" id="${id}" ${val?"checked":""} style="width:16px;height:16px;accent-color:var(--accent)"/>
                </label>`).join("")}
            </div>
          </div>

          <!-- ── SECCIÓN CONTENIDO ── -->
          <div class="plt-section" id="plt-sec-contenido" style="padding:20px 24px;display:none">

            <div class="plt-group-title">🏷️ Identificación de la plantilla</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div class="modal-field">
                <label>Nombre de la plantilla *</label>
                <input autocomplete="off" id="plt_nombre" class="ff-input" value="${prefill.nombre||""}" placeholder="Ej: Factura mensual cliente"/>
              </div>
              <div class="modal-field">
                <label>Concepto predeterminado</label>
                <input autocomplete="off" id="plt_concepto" class="ff-input" value="${prefill.concepto||""}" placeholder="Ej: Servicio de mantenimiento mensual"/>
              </div>
            </div>

            <div class="modal-field" style="margin-bottom:16px">
              <label>Descripción / Alcance del servicio</label>
              <textarea autocomplete="off" id="plt_descripcion" class="ff-input ff-textarea" style="min-height:70px"
                placeholder="Describe qué incluye este servicio, alcance, entregables… Aparecerá en el cuerpo del documento.">${prefill.descripcion||""}</textarea>
            </div>

            <div class="modal-field" style="margin-bottom:20px">
              <label>Notas / Condiciones de pago</label>
              <textarea autocomplete="off" id="plt_notas" class="ff-input ff-textarea" style="min-height:60px"
                placeholder="Forma de pago, plazo, penalizaciones, garantía…">${prefill.notas||""}</textarea>
            </div>

            <div class="plt-group-title">📝 Líneas predefinidas</div>
            <div class="lineas-header" style="grid-template-columns:1fr 58px 96px 56px 30px;font-size:10px">
              <div>Descripción</div><div>Cantidad</div><div>Precio (€)</div><div>IVA</div><div></div>
            </div>
            <div id="plt_lineasContainer">
              ${lineas.map((l,i)=>_renderLineaPlantilla(l,i)).join("")}
            </div>
            <button class="btn-add-linea" id="plt_addLinea" style="margin-top:8px">+ Añadir línea</button>
          </div>

          <!-- ── SECCIÓN AVANZADO ── -->
          <div class="plt-section" id="plt-sec-avanzado" style="padding:20px 24px;display:none">

            <div class="plt-group-title">🏛️ Pie de página</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
              <div class="modal-field">
                <label>Texto legal / Razón social</label>
                <input autocomplete="off" id="plt_pie" class="ff-input" value="${D.texto_pie}" placeholder="Inscrita en el RM de Madrid, Tomo…"/>
              </div>
              <div class="modal-field">
                <label>IBAN visible en el documento</label>
                <input autocomplete="off" id="plt_iban" class="ff-input" value="${D.iban_visible}" placeholder="ES00 0000 0000 00 0000 0000"/>
              </div>
            </div>

            <div class="plt-group-title" style="margin-top:4px">🎨 Color de texto principal</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
              <div class="modal-field">
                <label>Color del texto del documento</label>
                <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
                  <input type="color" id="plt_color_texto" value="${D.color_texto}" style="width:36px;height:36px;padding:2px;border:1.5px solid var(--brd);border-radius:6px;cursor:pointer"/>
                  <input type="text" id="plt_color_texto_hex" value="${D.color_texto}" style="flex:1;font-family:monospace;font-size:11px;padding:4px 6px;border:1.5px solid var(--brd);border-radius:6px;background:var(--bg2)"/>
                </div>
              </div>
            </div>

            <div class="plt-group-title">ℹ️ Sobre esta plantilla</div>
            <div style="background:var(--bg2);border-radius:10px;padding:14px 16px;font-size:13px;color:var(--t2);line-height:1.7">
              Las plantillas se aplican al generar el PDF de una factura o presupuesto. El logo, colores y fuentes que configures aquí reemplazarán el diseño por defecto. Los datos del emisor (nombre, NIF, dirección) siempre se toman de tu perfil fiscal.
            </div>
          </div>

        </div><!-- fin columna izquierda -->

        <!-- ═══ COLUMNA DERECHA: preview PDF en vivo ═══ -->
        <div style="background:var(--bg2);border-left:1px solid var(--brd);padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px">
          <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em">
            👁 Vista previa del documento
          </div>

          <!-- Mini PDF preview -->
          <div id="plt_preview" style="background:#fff;border-radius:8px;box-shadow:0 2px 16px rgba(0,0,0,.12);overflow:hidden;font-size:10px;width:100%">

            <!-- Header del documento -->
            <div id="plt_pv_header" style="padding:14px 16px;background:${D.color_cabecera}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <div id="plt_pv_tipo" style="font-size:8px;font-weight:800;letter-spacing:.12em;opacity:.65;color:${D.color_texto_cab}">FACTURA / PRESUPUESTO</div>
                  <div id="plt_pv_concepto" style="font-size:13px;font-weight:700;color:${D.color_texto_cab};margin-top:2px">Sin concepto</div>
                  <div id="plt_pv_numero" style="font-size:9px;opacity:.7;color:${D.color_texto_cab};margin-top:2px">FAC-2025-001</div>
                </div>
                <div id="plt_pv_logo_wrap" style="text-align:right">
                  ${D.logo_b64&&D.mostrar_logo?`<img src="${D.logo_b64}" style="max-height:36px;max-width:80px;object-fit:contain"/>`:
                    `<div style="font-size:10px;font-weight:700;color:${D.color_texto_cab};opacity:.8">Tu empresa</div>`}
                </div>
              </div>
            </div>

            <!-- Emisor / Cliente -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;padding:10px 16px;border-bottom:1px solid #e5e7eb">
              <div>
                <div style="font-size:7px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin-bottom:3px">DE / FROM</div>
                <div style="font-weight:700;font-size:10px;color:#111">Tu empresa</div>
                <div style="font-size:9px;color:#6b7280">NIF: B12345678</div>
                <div style="font-size:9px;color:#6b7280">C/ Ejemplo 1, Madrid</div>
              </div>
              <div>
                <div style="font-size:7px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin-bottom:3px">FACTURAR A</div>
                <div style="font-weight:700;font-size:10px;color:#111">Cliente ejemplo</div>
                <div style="font-size:9px;color:#6b7280">NIF: A98765432</div>
              </div>
            </div>

            <!-- Descripción si la hay -->
            <div id="plt_pv_descripcion_wrap" style="display:none;padding:8px 16px;border-bottom:1px solid #f3f4f6">
              <div style="font-size:9px;color:#6b7280;line-height:1.5" id="plt_pv_descripcion"></div>
            </div>

            <!-- Tabla de líneas -->
            <div style="padding:0 16px" id="plt_pv_lineas_wrap">
              <div id="plt_pv_tabla_head" style="display:grid;grid-template-columns:1fr 30px 52px 28px 54px;gap:2px;padding:6px 0 3px;font-size:7.5px;font-weight:700;text-transform:uppercase;color:#fff;background:${D.color_acento};margin:0 -16px;padding:6px 16px 4px;letter-spacing:.04em">
                <span>Descripción</span><span style="text-align:right">Cant</span><span style="text-align:right">Precio</span><span style="text-align:right">IVA</span><span style="text-align:right">Total</span>
              </div>
              <div id="plt_pv_lineas"></div>
            </div>

            <!-- Totales -->
            <div id="plt_pv_totales" style="padding:10px 16px;background:#f9fafb;border-top:1px solid #e5e7eb"></div>

            <!-- Notas -->
            <div id="plt_pv_notas" style="padding:8px 16px;font-size:9px;color:#6b7280;border-top:1px solid #e5e7eb;display:none;line-height:1.5"></div>

            <!-- Pie -->
            <div id="plt_pv_pie_wrap" style="padding:6px 16px;font-size:8px;color:#9ca3af;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between">
              <span id="plt_pv_pie_texto">Texto legal de pie</span>
              <span>Pág. 1</span>
            </div>
          </div>

          <!-- Leyenda -->
          <div style="font-size:10px;color:var(--t4);line-height:1.6;padding:8px 10px;background:var(--srf);border-radius:8px;border:1px solid var(--brd)">
            📌 La vista previa es aproximada. El PDF final incluirá tus datos fiscales reales y el diseño se ajustará al contenido.
          </div>
        </div><!-- fin preview -->

      </div><!-- fin grid editor+preview -->

      <div class="modal-ft" style="flex-shrink:0">
        ${isEdit?`<button class="btn-modal-danger" id="plt_del" style="margin-right:auto">🗑️ Eliminar plantilla</button>`:""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="plt_save" style="padding:10px 28px;font-size:14px">${isEdit?"💾 Actualizar plantilla":"✨ Guardar plantilla"}</button>
      </div>
    </div>
  `);

  // ── Inyectar CSS del editor ──
  if (!document.getElementById("plt-editor-css")) {
    const st = document.createElement("style");
    st.id = "plt-editor-css";
    st.textContent = `
      .plt-section-tab { border-right:1px solid var(--brd); }
      .plt-tab-active  { background:var(--srf)!important;color:var(--accent)!important;border-bottom-color:var(--accent)!important; }
      .plt-group-title {
        font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;
        letter-spacing:.06em;margin:0 0 12px;padding-bottom:6px;
        border-bottom:1px solid var(--brd);
      }
      .plt-group-title + * { margin-top:0; }
      .plt-section { animation:fadeIn .15s ease; }
    `;
    document.head.appendChild(st);
  }

  // ── Tabs de sección ──
  document.querySelectorAll(".plt-section-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".plt-section-tab").forEach(b => {
        b.classList.remove("plt-tab-active");
        b.style.background = "transparent";
        b.style.color = "var(--t3)";
        b.style.borderBottomColor = "transparent";
      });
      btn.classList.add("plt-tab-active");
      btn.style.background = "var(--srf)";
      btn.style.color = "var(--accent)";
      btn.style.borderBottomColor = "var(--accent)";
      document.querySelectorAll(".plt-section").forEach(s => s.style.display = "none");
      document.getElementById(`plt-sec-${btn.dataset.section}`).style.display = "";
    });
  });

  // ── Logo ──
  let _logoB64 = D.logo_b64;
  const logoInput   = document.getElementById("plt_logo_input");
  const logoPreview = document.getElementById("plt_logo_preview");

  document.getElementById("plt_logo_btn").addEventListener("click", () => logoInput.click());
  logoInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500*1024) { toast("El logo no puede superar 500KB","error"); return; }
    const r = new FileReader();
    r.onload = ev => {
      _logoB64 = ev.target.result;
      logoPreview.innerHTML = `<img src="${_logoB64}" style="max-width:96px;max-height:60px;object-fit:contain"/>`;
      document.getElementById("plt_logo_btn").textContent = "📁 Cambiar logo";
      _pltUpdatePreview();
    };
    r.readAsDataURL(file);
  });
  document.getElementById("plt_logo_remove")?.addEventListener("click", () => {
    _logoB64 = "";
    logoPreview.innerHTML = `<span style="font-size:11px;color:var(--t4);text-align:center;padding:6px">Click para<br>subir logo</span>`;
    _pltUpdatePreview();
  });

  // ── Sincronizar color picker ↔ hex input ──
  [["plt_color_cabecera","plt_color_cabecera_hex"],
   ["plt_color_texto_cab","plt_color_texto_cab_hex"],
   ["plt_color_acento","plt_color_acento_hex"],
   ["plt_color_fondo","plt_color_fondo_hex"],
   ["plt_color_texto","plt_color_texto_hex"]
  ].forEach(([pickId, hexId]) => {
    const pick = document.getElementById(pickId);
    const hex  = document.getElementById(hexId);
    if (!pick||!hex) return;
    pick.addEventListener("input", () => { hex.value = pick.value; _pltUpdatePreview(); });
    hex.addEventListener("change", () => {
      if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) { pick.value = hex.value.trim(); _pltUpdatePreview(); }
    });
  });

  // ── Preview en tiempo real ──
  function _pltUpdatePreview() {
    const concepto  = document.getElementById("plt_concepto")?.value    || "Sin concepto";
    const notas     = document.getElementById("plt_notas")?.value       || "";
    const descripcion = document.getElementById("plt_descripcion")?.value || "";
    const pie       = document.getElementById("plt_pie")?.value         || "";
    const colorCab  = document.getElementById("plt_color_cabecera")?.value || D.color_cabecera;
    const colorTxtC = document.getElementById("plt_color_texto_cab")?.value|| D.color_texto_cab;
    const colorAcc  = document.getElementById("plt_color_acento")?.value   || D.color_acento;
    const colorFondo= document.getElementById("plt_color_fondo")?.value    || D.color_fondo;
    const estCab    = document.getElementById("plt_estilo_cab")?.value     || "solido";
    const mostLogo  = document.getElementById("plt_mostrar_logo")?.checked;
    const mostCab   = document.getElementById("plt_mostrar_cabecera")?.checked;
    const mostPie   = document.getElementById("plt_mostrar_pie")?.checked;

    // Header
    const hdr = document.getElementById("plt_pv_header");
    if (hdr) {
      hdr.style.display = mostCab ? "" : "none";
      if (estCab === "solido")    hdr.style.background = colorCab;
      if (estCab === "gradiente") hdr.style.background = `linear-gradient(135deg,${colorCab},${colorAcc})`;
      if (estCab === "linea")     { hdr.style.background = "#fff"; hdr.style.borderBottom = `3px solid ${colorCab}`; }
      if (estCab === "sin_fondo") { hdr.style.background = "transparent"; hdr.style.borderBottom = "none"; }
    }
    const pvConc  = document.getElementById("plt_pv_concepto");
    const pvTipo  = document.getElementById("plt_pv_tipo");
    const pvNum   = document.getElementById("plt_pv_numero");
    if (pvConc) { pvConc.textContent = concepto; pvConc.style.color = colorTxtC; }
    if (pvTipo) pvTipo.style.color = colorTxtC;
    if (pvNum)  pvNum.style.color  = colorTxtC;

    // Logo
    const logoWrap = document.getElementById("plt_pv_logo_wrap");
    if (logoWrap) {
      if (mostLogo && _logoB64) {
        logoWrap.innerHTML = `<img src="${_logoB64}" style="max-height:36px;max-width:80px;object-fit:contain"/>`;
      } else {
        logoWrap.innerHTML = `<div style="font-size:10px;font-weight:700;color:${colorTxtC};opacity:.8">Tu empresa</div>`;
      }
    }

    // Cabecera tabla
    const tabHead = document.getElementById("plt_pv_tabla_head");
    if (tabHead) tabHead.style.background = colorAcc;

    // Descripción
    const descWrap = document.getElementById("plt_pv_descripcion_wrap");
    const descEl   = document.getElementById("plt_pv_descripcion");
    if (descWrap && descEl) {
      descWrap.style.display = descripcion ? "" : "none";
      descEl.textContent = descripcion;
    }

    // Líneas
    const rows = document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr = [...rows].map(row => ({
      descripcion: row.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:    parseFloat(row.querySelector("[data-field='cantidad']")?.value)||1,
      precio:      parseFloat(row.querySelector("[data-field='precio']")?.value)||0,
      iva:         parseInt(row.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l => l.descripcion||l.precio>0);

    const estTabla = document.getElementById("plt_estilo_tabla")?.value || "rayas";
    const pvLineas = document.getElementById("plt_pv_lineas");
    if (pvLineas) {
      if (!lineasArr.length) {
        pvLineas.innerHTML = `<div style="padding:10px 0;color:#9ca3af;text-align:center;font-size:9px">Sin líneas definidas</div>`;
      } else {
        pvLineas.innerHTML = lineasArr.map((l,ri) => {
          const total = l.cantidad*l.precio;
          const bgColor = estTabla==="rayas" ? (ri%2===0?"#f9fafb":"#fff") : "#fff";
          const border  = estTabla==="bordes" ? "border:1px solid #e5e7eb;" : "border-bottom:1px solid #f3f4f6;";
          return `<div style="display:grid;grid-template-columns:1fr 30px 52px 28px 54px;gap:2px;padding:5px 0;background:${bgColor};${border}font-size:9.5px;align-items:center">
            <span style="color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.descripcion}</span>
            <span style="text-align:right;color:#6b7280">${l.cantidad}</span>
            <span style="text-align:right;color:#6b7280">${l.precio.toFixed(2)}€</span>
            <span style="text-align:right;color:#6b7280">${l.iva}%</span>
            <span style="text-align:right;font-weight:700;font-family:monospace">${total.toFixed(2)}€</span>
          </div>`;
        }).join("");
      }
    }

    // Totales
    const base = lineasArr.reduce((a,l)=>a+l.cantidad*l.precio,0);
    const iva  = lineasArr.reduce((a,l)=>a+l.cantidad*l.precio*l.iva/100,0);
    const pvTot = document.getElementById("plt_pv_totales");
    if (pvTot) pvTot.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:2px"><span>Base imponible</span><span style="font-family:monospace">${base.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:5px"><span>IVA</span><span style="font-family:monospace">${iva.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:#111;border-top:2px solid ${colorAcc};padding-top:6px">
        <span>TOTAL</span><span style="font-family:monospace;color:${colorAcc}">${(base+iva).toFixed(2)} €</span>
      </div>`;

    // Notas
    const pvNotas = document.getElementById("plt_pv_notas");
    if (pvNotas) { pvNotas.textContent = notas; pvNotas.style.display = notas?"":"none"; }

    // Pie
    const pieWrap = document.getElementById("plt_pv_pie_wrap");
    const pieTxt  = document.getElementById("plt_pv_pie_texto");
    if (pieWrap) pieWrap.style.display = mostPie?"":"none";
    if (pieTxt)  pieTxt.textContent    = pie||"Texto legal de pie de página";

    // Fondo documento
    const preview = document.getElementById("plt_preview");
    if (preview) preview.style.background = colorFondo;
  }

  // Conectar todos los inputs al preview
  const previewFields = [
    "plt_concepto","plt_notas","plt_descripcion","plt_pie",
    "plt_color_cabecera","plt_color_texto_cab","plt_color_acento","plt_color_fondo","plt_color_texto",
    "plt_estilo_cab","plt_estilo_tabla","plt_fuente","plt_tamano_fuente",
    "plt_mostrar_logo","plt_mostrar_cabecera","plt_mostrar_pie","plt_mostrar_emisor","plt_mostrar_num_pag",
    "plt_margen_sup","plt_margen_inf","plt_margen_izq","plt_margen_der",
  ];
  previewFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input",  _pltUpdatePreview);
    el.addEventListener("change", _pltUpdatePreview);
  });
  document.getElementById("plt_lineasContainer")?.addEventListener("input",  _pltUpdatePreview);
  document.getElementById("plt_lineasContainer")?.addEventListener("change", _pltUpdatePreview);

  // Preview inicial
  _pltUpdatePreview();

  // ── Líneas ──
  let lineaCount = lineas.length;
  document.getElementById("plt_addLinea").addEventListener("click", () => {
    document.getElementById("plt_lineasContainer").insertAdjacentHTML("beforeend", _renderLineaPlantilla({}, lineaCount++));
    _pltUpdatePreview();
  });
  document.addEventListener("click", e => {
    if (e.target.closest(".plt-del-linea")) {
      e.target.closest(".linea-row")?.remove();
      _pltUpdatePreview();
    }
  });

  // ── GUARDAR ──
  document.getElementById("plt_save").addEventListener("click", async () => {
    // Asegurar que estamos en la tab de contenido para validar nombre
    const nombre = document.getElementById("plt_nombre")?.value.trim();
    if (!nombre) {
      // Ir a la tab contenido
      document.querySelectorAll(".plt-section-tab").forEach(b => b.dispatchEvent(new Event("click")));
      document.querySelector(".plt-section-tab[data-section='contenido']")?.click();
      toast("El nombre de la plantilla es obligatorio","error");
      return;
    }

    const rows = document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr = [...rows].map(row=>({
      descripcion: row.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:    parseFloat(row.querySelector("[data-field='cantidad']")?.value)||1,
      precio:      parseFloat(row.querySelector("[data-field='precio']")?.value)||0,
      iva:         parseInt(row.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.descripcion||l.precio>0);

    const getV = id => document.getElementById(id)?.value?.trim()||null;
    const getB = id => document.getElementById(id)?.checked||false;
    const getN = (id,def) => parseFloat(document.getElementById(id)?.value)||def;
    const getI = (id,def) => parseInt(document.getElementById(id)?.value)||def;

    const payload = {
      user_id:          SESSION.user.id,
      nombre,
      concepto:         getV("plt_concepto"),
      descripcion:      getV("plt_descripcion"),
      notas:            getV("plt_notas"),
      texto_pie:        getV("plt_pie"),
      iban_visible:     getV("plt_iban"),
      lineas:           JSON.stringify(lineasArr),
      // Diseño
      color_cabecera:   getV("plt_color_cabecera") || D.color_cabecera,
      color_texto_cab:  getV("plt_color_texto_cab")|| D.color_texto_cab,
      color_acento:     getV("plt_color_acento")   || D.color_acento,
      color_fondo:      getV("plt_color_fondo")    || D.color_fondo,
      color_texto:      getV("plt_color_texto")    || D.color_texto,
      fuente:           getV("plt_fuente")          || "helvetica",
      tamano_fuente:    getI("plt_tamano_fuente",9),
      estilo_cabecera:  getV("plt_estilo_cab")      || "solido",
      estilo_tabla:     getV("plt_estilo_tabla")    || "rayas",
      margen_sup:       getI("plt_margen_sup",18),
      margen_inf:       getI("plt_margen_inf",18),
      margen_izq:       getI("plt_margen_izq",18),
      margen_der:       getI("plt_margen_der",18),
      mostrar_cabecera: getB("plt_mostrar_cabecera"),
      mostrar_logo:     getB("plt_mostrar_logo"),
      mostrar_emisor:   getB("plt_mostrar_emisor"),
      mostrar_num_pag:  getB("plt_mostrar_num_pag"),
      mostrar_pie:      getB("plt_mostrar_pie"),
      logo_b64:         _logoB64 || null,
      // Compatibilidad con campo anterior
      color_principal:  getV("plt_color_cabecera") || D.color_cabecera,
    };

    const btn = document.getElementById("plt_save");
    btn.disabled = true; btn.textContent = "Guardando…";

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id));
    } else {
      ({ error: err } = await supabase.from("plantillas_usuario").insert(payload));
    }
    if (err) { toast("Error: "+err.message,"error"); btn.disabled=false; btn.textContent=isEdit?"💾 Actualizar plantilla":"✨ Guardar plantilla"; return; }

    toast(isEdit?"Plantilla actualizada ✅":"Plantilla creada ✅","success");
    closeModal();
    await refreshPlantillas();
  });

  if (isEdit) {
    document.getElementById("plt_del")?.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta plantilla?")) return;
      await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
      closeModal(); toast("Plantilla eliminada","success");
      await refreshPlantillas();
    });
  }
}

/* ══════════════════════════
   RENDER LÍNEA
══════════════════════════ */
function _renderLineaPlantilla(l={}) {
  return `
    <div class="linea-row" style="grid-template-columns:1fr 58px 96px 56px 30px">
      <input autocomplete="off" class="ff-input" data-field="descripcion" value="${l.descripcion||""}" placeholder="Descripción del servicio o producto"/>
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

/* ══════════════════════════
   APLICAR PLANTILLA
══════════════════════════ */
export function getPlantillaData(plantillaId) {
  const p = PLANTILLAS.find(x => x.id === plantillaId);
  if (!p) return null;
  return {
    concepto:         p.concepto,
    descripcion:      p.descripcion,
    notas:            p.notas,
    lineas:           p.lineas ? JSON.parse(p.lineas) : [],
    color_principal:  p.color_cabecera || p.color_principal,
    color_cabecera:   p.color_cabecera,
    color_acento:     p.color_acento,
    texto_pie:        p.texto_pie,
    iban_visible:     p.iban_visible,
    logo_b64:         p.logo_b64,
  };
}

/* ══════════════════════════
   SELECTOR INLINE
══════════════════════════ */
export async function renderSelectorPlantillas(containerId, onSelect) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  if (!PLANTILLAS.length) await loadPlantillas();

  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="padding:10px 14px;background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px;font-size:12px;color:var(--t4);display:flex;align-items:center;gap:8px">
        📋 Sin plantillas — <a href="#" onclick="window._switchView('plantillas');return false" style="color:var(--accent);font-weight:600">Crea tu primera plantilla →</a>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div style="padding:10px 14px;background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
      <div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">📋 Usar plantilla</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${PLANTILLAS.map(p=>`
          <button class="plt-sel-btn btn-outline" data-plt-id="${p.id}"
            style="font-size:12px;padding:4px 12px;border-radius:7px;transition:all .15s">
            ${p.nombre}
          </button>`).join("")}
        <button class="plt-sel-btn btn-outline" data-plt-id=""
          style="font-size:12px;padding:4px 12px;border-radius:7px;color:var(--t4)">
          ✕ En blanco
        </button>
      </div>
    </div>`;

  wrap.querySelectorAll(".plt-sel-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".plt-sel-btn").forEach(b => { b.style.background=""; b.style.borderColor=""; b.style.color=""; });
      if (btn.dataset.pltId) {
        btn.style.background = "var(--accent)"; btn.style.borderColor = "var(--accent)"; btn.style.color = "#fff";
        const data = getPlantillaData(btn.dataset.pltId);
        if (onSelect && data) onSelect(data);
      } else {
        if (onSelect) onSelect(null);
      }
    });
  });
}

/* ══════════════════════════
   GLOBAL HANDLERS
══════════════════════════ */
window._nuevaPlantilla  = () => showPlantillaModal();
window._editPlantilla   = id => { const p = PLANTILLAS.find(x=>x.id===id); if (p) showPlantillaModal(p); };
window._delPlantilla    = id => {
  openModal(`
    <div class="modal" style="max-width:400px">
      <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? Esta acción no se puede deshacer.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpltOk").addEventListener("click", async () => {
    await supabase.from("plantillas_usuario").delete().eq("id",id);
    closeModal(); toast("Plantilla eliminada","success");
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

/* ══════════════════════════
   MIGRACIÓN SQL NECESARIA
   ALTER TABLE plantillas_usuario ADD COLUMN IF NOT EXISTS
     color_cabecera TEXT, color_texto_cab TEXT, color_acento TEXT,
     color_fondo TEXT, color_texto TEXT, estilo_cabecera TEXT,
     estilo_tabla TEXT, fuente TEXT, tamano_fuente INTEGER,
     margen_sup INTEGER, margen_inf INTEGER, margen_izq INTEGER, margen_der INTEGER,
     mostrar_cabecera BOOLEAN DEFAULT true, mostrar_logo BOOLEAN DEFAULT true,
     mostrar_emisor BOOLEAN DEFAULT true, mostrar_num_pag BOOLEAN DEFAULT true,
     mostrar_pie BOOLEAN DEFAULT true, logo_b64 TEXT, descripcion TEXT;
══════════════════════════ */

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initPlantillasView() {
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click", () => showPlantillaModal());
  refreshPlantillas();
}
