/* ═══════════════════════════════════════════════════════
   TAURIX · dashboard.js  — v3 MÁXIMO
   Dashboard avanzado: KPIs, gráfico, cashflow 30d,
   widgets de tesorería, alertas fiscales automáticas
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtShort, fmtDate,
  getYear, getTrim, getFacturasTrim, getFacturasYear,
  calcIVA, calcIRPF, TRIM_LABELS
} from "./utils.js";

export async function refreshDashboard() {
  const year = getYear(), trim = getTrim();
  const facturas = await getFacturasTrim(year, trim);
  const { ingresos, gastos, rendimiento, pagoFrac } = calcIRPF(facturas);
  const { resultado: ivaRes } = calcIVA(facturas);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("kpiIngresos", ingresos);
  s("kpiGastos", gastos);
  s("kpiBeneficio", rendimiento);
  s("kpiIVA", ivaRes);
  s("kpiIRPF", pagoFrac);

  const lbl = document.getElementById("dashPeriodoLabel");
  if (lbl) lbl.textContent = `${TRIM_LABELS[trim]} · ${year}`;

  // KPI cobro pendiente
  const emitidas = facturas.filter(f => f.tipo === "emitida" && f.estado === "emitida");
  const pendienteCobro = emitidas.filter(f => !f.cobrada).reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);
  const kpiCobro = document.getElementById("kpiCobroPendiente");
  if (kpiCobro) kpiCobro.textContent = fmt(pendienteCobro);

  // Trim summary
  const tce = document.getElementById("tCountEmit");
  const tcr = document.getElementById("tCountRecib");
  const tcc = document.getElementById("tCountClientes");
  if (tce) tce.textContent = facturas.filter(f => f.tipo === "emitida").length;
  if (tcr) tcr.textContent = facturas.filter(f => f.tipo === "recibida").length;
  if (tcc) tcc.textContent = CLIENTES.length;

  // Nóminas pendientes
  const { data: nominasPend } = await supabase.from("nominas")
    .select("id", { count: "exact" })
    .eq("user_id", SESSION.user.id)
    .eq("estado", "pendiente")
    .limit(1);
  const tcn = document.getElementById("tCountNominas");
  if (tcn) tcn.textContent = nominasPend?.length || "—";

  // Gauge margen
  const margen = ingresos > 0 ? Math.min(100, Math.round((rendimiento / ingresos) * 100)) : 0;
  const gpath = document.getElementById("gaugePath");
  const glbl = document.getElementById("gaugeLabel");
  if (gpath) {
    const offset = 157 - (157 * margen / 100);
    gpath.style.strokeDashoffset = offset;
    gpath.style.stroke = margen > 50 ? "#059669" : margen > 20 ? "#d97706" : "#dc2626";
  }
  if (glbl) glbl.textContent = margen + "%";

  // Cashflow previsión 30 días
  await refreshCashflowPreview();

  // Alertas dashboard
  await refreshAlertasDashboard(ivaRes, pagoFrac);

  await drawChart(year, trim);

  // Últimas facturas
  const recent = [...facturas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
  const tbody = document.getElementById("recentFacturasBody");
  if (tbody) {
    if (!recent.length) {
      tbody.innerHTML = `<tr class="dt-empty"><td colspan="7">Sin facturas en este periodo</td></tr>`;
    } else {
      tbody.innerHTML = recent.map(f => `
        <tr>
          <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
          <td>${f.estado === "emitida" ? `<span class="badge b-income mono" style="font-size:11px">${f.numero_factura}</span>` : `<span class="badge b-draft">Borrador</span>`}</td>
          <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.concepto || "—"}</td>
          <td style="font-size:12px;color:var(--t3)">${f.cliente_nombre || "—"}</td>
          <td class="mono fw7">${fmt(f.base + f.base * f.iva / 100)}</td>
          <td><span class="badge ${f.tipo === "emitida" ? "b-income" : "b-expense"}">${f.tipo === "emitida" ? "📤" : "📥"}</span></td>
          <td>${f.tipo === "emitida" && f.estado === "emitida"
            ? `<span class="badge ${f.cobrada ? "b-cobrada" : "b-pendiente"}">${f.cobrada ? "✅ Cobrada" : "⏳ Pendiente"}</span>`
            : "<span style='color:var(--t4);font-size:11px'>—</span>"}</td>
        </tr>`).join("");
    }
  }
}

/* ══════════════════════════════
   CASHFLOW PREVIEW 30 DÍAS
══════════════════════════════ */
async function refreshCashflowPreview() {
  try {
    const hoy = new Date();
    const en30 = new Date(hoy.getTime() + 30 * 86400000);
    const hoyStr = hoy.toISOString().slice(0, 10);
    const en30Str = en30.toISOString().slice(0, 10);

    // Cobros previstos: facturas emitidas sin cobrar
    const { data: porCobrar } = await supabase.from("facturas")
      .select("base, iva, fecha_vencimiento")
      .eq("user_id", SESSION.user.id)
      .eq("tipo", "emitida")
      .eq("estado", "emitida")
      .eq("cobrada", false)
      .gte("fecha_vencimiento", hoyStr)
      .lte("fecha_vencimiento", en30Str);

    const cobrosPrevistos = (porCobrar || []).reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);

    // Pagos previstos: gastos recurrentes + facturas recibidas pendientes
    const { data: recurrentes } = await supabase.from("gastos_recurrentes")
      .select("importe, proxima_fecha")
      .eq("user_id", SESSION.user.id)
      .eq("activo", true)
      .gte("proxima_fecha", hoyStr)
      .lte("proxima_fecha", en30Str);

    const pagosPrevistos = (recurrentes || []).reduce((a, g) => a + g.importe, 0);
    const saldoNeto = cobrosPrevistos - pagosPrevistos;

    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s("cashCobros", fmt(cobrosPrevistos));
    s("cashPagos", fmt(pagosPrevistos));
    s("cashSaldo", fmt(saldoNeto));

    // Color saldo
    const wrap = document.getElementById("cashSaldoWrap");
    if (wrap) {
      wrap.className = `cash-indicator ${saldoNeto >= 1000 ? "cash-indicator--pos" : saldoNeto >= 0 ? "cash-indicator--warn" : "cash-indicator--neg"}`;
    }
  } catch (e) {
    console.warn("cashflow preview:", e.message);
  }
}

/* ══════════════════════════════
   ALERTAS AUTOMÁTICAS
══════════════════════════════ */
async function refreshAlertasDashboard(ivaRes, irpfRes) {
  // Actualiza los valores en la vista de alertas si está cargada
  const alertaIVA = document.getElementById("alertaIVAVal");
  const alertaIRPF = document.getElementById("alertaIRPFVal");
  if (alertaIVA) alertaIVA.textContent = fmt(ivaRes);
  if (alertaIRPF) alertaIRPF.textContent = fmt(irpfRes);

  // Dot de notificaciones en topbar
  const hoy = new Date();
  const mes = hoy.getMonth() + 1;
  const hasUrgentDeadline = (mes === 4 || mes === 7 || mes === 10 || mes === 1);
  const dot = document.getElementById("notifDot");
  if (dot) dot.style.display = hasUrgentDeadline ? "" : "none";
  const badge = document.getElementById("snBadgeAlertas");
  if (badge) {
    const count = hasUrgentDeadline ? "!" : "";
    badge.textContent = count;
    badge.style.display = count ? "" : "none";
  }
}

/* ══════════════════════════════
   GRÁFICO EVOLUCIÓN MENSUAL
══════════════════════════════ */
let _chartInstance = null;

async function drawChart(year, trim) {
  const canvas = document.getElementById("chartEvolucion");
  if (!canvas) return;

  const meses = { T1: [0, 1, 2], T2: [3, 4, 5], T3: [6, 7, 8], T4: [9, 10, 11] };
  const mNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const ms = meses[trim];

  const datos = await Promise.all(ms.map(async m => {
    const d1 = `${year}-${String(m + 1).padStart(2, "0")}-01`;
    const d2 = `${year}-${String(m + 1).padStart(2, "0")}-31`;
    const { data, error } = await supabase.from("facturas").select("tipo,base,cobrada,iva")
      .eq("user_id", SESSION.user.id).gte("fecha", d1).lte("fecha", d2);
    if (error) console.warn("chart query:", error.message);
    let ing = 0, gst = 0, cobrado = 0;
    (data || []).forEach(f => {
      if (f.tipo === "emitida") { ing += f.base; if (f.cobrada) cobrado += f.base + f.base * f.iva / 100; }
      else gst += f.base;
    });
    return { label: mNames[m], ing, gst, cobrado };
  }));

  if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }

  if (!window.Chart) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const isDark = document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
  const labelColor = isDark ? "#9ca3af" : "#6b7280";

  _chartInstance = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: datos.map(d => d.label),
      datasets: [
        {
          label: "Ingresos",
          data: datos.map(d => d.ing),
          backgroundColor: "rgba(26,86,219,0.82)",
          borderRadius: 5,
          borderSkipped: false,
          barPercentage: 0.45,
          categoryPercentage: 0.65,
        },
        {
          label: "Gastos",
          data: datos.map(d => d.gst),
          backgroundColor: "rgba(220,38,38,0.72)",
          borderRadius: 5,
          borderSkipped: false,
          barPercentage: 0.45,
          categoryPercentage: 0.65,
        },
        {
          label: "Cobrado",
          type: "line",
          data: datos.map(d => d.cobrado),
          borderColor: "#059669",
          backgroundColor: "rgba(5,150,105,0.1)",
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: "#059669",
          fill: false,
          tension: 0.3,
          yAxisID: "y",
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { color: labelColor, font: { size: 11, family: "'Plus Jakarta Sans', sans-serif" }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: labelColor, font: { size: 12, family: "'Plus Jakarta Sans', sans-serif" } },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          border: { display: false },
          ticks: {
            color: labelColor,
            font: { size: 11, family: "'Plus Jakarta Sans', sans-serif" },
            callback: v => fmtShort(v)
          }
        }
      }
    }
  });
}

/* ══════════════════════════════
   HISTÓRICO ANUAL
══════════════════════════════ */
export async function refreshHistorico() {
  const year = getYear();
  const lbl = document.getElementById("histYearLabel");
  if (lbl) lbl.textContent = `Año ${year}`;

  let ingTotal = 0, gstTotal = 0, ivaTotal = 0, irpfTotal = 0;
  const ivaRows = [], irpfRows = [];

  for (const trim of ["T1", "T2", "T3", "T4"]) {
    const facturas = await getFacturasTrim(year, trim);
    const iva = calcIVA(facturas);
    const irpf = calcIRPF(facturas);
    ingTotal += irpf.ingresos; gstTotal += irpf.gastos;
    ivaTotal += iva.resultado; irpfTotal += irpf.resultado;
    ivaRows.push({ trim, ...iva }); irpfRows.push({ trim, ...irpf });
  }

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("histIngAnual", ingTotal); s("histGstAnual", gstTotal); s("histBenAnual", ingTotal - gstTotal);
  s("histIvaAnual", ivaTotal); s("histIrpfAnual", irpfTotal);

  const ib = document.getElementById("histIvaBody");
  if (ib) ib.innerHTML = ivaRows.map(r => `
    <tr>
      <td><span class="badge b-income">${r.trim}</span></td>
      <td class="mono">${fmt(r.rep.total)}</td>
      <td class="mono">${fmt(r.sop.total)}</td>
      <td class="mono fw7 ${r.resultado > 0 ? "c-red" : "c-green"}">${fmt(r.resultado)}</td>
      <td>${r.resultado > 0 ? `<span class="badge b-pagar">A pagar</span>` : `<span class="badge b-compen">A compensar</span>`}</td>
    </tr>`).join("");

  const irb = document.getElementById("histIrpfBody");
  if (irb) irb.innerHTML = irpfRows.map(r => `
    <tr>
      <td><span class="badge b-income">${r.trim}</span></td>
      <td class="mono">${fmt(r.ingresos)}</td>
      <td class="mono">${fmt(r.gastos)}</td>
      <td class="mono fw7">${fmt(r.rendimiento)}</td>
      <td class="mono">${fmt(r.retenciones)}</td>
      <td class="mono fw7 ${r.resultado > 0 ? "c-red" : "c-green"}">${fmt(r.resultado)}</td>
    </tr>`).join("");
}

/* ══════════════════════════════
   IMPUESTO DE SOCIEDADES
══════════════════════════════ */
export async function refreshIS() {
  const year = getYear();
  const ejEl = document.getElementById("isEjercicio");
  if (ejEl) ejEl.textContent = year;

  // Obtener facturas del año completo
  const { data: facturas, error } = await supabase.from("facturas")
    .select("tipo, base, iva, estado")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);

  if (error) { console.error("refreshIS:", error.message); return; }

  const ingresos = (facturas || []).filter(f => f.tipo === "emitida" && f.estado === "emitida").reduce((a, f) => a + f.base, 0);
  const gastos = (facturas || []).filter(f => f.tipo === "recibida").reduce((a, f) => a + f.base, 0);

  // Obtener nóminas
  const { data: nominas } = await supabase.from("nominas")
    .select("total_bruto")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);
  const gstPersonal = (nominas || []).reduce((a, n) => a + (n.total_bruto || 0), 0);

  const baii = ingresos - gastos - gstPersonal;
  const bai = baii; // simplificado (sin financiero)
  const baseImp = Math.max(0, bai);
  const cuotaIntegra = baseImp * 0.25;

  // Retenciones (simplificado)
  const { data: retenciones } = await supabase.from("facturas")
    .select("base, irpf")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`)
    .eq("tipo", "emitida")
    .not("irpf", "is", null);
  const totalRet = (retenciones || []).reduce((a, f) => a + f.base * (f.irpf || 0) / 100, 0);

  const cuotaDif = Math.max(0, cuotaIntegra - totalRet);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("isResultContable", bai);
  s("isBaseImp", baseImp);
  s("isCuotaIntegra", cuotaIntegra);
  s("isCuotaDif", cuotaDif);
  s("isIngExplot", ingresos);
  s("isGstExplot", gastos + gstPersonal);
  s("isBAII", baii);
  s("isBAI", bai);
  s("isBaseAjust", baseImp);
  s("isCuotaIntBruta", cuotaIntegra);
  s("isCuotaIntAjust", cuotaIntegra);
  s("isRetenciones", totalRet);
  s("isPagosFrac", 0);
  s("isCuotaDif2", cuotaDif);
  s("isResultFinal", cuotaDif);
  s("isGstPersonal", gstPersonal);

  const tipoEf = ingresos > 0 ? ((cuotaIntegra / ingresos) * 100).toFixed(1) + "%" : "—";
  const teEl = document.getElementById("isTipoEf"); if (teEl) teEl.textContent = tipoEf;

  const stEl = document.getElementById("isEstado");
  if (stEl) stEl.innerHTML = cuotaDif > 0
    ? `<span class="badge b-pagar">A ingresar · Modelo 200</span>`
    : `<span class="badge b-compen">Sin pago</span>`;
}
