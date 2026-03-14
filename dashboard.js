/* ═══════════════════════════════════════════════════════
   TUGESTOR · dashboard.js
   Dashboard, gráfico de evolución mensual, histórico
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

  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v); };
  s("kpiIngresos",ingresos); s("kpiGastos",gastos); s("kpiBeneficio",rendimiento);
  s("kpiIVA",ivaRes); s("kpiIRPF",pagoFrac);

  const lbl = document.getElementById("dashPeriodoLabel");
  if (lbl) lbl.textContent = `${TRIM_LABELS[trim]} · ${year}`;

  // KPI cobro pendiente
  const emitidas       = facturas.filter(f=>f.tipo==="emitida"&&f.estado==="emitida");
  const pendienteCobro = emitidas.filter(f=>!f.cobrada).reduce((a,f)=>a+f.base+(f.base*f.iva/100),0);
  const kpiCobro = document.getElementById("kpiCobroPendiente");
  if (kpiCobro) kpiCobro.textContent = fmt(pendienteCobro);

  // Trim summary
  const tce=document.getElementById("tCountEmit"), tcr=document.getElementById("tCountRecib"), tcc=document.getElementById("tCountClientes");
  if(tce) tce.textContent=facturas.filter(f=>f.tipo==="emitida").length;
  if(tcr) tcr.textContent=facturas.filter(f=>f.tipo==="recibida").length;
  if(tcc) tcc.textContent=CLIENTES.length;

  // Gauge margen
  const margen = ingresos>0 ? Math.min(100,Math.round((rendimiento/ingresos)*100)) : 0;
  const gpath  = document.getElementById("gaugePath");
  const glbl   = document.getElementById("gaugeLabel");
  if (gpath) {
    const offset = 157 - (157*margen/100);
    gpath.style.strokeDashoffset = offset;
    gpath.style.stroke = margen>50?"#059669":margen>20?"#d97706":"#dc2626";
  }
  if (glbl) glbl.textContent = margen+"%";

  await drawChart(year, trim);

  // Últimas facturas
  const recent = [...facturas].sort((a,b)=>b.fecha.localeCompare(a.fecha)).slice(0,8);
  const tbody  = document.getElementById("recentFacturasBody");
  if (tbody) {
    if (!recent.length) {
      tbody.innerHTML=`<tr class="dt-empty"><td colspan="7">Sin facturas en este periodo</td></tr>`;
    } else {
      tbody.innerHTML = recent.map(f=>`
        <tr>
          <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
          <td>${f.estado==="emitida"?`<span class="badge b-income mono" style="font-size:11px">${f.numero_factura}</span>`:`<span class="badge b-draft">Borrador</span>`}</td>
          <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.concepto||"—"}</td>
          <td style="font-size:12px;color:var(--t3)">${f.cliente_nombre||"—"}</td>
          <td class="mono fw7">${fmt(f.base+(f.base*f.iva)/100)}</td>
          <td><span class="badge ${f.tipo==="emitida"?"b-income":"b-expense"}">${f.tipo==="emitida"?"📤":"📥"}</span></td>
          <td>${f.tipo==="emitida"&&f.estado==="emitida"?`<span class="badge ${f.cobrada?"b-cobrada":"b-pendiente"}">${f.cobrada?"✅ Cobrada":"⏳ Pendiente"}</span>`:"<span style='color:var(--t4);font-size:11px'>—</span>"}</td>
        </tr>`).join("");
    }
  }
}

let _chartInstance = null;

async function drawChart(year, trim) {
  const canvas = document.getElementById("chartEvolucion");
  if (!canvas) return;

  const meses  = {T1:[0,1,2],T2:[3,4,5],T3:[6,7,8],T4:[9,10,11]};
  const mNames = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const ms     = meses[trim];

  const datos = await Promise.all(ms.map(async m => {
    const d1 = `${year}-${String(m+1).padStart(2,"0")}-01`;
    const d2 = `${year}-${String(m+1).padStart(2,"0")}-31`;
    const { data, error } = await supabase.from("facturas").select("tipo,base")
      .eq("user_id", SESSION.user.id).gte("fecha", d1).lte("fecha", d2);
    if (error) console.warn("chart query:", error.message);
    let ing=0, gst=0;
    (data||[]).forEach(f => { if(f.tipo==="emitida") ing+=f.base; else gst+=f.base; });
    return { label: mNames[m], ing, gst };
  }));

  // Destruir instancia anterior si existe
  if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }

  // Cargar Chart.js si no está disponible
  if (!window.Chart) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const isDark = document.documentElement.classList.contains("dark");
  const gridColor  = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
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
          barPercentage: 0.5,
          categoryPercentage: 0.6,
        },
        {
          label: "Gastos",
          data: datos.map(d => d.gst),
          backgroundColor: "rgba(220,38,38,0.72)",
          borderRadius: 5,
          borderSkipped: false,
          barPercentage: 0.5,
          categoryPercentage: 0.6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
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

/* ══════════════════════════
   HISTÓRICO ANUAL
══════════════════════════ */
export async function refreshHistorico() {
  const year = getYear();
  const lbl  = document.getElementById("histYearLabel");
  if (lbl) lbl.textContent=`Año ${year}`;

  let ingTotal=0,gstTotal=0,ivaTotal=0,irpfTotal=0;
  const ivaRows=[], irpfRows=[];

  for (const trim of ["T1","T2","T3","T4"]) {
    const facturas = await getFacturasTrim(year, trim);
    const iva  = calcIVA(facturas);
    const irpf = calcIRPF(facturas);
    ingTotal+=irpf.ingresos; gstTotal+=irpf.gastos;
    ivaTotal+=iva.resultado; irpfTotal+=irpf.resultado;
    ivaRows.push({trim,...iva}); irpfRows.push({trim,...irpf});
  }

  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=fmt(v);};
  s("histIngAnual",ingTotal); s("histGstAnual",gstTotal); s("histBenAnual",ingTotal-gstTotal);
  s("histIvaAnual",ivaTotal); s("histIrpfAnual",irpfTotal);

  const ib = document.getElementById("histIvaBody");
  if (ib) ib.innerHTML = ivaRows.map(r=>`
    <tr>
      <td><span class="badge b-income">${r.trim}</span></td>
      <td class="mono">${fmt(r.rep.total)}</td>
      <td class="mono">${fmt(r.sop.total)}</td>
      <td class="mono fw7 ${r.resultado>0?"c-red":"c-green"}">${fmt(r.resultado)}</td>
      <td>${r.resultado>0?`<span class="badge b-pagar">A pagar</span>`:`<span class="badge b-compen">A compensar</span>`}</td>
    </tr>`).join("");

  const irb = document.getElementById("histIrpfBody");
  if (irb) irb.innerHTML = irpfRows.map(r=>`
    <tr>
      <td><span class="badge b-income">${r.trim}</span></td>
      <td class="mono">${fmt(r.ingresos)}</td>
      <td class="mono">${fmt(r.gastos)}</td>
      <td class="mono fw7">${fmt(r.rendimiento)}</td>
      <td class="mono">${fmt(r.retenciones)}</td>
      <td class="mono fw7 ${r.resultado>0?"c-red":"c-green"}">${fmt(r.resultado)}</td>
    </tr>`).join("");
}
