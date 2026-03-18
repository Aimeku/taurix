/* ═══════════════════════════════════════════════════════
   TAURIX · informes.js
   Informes avanzados: rentabilidad clientes, previsión
   fiscal, DSO, comparativa plurianual, gastos categoría
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal, calcIVA, calcIRPF } from "./utils.js";

/* ══════════════════════════
   ROUTER
══════════════════════════ */
export function initInformesView() {
  document.querySelectorAll(".informe-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.id;
      const handlers = {
        informe_rentabilidad_cliente: showInformeRentabilidadCliente,
        informe_evolucion_ingresos:   showInformeEvolucionIngresos,
        informe_gastos_categoria:     showInformeGastosCategoria,
        informe_prevision_fiscal:     showInformePrevisionFiscal,
        informe_margen_bruto:         showInformeMargenBruto,
        informe_dias_cobro:           showInformeDSO,
        informe_347_previo:           showInforme347,
        informe_coste_laboral:        showInformeCosteLab,
        informe_comparativa_anual:    showInformeComparativa,
      };
      if (handlers[id]) handlers[id]();
    });
  });
}

/* ══════════════════════════
   1. RENTABILIDAD POR CLIENTE
══════════════════════════ */
async function showInformeRentabilidadCliente() {
  toast("Generando informe…", "info", 1500);
  const year = new Date().getFullYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("cliente_nombre, cliente_id, base, iva, tipo, estado, cobrada, fecha_cobro")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);

  const clientes = {};
  (facturas || []).forEach(f => {
    if (f.tipo !== "emitida" || f.estado !== "emitida") return;
    const key = f.cliente_nombre || "Sin cliente";
    if (!clientes[key]) clientes[key] = { nombre: key, total: 0, cobrado: 0, facturas: 0 };
    const tot = f.base + f.base * f.iva / 100;
    clientes[key].total += tot;
    clientes[key].facturas++;
    if (f.cobrada) clientes[key].cobrado += tot;
  });

  const sorted = Object.values(clientes).sort((a, b) => b.total - a.total);
  const totalGeneral = sorted.reduce((a, c) => a + c.total, 0);

  openModal(`
    <div class="modal" style="max-width:720px">
      <div class="modal-hd">
        <span class="modal-title">👤 Rentabilidad por cliente — ${year}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        ${!sorted.length ? `<p style="text-align:center;color:var(--t3);padding:32px">Sin datos para este ejercicio</p>` : `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
          <div style="background:var(--bg2);padding:14px;border-radius:10px">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">Facturado total</div>
            <div style="font-size:22px;font-weight:800;font-family:monospace">${fmt(totalGeneral)}</div>
          </div>
          <div style="background:var(--bg2);padding:14px;border-radius:10px">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">Clientes activos</div>
            <div style="font-size:22px;font-weight:800">${sorted.length}</div>
          </div>
          <div style="background:var(--bg2);padding:14px;border-radius:10px">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">Ticket medio</div>
            <div style="font-size:22px;font-weight:800;font-family:monospace">${sorted.length ? fmt(totalGeneral / sorted.reduce((a, c) => a + c.facturas, 0)) : "—"}</div>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>#</th><th>Cliente</th><th>Facturas</th><th>Facturado</th><th>Cobrado</th><th>Pendiente</th><th>% sobre total</th><th>Barra</th></tr></thead>
          <tbody>
            ${sorted.map((c, i) => {
              const pct = totalGeneral > 0 ? (c.total / totalGeneral * 100).toFixed(1) : 0;
              const pendiente = c.total - c.cobrado;
              return `<tr>
                <td style="color:var(--t3);font-size:12px">${i + 1}</td>
                <td style="font-weight:600">${c.nombre}</td>
                <td style="text-align:center">${c.facturas}</td>
                <td class="mono fw7">${fmt(c.total)}</td>
                <td class="mono" style="color:#059669">${fmt(c.cobrado)}</td>
                <td class="mono" style="color:${pendiente > 0 ? "#dc2626" : "var(--t3)"}">${fmt(pendiente)}</td>
                <td style="font-size:12px;color:var(--t3)">${pct}%</td>
                <td style="min-width:80px">
                  <div style="background:var(--brd);border-radius:4px;height:6px">
                    <div style="background:var(--accent);width:${pct}%;height:100%;border-radius:4px;transition:width .5s"></div>
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`}
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        <button class="btn-modal-save" onclick="window._exportInforme347()">📊 Exportar Excel</button>
      </div>
    </div>`);
}

/* ══════════════════════════
   2. EVOLUCIÓN INGRESOS
══════════════════════════ */
async function showInformeEvolucionIngresos() {
  toast("Generando informe…", "info", 1500);
  const yearActual = new Date().getFullYear();
  const yearAnt = yearActual - 1;

  const fetchYear = async (y) => {
    const { data } = await supabase.from("facturas")
      .select("base, iva, tipo, estado, fecha")
      .eq("user_id", SESSION.user.id).eq("tipo", "emitida").eq("estado", "emitida")
      .gte("fecha", `${y}-01-01`).lte("fecha", `${y}-12-31`);
    const meses = Array(12).fill(0);
    (data || []).forEach(f => { meses[new Date(f.fecha).getMonth()] += f.base + f.base * f.iva / 100; });
    return meses;
  };

  const [actual, anterior] = await Promise.all([fetchYear(yearActual), fetchYear(yearAnt)]);
  const mNom = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const totalActual = actual.reduce((a, b) => a + b, 0);
  const totalAnt    = anterior.reduce((a, b) => a + b, 0);
  const variacion   = totalAnt > 0 ? (((totalActual - totalAnt) / totalAnt) * 100).toFixed(1) : "—";

  openModal(`
    <div class="modal" style="max-width:740px">
      <div class="modal-hd">
        <span class="modal-title">📈 Evolución de ingresos — ${yearActual} vs ${yearAnt}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
          <div style="background:var(--bg2);padding:14px;border-radius:10px">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">${yearActual}</div>
            <div style="font-size:22px;font-weight:800;font-family:monospace;color:var(--accent)">${fmt(totalActual)}</div>
          </div>
          <div style="background:var(--bg2);padding:14px;border-radius:10px">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">${yearAnt}</div>
            <div style="font-size:22px;font-weight:800;font-family:monospace">${fmt(totalAnt)}</div>
          </div>
          <div style="background:${parseFloat(variacion) >= 0 ? "#f0fdf4" : "#fef2f2"};padding:14px;border-radius:10px">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">Variación</div>
            <div style="font-size:22px;font-weight:800;color:${parseFloat(variacion) >= 0 ? "#059669" : "#dc2626"}">${variacion !== "—" ? (parseFloat(variacion) >= 0 ? "+" : "") + variacion + "%" : "—"}</div>
          </div>
        </div>
        <table class="data-table">
          <thead><tr><th>Mes</th><th>${yearActual}</th><th>${yearAnt}</th><th>Variación</th><th>Tendencia</th></tr></thead>
          <tbody>
            ${mNom.map((m, i) => {
              const var_pct = anterior[i] > 0 ? ((actual[i] - anterior[i]) / anterior[i] * 100).toFixed(0) : (actual[i] > 0 ? "+∞" : "—");
              return `<tr>
                <td style="font-weight:600">${m}</td>
                <td class="mono fw7">${fmt(actual[i])}</td>
                <td class="mono" style="color:var(--t3)">${fmt(anterior[i])}</td>
                <td style="color:${typeof var_pct === "string" && var_pct.startsWith("+") || parseFloat(var_pct) >= 0 ? "#059669" : "#dc2626"};font-weight:700">${var_pct !== "—" ? (parseFloat(var_pct) > 0 ? "▲ " : parseFloat(var_pct) < 0 ? "▼ " : "") + var_pct + (var_pct !== "+∞" ? "%" : "") : "—"}</td>
                <td style="min-width:120px">
                  <div style="display:flex;gap:2px;align-items:flex-end;height:20px">
                    <div style="background:var(--accent);width:8px;height:${actual[i] > 0 ? Math.max(2, actual[i] / (Math.max(...actual) || 1) * 20) : 2}px;border-radius:2px;opacity:.8"></div>
                    <div style="background:var(--brd);width:8px;height:${anterior[i] > 0 ? Math.max(2, anterior[i] / (Math.max(...anterior) || 1) * 20) : 2}px;border-radius:2px"></div>
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   3. GASTOS POR CATEGORÍA
══════════════════════════ */
async function showInformeGastosCategoria() {
  const year = new Date().getFullYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("base, iva, concepto, categoria_gasto")
    .eq("user_id", SESSION.user.id).eq("tipo", "recibida")
    .gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`);

  const cats = {};
  (facturas || []).forEach(f => {
    const cat = f.categoria_gasto || detectarCategoria(f.concepto || "");
    if (!cats[cat]) cats[cat] = { nombre: cat, total: 0, count: 0 };
    cats[cat].total += f.base + f.base * f.iva / 100;
    cats[cat].count++;
  });

  const sorted = Object.values(cats).sort((a, b) => b.total - a.total);
  const total = sorted.reduce((a, c) => a + c.total, 0);

  const iconos = { "Suministros":"💡","Software / Suscripciones":"💻","Transporte":"🚗","Alquiler":"🏠","Seguros":"🛡️","Publicidad":"📣","Material de oficina":"📦","Telecomunicaciones":"📱","Servicios profesionales":"👔","Dietas":"🍽️","Otros":"📝" };

  openModal(`
    <div class="modal" style="max-width:620px">
      <div class="modal-hd">
        <span class="modal-title">🏷️ Gastos por categoría — ${year}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="font-size:13px;font-weight:600;margin-bottom:16px">Total gastos: <span style="font-family:monospace;color:var(--accent)">${fmt(total)}</span></div>
        ${sorted.map(c => {
          const pct = total > 0 ? (c.total / total * 100).toFixed(1) : 0;
          return `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <div style="font-size:20px;width:28px;text-align:center">${iconos[c.nombre] || "📝"}</div>
              <div style="flex:1">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:13px;font-weight:600">${c.nombre}</span>
                  <span style="font-family:monospace;font-weight:700;font-size:13px">${fmt(c.total)} <span style="font-size:11px;color:var(--t3)">${pct}%</span></span>
                </div>
                <div style="background:var(--brd);border-radius:6px;height:8px">
                  <div style="background:linear-gradient(90deg,var(--accent),#60a5fa);width:${pct}%;height:100%;border-radius:6px;transition:width .6s"></div>
                </div>
              </div>
            </div>`;
        }).join("")}
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

function detectarCategoria(concepto) {
  const c = concepto.toLowerCase();
  if (c.includes("alquiler") || c.includes("arrendamiento")) return "Alquiler";
  if (c.includes("gas") || c.includes("luz") || c.includes("agua") || c.includes("electric")) return "Suministros";
  if (c.includes("seguro")) return "Seguros";
  if (c.includes("publicidad") || c.includes("marketing")) return "Publicidad";
  if (c.includes("dieta") || c.includes("restaurante") || c.includes("comida")) return "Dietas";
  if (c.includes("transporte") || c.includes("gasolina") || c.includes("taxi") || c.includes("tren") || c.includes("avión")) return "Transporte";
  if (c.includes("teléfono") || c.includes("móvil") || c.includes("internet")) return "Telecomunicaciones";
  if (c.includes("software") || c.includes("licencia") || c.includes("suscripción")) return "Software / Suscripciones";
  return "Otros";
}

/* ══════════════════════════
   4. PREVISIÓN FISCAL ANUAL
══════════════════════════ */
async function showInformePrevisionFiscal() {
  const year = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;

  const { data: facturas } = await supabase.from("facturas")
    .select("base, iva, tipo, estado, irpf_retencion, fecha")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);

  // Calcular YTD
  const emitidas  = (facturas || []).filter(f => f.tipo === "emitida" && f.estado === "emitida");
  const recibidas = (facturas || []).filter(f => f.tipo === "recibida");

  const ingYTD = emitidas.reduce((a, f) => a + f.base, 0);
  const gstYTD = recibidas.reduce((a, f) => a + f.base, 0);
  const retYTD = emitidas.reduce((a, f) => a + f.base * (f.irpf_retencion || 0) / 100, 0);
  const ivaRepYTD = emitidas.reduce((a, f) => a + f.base * f.iva / 100, 0);
  const ivaSopYTD = recibidas.reduce((a, f) => a + f.base * f.iva / 100, 0);

  // Proyectar al año completo si no ha terminado
  const factor = mesActual < 12 ? 12 / mesActual : 1;
  const ingProyectado = ingYTD * factor;
  const gstProyectado = gstYTD * factor;
  const retProyectado = retYTD * factor;

  // IRPF estimado año completo (Mod 130 acumulado)
  const rendimientoProyect = ingProyectado - gstProyectado;
  const irpfEstimado = Math.max(0, rendimientoProyect * 0.20 - retProyectado);

  // IVA proyectado
  const ivaEstimado = (ivaRepYTD - ivaSopYTD) * factor;

  const cargaTotal = irpfEstimado + ivaEstimado;
  const reservaMes = cargaTotal > 0 ? cargaTotal / (12 - mesActual + 1) : 0;

  openModal(`
    <div class="modal" style="max-width:660px">
      <div class="modal-hd">
        <span class="modal-title">🔮 Previsión fiscal — ${year}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="background:linear-gradient(135deg,#1a56db,#1e40af);border-radius:14px;padding:20px;color:#fff;margin-bottom:20px">
          <div style="font-size:12px;opacity:.7;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Carga fiscal estimada año completo</div>
          <div style="font-size:36px;font-weight:800;font-family:monospace">${fmt(cargaTotal)}</div>
          <div style="font-size:13px;opacity:.7;margin-top:4px">Reservar ${fmt(reservaMes)}/mes para los ${12 - mesActual + 1} meses restantes</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:var(--bg2);border-radius:10px;padding:14px">
            <div style="font-size:11px;color:var(--t3);margin-bottom:8px;font-weight:700;text-transform:uppercase">Ingresos</div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>YTD (hasta ${mesActual}/2025)</span><strong>${fmt(ingYTD)}</strong></div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--t3)"><span>Proyectado año</span><strong>${fmt(ingProyectado)}</strong></div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:14px">
            <div style="font-size:11px;color:var(--t3);margin-bottom:8px;font-weight:700;text-transform:uppercase">Gastos</div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>YTD</span><strong>${fmt(gstYTD)}</strong></div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--t3)"><span>Proyectado</span><strong>${fmt(gstProyectado)}</strong></div>
          </div>
        </div>

        <table class="data-table" style="margin-bottom:16px">
          <thead><tr><th>Concepto</th><th>YTD real</th><th>Estimado año</th></tr></thead>
          <tbody>
            <tr><td>IRPF (Modelo 130)</td><td class="mono">${fmt(irpfEstimado / factor)}</td><td class="mono fw7" style="color:#dc2626">${fmt(irpfEstimado)}</td></tr>
            <tr><td>IVA neto (Modelo 303)</td><td class="mono">${fmt(ivaRepYTD - ivaSopYTD)}</td><td class="mono fw7" style="color:#d97706">${fmt(ivaEstimado)}</td></tr>
            <tr><td>Retenciones soportadas</td><td class="mono" style="color:#059669">-${fmt(retYTD)}</td><td class="mono" style="color:#059669">-${fmt(retProyectado)}</td></tr>
          </tbody>
        </table>

        <div style="background:#fef9c3;border-radius:10px;padding:12px 16px;font-size:12px;color:#854d0e;line-height:1.6">
          💡 <strong>Consejo:</strong> Reserva al menos el <strong>30% de cada factura cobrada</strong> en una cuenta separada para cubrir IVA e IRPF. Con tus ingresos actuales, necesitas reservar <strong>${fmt(ingProyectado * 0.30 / 12)}/mes</strong>.
        </div>
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   5. DSO — Días medios de cobro
══════════════════════════ */
async function showInformeDSO() {
  const { data: cobradas } = await supabase.from("facturas")
    .select("fecha, fecha_cobro, base, iva, cliente_nombre")
    .eq("user_id", SESSION.user.id).eq("tipo", "emitida").eq("cobrada", true)
    .not("fecha_cobro", "is", null).order("fecha", { ascending: false }).limit(100);

  const byCliente = {};
  (cobradas || []).forEach(f => {
    const dias = Math.floor((new Date(f.fecha_cobro) - new Date(f.fecha + "T12:00:00")) / 86400000);
    const total = f.base + f.base * f.iva / 100;
    const key = f.cliente_nombre || "Sin cliente";
    if (!byCliente[key]) byCliente[key] = { nombre: key, diasTotal: 0, count: 0, volumen: 0 };
    byCliente[key].diasTotal += dias;
    byCliente[key].count++;
    byCliente[key].volumen += total;
  });

  const sorted = Object.values(byCliente).map(c => ({
    ...c, diasMedio: Math.round(c.diasTotal / c.count)
  })).sort((a, b) => b.diasMedio - a.diasMedio);

  const dsoGlobal = sorted.length ? Math.round(sorted.reduce((a, c) => a + c.diasTotal, 0) / sorted.reduce((a, c) => a + c.count, 0)) : 0;

  openModal(`
    <div class="modal" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">⏱️ Días de cobro (DSO)</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
          <div style="background:${dsoGlobal <= 30 ? "#f0fdf4" : dsoGlobal <= 60 ? "#fef9c3" : "#fef2f2"};border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:4px">DSO Global</div>
            <div style="font-size:36px;font-weight:800;color:${dsoGlobal <= 30 ? "#059669" : dsoGlobal <= 60 ? "#d97706" : "#dc2626"}">${dsoGlobal}d</div>
            <div style="font-size:11px;color:var(--t3);margin-top:4px">${dsoGlobal <= 30 ? "✅ Excelente" : dsoGlobal <= 60 ? "⚠️ Aceptable" : "🚨 A mejorar"}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:4px">Facturas analizadas</div>
            <div style="font-size:36px;font-weight:800">${cobradas?.length || 0}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:4px">Mejor pagador</div>
            <div style="font-size:14px;font-weight:700;margin-top:8px">${sorted.length ? sorted[sorted.length - 1].nombre.substring(0, 20) : "—"}</div>
            <div style="font-size:12px;color:#059669">${sorted.length ? sorted[sorted.length - 1].diasMedio + "d medio" : ""}</div>
          </div>
        </div>
        ${sorted.length ? `
        <table class="data-table">
          <thead><tr><th>Cliente</th><th>Facturas</th><th>Volumen</th><th>DSO medio</th><th>Valoración</th></tr></thead>
          <tbody>
            ${sorted.map(c => `<tr>
              <td style="font-weight:600">${c.nombre}</td>
              <td style="text-align:center">${c.count}</td>
              <td class="mono">${fmt(c.volumen)}</td>
              <td class="mono fw7">${c.diasMedio}d</td>
              <td>${c.diasMedio <= 15 ? "🟢 Muy bueno" : c.diasMedio <= 30 ? "🟡 Bueno" : c.diasMedio <= 60 ? "🟠 Regular" : "🔴 Lento"}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<p style="text-align:center;color:var(--t3);padding:24px">Sin datos suficientes de facturas cobradas</p>`}
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   6. MODELO 347 PREVIO
══════════════════════════ */
async function showInforme347() {
  const year = new Date().getFullYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("cliente_nombre, cliente_nif, tipo, base, iva, estado")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`);

  const UMBRAL = 3005.06;
  const acum = {};
  (facturas || []).forEach(f => {
    if (f.estado !== "emitida" && f.tipo === "emitida") return;
    const key = f.cliente_nif || f.cliente_nombre || "SIN_ID";
    if (!acum[key]) acum[key] = { nombre: f.cliente_nombre, nif: f.cliente_nif, total: 0, tipo: f.tipo };
    acum[key].total += f.base + f.base * f.iva / 100;
  });

  const declarables = Object.values(acum).filter(a => a.total >= UMBRAL).sort((a, b) => b.total - a.total);

  openModal(`
    <div class="modal" style="max-width:660px">
      <div class="modal-hd">
        <span class="modal-title">📋 Modelo 347 previo — ${year}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="background:#eff6ff;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1d4ed8;line-height:1.6">
          El Modelo 347 debe presentarse en <strong>febrero del año siguiente</strong> e incluye todas las personas o entidades con las que hayas operado por importe superior a <strong>3.005,06€</strong> anuales.
        </div>
        ${!declarables.length ? `<p style="text-align:center;color:var(--t3);padding:24px">Ninguna operación supera el umbral de 3.005,06€</p>` : `
        <div style="font-size:13px;margin-bottom:12px"><strong>${declarables.length}</strong> partes superan el umbral</div>
        <table class="data-table">
          <thead><tr><th>Nombre</th><th>NIF</th><th>Total operaciones</th><th>Tipo</th></tr></thead>
          <tbody>
            ${declarables.map(d => `<tr>
              <td style="font-weight:600">${d.nombre || "—"}</td>
              <td class="mono">${d.nif || "SIN NIF"}</td>
              <td class="mono fw7" style="color:var(--accent)">${fmt(d.total)}</td>
              <td><span class="badge ${d.tipo === "emitida" ? "b-income" : "b-expense"}">${d.tipo === "emitida" ? "Cliente" : "Proveedor"}</span></td>
            </tr>`).join("")}
          </tbody>
        </table>`}
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   7. MARGEN BRUTO
══════════════════════════ */
async function showInformeMargenBruto() {
  const year = new Date().getFullYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("base, iva, tipo, estado, fecha")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`);

  const ingresos = (facturas || []).filter(f => f.tipo === "emitida" && f.estado === "emitida").reduce((a, f) => a + f.base, 0);
  const gastos   = (facturas || []).filter(f => f.tipo === "recibida").reduce((a, f) => a + f.base, 0);
  const margen   = ingresos - gastos;
  const pctMargen = ingresos > 0 ? (margen / ingresos * 100).toFixed(1) : 0;

  openModal(`
    <div class="modal" style="max-width:560px">
      <div class="modal-hd">
        <span class="modal-title">💹 Análisis de margen — ${year}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--bg2);border-radius:10px">
            <span style="font-size:14px">Ingresos netos (base)</span>
            <strong style="font-family:monospace;font-size:18px;color:var(--accent)">${fmt(ingresos)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--bg2);border-radius:10px">
            <span style="font-size:14px">Gastos deducibles (base)</span>
            <strong style="font-family:monospace;font-size:18px;color:#dc2626">-${fmt(gastos)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:${parseFloat(pctMargen) >= 40 ? "#f0fdf4" : parseFloat(pctMargen) >= 20 ? "#fef9c3" : "#fef2f2"};border-radius:10px;border:2px solid ${parseFloat(pctMargen) >= 40 ? "#059669" : parseFloat(pctMargen) >= 20 ? "#d97706" : "#dc2626"}">
            <div>
              <div style="font-size:14px;font-weight:700">Margen bruto</div>
              <div style="font-size:12px;color:var(--t3)">${pctMargen}% sobre ingresos</div>
            </div>
            <strong style="font-family:monospace;font-size:24px;color:${parseFloat(pctMargen) >= 40 ? "#059669" : parseFloat(pctMargen) >= 20 ? "#d97706" : "#dc2626"}">${fmt(margen)}</strong>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:14px">
            <div style="font-size:12px;font-weight:700;color:var(--t3);margin-bottom:10px">Indicadores</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;font-size:13px"><span>Por cada 100€ ingresados</span><strong>${fmt(margen / (ingresos / 100))}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span>Gastos como % de ingresos</span><strong>${ingresos > 0 ? (gastos / ingresos * 100).toFixed(1) + "%" : "—"}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span>Valoración del margen</span><strong style="color:${parseFloat(pctMargen) >= 40 ? "#059669" : parseFloat(pctMargen) >= 20 ? "#d97706" : "#dc2626"}">${parseFloat(pctMargen) >= 60 ? "🟢 Excelente" : parseFloat(pctMargen) >= 40 ? "🟡 Bueno" : parseFloat(pctMargen) >= 20 ? "🟠 Aceptable" : "🔴 Bajo"}</strong></div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   8. COSTE LABORAL
══════════════════════════ */
async function showInformeCosteLab() {
  const { data: nominas } = await supabase.from("nominas")
    .select("*").eq("user_id", SESSION.user.id)
    .gte("fecha", `${new Date().getFullYear()}-01-01`);

  const total = (nominas || []).reduce((a, n) => ({
    bruto: a.bruto + (n.salario_bruto || 0),
    neto:  a.neto  + (n.salario_neto  || 0),
    ss:    a.ss    + (n.ss_empresa    || 0),
    irpf:  a.irpf  + (n.irpf         || 0),
  }), { bruto: 0, neto: 0, ss: 0, irpf: 0 });

  openModal(`
    <div class="modal" style="max-width:560px">
      <div class="modal-hd">
        <span class="modal-title">👥 Coste laboral — ${new Date().getFullYear()}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        ${!nominas?.length ? `<p style="text-align:center;color:var(--t3);padding:24px">Sin nóminas generadas en este ejercicio. Añade empleados y genera nóminas para ver este informe.</p>` : `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="background:var(--bg2);padding:14px;border-radius:10px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase">Coste empresa total</div><div style="font-size:24px;font-weight:800;font-family:monospace;color:#dc2626">${fmt(total.bruto + total.ss)}</div></div>
          <div style="background:var(--bg2);padding:14px;border-radius:10px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase">Neto pagado trabajadores</div><div style="font-size:24px;font-weight:800;font-family:monospace;color:#059669">${fmt(total.neto)}</div></div>
          <div style="background:var(--bg2);padding:14px;border-radius:10px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase">SS empresa (retener)</div><div style="font-size:20px;font-weight:800;font-family:monospace">${fmt(total.ss)}</div></div>
          <div style="background:var(--bg2);padding:14px;border-radius:10px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase">IRPF retenciones (Mod.111)</div><div style="font-size:20px;font-weight:800;font-family:monospace">${fmt(total.irpf)}</div></div>
        </div>`}
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   9. COMPARATIVA PLURIANUAL
══════════════════════════ */
async function showInformeComparativa() {
  const yearActual = new Date().getFullYear();
  const years = [yearActual - 2, yearActual - 1, yearActual];

  const fetchYear = async (y) => {
    const { data } = await supabase.from("facturas")
      .select("base, iva, tipo, estado")
      .eq("user_id", SESSION.user.id)
      .gte("fecha", `${y}-01-01`).lte("fecha", `${y}-12-31`);
    const ingresos = (data || []).filter(f => f.tipo === "emitida" && f.estado === "emitida").reduce((a, f) => a + f.base, 0);
    const gastos   = (data || []).filter(f => f.tipo === "recibida").reduce((a, f) => a + f.base, 0);
    return { year: y, ingresos, gastos, margen: ingresos - gastos };
  };

  const datos = await Promise.all(years.map(fetchYear));

  openModal(`
    <div class="modal" style="max-width:640px">
      <div class="modal-hd">
        <span class="modal-title">📊 Comparativa plurianual</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <table class="data-table">
          <thead><tr><th>Año</th><th>Ingresos</th><th>Gastos</th><th>Margen</th><th>% Margen</th><th>vs año ant.</th></tr></thead>
          <tbody>
            ${datos.map((d, i) => {
              const pct = d.ingresos > 0 ? (d.margen / d.ingresos * 100).toFixed(1) + "%" : "—";
              const ant = i > 0 ? datos[i - 1].ingresos : null;
              const vs = ant ? (((d.ingresos - ant) / ant) * 100).toFixed(1) : "—";
              return `<tr ${i === datos.length - 1 ? 'style="font-weight:700;background:var(--bg2)"' : ""}>
                <td><strong>${d.year}</strong></td>
                <td class="mono">${fmt(d.ingresos)}</td>
                <td class="mono">${fmt(d.gastos)}</td>
                <td class="mono fw7" style="color:${d.margen >= 0 ? "#059669" : "#dc2626"}">${fmt(d.margen)}</td>
                <td>${pct}</td>
                <td style="color:${vs !== "—" && parseFloat(vs) >= 0 ? "#059669" : "#dc2626"}">${vs !== "—" ? (parseFloat(vs) >= 0 ? "▲ +" : "▼ ") + vs + "%" : "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}
