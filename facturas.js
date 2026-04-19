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
import { totalFactura, desglosarIva } from "./factura-helpers.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";
import { renderSedeSelector, readSedeIdFromForm, applySedeFilter } from "./sedes.js";

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
  // Sanear: si el formato empieza directamente por {YEAR} o por un dígito (sin prefijo letra),
  // forzar el prefijo "F-" para evitar números del tipo "2025-0001" sin identificador.
  let formatoSerie = pfRaw?.serie_formato || "F-{YEAR}-{NUM4}";
  if (/^\{YEAR\}/.test(formatoSerie) || /^\d/.test(formatoSerie)) {
    formatoSerie = "F-" + formatoSerie;
  }

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
        // Crear la serie desde cero usando el numero_inicial configurado.
        // Usamos upsert en lugar de insert para que dos tabs simultáneas
        // no colisionen: si alguien se adelanta, el upsert actualiza
        // solo si el valor actual sigue siendo 0 (ninguna factura emitida aún).
        let inicialNum = 1;
        try {
          const { getNumeroInicialFactura } = await import('./numeracion-docs.js');
          inicialNum = await getNumeroInicialFactura(serie);
        } catch (_) { /* tabla aún no existe — usar 1 */ }

        const { data: nuevaSerie, error: insertErr } = await supabase
          .from("factura_series")
          .upsert(
            { user_id: SESSION.user.id, serie, ultimo_numero: inicialNum },
            { onConflict: "user_id,serie", ignoreDuplicates: false }
          )
          .select().maybeSingle();
        if (insertErr) {
          // Fallback: releer la fila que el proceso concurrente ya creó
          const { data: existing } = await supabase.from("factura_series")
            .select("ultimo_numero").eq("user_id", SESSION.user.id)
            .eq("serie", serie).maybeSingle();
          finalNum = existing ? (existing.ultimo_numero || 0) + 1 : inicialNum;
          if (existing) {
            await supabase.from("factura_series")
              .update({ ultimo_numero: finalNum })
              .eq("user_id", SESSION.user.id).eq("serie", serie);
          }
        } else {
          finalNum = nuevaSerie?.ultimo_numero || inicialNum;
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
    .replace("{NUM2}", String(finalNum).padStart(2,"0"))
    .replace("{NUM}",  String(finalNum));

  const { error: ue } = await supabase.from("facturas").update({
    numero_factura: numero, serie, estado: "emitida",
    fecha_emision: new Date().toISOString().slice(0,10)
  }).eq("id", facturaId);
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
    .order("numero_factura",{ascending:false,nullsFirst:false}).order("id",{ascending:false,nullsFirst:false}).range(desde, desde+POR_PAGINA-1);
  q = applySedeFilter(q);
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

  // Ordenar por número de factura descendente (extrae parte numérica final: F-2026-0010 → 20260010)
  facturas.sort((a, b) => {
    const parseNum = n => {
      if (!n) return 0;
      const m = n.match(/-(\d{4})-(\d+)$/);
      return m ? parseInt(m[1]) * 100000 + parseInt(m[2]) : 0;
    };
    return parseNum(b.numero_factura) - parseNum(a.numero_factura);
  });

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

  facturas.sort((a,b) => (b.fecha||"").localeCompare(a.fecha||""));
  tbody.innerHTML = facturas.map(f => {
    // Hallazgo 1 del informe fiscal — multi-IVA:
    // Antes: const total = f.base + f.base*(f.iva||0)/100 − f.base*(f.irpf_retencion||0)/100;
    // Eso usaba un único tipo de IVA principal sobre toda la base, lo que para
    // facturas con varios tipos (p.ej. 21% + 10%) daba un total incorrecto.
    // Ahora leemos el desglose real por línea con totalFactura().
    const t      = totalFactura(f);
    const total  = t.total;
    const ivaAmt = t.cuota_iva;
    const opKey  = f.tipo_operacion||"nacional";

    /* ── Columna acciones ── */
    let acciones = "";
    if (cerrado) {
      acciones = `<div class="tbl-act">
        <button class="ta-btn" onclick="window._pdfFact('${f.id}')" title="Descargar PDF">📄 PDF</button>
        <span class="ta-locked">🔒</span>
      </div>`;
    } else {
      // Emitida — INMUTABLE: solo PDF, cobro, duplicar, nota de crédito
      acciones = `<div class="tbl-act">
        <button class="ta-btn" onclick="window._pdfFact('${f.id}')" title="Descargar PDF">📄 PDF</button>
        <button class="ta-btn" onclick="window._duplicarFact('${f.id}')" title="Duplicar factura">📋</button>
        ${f.tipo==="emitida"?`<button class="ta-btn" onclick="window._notaCredito('${f.id}')" title="Nota de crédito / Rectificativa" style="color:#dc2626">🔄</button>`:""}
      </div>`;
    }


    return `
      <tr>
        <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
        <td>${f.estado==="emitida"?`<span class="badge b-income mono" style="font-size:11px">${f.numero_factura}</span>`:`<span style="color:var(--t4);font-size:11px">—</span>`}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${f.concepto||"—"}</td>
        <td style="font-size:12px;color:var(--t3)">${f.cliente_nombre||"—"}</td>
        <td><span class="badge ${opBadges[opKey]||"b-nac"}" style="font-size:10px">${opLabels[opKey]||"—"}</span></td>
        <td class="mono fw7">${fmt(f.base)}</td>
        <td style="font-size:12px">${f.iva}%<br><span style="color:var(--t4);font-size:11px">${fmt(ivaAmt)}</span></td>
        <td class="mono fw7">${fmt(total)}</td>
        <td><span class="badge ${f.tipo==="emitida"?"b-income":"b-expense"}">${f.tipo==="emitida"?"Expedida":"Recibida"}</span></td>
        <td style="font-size:11px;text-align:center;color:var(--t3)">${f.factura_rectif_de ? 'S&iacute;' : 'No'}</td>
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
  // Copiar TODOS los campos relevantes (Hallazgo del informe):
  // antes se perdían descuento_global, forma_pago, condiciones_pago, iban,
  // titular_cuenta y fecha_vencimiento al duplicar, lo que rompía el total.
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
    forma_pago:        f.forma_pago,
    condiciones_pago:  f.condiciones_pago,
    iban:              f.iban,
    titular_cuenta:    f.titular_cuenta,
    descuento_global:  f.descuento_global,
    // NO se copia numero_factura (serie/correlativo se asigna al emitir)
    // NO se copia factura_rectif_de ni es_rectificativa
    // NO se copia fecha_cobro ni cobrada (la duplicada nace como pendiente)
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

  const _totFmt = fmt(totalFactura(f).total);
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🔄 Nota de crédito — ${f.numero_factura}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px">
          ⚠️ La nota de crédito anulará total o parcialmente la factura <strong>${f.numero_factura}</strong> (${_totFmt}).
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
      user_id:           SESSION.user.id,
      concepto:          `Nota de crédito — ${f.numero_factura}`,
      base:              baseRect,
      iva:               f.iva,
      tipo:              "emitida",
      tipo_operacion:    f.tipo_operacion,
      fecha,
      estado:            "borrador",
      cliente_id:        f.cliente_id,
      cliente_nombre:    f.cliente_nombre,
      cliente_nif:       f.cliente_nif,
      cliente_direccion: f.cliente_direccion,
      factura_rectif_de: f.id,
      cobrada:           false,
      es_rectificativa:  true,
      // Guardamos número de la original y motivo en notas para el PDF
      notas: `RECTIF_NUMERO:${f.numero_factura}|RECTIF_MOTIVO:${causa}`,
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

window._pdfFact = (id, plantillaId = null) => {
  // Cascada resuelta en pdf-plantilla.js: plantilla_id del doc → es_default → sin plantilla
  // NO leer el selector activo del formulario: cada factura usa su propia plantilla guardada.
  import("./exports.js").then(m => m.exportFacturaPDF(id, plantillaId || null));
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
   NUMERACIÓN TIQ — TIQ-(año)-0001
   Busca el último número del año en curso
   y devuelve el siguiente.
══════════════════════════════════════════ */
export async function _nextTiqueNum(fecha) {
  const year = (fecha || new Date().toISOString().slice(0,10)).slice(0, 4);
  const prefix = `TIQ-${year}-`;

  // Buscar todos los tiques del año con ese prefijo
  const { data } = await supabase
    .from("facturas")
    .select("numero_factura")
    .eq("user_id", SESSION.user.id)
    .like("numero_factura", `${prefix}%`)
    .order("numero_factura", { ascending: false })
    .limit(1);

  let next = 1;
  if (data && data.length > 0) {
    const last = data[0].numero_factura; // e.g. "TIQ-2025-0042"
    const num  = parseInt(last.replace(prefix, ""), 10);
    if (!isNaN(num)) next = num + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}

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
        ${renderSedeSelector({ inputId: "gr_sede", wrapperClass: "modal-field" })}
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
      sede_id:        readSedeIdFromForm("gr_sede"),
      concepto:       `[${cat}] ${concepto}`,
      base,
      iva:            ivaPct,
      irpf_retencion: 0,
      tipo:           "recibida",
      tipo_operacion: "nacional",
      estado:         "emitida",
      fecha,
      cliente_nombre: proveedor || "Tique / Sin proveedor",
      numero_factura: await _nextTiqueNum(fecha),
      fecha_emision:  fecha,
      notas:          "Gasto rápido · Ticket simplificado. IVA incluido en el importe. El IVA de tickets sin NIF no es deducible en el Modelo 303 (art. 97 LIVA), pero el importe total computa como gasto en IRPF."
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
   CONFIGURACIÓN DE NUMERACIÓN — Unificada
   Cubre facturas, presupuestos, albaranes y proformas.
   Delega la persistencia a numeracion-docs.js.
══════════════════════════════════════════ */
export async function showSerieConfigModal() {
  const { getAllSerieConfigs, updateCounter, previewNumero, TIPO_CONFIG } = await import('./numeracion-docs.js');

  // Cargar configs actuales de los 4 tipos
  let configs = {};
  try { configs = await getAllSerieConfigs(); } catch (e) { console.warn('showSerieConfigModal:', e.message); }

  const year = new Date().getFullYear();

  // Render de un bloque por tipo
  const renderTipo = (tipo, cfg) => {
    const def   = TIPO_CONFIG[tipo] || {};
    const fmt   = cfg?.formato        || def.formato || 'F-{YEAR}-{NUM4}';
    const ini   = cfg?.numero_inicial || 1;
    const ult   = cfg?.ultimo_numero  || 0;
    const prv   = previewNumero(fmt, ini);
    const emoji = { factura:'🧾', presupuesto:'📋', albaran:'📦', proforma:'📄' }[tipo] || '📄';
    return `
    <div class="sn-tipo-block" id="sntb_${tipo}" style="border:1.5px solid var(--brd);border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <span style="font-size:16px">${emoji}</span>
        <span style="font-size:14px;font-weight:700;color:var(--t1)">${def.label || tipo}</span>
        ${cfg?._sinGuardar ? '<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:var(--amber-lt);color:var(--amber);font-weight:700">Sin configurar</span>' : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="ff-field">
          <label style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Formato</label>
          <input id="snf_${tipo}" class="ff-input" value="${fmt}" placeholder="${def.formato}" style="font-family:monospace;font-size:13px"/>
        </div>
        <div class="ff-field">
          <label style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Número inicial</label>
          <input id="sni_${tipo}" type="number" min="1" class="ff-input" value="${ini}" style="font-size:13px"/>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--t3)">Vista previa:</span>
          <code id="snp_${tipo}" style="font-size:14px;font-weight:800;color:var(--accent)">${prv}</code>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t4)">
          Último emitido: <strong style="font-family:monospace">${ult}</strong>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        ${(['F-{YEAR}-{NUM4}','P-{YEAR}-{NUM4}','A-{YEAR}-{NUM4}','PRF-{YEAR}-{NUM3}','{YEAR}/{NUM3}'].filter(Boolean)).map(f =>
          `<button type="button" onclick="
            document.getElementById('snf_${tipo}').value='${f}';
            document.getElementById('snp_${tipo}').textContent=window.__snPrev('${f}',parseInt(document.getElementById('sni_${tipo}').value)||1);
          " style="font-size:11px;font-family:monospace;padding:3px 8px;border-radius:6px;border:1.5px solid var(--brd);background:var(--bg2);color:var(--t2);cursor:pointer">${previewNumero(f)}</button>`
        ).join('')}
      </div>
      <div style="margin-top:10px;text-align:right">
        <button id="snbtn_${tipo}" class="btn-modal-save" style="padding:6px 18px;font-size:12px" onclick="window.__snSave('${tipo}')">
          Guardar ${def.label || tipo}
        </button>
      </div>
    </div>`;
  };

  openModal(`
    <div class="modal" style="max-width:640px">
      <div class="modal-hd">
        <span class="modal-title">🔢 Numeración de documentos</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd" style="max-height:70vh;overflow-y:auto">
        <p style="font-size:12px;color:var(--t3);margin-bottom:16px;padding:8px 12px;background:var(--bg2);border-radius:8px;line-height:1.6">
          Variables disponibles:
          <code style="background:var(--srf);padding:1px 5px;border-radius:4px">{YEAR}</code> año &nbsp;
          <code style="background:var(--srf);padding:1px 5px;border-radius:4px">{MONTH}</code> mes &nbsp;
          <code style="background:var(--srf);padding:1px 5px;border-radius:4px">{NUM4}</code> 4 dígitos &nbsp;
          <code style="background:var(--srf);padding:1px 5px;border-radius:4px">{NUM3}</code> 3 dígitos &nbsp;
          <code style="background:var(--srf);padding:1px 5px;border-radius:4px">{NUM2}</code> 2 dígitos &nbsp;
          <code style="background:var(--srf);padding:1px 5px;border-radius:4px">{NUM}</code> sin relleno
        </p>
        ${Object.entries(configs).map(([tipo, cfg]) => renderTipo(tipo, cfg)).join('')}
        <p style="font-size:11px;color:var(--t4);margin-top:4px;line-height:1.5">
          ⚠️ El número inicial no puede ser inferior al último ya emitido. Los cambios aplican al siguiente documento creado.
        </p>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
      </div>
    </div>
  `);

  // Helper de preview accesible desde el HTML inline
  window.__snPrev = (fmt, num) => {
    const d = new Date();
    return fmt
      .replace('{YEAR}',  d.getFullYear())
      .replace('{MONTH}', String(d.getMonth()+1).padStart(2,'0'))
      .replace('{NUM4}',  String(num).padStart(4,'0'))
      .replace('{NUM3}',  String(num).padStart(3,'0'))
      .replace('{NUM2}',  String(num).padStart(2,'0'))
      .replace('{NUM}',   String(num));
  };

  // Preview en tiempo real al escribir
  Object.keys(TIPO_CONFIG).forEach(tipo => {
    document.getElementById(`snf_${tipo}`)?.addEventListener('input', e => {
      const num = parseInt(document.getElementById(`sni_${tipo}`)?.value) || 1;
      const el  = document.getElementById(`snp_${tipo}`);
      if (el) el.textContent = window.__snPrev(e.target.value || TIPO_CONFIG[tipo].formato, num);
    });
    document.getElementById(`sni_${tipo}`)?.addEventListener('input', e => {
      const fmt = document.getElementById(`snf_${tipo}`)?.value || TIPO_CONFIG[tipo].formato;
      const el  = document.getElementById(`snp_${tipo}`);
      if (el) el.textContent = window.__snPrev(fmt, parseInt(e.target.value) || 1);
    });
  });

  // Guardar por tipo
  window.__snSave = async (tipo) => {
    const formato       = document.getElementById(`snf_${tipo}`)?.value.trim() || TIPO_CONFIG[tipo]?.formato;
    const numero_inicial = parseInt(document.getElementById(`sni_${tipo}`)?.value) || 1;
    const btn           = document.getElementById(`snbtn_${tipo}`);

    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      await updateCounter(tipo, { numero_inicial, formato });
      toast(`${TIPO_CONFIG[tipo]?.label || tipo}: numeración guardada ✅`, 'success');
      if (btn) { btn.disabled = false; btn.textContent = `Guardado ✅`; btn.style.background = 'var(--green)'; }
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = `Guardar ${TIPO_CONFIG[tipo]?.label || tipo}`; }
    }
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
