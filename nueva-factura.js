/* ═══════════════════════════════════════════════════════
   TUGESTOR · nueva-factura.js
   Módulo completo: líneas, preview en vivo, guardar/emitir
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, isCerrado, switchView,
  getYear, getTrim, OP_INFO
} from "./utils.js";
import { emitirFacturaDB } from "./facturas.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";
import { refreshDashboard } from "./dashboard.js";
import { refreshFacturas } from "./facturas.js";
import { PRODUCTOS, buscarProductoPorCodigo } from "./productos.js";

/* ── Estado interno del formulario ── */
let LINEAS = [];
let lineaIdCounter = 0;
let PERFIL_FISCAL_CACHE = null;
let clienteSeleccionadoId = null;
let opTipoActual = "nacional";

/* ══════════════════════════
   TOTALES
══════════════════════════ */
function getLineasTotales() {
  const toggle  = document.getElementById("nfIrpfToggle");
  const irpfPct = (toggle?.checked)
    ? (parseInt(document.getElementById("nfIrpf")?.value) || 0)
    : 0;
  let baseTotal = 0;
  const ivaMap = {};
  LINEAS.forEach(l => {
    const subtotal = l.cantidad * l.precio;
    baseTotal += subtotal;
    const ivaAmt = subtotal * l.iva / 100;
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + ivaAmt;
  });
  const ivaTotal = Object.values(ivaMap).reduce((a,b) => a+b, 0);
  const irpfAmt = baseTotal * irpfPct / 100;
  const total   = baseTotal + ivaTotal - irpfAmt;
  return { baseTotal, ivaMap, ivaTotal, irpfAmt, irpfPct, total };
}

/* ══════════════════════════
   LÍNEAS
══════════════════════════ */
function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const sinIva = ["intracomunitaria","exportacion","inversion_sujeto_pasivo"].includes(opTipoActual);
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad:    prefill.cantidad    || 1,
    precio:      prefill.precio      || 0,
    iva:         sinIva ? 0 : (prefill.iva !== undefined ? prefill.iva : 21),
    tipo:        prefill.tipo        || "servicio"
  };
  LINEAS.push(linea);

  const container = document.getElementById("lineasContainer");
  const row = document.createElement("div");
  row.className = "linea-row";
  row.dataset.lineaId = id;
  row.innerHTML = `
    <input type="text"   class="linea-desc ff-input"  placeholder="Descripción del producto o servicio" value="${linea.descripcion}" data-field="descripcion"/>
    <select class="linea-tipo ff-select" data-field="tipo" title="Tipo de línea">
      <option value="servicio" ${linea.tipo==="servicio"?"selected":""}>🔧 Servicio</option>
      <option value="producto" ${linea.tipo==="producto"?"selected":""}>📦 Producto</option>
    </select>
    <input type="number" class="linea-qty  ff-input"  value="${linea.cantidad}" min="0.01" step="0.01" data-field="cantidad"/>
    <div class="linea-price-wrap">
      <span class="linea-euro">€</span>
      <input type="number" class="linea-price ff-input" value="${linea.precio||""}" placeholder="0.00" step="0.01" data-field="precio"/>
    </div>
    <select class="linea-iva ff-select" data-field="iva" ${sinIva?"disabled":""}>
      <option value="21" ${linea.iva===21?"selected":""}>21%</option>
      <option value="10" ${linea.iva===10?"selected":""}>10%</option>
      <option value="4"  ${linea.iva===4 ?"selected":""}>4%</option>
      <option value="0"  ${linea.iva===0 ?"selected":""}>0%</option>
    </select>
    <div class="linea-total" id="ltRow${id}">0,00 €</div>
    <button class="linea-del" onclick="window._delLinea(${id})" title="Eliminar línea">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input",  () => onLineaChange(id, el));
    el.addEventListener("change", () => onLineaChange(id, el));
  });

  // Autocomplete catálogo de productos
  const descInput = row.querySelector(".linea-desc");
  if (descInput && PRODUCTOS && PRODUCTOS.length > 0) {
    const dropdown = document.createElement("div");
    dropdown.className = "csc-dropdown prod-autocomplete";
    dropdown.style.cssText = "position:absolute;z-index:200;width:100%;top:100%;left:0";
    descInput.parentElement.style.position = "relative";
    descInput.parentElement.appendChild(dropdown);

    descInput.addEventListener("input", () => {
      const q = descInput.value.toLowerCase();
      if (!q || q.length < 2) { dropdown.style.display = "none"; return; }
      const matches = PRODUCTOS.filter(p =>
        p.activo !== false && (
          p.nombre.toLowerCase().includes(q) ||
          (p.referencia || "").toLowerCase().includes(q)
        )
      ).slice(0, 6);
      if (!matches.length) { dropdown.style.display = "none"; return; }
      dropdown.innerHTML = matches.map(p => `
        <div class="csd-item prod-ac-item" data-id="${p.id}" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="csd-name">${p.nombre}</div>
            <div class="csd-meta">${p.referencia ? p.referencia + " · " : ""}${p.tipo}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--brand)">${fmt(p.precio)}</div>
        </div>`).join("");
      dropdown.querySelectorAll(".prod-ac-item").forEach(item => {
        item.addEventListener("mousedown", e => {
          e.preventDefault();
          const p = PRODUCTOS.find(x => x.id === item.dataset.id);
          if (!p) return;
          const linea = LINEAS.find(l => l.id === id);
          if (linea) {
            linea.descripcion = p.nombre;
            linea.precio = p.precio;
            linea.iva = p.iva;
            descInput.value = p.nombre;
            const priceInput = row.querySelector("[data-field='precio']");
            const ivaSelect  = row.querySelector("[data-field='iva']");
            if (priceInput) priceInput.value = p.precio;
            if (ivaSelect)  ivaSelect.value  = p.iva;
            const rowEl = document.getElementById(`ltRow${id}`);
            if (rowEl) rowEl.textContent = fmt(linea.cantidad * linea.precio);
            updateTotalesUI(); updatePreview();
          }
          dropdown.style.display = "none";
        });
      });
      dropdown.style.display = "";
    });
    descInput.addEventListener("blur", () => setTimeout(() => { dropdown.style.display = "none"; }, 200));
  }
  container.appendChild(row);
  updateTotalesUI();
  updatePreview();
  if (!prefill.descripcion) row.querySelector(".linea-desc").focus();
}

function onLineaChange(id, el) {
  const linea = LINEAS.find(l => l.id === id);
  if (!linea) return;
  const field = el.dataset.field;
  if      (field === "descripcion") linea.descripcion = el.value;
  else if (field === "cantidad")    linea.cantidad    = parseFloat(el.value) || 0;
  else if (field === "precio")      linea.precio      = parseFloat(el.value) || 0;
  else if (field === "iva")         linea.iva         = parseInt(el.value)   || 0;
  else if (field === "tipo")      { linea.tipo        = el.value; updateIrpfVisibility(); return; }
  const subtotal = linea.cantidad * linea.precio;
  const rowEl = document.getElementById(`ltRow${id}`);
  if (rowEl) rowEl.textContent = fmt(subtotal);
  updateTotalesUI();
  updatePreview();
}

window._delLinea = (id) => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  updateIrpfVisibility();
  updateTotalesUI();
  updatePreview();
};

function updateTotalesUI() {
  const { baseTotal, ivaMap, irpfAmt, irpfPct, total } = getLineasTotales();
  const el = id => document.getElementById(id);
  if (el("ltBase"))    el("ltBase").textContent    = fmt(baseTotal);
  if (el("ltTotal"))   el("ltTotal").textContent   = fmt(total);
  if (el("ltIrpfRow")) el("ltIrpfRow").style.display = irpfPct>0?"":"none";
  if (el("ltIrpf"))    el("ltIrpf").textContent    = fmt(irpfAmt);
  if (el("ltIrpfLbl")) el("ltIrpfLbl").textContent = `IRPF (−${irpfPct}%)`;
  if (el("ltIvaRows")) {
    el("ltIvaRows").innerHTML = Object.entries(ivaMap)
      .filter(([,v])=>v>0).sort(([a],[b])=>b-a)
      .map(([pct,amt])=>`<div class="lt-row"><span>IVA ${pct}%</span><strong>${fmt(amt)}</strong></div>`)
      .join("");
  }
}

/* ══════════════════════════
   BÚSQUEDA DE CLIENTE
══════════════════════════ */
function initClienteSearch() {
  const input    = document.getElementById("clienteSearchInput");
  const dropdown = document.getElementById("clienteDropdown");
  const limpiar  = document.getElementById("clienteLimpiarBtn");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    limpiar.style.display = q ? "" : "none";
    if (!q) { dropdown.style.display="none"; clienteSeleccionadoId=null; return; }
    const matches = CLIENTES.filter(c =>
      c.nombre.toLowerCase().includes(q) ||
      (c.nif||"").toLowerCase().includes(q) ||
      (c.email||"").toLowerCase().includes(q)
    ).slice(0,8);
    dropdown.innerHTML = matches.length
      ? matches.map(c=>`<div class="csd-item" data-id="${c.id}"><div class="csd-name">${c.nombre}</div><div class="csd-meta">${c.nif?c.nif+" · ":""}${c.email||""}</div></div>`).join("")
      : `<div class="csd-empty">Sin resultados · Se creará como cliente nuevo</div>`;
    dropdown.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("click", () => {
        const c = CLIENTES.find(x=>x.id===item.dataset.id);
        if (!c) return;
        clienteSeleccionadoId = c.id;
        input.value = c.nombre;
        limpiar.style.display = "";
        dropdown.style.display = "none";
        const set = (id,v) => { const e=document.getElementById(id); if(e) e.value=v; };
        set("nfNombre",c.nombre); set("nfNif",c.nif||"");
        set("nfPais",c.pais||"ES"); set("nfTipoCliente",c.tipo||"empresa");
        set("nfDireccion", c.direccion||"");
        document.getElementById("nfClientePanel")?.classList.add("cliente-panel--filled");
        updateIrpfVisibility();
        updatePreview();
      });
    });
    dropdown.style.display = "";
  });

  input.addEventListener("blur",  () => setTimeout(()=>{ dropdown.style.display="none"; },180));
  input.addEventListener("focus", () => { if(input.value) input.dispatchEvent(new Event("input")); });
  limpiar.addEventListener("click", () => {
    input.value=""; limpiar.style.display="none"; dropdown.style.display="none";
    clienteSeleccionadoId=null;
    ["nfNombre","nfNif","nfDireccion"].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=""; });
    document.getElementById("nfClientePanel")?.classList.remove("cliente-panel--filled");
    updatePreview();
  });
}

/* ══════════════════════════
   TIPO DE OPERACIÓN
══════════════════════════ */
function updateOpUI() {
  const banner    = document.getElementById("opInfoBanner");
  const pvOpNote  = document.getElementById("pvOpNote");
  const nifNote   = document.getElementById("nifNote");
  if (banner)  { banner.textContent=OP_INFO[opTipoActual]||""; banner.classList.toggle("visible",!!OP_INFO[opTipoActual]); }
  if (nifNote) nifNote.textContent = opTipoActual==="intracomunitaria"?"(VAT número UE obligatorio)":"";
  if (pvOpNote) {
    const notes = {
      intracomunitaria:     "🇪🇺 Operación intracomunitaria — IVA 0% (Art. 25 LIVA).",
      exportacion:          "🌍 Exportación exenta de IVA (Art. 21 LIVA).",
      inversion_sujeto_pasivo: "🔄 Inversión del sujeto pasivo — IVA 0% (Art. 84 LIVA).",
      importacion:          "📦 Importación — IVA liquidado en aduana (DUA)."
    };
    pvOpNote.textContent     = notes[opTipoActual]||"";
    pvOpNote.style.display   = notes[opTipoActual]?"":"none";
  }
}

/* ══════════════════════════
   PREVIEW EN VIVO
══════════════════════════ */
function updatePreview() {
  const { baseTotal, ivaMap, irpfAmt, irpfPct, total } = getLineasTotales();
  const fecha   = document.getElementById("nfFecha")?.value;
  const nombre  = document.getElementById("nfNombre")?.value  || "";
  const nif     = document.getElementById("nfNif")?.value     || "";
  const dir     = document.getElementById("nfDireccion")?.value || "";
  const notas   = document.getElementById("nfNotas")?.value   || "";
  const ops     = {nacional:"🇪🇸 Nacional",intracomunitaria:"🇪🇺 Intracomunitaria",exportacion:"🌍 Exportación",importacion:"📦 Importación",inversion_sujeto_pasivo:"🔄 Inv. Sujeto Pasivo"};
  const set     = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };

  set("pvFecha",  fecha?fmtDate(fecha):"—");
  set("pvCliente",nombre||"—");
  set("pvNif",    nif ? "NIF/CIF: "+nif : "—");
  set("pvOp",     ops[opTipoActual]||"Nacional");

  // Dirección en preview
  const pvDirEl = document.getElementById("pvClienteDir");
  if (pvDirEl) pvDirEl.textContent = dir || "";

  const pvLineas = document.getElementById("pvLineas");
  if (pvLineas) {
    const hasContent = LINEAS.some(l=>l.descripcion||l.precio>0);
    pvLineas.innerHTML = !hasContent
      ? `<div class="fpv-lineas-empty">Las líneas aparecerán aquí…</div>`
      : LINEAS.filter(l=>l.descripcion||l.precio>0).map(l=>`
          <div class="fpv-linea-row">
            <span class="fpvl-desc">${l.descripcion||"—"}</span>
            <span class="fpvl-qty">${l.cantidad}</span>
            <span class="fpvl-price">${fmt(l.precio)}</span>
            <span class="fpvl-total">${fmt(l.cantidad*l.precio)}</span>
          </div>`).join("");
  }

  set("pvBase",    baseTotal>0?fmt(baseTotal):"—");
  set("pvTotal",   total>0?fmt(total):"— €");
  set("pvIrpfAmt", irpfAmt>0?"−"+fmt(irpfAmt):"—");
  set("pvIrpfLbl", `IRPF (−${irpfPct}%)`);
  const pvIrpfRow = document.getElementById("pvIrpfRow");
  if (pvIrpfRow) pvIrpfRow.style.display = irpfPct>0?"":"none";
  const pvIvaDesglose = document.getElementById("pvIvaDesglose");
  if (pvIvaDesglose) {
    pvIvaDesglose.innerHTML = Object.entries(ivaMap)
      .filter(([,v])=>v>0).sort(([a],[b])=>b-a)
      .map(([pct,amt])=>`<div class="fpvt-row"><span>IVA ${pct}%</span><span>${fmt(amt)}</span></div>`)
      .join("");
  }
  const pvNotas = document.getElementById("pvNotas");
  if (pvNotas) { pvNotas.textContent=notas; pvNotas.style.display=notas?"":"none"; }
}

/* ══════════════════════════
   LÓGICA IRPF INTELIGENTE
   - Sociedad o cliente particular → campo oculto
   - Autónomo + cliente empresa   → toggle ON/OFF + selector %
══════════════════════════ */
function updateIrpfVisibility() {
  const wrap   = document.getElementById("irpfFieldWrap");
  const toggle = document.getElementById("nfIrpfToggle");
  const sel    = document.getElementById("nfIrpf");
  const hint   = document.getElementById("nfIrpfHint");
  if (!wrap || !toggle || !sel) return;

  const regime       = PERFIL_FISCAL_CACHE?.regime || "autonomo_ed";
  const tipoCliente  = document.getElementById("nfTipoCliente")?.value || "empresa";
  const esSociedad   = regime === "sociedad";
  const esParticular = tipoCliente === "particular";

  // Al menos una línea debe ser servicio para que aplique IRPF
  const hayServicio  = LINEAS.length === 0 || LINEAS.some(l => (l.tipo || "servicio") === "servicio");

  const irpfAplica = !esSociedad && !esParticular && hayServicio;

  if (!irpfAplica) {
    wrap.style.display = "none";
    toggle.checked = false;
    sel.style.display = "none";
    sel.value = "0";
    if (hint) { hint.style.display = ""; hint.textContent = "No aplicar"; }
  } else {
    wrap.style.display = "";
  }

  updateTotalesUI();
  updatePreview();
}

function initIrpfToggle() {
  const toggle = document.getElementById("nfIrpfToggle");
  const sel    = document.getElementById("nfIrpf");
  const hint   = document.getElementById("nfIrpfHint");
  if (!toggle || !sel) return;

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      sel.style.display = "";
      if (hint) hint.style.display = "none";
    } else {
      sel.style.display = "none";
      sel.value = "0"; // sin retención cuando toggle OFF
      if (hint) { hint.style.display = ""; hint.textContent = "No aplicar"; }
    }
    updateTotalesUI();
    updatePreview();
  });

  sel.addEventListener("change", () => { updateTotalesUI(); updatePreview(); });
}


async function loadPerfilForPreview() {
  if (!SESSION) return;
  if (!PERFIL_FISCAL_CACHE) {
    const { data, error } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).single();
    if (error && error.code!=="PGRST116") console.warn("perfil preview:", error.message);
    PERFIL_FISCAL_CACHE = data;
  }
  const pf  = PERFIL_FISCAL_CACHE;
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v||""; };
  set("pvEmisorNombre", pf?.nombre_razon_social||"Tu nombre / empresa");
  set("pvEmisorNif",    pf?.nif?"NIF: "+pf.nif:"");
  set("pvEmisorDir",    pf?.domicilio_fiscal||"");

  // Logo en preview
  const logoWrap = document.getElementById("pvEmisorLogo");
  if (logoWrap) {
    if (pf?.logo_url) {
      logoWrap.innerHTML = `<img src="${pf.logo_url}" style="max-height:40px;max-width:120px;object-fit:contain;margin-bottom:4px"/>`;
    } else {
      logoWrap.innerHTML = "";
    }
  }

  // Actualizar visibilidad del IRPF según régimen del emisor
  updateIrpfVisibility();
}

/* ══════════════════════════
   GUARDAR / EMITIR
══════════════════════════ */
async function saveFactura(emitirDirecto = false) {
  if (!LINEAS.length || LINEAS.every(l=>!l.precio||l.precio<=0)) {
    toast("Añade al menos una línea con precio","error"); return;
  }
  const fecha        = document.getElementById("nfFecha")?.value;
  const toggle   = document.getElementById("nfIrpfToggle");
  const irpf     = toggle?.checked
    ? (parseInt(document.getElementById("nfIrpf")?.value) || 0)
    : 0;
  const tipo         = document.getElementById("nfTipo")?.value;
  const tipoCliente  = document.getElementById("nfTipoCliente")?.value;
  const clienteNombre= document.getElementById("nfNombre")?.value.trim();
  const clienteNif   = document.getElementById("nfNif")?.value.trim();
  const clienteDir   = document.getElementById("nfDireccion")?.value.trim();
  const pais         = document.getElementById("nfPais")?.value || "ES";
  const notas        = document.getElementById("nfNotas")?.value.trim();
  const guardarCliente = document.getElementById("nfGuardarCliente")?.checked;

  if (!fecha)                                         { toast("Introduce la fecha de la factura","error"); return; }
  if (!clienteNombre && !clienteSeleccionadoId)       { toast("Introduce el nombre del cliente","error"); return; }
  if (tipoCliente==="empresa"&&!clienteNif&&!clienteSeleccionadoId)
                                                      { toast("El NIF es obligatorio para empresas","error"); return; }
  if (tipoCliente==="empresa"&&!clienteDir&&!clienteSeleccionadoId)
                                                      { toast("La dirección fiscal es obligatoria para empresas","error"); return; }

  const fobj = new Date(fecha);
  const year = fobj.getFullYear();
  const trim = "T"+(Math.floor(fobj.getMonth()/3)+1);
  if (await isCerrado(year,trim)) { toast(`El trimestre ${trim} de ${year} está cerrado`,"error"); return; }

  const { baseTotal, ivaMap } = getLineasTotales();
  const ivaEntry  = Object.entries(ivaMap).sort(([,a],[,b])=>b-a)[0];
  const ivaMain   = ivaEntry ? parseInt(ivaEntry[0]) : 0;
  const concepto  = LINEAS.filter(l=>l.descripcion).map(l=>l.descripcion).join(" · ") || "Factura";

  const btn = document.getElementById(emitirDirecto?"nfEmitirBtn":"nfGuardarBtn");
  if (btn) { btn.disabled=true; btn.innerHTML=`<span class="spin"></span> Guardando…`; }

  // Crear cliente nuevo si procede
  let cId = clienteSeleccionadoId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc, error: ce } = await supabase.from("clientes").insert({
      user_id: SESSION.user.id, nombre: clienteNombre, nif: clienteNif,
      tipo: tipoCliente, pais, direccion: clienteDir
    }).select().single();
    if (ce) { toast("Error creando cliente: "+ce.message,"warn"); }
    else    { cId=nc.id; await refreshClientes(); }
  }

  const resolvedNombre = cId ? (CLIENTES.find(c=>c.id===cId)?.nombre||clienteNombre) : clienteNombre;
  const resolvedNif    = cId ? (CLIENTES.find(c=>c.id===cId)?.nif   ||clienteNif)    : clienteNif;
  const resolvedDir    = cId ? (CLIENTES.find(c=>c.id===cId)?.direccion||clienteDir)  : clienteDir;

  const { data: fData, error } = await supabase.from("facturas").insert({
    user_id: SESSION.user.id, concepto, base: baseTotal,
    iva: ivaMain, irpf_retencion: irpf, tipo, fecha,
    tipo_operacion: opTipoActual, estado: "borrador",
    tipo_cliente: tipoCliente, cliente_id: cId,
    cliente_nombre: resolvedNombre, cliente_nif: resolvedNif,
    cliente_direccion: resolvedDir,
    cliente_pais: pais, notas,
    lineas: JSON.stringify(LINEAS.map(l=>({
      descripcion: l.descripcion, cantidad: l.cantidad,
      precio: l.precio, iva: l.iva, subtotal: l.cantidad*l.precio,
      tipo: l.tipo || "servicio"
    })))
  }).select().single();

  if (error) {
    if (btn) { btn.disabled=false; btn.textContent=emitirDirecto?"Guardar y emitir":"Guardar borrador"; }
    toast("Error guardando: "+error.message,"error"); return;
  }

  if (emitirDirecto && fData) {
    try {
      const num = await emitirFacturaDB(fData.id);
      toast(`Factura emitida: ${num}`,"success");
    } catch(e) {
      toast("Guardada pero error al emitir: "+e.message,"warn");
    }
  } else {
    toast("Factura guardada como borrador","success");
  }

  // Reset formulario
  resetForm();
  if (btn) {
    btn.disabled=false;
    btn.innerHTML = emitirDirecto
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Guardar y emitir directamente`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/></svg> Guardar como borrador`;
  }
  await refreshDashboard(); await refreshFacturas();
  switchView("facturas");
}

function resetForm() {
  LINEAS=[]; lineaIdCounter=0; clienteSeleccionadoId=null; opTipoActual="nacional";
  document.getElementById("lineasContainer").innerHTML="";
  ["nfNombre","nfNif","nfDireccion","nfNotas"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
  const csi=document.getElementById("clienteSearchInput"); if(csi) csi.value="";
  const clb=document.getElementById("clienteLimpiarBtn"); if(clb) clb.style.display="none";
  document.getElementById("nfClientePanel")?.classList.remove("cliente-panel--filled");
  document.getElementById("nfFecha").value=new Date().toISOString().slice(0,10);
  document.getElementById("nfGuardarCliente").checked=false;
  document.querySelectorAll(".op-type-btn").forEach(b=>b.classList.remove("active"));
  document.querySelector(".op-type-btn[data-op='nacional']")?.classList.add("active");
  updateOpUI(); addLinea(); updatePreview();
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initNuevaFactura() {
  const fechaEl = document.getElementById("nfFecha");
  if (fechaEl && !fechaEl.value) fechaEl.value=new Date().toISOString().slice(0,10);
  loadPerfilForPreview();

  document.querySelectorAll(".op-type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".op-type-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      opTipoActual = btn.dataset.op;
      updateOpUI();
      const sinIva = ["intracomunitaria","exportacion","inversion_sujeto_pasivo"].includes(opTipoActual);
      if (sinIva) {
        LINEAS.forEach(l=>{ l.iva=0; });
        document.querySelectorAll(".linea-iva").forEach(sel=>{ sel.value="0"; sel.disabled=true; });
        updateTotalesUI();
      } else {
        document.querySelectorAll(".linea-iva").forEach(sel=>{ sel.disabled=false; });
      }
      updatePreview();
    });
  });

  initClienteSearch();
  initIrpfToggle();
  ["nfNombre","nfNif","nfDireccion","nfFecha","nfNotas"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });
  document.getElementById("nfTipoCliente")?.addEventListener("change", updateIrpfVisibility);
  document.getElementById("addLineaBtn")?.addEventListener("click", ()=>addLinea());

  // ══════════════════════════════════════════════════
  // ESCÁNER en Nueva Factura — igual que en presupuestos
  // ══════════════════════════════════════════════════
  const nfScanInput    = document.getElementById("nfScanInput");
  const nfScanFeedback = document.getElementById("nfScanFeedback");

  const nfProcesarCodigo = () => {
    const codigo = nfScanInput?.value.trim().replace(/[\r\n\t]/g,"");
    if (!codigo) return;
    const prod = buscarProductoPorCodigo ? buscarProductoPorCodigo(codigo) : null;
    const qty  = Math.max(1, parseInt(document.getElementById("nfScanQty")?.value)||1);

    if (prod) {
      // Buscar línea existente con mismo nombre para sumar cantidad
      let yaExiste = false;
      LINEAS.forEach(l => {
        if (l.descripcion === (prod.descripcion||prod.nombre)) {
          l.cantidad += qty;
          const row = document.querySelector(`.linea-row[data-linea-id="${l.id}"]`);
          if (row) {
            const qEl = row.querySelector("[data-field='cantidad']");
            if (qEl) { qEl.value = l.cantidad; }
          }
          yaExiste = true;
        }
      });
      if (!yaExiste) addLinea({ descripcion: prod.descripcion||prod.nombre, cantidad: qty, precio: prod.precio, iva: prod.iva });
      updateTotalesUI(); updatePreview();
      if (nfScanFeedback) {
        nfScanFeedback.style.color="#059669"; nfScanFeedback.style.opacity="1";
        nfScanFeedback.textContent=`✅ ${yaExiste?"Cantidad actualizada":"Añadido"}: ${prod.nombre}${qty>1?" × "+qty:""} — ${fmt(prod.precio)}`;
        setTimeout(()=>{ if(nfScanFeedback) nfScanFeedback.style.opacity="0"; },3000);
      }
      try {
        const ctx=new(window.AudioContext||window.webkitAudioContext)();
        const osc=ctx.createOscillator(); const g=ctx.createGain();
        osc.connect(g); g.connect(ctx.destination); osc.frequency.value=880;
        g.gain.setValueAtTime(0.15,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.12);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.12);
      } catch(e){}
    } else {
      if (nfScanFeedback) {
        nfScanFeedback.style.color="#dc2626"; nfScanFeedback.style.opacity="1";
        nfScanFeedback.textContent=`❌ Código "${codigo}" no encontrado`;
        setTimeout(()=>{ if(nfScanFeedback) nfScanFeedback.style.opacity="0"; },3000);
      }
      if(nfScanInput){ nfScanInput.style.borderColor="#dc2626"; nfScanInput.style.background="#fef2f2"; setTimeout(()=>{ nfScanInput.style.borderColor=""; nfScanInput.style.background=""; },1200); }
    }
    if(nfScanInput){ nfScanInput.value=""; nfScanInput.focus(); }
  };

  nfScanInput?.addEventListener("keydown", e => { if(e.key==="Enter"){ e.preventDefault(); nfProcesarCodigo(); } });
  nfScanInput?.addEventListener("focus", () => {
    if(nfScanFeedback){ nfScanFeedback.style.color="var(--t3)"; nfScanFeedback.style.opacity="1"; nfScanFeedback.textContent="🎯 Listo para escanear"; }
  });
  nfScanInput?.addEventListener("blur", () => { if(nfScanFeedback) nfScanFeedback.style.opacity="0"; });
  document.getElementById("nfGuardarBtn")?.addEventListener("click", ()=>saveFactura(false));
  document.getElementById("nfEmitirBtn")?.addEventListener("click",  ()=>saveFactura(true));
  if (LINEAS.length===0) addLinea();
}
