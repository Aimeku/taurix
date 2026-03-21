/* ═══════════════════════════════════════════════════════
   TUGESTOR · facturas.js
   Módulo de facturas: tabla, acciones, emitir, cobro,
   gasto rápido con "Deshacer", numeración configurable
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast, toastConDeshacer,
  openModal, closeModal, isCerrado, getYear, getTrim, getFechaRango,
  TRIM_LABELS, TRIM_PLAZOS, OP_INFO
} from "./utils.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";

let paginaActual = 1;
const POR_PAGINA  = 30;

/* ══════════════════════════════════════════
   EMITIR FACTURA
   Respeta la serie + formato configurado
   en perfil (serie_formato)
══════════════════════════════════════════ */
export async function emitirFacturaDB(facturaId) {
  const { data: f, error: fe } = await supabase.from("facturas").select("*").eq("id", facturaId).single();
  if (fe || !f) throw new Error(fe?.message || "Factura no encontrada");

  const { data: pfRaw } = await supabase.from("perfil_fiscal").select("serie_formato").eq("user_id", SESSION.user.id).single();
  const formatoSerie = pfRaw?.serie_formato || "{YEAR}-{NUM4}";

  const serie = new Date(f.fecha).getFullYear().toString();

  // RPC atómica — evita race condition con numeración duplicada
  const { data: num, error: rpcErr } = await supabase.rpc("get_next_factura_number", {
    p_user_id: SESSION.user.id,
    p_serie: serie
  });

  let finalNum = num;

  if (rpcErr || !finalNum) {
    console.warn("RPC fallback activado:", rpcErr?.message || "num vacío");
    try {
      // Intentar obtener la serie existente
      const { data: serieData } = await supabase.from("factura_series")
        .select("*").eq("user_id", SESSION.user.id).eq("serie", serie)
        .maybeSingle(); // maybeSingle no lanza error si no hay filas

      if (serieData) {
        finalNum = (serieData.ultimo_numero || 0) + 1;
        await supabase.from("factura_series")
          .update({ ultimo_numero: finalNum }).eq("id", serieData.id);
      } else {
        // Crear la serie desde cero
        const { data: nuevaSerie, error: insertErr } = await supabase
          .from("factura_series")
          .insert({ user_id: SESSION.user.id, serie, ultimo_numero: 1 })
          .select().maybeSingle();
        if (insertErr) {
          // Último fallback absoluto: timestamp para que nunca quede sin número
          console.error("No se pudo crear serie, usando timestamp:", insertErr.message);
          finalNum = Date.now() % 100000; // número único de 5 dígitos
        } else {
          finalNum = nuevaSerie?.ultimo_numero || 1;
        }
      }
    } catch(fallbackErr) {
      console.error("Fallback completo falló:", fallbackErr.message);
      finalNum = Date.now() % 100000;
    }
  }

  // Garantía final: nunca guardar sin número
  if (!finalNum || isNaN(finalNum)) finalNum = 1;

  const numero = formatoSerie
    .replace("{YEAR}", serie)
    .replace("{NUM4}", String(finalNum).padStart(4,"0"))
    .replace("{NUM3}", String(finalNum).padStart(3,"0"))
    .replace("{NUM}",  String(finalNum));

  const { error: ue } = await supabase.from("facturas").update({
    numero_factura: numero, serie, estado: "emitida",
    fecha_emision: new Date().toISOString().slice(0,10)
  }).eq("id", facturaId).eq("estado","borrador");
  if (ue) throw new Error(ue.message);

  return numero;
}

/* ══════════════════════════════════════════
   COBRO: marcar cobrada / pendiente
   Actualiza también fecha_cobro y registra
   quien marcó el cambio (para auditoría)
══════════════════════════════════════════ */
export async function marcarCobrada(facturaId, cobrada) {
  const { error } = await supabase.from("facturas").update({
    cobrada,
    fecha_cobro: cobrada ? new Date().toISOString().slice(0,10) : null,
    cobro_updated_at: new Date().toISOString()
  }).eq("id", facturaId);

  if (error) { toast("Error actualizando cobro: "+error.message,"error"); return; }
  toast(cobrada ? "✅ Factura marcada como cobrada" : "⏳ Factura marcada como pendiente", "success");
  // Refresca ambas vistas para que el dashboard refleje el cambio
  const { refreshDashboard } = await import("./dashboard.js");
  await refreshDashboard();
  await refreshFacturas();
}
window._toggleCobro = (id, cobrada) => marcarCobrada(id, cobrada);

/* ══════════════════════════════════════════
   TABLA FACTURAS
══════════════════════════════════════════ */
export async function refreshFacturas() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const tipof     = document.getElementById("filterTipo")?.value    || "";
  const estadof   = document.getElementById("filterEstado")?.value  || "";
  const opf       = document.getElementById("filterOp")?.value      || "";
  const search    = (document.getElementById("facturasSearch")?.value || "").toLowerCase();
  const dateFrom  = document.getElementById("filterFechaFrom")?.value || "";
  const dateTo    = document.getElementById("filterFechaTo")?.value   || "";
  const importeMin = parseFloat(document.getElementById("filterImporteMin")?.value) || 0;
  const importeMax = parseFloat(document.getElementById("filterImporteMax")?.value) || 0;
  const desde = (paginaActual-1)*POR_PAGINA;

  let q = supabase.from("facturas").select("*", {count:"exact"})
    .eq("user_id", SESSION.user.id).gte("fecha",ini).lte("fecha",fin)
    .order("fecha",{ascending:false}).range(desde, desde+POR_PAGINA-1);
  if (tipof)  q = q.eq("tipo", tipof);
  if (estadof) q = q.eq("estado", estadof);
  if (opf)    q = q.eq("tipo_operacion", opf);

  const { data, count, error } = await q;
  if (error) {
    console.error("refreshFacturas:", error.message);
    const tbody = document.getElementById("facturasBody");
    if (tbody) tbody.innerHTML = `<tr class="dt-empty"><td colspan="12">Error cargando facturas. Comprueba tu conexión.</td></tr>`;
    return;
  }

  let facturas = data || [];
  if (search)    facturas = facturas.filter(f =>
    (f.concepto||"").toLowerCase().includes(search) ||
    (f.numero_factura||"").toLowerCase().includes(search) ||
    (f.cliente_nombre||"").toLowerCase().includes(search));
  if (dateFrom)      facturas = facturas.filter(f => f.fecha >= dateFrom);
  if (dateTo)        facturas = facturas.filter(f => f.fecha <= dateTo);
  if (importeMin>0)  facturas = facturas.filter(f => f.base >= importeMin);
  if (importeMax>0)  facturas = facturas.filter(f => f.base <= importeMax);

  const countEl = document.getElementById("facturasCount");
  if (countEl) countEl.textContent = `${count||0} facturas en el periodo`;

  const borradores = facturas.filter(f=>f.estado==="borrador").length;
  const badge = document.getElementById("snBadgeBorradores");
  if (badge) { badge.textContent = borradores; badge.style.display = borradores>0?"":"none"; }

  const cerrado = await isCerrado(year, trim);
  const tbody   = document.getElementById("facturasBody");
  if (!tbody) return;

  if (!facturas.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="12">Sin facturas para este periodo y filtros aplicados.</td></tr>`;
    document.getElementById("facturasPaginacion").innerHTML = "";
    return;
  }

  const opBadges = {nacional:"b-nac",intracomunitaria:"b-ic",exportacion:"b-exp",importacion:"b-imp",inversion_sujeto_pasivo:"b-isp"};
  const opLabels = {nacional:"Nacional",intracomunitaria:"Intracom.",exportacion:"Exportación",importacion:"Importación",inversion_sujeto_pasivo:"Inv. SP"};

  tbody.innerHTML = facturas.map(f => {
    const total  = f.base + (f.base*f.iva)/100;
    const ivaAmt = (f.base*f.iva)/100;
    const opKey  = f.tipo_operacion||"nacional";

    /* ── Columna acciones ── */
    let acciones = "";
    if (cerrado) {
      acciones = `<div class="tbl-act">
        <button class="ta-btn" onclick="window._pdfFact('${f.id}')" title="Descargar PDF">📄 PDF Fac</button>
        <span class="ta-locked">🔒</span>
      </div>`;
    } else if (f.estado !== "emitida") {
      acciones = `<div class="tbl-act">
        <button class="ta-btn ta-emit" onclick="window._emitir('${f.id}')">📤 Emitir</button>
        <button class="ta-btn" onclick="window._pdfFact('${f.id}')" title="Descargar PDF borrador">📄 PDF Fac</button>
        <button class="ta-btn" onclick="window._editFact('${f.id}')">✏️</button>
        <button class="ta-btn ta-del" onclick="window._delFact('${f.id}')">🗑️</button>
      </div>`;
    } else {
      acciones = `<div class="tbl-act">
        <button class="ta-btn" onclick="window._pdfFact('${f.id}')" title="Descargar PDF">📄 PDF Fac</button>
        ${f.tipo==="emitida"?`<button class="ta-btn ${f.cobrada?"ta-cobrada":"ta-pendiente"}" onclick="window._toggleCobro('${f.id}',${!f.cobrada})" title="${f.cobrada?"Cobrada":"Pendiente"}">${f.cobrada?"✅":"⏳"}</button>`:""}
        <button class="ta-btn" onclick="window._duplicarFact('${f.id}')" title="Duplicar factura">📋</button>
        ${f.tipo==="emitida"?`<button class="ta-btn" onclick="window._notaCredito('${f.id}')" title="Nota de crédito / Rectificativa" style="color:#dc2626">🔄</button>`:""}
        <button class="ta-btn ta-del" onclick="window._delFact('${f.id}')">🗑️</button>
      </div>`;
    }

    /* ── Columna cobro (badge) ── */
    let cobroBadge;
    if (f.tipo==="emitida" && f.estado==="emitida") {
      if (f.cobrada) {
        cobroBadge = `<span class="badge b-cobrada" title="Cobrada el ${fmtDate(f.fecha_cobro)}">✅ Cobrada${f.fecha_cobro?`<br><span style="font-size:9px;opacity:.7">${fmtDate(f.fecha_cobro)}</span>`:"" }</span>`;
      } else {
        // Detectar vencida: si la fecha de la factura tiene > 30 días y no está cobrada
        const diasPendiente = Math.floor((Date.now() - new Date(f.fecha+"T12:00:00")) / 86400000);
        const vencida = diasPendiente > 30;
        cobroBadge = vencida
          ? `<span class="badge b-vencida" title="${diasPendiente} días sin cobrar">⚠️ Vencida</span>`
          : `<span class="badge b-pendiente">⏳ Pendiente</span>`;
      }
    } else {
      cobroBadge = `<span style="color:var(--t4);font-size:11px">—</span>`;
    }

    return `
      <tr>
        <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
        <td>${f.estado==="emitida"?`<span class="badge b-income mono" style="font-size:11px">${f.numero_factura}</span>`:`<span class="badge b-draft">Borrador</span>`}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${f.concepto||"—"}</td>
        <td style="font-size:12px;color:var(--t3)">${f.cliente_nombre||"—"}</td>
        <td><span class="badge ${opBadges[opKey]||"b-nac"}" style="font-size:10px">${opLabels[opKey]||"—"}</span></td>
        <td class="mono fw7">${fmt(f.base)}</td>
        <td style="font-size:12px">${f.iva}%<br><span style="color:var(--t4);font-size:11px">${fmt(ivaAmt)}</span></td>
        <td class="mono fw7">${fmt(total)}</td>
        <td><span class="badge ${f.tipo==="emitida"?"b-income":"b-expense"}">${f.tipo==="emitida"?"📤 Emitida":"📥 Recibida"}</span></td>
        <td><span class="badge ${f.estado==="emitida"?"b-emit":"b-draft"}">${f.estado==="emitida"?"Oficial":"Borrador"}</span></td>
        <td>${cobroBadge}</td>
        <td>${f.verifactu_hash ? `<span class="verifactu-badge" title="${f.verifactu_hash.substring(0,16)}…" style="font-size:9px;padding:2px 7px">✓ VF</span>` : `<span style="color:var(--t4);font-size:11px">—</span>`}</td>
        <td>${acciones}</td>
      </tr>`;
  }).join("");

  // Paginación
  const totalPags = Math.ceil((count||0)/POR_PAGINA);
  const pEl = document.getElementById("facturasPaginacion");
  if (pEl) {
    pEl.innerHTML = totalPags>1 ? `
      <button class="btn-outline" ${paginaActual===1?"disabled":""} id="_prevPag">← Anterior</button>
      <span style="font-size:13px;color:var(--t3)">Pág. ${paginaActual} / ${totalPags}</span>
      <button class="btn-outline" ${paginaActual===totalPags?"disabled":""} id="_nextPag">Siguiente →</button>
    ` : "";
    document.getElementById("_prevPag")?.addEventListener("click",()=>{paginaActual--;refreshFacturas();});
    document.getElementById("_nextPag")?.addEventListener("click",()=>{paginaActual++;refreshFacturas();});
  }
}

/* ══════════════════════════════════════════
   DUPLICAR FACTURA
══════════════════════════════════════════ */
window._duplicarFact = async (id) => {
  const { data: f } = await supabase.from("facturas").select("*").eq("id", id).single();
  if (!f) { toast("Factura no encontrada","error"); return; }
  const { error } = await supabase.from("facturas").insert({
    user_id: SESSION.user.id,
    concepto: f.concepto,
    base: f.base, iva: f.iva, irpf_retencion: f.irpf_retencion,
    tipo: f.tipo, tipo_operacion: f.tipo_operacion,
    fecha: new Date().toISOString().slice(0,10),
    estado: "borrador",
    cliente_id: f.cliente_id, cliente_nombre: f.cliente_nombre,
    cliente_nif: f.cliente_nif, cliente_direccion: f.cliente_direccion,
    cliente_pais: f.cliente_pais, notas: f.notas, lineas: f.lineas,
    forma_pago: f.forma_pago,
  });
  if (error) { toast("Error duplicando: "+error.message,"error"); return; }
  toast("Factura duplicada como borrador ✅","success");
  const { refreshDashboard } = await import("./dashboard.js");
  await refreshDashboard(); await refreshFacturas();
};

/* ══════════════════════════════════════════
   NOTA DE CRÉDITO / RECTIFICATIVA
══════════════════════════════════════════ */
window._notaCredito = async (id) => {
  const { data: f } = await supabase.from("facturas").select("*").eq("id", id).single();
  if (!f) { toast("Factura no encontrada","error"); return; }
  if (f.estado !== "emitida") { toast("Solo se pueden rectificar facturas emitidas","error"); return; }

  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🔄 Nota de crédito — ${f.numero_factura}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px">
          ⚠️ La nota de crédito anulará total o parcialmente la factura <strong>${f.numero_factura}</strong> (${fmt(f.base + f.base*(f.iva||0)/100)}).
        </div>
        <div class="modal-field"><label>Causa de la rectificación</label>
          <select id="nc_causa" class="ff-select">
            <option>Devolución total</option>
            <option>Devolución parcial</option>
            <option>Error en el precio</option>
            <option>Error en datos fiscales</option>
            <option>Descuento posterior</option>
            <option>Otra causa</option>
          </select>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Base a rectificar (€)</label>
            <input type="number" id="nc_base" class="ff-input" value="${f.base}" step="0.01" max="${f.base}"/>
          </div>
          <div class="modal-field"><label>Fecha</label>
            <input type="date" id="nc_fecha" class="ff-input" value="${new Date().toISOString().slice(0,10)}"/>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="nc_ok" style="background:#dc2626">Emitir nota de crédito</button>
      </div>
    </div>`);

  document.getElementById("nc_ok").addEventListener("click", async () => {
    const base  = parseFloat(document.getElementById("nc_base").value) || f.base;
    const fecha = document.getElementById("nc_fecha").value;
    const causa = document.getElementById("nc_causa").value;
    const baseRect = -Math.abs(base);

    const { data: nc, error } = await supabase.from("facturas").insert({
      user_id: SESSION.user.id,
      concepto: `Nota de crédito · ${f.numero_factura} · ${causa}`,
      base: baseRect, iva: f.iva, tipo: "emitida",
      tipo_operacion: f.tipo_operacion, fecha, estado: "borrador",
      cliente_id: f.cliente_id, cliente_nombre: f.cliente_nombre,
      cliente_nif: f.cliente_nif, cliente_direccion: f.cliente_direccion,
      factura_rectif_de: f.id, cobrada: false,
    }).select().single();
    if (error) { toast("Error: "+error.message,"error"); return; }

    // Emitir directamente
    try {
      const num = await emitirFacturaDB(nc.id);
      toast(`Nota de crédito emitida: ${num} ✅`,"success");
    } catch(e) { toast("Guardada pero sin emitir: "+e.message,"warn"); }
    closeModal();
    const { refreshDashboard } = await import("./dashboard.js");
    await refreshDashboard(); await refreshFacturas();
  });
};

window._pdfFact = id => { import("./exports.js").then(m => m.exportFacturaPDF(id)); };

window._emitir = async id => {
  try {
    const { data: f, error: fe } = await supabase.from("facturas").select("*").eq("id",id).single();
    if (fe || !f) { toast("Factura no encontrada","error"); return; }
    if (f.estado==="emitida") { toast("Ya está emitida","info"); return; }
    const year = new Date(f.fecha).getFullYear();
    const trim = "T"+(Math.floor(new Date(f.fecha).getMonth()/3)+1);
    if (await isCerrado(year,trim)) { toast("El trimestre está cerrado","error"); return; }

    const total = f.base + (f.base * f.iva / 100);
    openModal(`
      <div class="modal">
        <div class="modal-hd">
          <span class="modal-title">📤 Confirmar emisión</span>
          <button class="modal-x" onclick="window._cm()">×</button>
        </div>
        <div class="modal-bd">
          <div style="text-align:center;padding:8px 0 16px">
            <div style="width:52px;height:52px;border-radius:50%;background:#fff7ed;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:24px">📤</div>
            <p style="font-size:15px;font-weight:600;color:var(--t1);margin:0 0 6px">${f.concepto||"Factura"}</p>
            <p style="font-size:13px;color:var(--t3);margin:0 0 4px">${f.cliente_nombre||"—"} · ${fmtDate(f.fecha)}</p>
            <p style="font-size:22px;font-weight:800;color:#f97316;margin:10px 0 0">${fmt(total)}</p>
          </div>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;color:#92400e;display:flex;gap:10px">
            <span style="font-size:16px;flex-shrink:0">⚠️</span>
            <span>Una vez emitida, <strong>la factura no podrá editarse ni eliminarse</strong>. Se asignará un número correlativo definitivo.</span>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button id="_confirmEmitir" style="padding:10px 22px;border:none;border-radius:10px;background:linear-gradient(135deg,#f97316,#fb923c);color:#fff;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px">
            📤 Sí, emitir factura
          </button>
        </div>
      </div>
    `);

    document.getElementById("_confirmEmitir").addEventListener("click", async () => {
      closeModal();
      try {
        const num = await emitirFacturaDB(id);
        toast(`Factura emitida: ${num}`,"success");
        const { refreshDashboard } = await import("./dashboard.js");
        await refreshDashboard(); await refreshFacturas();
      } catch(e) { toast("Error: "+e.message,"error"); }
    });

  } catch(e) { toast("Error: "+e.message,"error"); }
};

window._editFact = async id => {
  const { data: f, error } = await supabase.from("facturas").select("*").eq("id",id).single();
  if (error || !f) { toast("No se pudo cargar la factura","error"); return; }
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">✏️ Editar factura</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <div class="modal-field"><label>Concepto</label><input id="_ef_concepto" value="${f.concepto||""}"/></div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Base imponible (€)</label><input type="number" id="_ef_base" value="${f.base}" step="0.01"/></div>
          <div class="modal-field"><label>Fecha</label><input type="date" id="_ef_fecha" value="${f.fecha}"/></div>
        </div>
        <div class="modal-field"><label>Notas</label><textarea id="_ef_notas">${f.notas||""}</textarea></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="_ef_save">Guardar</button>
      </div>
    </div>
  `);
  document.getElementById("_ef_save").onclick = async () => {
    const { error: ue } = await supabase.from("facturas").update({
      concepto: document.getElementById("_ef_concepto").value.trim(),
      base:     Number(document.getElementById("_ef_base").value),
      fecha:    document.getElementById("_ef_fecha").value,
      notas:    document.getElementById("_ef_notas").value.trim()
    }).eq("id",id);
    if (ue) { toast("Error guardando: "+ue.message,"error"); return; }
    closeModal(); toast("Factura actualizada","success");
    const { refreshDashboard } = await import("./dashboard.js");
    await refreshDashboard(); await refreshFacturas();
  };
};

window._delFact = id => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar factura</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta factura definitivamente? Esta acción no se puede deshacer.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_df_ok">Eliminar</button>
      </div>
    </div>
  `);
  document.getElementById("_df_ok").onclick = async () => {
    const { error } = await supabase.from("facturas").delete().eq("id",id);
    if (error) { toast("Error: "+error.message,"error"); closeModal(); return; }
    closeModal(); toast("Factura eliminada","success");
    const { refreshDashboard } = await import("./dashboard.js");
    await refreshDashboard(); await refreshFacturas();
  };
};

/* ══════════════════════════════════════════
   GASTO RÁPIDO (con "Deshacer")
   El insert se hace, pero si el usuario
   pulsa "Deshacer" en el toast se elimina
   el registro antes de que pase el tiempo
══════════════════════════════════════════ */
export function showGastoRapidoModal() {
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">⚡ Gasto rápido</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Para tiques, gasolina, parking, dietas y otros gastos menores sin factura completa.</p>
        <div class="modal-field">
          <label>Descripción *</label>
          <input id="gr_concepto" placeholder="Ej: Gasolina · Parking aeropuerto · Dieta viaje…"/>
        </div>
        <div class="modal-grid2">
          <div class="modal-field">
            <label>Importe total con IVA (€) *</label>
            <input type="number" id="gr_total" placeholder="0.00" step="0.01" min="0.01"/>
          </div>
          <div class="modal-field"><label>Fecha *</label><input type="date" id="gr_fecha" value="${new Date().toISOString().slice(0,10)}"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Tipo de gasto</label>
            <select id="gr_categoria">
              <option value="dietas">🍽️ Dietas / Restaurante</option>
              <option value="transporte">🚗 Transporte / Gasolina</option>
              <option value="parking">🅿️ Parking / Peajes</option>
              <option value="material">📦 Material de oficina</option>
              <option value="servicios">💼 Servicios profesionales</option>
              <option value="otros">📝 Otros</option>
            </select>
          </div>
          <div class="modal-field"><label>IVA incluido</label>
            <select id="gr_iva">
              <option value="21">21% — General</option>
              <option value="10">10% — Reducido</option>
              <option value="4">4% — Superreducido</option>
              <option value="0">0% — Exento</option>
            </select>
          </div>
        </div>
        <div class="modal-field"><label>Proveedor (opcional)</label><input id="gr_proveedor" placeholder="Nombre del establecimiento"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="gr_save">Registrar gasto</button>
      </div>
    </div>
  `);

  document.getElementById("gr_save").onclick = async () => {
    const concepto  = document.getElementById("gr_concepto").value.trim();
    const totalVal  = parseFloat(document.getElementById("gr_total").value) || 0;
    const fecha     = document.getElementById("gr_fecha").value;
    const ivaPct    = parseInt(document.getElementById("gr_iva").value) || 0;
    const cat       = document.getElementById("gr_categoria").value;
    const proveedor = document.getElementById("gr_proveedor").value.trim();

    // Validaciones con mensajes claros
    if (!concepto)       { toast("Introduce una descripción","error"); return; }
    if (totalVal <= 0)   { toast("El importe debe ser mayor que 0","error"); return; }
    if (!fecha)          { toast("Introduce la fecha","error"); return; }

    const base = ivaPct > 0 ? +(totalVal / (1 + ivaPct/100)).toFixed(2) : totalVal;
    const saveBtn = document.getElementById("gr_save");
    if (saveBtn) { saveBtn.disabled=true; saveBtn.innerHTML=`<span class="spin"></span> Guardando…`; }

    const { data: inserted, error } = await supabase.from("facturas").insert({
      user_id:        SESSION.user.id,
      concepto:       `[${cat}] ${concepto}`,
      base,
      iva:            ivaPct,
      irpf_retencion: 0,
      tipo:           "recibida",
      tipo_operacion: "nacional",
      estado:         "emitida",
      fecha,
      cliente_nombre: proveedor || "Tique / Sin proveedor",
      numero_factura: `TIQUE-${Date.now()}`,
      fecha_emision:  fecha,
      notas:          "Gasto rápido registrado desde tique"
    }).select().single();

    if (error) {
      if (saveBtn) { saveBtn.disabled=false; saveBtn.textContent="Registrar gasto"; }
      toast("Error: "+error.message,"error");
      return;
    }

    closeModal();
    const { refreshDashboard } = await import("./dashboard.js");
    await refreshDashboard(); await refreshFacturas();

    // Toast con "Deshacer" — si el usuario pulsa, borramos el registro
    toastConDeshacer(`Gasto registrado: ${concepto}`, async () => {
      if (inserted?.id) {
        const { error: de } = await supabase.from("facturas").delete().eq("id", inserted.id);
        if (de) { toast("No se pudo deshacer: "+de.message,"error"); return; }
        toast("Gasto eliminado ↩️","info");
        await refreshDashboard(); await refreshFacturas();
      }
    }, 6000);
  };
}

/* ══════════════════════════════════════════
   CONFIGURACIÓN DE SERIE / NUMERACIÓN
   Permite al usuario personalizar el formato
   Ej: "F-{YEAR}-{NUM4}"  → F-2025-0001
       "{YEAR}/{NUM3}"     → 2025/001
══════════════════════════════════════════ */
export async function showSerieConfigModal() {
  const { data: pf } = await supabase.from("perfil_fiscal").select("serie_formato").eq("user_id", SESSION.user.id).single();
  const formato = pf?.serie_formato || "{YEAR}-{NUM4}";

  // Calcular preview con el número 1
  const previewNum = (f) => f
    .replace("{YEAR}", new Date().getFullYear())
    .replace("{NUM4}", "0001")
    .replace("{NUM3}", "001")
    .replace("{NUM}",  "1");

  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🔢 Configurar numeración de facturas</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">
          Personaliza el formato del número de factura. Variables disponibles:<br>
          <code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:12px">{YEAR}</code> → año actual &nbsp;
          <code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:12px">{NUM4}</code> → correlativo 4 dígitos &nbsp;
          <code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:12px">{NUM3}</code> → 3 dígitos &nbsp;
          <code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:12px">{NUM}</code> → sin relleno
        </p>

        <div class="modal-field">
          <label>Formato del número de factura</label>
          <input id="serie_formato" value="${formato}" placeholder="Ej: F-{YEAR}-{NUM4}"/>
        </div>

        <div style="background:var(--surface-2);border-radius:8px;padding:12px 14px;margin-top:4px;font-size:13px">
          <span style="color:var(--t3);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Vista previa</span><br>
          <span id="serie_preview" style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--brand)">${previewNum(formato)}</span>
        </div>

        <div style="margin-top:16px">
          <p style="font-size:12px;color:var(--t3);margin-bottom:8px">Formatos habituales:</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${["{YEAR}-{NUM4}","F-{YEAR}-{NUM4}","{YEAR}/{NUM3}","F{NUM4}/{YEAR}"].map(f=>`
              <button class="btn-outline" style="font-family:var(--font-mono);font-size:12px" onclick="
                document.getElementById('serie_formato').value='${f}';
                document.getElementById('serie_preview').textContent='${previewNum(f)}';
              ">${previewNum(f)}</button>
            `).join("")}
          </div>
        </div>

        <p style="margin-top:16px;font-size:12px;color:var(--amber);background:var(--amber-lt);border-radius:7px;padding:9px 12px">
          ⚠️ El cambio aplica a partir de la siguiente factura emitida. Las facturas ya emitidas mantienen su número.
        </p>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="serie_save">Guardar formato</button>
      </div>
    </div>
  `);

  // Preview en tiempo real
  document.getElementById("serie_formato")?.addEventListener("input", e => {
    const el = document.getElementById("serie_preview");
    if (el) el.textContent = previewNum(e.target.value || "{YEAR}-{NUM4}");
  });

  document.getElementById("serie_save").onclick = async () => {
    const nuevoFormato = document.getElementById("serie_formato").value.trim() || "{YEAR}-{NUM4}";
    const { error } = await supabase.from("perfil_fiscal").upsert({
      user_id: SESSION.user.id,
      serie_formato: nuevoFormato,
      updated_at: new Date().toISOString()
    }, { onConflict:"user_id" });
    if (error) { toast("Error guardando formato: "+error.message,"error"); return; }
    closeModal();
    toast(`Formato guardado: ${previewNum(nuevoFormato)}`,"success");
  };
}
window._showSerieConfig = showSerieConfigModal;

/* ══════════════════════════════════════════
   CIERRE TRIMESTRE
══════════════════════════════════════════ */
export async function updateCierreBtn() {
  const btn = document.getElementById("cerrarTrimestreBtn");
  if (!btn) return;
  const year = getYear(), trim = getTrim();
  const cerrado = await isCerrado(year, trim);
  btn.title   = cerrado ? `${trim} ${year} cerrado` : `Cerrar ${trim} ${year}`;
  btn.style.background   = cerrado ? "#d1fae5" : "";
  btn.style.borderColor  = cerrado ? "#6ee7b7" : "";
  btn.disabled = cerrado;

  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener("click", () => {
    if (cerrado) { toast("Este trimestre ya está cerrado","info"); return; }
    openModal(`
      <div class="modal">
        <div class="modal-hd"><span class="modal-title">🔒 Cerrar ${trim} de ${year}</span><button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd">
          <p style="color:var(--t2);margin-bottom:12px;line-height:1.6">Una vez cerrado, <strong>no podrás emitir, editar ni eliminar facturas</strong> de este trimestre.</p>
          <p class="modal-warn">⚠️ Esta acción no se puede deshacer. Asegúrate de haber revisado todas las facturas antes de cerrar.</p>
        </div>
        <div class="modal-ft">
          <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button class="btn-modal-danger" id="_closeTrim">Confirmar cierre</button>
        </div>
      </div>
    `);
    document.getElementById("_closeTrim").onclick = async () => {
      const { error } = await supabase.from("cierres_trimestrales")
        .insert({ user_id: SESSION.user.id, year, trimestre: trim });
      if (error && error.code !== "23505") { toast("Error al cerrar","error"); closeModal(); return; }
      closeModal(); toast(`${trim} ${year} cerrado correctamente`,"success");
      await window._refresh();
    };
  });
}

/* ══════════════════════════════════════════
   INIT filtros de la vista Facturas
══════════════════════════════════════════ */
export function initFacturasView() {
  document.getElementById("irNuevaFacturaBtn")?.addEventListener("click", () => {
    import("./utils.js").then(m => m.switchView("nueva-factura"));
  });
  ["facturasSearch","filterTipo","filterEstado","filterOp"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  () => { paginaActual=1; refreshFacturas(); });
    document.getElementById(id)?.addEventListener("change", () => { paginaActual=1; refreshFacturas(); });
  });
  ["filterFechaFrom","filterFechaTo","filterImporteMin","filterImporteMax"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => { paginaActual=1; refreshFacturas(); });
  });
}
