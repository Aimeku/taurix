/* ═══════════════════════════════════════════════════════
   TUGESTOR · fiscal.js
   Módulo IVA (Modelo 303) + IRPF (Modelo 130)
   ═══════════════════════════════════════════════════════ */

import {
  fmt, getYear, getTrim, getFacturasTrim, getFacturasYear,
  calcIVA, calcIRPF, TRIM_LABELS, TRIM_PLAZOS
} from "./utils.js";

export async function refreshIVA() {
  const year = getYear(), trim = getTrim();
  const facturas = await getFacturasTrim(year, trim);
  const { rep, sop, resultado, byOp } = calcIVA(facturas);

  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v); };
  s("iva21Rep",rep[21]); s("iva10Rep",rep[10]); s("iva4Rep",rep[4]); s("ivaTotalRep",rep.total);
  s("ivaSoportadoInt",sop.int); s("ivaSoportadoImp",sop.imp); s("ivaTotalSop",sop.total);
  s("ivaRepSumary",rep.total); s("ivaSopSumary",sop.total);
  s("ivaOpNac",byOp.nacional||0); s("ivaOpIC",byOp.intracomunitaria||0);
  s("ivaOpExp",byOp.exportacion||0); s("ivaOpISP",byOp.inversion_sujeto_pasivo||0);

  const resEl  = document.getElementById("ivaResultado303");
  const stEl   = document.getElementById("ivaEstado303");
  const deadEl = document.getElementById("ivaDeadline");
  const lblEl  = document.getElementById("ivaPeriodoLabel");
  if (resEl) resEl.textContent = fmt(resultado);
  if (stEl)  stEl.innerHTML   = resultado>0
    ? `<span class="badge b-pagar">A pagar · Modelo 303</span>`
    : `<span class="badge b-compen">A compensar</span>`;
  if (deadEl) deadEl.textContent = `Plazo presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;
}

export async function refreshIRPF() {
  const year = getYear(), trim = getTrim();
  const facturasTrim = await getFacturasTrim(year, trim);
  const { ingresos, gastos, rendimiento, retenciones, pagoFrac, resultado } = calcIRPF(facturasTrim);

  // Acumulados trimestres anteriores
  let ingAcum=0, gstAcum=0, retAcum=0;
  for (const t of ["T1","T2","T3","T4"]) {
    if (t >= trim) break;
    const ff = await getFacturasTrim(year, t);
    const r  = calcIRPF(ff);
    ingAcum += r.ingresos; gstAcum += r.gastos; retAcum += r.retenciones;
  }

  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v); };
  s("irpfIngBrutos",ingresos); s("irpfIngAcum",ingAcum); s("irpfIngTotal",ingresos+ingAcum);
  s("irpfGstPeriodo",gastos);  s("irpfGstAcum",gstAcum); s("irpfGstTotal",gastos+gstAcum);
  s("irpfRetPeriodo",retenciones); s("irpfRetAcum",retAcum);
  s("irpfRendNeto",rendimiento); s("irpfPagoFrac",pagoFrac); s("irpfMenosRet",retenciones);

  const resEl  = document.getElementById("irpfResultado130");
  const stEl   = document.getElementById("irpfEstado130");
  const deadEl = document.getElementById("irpfDeadline");
  const lblEl  = document.getElementById("irpfPeriodoLabel");
  if (resEl) resEl.textContent = fmt(resultado);
  if (stEl)  stEl.innerHTML   = resultado>0
    ? `<span class="badge b-pagar">A ingresar · Modelo 130</span>`
    : `<span class="badge b-compen">Sin pago</span>`;
  if (deadEl) deadEl.textContent = `Plazo presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;

  // Proyección anual
  const totalFacturas = await getFacturasYear(year);
  const annual = calcIRPF(totalFacturas);
  s("irpfProyAnual", annual.pagoFrac);
  const tipoEf = annual.ingresos>0 ? ((annual.pagoFrac/annual.ingresos)*100).toFixed(1)+"%" : "—";
  const tEl = document.getElementById("irpfTipoEf"); if(tEl) tEl.textContent = tipoEf;
}
