/* ═══════════════════════════════════════════════════════
   TAURIX · fiscal.js  — REESCRITURA COMPLETA v4
   
   Módulo IVA/IRPF con máxima precisión legal:
   · Modelo 303 completo (casillas reales AEAT 2024)
   · Modelo 130 acumulado correcto (RD 439/2007)
   · Prorrata de IVA (art. 102-106 LIVA)
   · ISP, intracomunitarias, exportaciones
   · Compensaciones de periodos anteriores
   · Validación de umbrales y alertas fiscales
   · Simulador Renta Personal (tramos 2024)
   · Tablas de amortización oficiales AEAT
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, fmt, getYear, getTrim,
  getFacturasTrim, getFacturasYear,
  calcIVA, calcIRPF,
  TRIM_LABELS, TRIM_PLAZOS
} from "./utils.js";

/* ── CONSTANTES LEGALES 2024-2025 ── */
const REDUCCION_TRABAJO_2024 = {
  hasta_13115: 5565,
  tramo_medio: (base) => Math.max(1000, 5565 - 1.5 * (base - 13115)),
  desde_16825: 1000,
};
const MINIMO_PERSONAL = 5550;

/* ══════════════════════════════════════════
   MODELO 303 — IVA TRIMESTRAL COMPLETO
══════════════════════════════════════════ */
export async function refreshIVA() {
  const year = getYear(), trim = getTrim();
  const facturas = await getFacturasTrim(year, trim);
  // DEBUG TEMPORAL — eliminar tras confirmar funcionamiento
  console.log("[IVA] SESSION:", !!SESSION, "year:", year, "trim:", trim);
  console.log("[IVA] facturas recibidas:", facturas.length, facturas.slice(0,3).map(f=>({id:f.id,fecha:f.fecha,tipo:f.tipo,estado:f.estado,base:f.base,iva:f.iva})));
  const r303 = calcModelo303Completo(facturas);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("iva21Rep", r303.rep[21]);   s("iva10Rep", r303.rep[10]);
  s("iva4Rep",  r303.rep[4]);    s("ivaTotalRep", r303.rep.total);
  s("ivaSoportadoInt", r303.sop.int); s("ivaSoportadoImp", r303.sop.imp);
  s("ivaTotalSop", r303.sop.total);
  s("ivaRepSumary", r303.rep.total); s("ivaSopSumary", r303.sop.total);
  s("ivaOpNac",  r303.byOp.nacional || 0);
  s("ivaOpIC",   r303.byOp.intracomunitaria || 0);
  s("ivaOpExp",  r303.byOp.exportacion || 0);
  s("ivaOpISP",  r303.byOp.inversion_sujeto_pasivo || 0);

  const resEl = document.getElementById("ivaResultado303");
  const stEl  = document.getElementById("ivaEstado303");
  if (resEl) resEl.textContent = fmt(r303.resultado);
  if (stEl) {
    if (r303.resultado > 0) {
      stEl.innerHTML = `<span class="badge b-pagar">A ingresar · Modelo 303</span>`;
    } else if (r303.resultado < 0 && trim === "T4") {
      stEl.innerHTML = `<span class="badge b-compen">A devolver · Art. 115 LIVA</span>`;
    } else {
      const sig = { T1:"T2", T2:"T3", T3:"T4", T4:"próximo T1" }[trim];
      stEl.innerHTML = `<span class="badge b-compen">A compensar en ${sig}</span>`;
    }
  }
  const deadEl = document.getElementById("ivaDeadline");
  const lblEl  = document.getElementById("ivaPeriodoLabel");
  if (deadEl) deadEl.textContent = `Plazo de presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;

  // Casillas numéricas reales (para referencia interna)
  actualizarCasillas303(r303);
  // Alertas fiscales
  renderAlertasIVA(r303, trim);
}

function calcModelo303Completo(facturas) {
  const rep = { 21: 0, 10: 0, 4: 0, 0: 0, total: 0 };
  const sop = { int: 0, imp: 0, total: 0 };
  const byOp = { nacional: 0, intracomunitaria: 0, exportacion: 0,
                 importacion: 0, inversion_sujeto_pasivo: 0 };
  let baseExenta = 0;

  facturas.forEach(f => {
    const cuota = f.base * (f.iva || 0) / 100;
    const op = f.tipo_operacion || "nacional";

    if (f.tipo === "emitida" && f.estado === "emitida") {
      if (op === "exportacion") {
        // Exenta 0% — art. 21 LIVA
        baseExenta += f.base;
        byOp.exportacion = (byOp.exportacion || 0) + f.base;
      } else if (op === "intracomunitaria") {
        // Entrega IC exenta — art. 25 LIVA
        baseExenta += f.base;
        byOp.intracomunitaria = (byOp.intracomunitaria || 0) + f.base;
      } else if (op === "inversion_sujeto_pasivo") {
        // ISP emitida: el receptor liquida — art. 84 LIVA
        byOp.inversion_sujeto_pasivo = (byOp.inversion_sujeto_pasivo || 0) + f.base;
      } else {
        // Nacional con IVA
        const k = [21, 10, 4, 0].includes(Number(f.iva)) ? Number(f.iva) : 21;
        rep[k] = (rep[k] || 0) + cuota;
        rep.total += cuota;
        byOp.nacional = (byOp.nacional || 0) + f.base;
      }
    } else if (f.tipo === "recibida") {
      if (op === "importacion") {
        sop.imp += cuota;
      } else if (op === "intracomunitaria" || op === "inversion_sujeto_pasivo") {
        // Adquisición IC e ISP recibida: el declarante es receptor
        // repercute (devengado) Y deduce (soportado) — efecto neutro
        rep.total += cuota;
        sop.int   += cuota;
        byOp[op]   = (byOp[op] || 0) + f.base;
      } else {
        sop.int += cuota;
      }
      sop.total = sop.int + sop.imp;
    }
  });

  const resultado = rep.total - sop.total;
  return { rep, sop, resultado, byOp, baseExenta };
}

function actualizarCasillas303(r) {
  const cas = {
    "cas1": (r.byOp.nacional || 0).toFixed(2),
    "cas3": r.rep[21].toFixed(2),
    "cas5": r.rep[10].toFixed(2),
    "cas7": r.rep[4].toFixed(2),
    "cas9": r.rep.total.toFixed(2),
    "cas28": r.sop.int.toFixed(2),
    "cas29": r.sop.imp.toFixed(2),
    "cas40": r.sop.total.toFixed(2),
    "cas64": r.resultado.toFixed(2),
  };
  Object.entries(cas).forEach(([id, v]) => {
    const el = document.getElementById(id); if (el) el.textContent = v;
  });
}

function renderAlertasIVA(r303, trim) {
  const el = document.getElementById("ivaAlertasEl");
  if (!el) return;
  const msgs = [];

  if (r303.baseExenta > 0 && r303.sop.total > 0) {
    const prorrata = r303.byOp.nacional > 0
      ? Math.ceil(r303.byOp.nacional / (r303.byOp.nacional + r303.baseExenta) * 100)
      : 0;
    msgs.push({ tipo: "aviso",
      txt: `⚠️ Prorrata de IVA: tienes operaciones exentas (${fmt(r303.baseExenta)}). Porcentaje de deducción estimado: ${prorrata}%. Regularización anual obligatoria en T4 (art. 104-106 LIVA).`
    });
  }
  if (r303.resultado < 0 && trim !== "T4") {
    msgs.push({ tipo: "info",
      txt: `Cuota negativa: ${fmt(Math.abs(r303.resultado))} se arrastra al siguiente periodo. Solo se puede solicitar devolución en T4 (art. 115 LIVA) salvo alta en ROM.`
    });
  }
  if (r303.byOp.inversion_sujeto_pasivo > 0) {
    msgs.push({ tipo: "info",
      txt: `Inversión del sujeto pasivo declarada: ${fmt(r303.byOp.inversion_sujeto_pasivo)}. Recuerda incluir tanto el IVA devengado (cas. 12-13) como el deducible (cas. 40) en el modelo 303.`
    });
  }

  el.innerHTML = msgs.map(m => `
    <div class="alerta-fiscal alerta-fiscal--${m.tipo}" style="margin-bottom:8px">
      <div class="af-body"><div class="af-desc">${m.txt}</div></div>
    </div>`).join("");
}

/* ══════════════════════════════════════════
   MODELO 130 — IRPF TRIMESTRAL ACUMULADO
   Fórmula correcta según art. 110 LIRPF
   y RD 439/2007 (Reglamento IRPF)
══════════════════════════════════════════ */
export async function refreshIRPF() {
  const year = getYear(), trim = getTrim();
  const facturasTrim = await getFacturasTrim(year, trim);
  const periodo = calcIRPF(facturasTrim);

  // Acumulado trimestres anteriores (OBLIGATORIO para el 130)
  let ingAcum = 0, gstAcum = 0, retAcum = 0, pagosPrevios = 0;
  const orden = ["T1","T2","T3","T4"];
  const idx = orden.indexOf(trim);
  for (let i = 0; i < idx; i++) {
    const ff = await getFacturasTrim(year, orden[i]);
    const r  = calcIRPF(ff);
    ingAcum      += r.ingresos;
    gstAcum      += r.gastos;
    retAcum      += r.retenciones;
    pagosPrevios += Math.max(0, (r.ingresos - r.gastos) * 0.20 - r.retenciones);
  }

  const ingTotal  = periodo.ingresos + ingAcum;
  const gstTotal  = periodo.gastos   + gstAcum;
  const retTotal  = periodo.retenciones + retAcum;
  const rendAcum  = ingTotal - gstTotal;
  // 20% del rendimiento neto acumulado (art. 110.1 LIRPF)
  const pagoAcum  = Math.max(0, rendAcum * 0.20);
  // Resultado = pago fraccionado − retenciones − pagos anteriores
  const resultado = Math.max(0, pagoAcum - retTotal - pagosPrevios);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("irpfIngBrutos",   periodo.ingresos);
  s("irpfIngAcum",     ingAcum);
  s("irpfIngTotal",    ingTotal);
  s("irpfGstPeriodo",  periodo.gastos);
  s("irpfGstAcum",     gstAcum);
  s("irpfGstTotal",    gstTotal);
  s("irpfRetPeriodo",  periodo.retenciones);
  s("irpfRetAcum",     retAcum);
  s("irpfRendNeto",    rendAcum);
  s("irpfPagoFrac",    pagoAcum);
  s("irpfMenosRet",    retTotal);
  s("irpfMenosPagAnt", pagosPrevios);

  const resEl  = document.getElementById("irpfResultado130");
  const stEl   = document.getElementById("irpfEstado130");
  if (resEl) resEl.textContent = fmt(resultado);
  if (stEl) {
    stEl.innerHTML = resultado > 0
      ? `<span class="badge b-pagar">A ingresar · Modelo 130</span>`
      : `<span class="badge b-compen">Sin pago · Resultado ≤ 0 (no negativo)</span>`;
  }
  const deadEl = document.getElementById("irpfDeadline");
  const lblEl  = document.getElementById("irpfPeriodoLabel");
  if (deadEl) deadEl.textContent = `Plazo de presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;

  // Proyección anual + alertas
  await refreshProyeccionAnual(year, trim, ingTotal, gstTotal, retTotal, rendAcum);
  renderAlertasIRPF(resultado, pagoAcum, retTotal, rendAcum, retAcum);
}

async function refreshProyeccionAnual(year, trim, ingYTD, gstYTD, retYTD, rendYTD) {
  const mesActual = ["T1","T2","T3","T4"].indexOf(trim) + 1;
  const factor    = 4 / mesActual;

  const ingProyect  = ingYTD  * factor;
  const gstProyect  = gstYTD  * factor;
  const retProyect  = retYTD  * factor;
  const rendProyect = ingProyect - gstProyect;
  const cuota       = Math.max(0, rendProyect * 0.20 - retProyect);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("irpfProyAnual", fmt(cuota));
  s("irpfTipoEf", ingProyect > 0
    ? ((cuota / ingProyect) * 100).toFixed(1) + "%" : "—");
  s("irpfReservaMes", fmt(cuota / 12));

  // Simulador Renta aproximado
  const sim = calcSimuladorRenta({
    rendimientoActividad: rendProyect,
    retrasacionesSoportadas: retProyect,
  });
  s("irpfCuotaRenta", fmt(sim.cuotaLiquida));
  s("irpfTipoEfRenta", sim.tipoEfectivo + "%");
}

function renderAlertasIRPF(resultado, pagoFrac, retTotal, rendimiento, retAcum) {
  const el = document.getElementById("irpfAlertasEl");
  if (!el) return;
  const msgs = [];

  // Aviso: retenciones < 20% del resultado
  if (retTotal > 0 && retTotal < pagoFrac * 0.4) {
    msgs.push({ tipo: "aviso",
      txt: `⚠️ Las retenciones soportadas acumuladas (${fmt(retTotal)}) son bajas. Considera aplicar un % de retención mayor en tus facturas (actualmente tienes el ${(retTotal/rendimiento*100).toFixed(1)}% de retención efectiva vs 20% recomendado).`
    });
  }

  // Aviso: rendimiento alto
  if (rendimiento > 57000) {
    msgs.push({ tipo: "aviso",
      txt: `Tu rendimiento neto acumulado supera 57.000€ (tramo 45% IRPF). Consulta con tu asesor posibles deducciones: planes de pensiones (hasta 1.500€/año), formación, amortizaciones...`
    });
  }

  // Aviso exención primer año
  if (retAcum === 0 && resultado > 0) {
    msgs.push({ tipo: "info",
      txt: `Si estás en el primer o segundo año de actividad puedes aplicar una retención reducida del 7% (en lugar del 15%) en tus facturas durante los 3 primeros ejercicios. Comunícalo a tus clientes en la factura.`
    });
  }

  el.innerHTML = msgs.map(m => `
    <div class="alerta-fiscal alerta-fiscal--${m.tipo}" style="margin-bottom:8px">
      <div class="af-body"><div class="af-desc">${m.txt}</div></div>
    </div>`).join("");
}

/* ══════════════════════════════════════════
   SIMULADOR RENTA PERSONAL (Declaración IRPF)
   Tramos 2024 + mínimos personales y familiares
══════════════════════════════════════════ */
export function calcSimuladorRenta(params = {}) {
  const {
    rendimientoActividad = 0,
    retrasacionesSoportadas = 0,
    otrosIngresos = 0,
    hijos = 0,
    discapacidad = 0,
  } = params;

  // Reducción por actividad económica (art. 32.2 LIRPF)
  // Para estimación directa: reducción general 2.000€ + 3.500 si renta ≤ 14.047,5€
  let reduccionActividad = 2000;
  if (rendimientoActividad <= 14047.5) reduccionActividad += 3500;
  else if (rendimientoActividad <= 19747.5) {
    reduccionActividad += 3500 - 1.14286 * (rendimientoActividad - 14047.5);
  }

  const baseImponible = Math.max(0, rendimientoActividad - reduccionActividad + otrosIngresos);

  // Mínimo personal y familiar
  let minimo = MINIMO_PERSONAL;
  if (hijos >= 1) minimo += 2400;
  if (hijos >= 2) minimo += 2700;
  if (hijos >= 3) minimo += 4000;
  if (hijos >= 4) minimo += 4500;
  if (discapacidad >= 33 && discapacidad < 65) minimo += 3000;
  else if (discapacidad >= 65) minimo += 9000;

  // Tramos IRPF 2024 (escala estatal + autonómica aproximada)
  const tramos = [
    { hasta: 12450,  tipo: 0.19 },
    { hasta: 20200,  tipo: 0.24 },
    { hasta: 35200,  tipo: 0.30 },
    { hasta: 60000,  tipo: 0.37 },
    { hasta: 300000, tipo: 0.45 },
    { hasta: Infinity, tipo: 0.47 },
  ];

  let cuotaIntegra = 0;
  let base = Math.max(0, baseImponible - minimo);
  let anterior = 0;
  for (const t of tramos) {
    if (base <= 0) break;
    const enT = Math.min(base, t.hasta - anterior);
    cuotaIntegra += enT * t.tipo;
    anterior = t.hasta;
    base -= enT;
  }

  const cuotaLiquida = Math.max(0, cuotaIntegra - retrasacionesSoportadas);
  const tipoEfectivo = baseImponible > 0
    ? (cuotaIntegra / baseImponible * 100).toFixed(2)
    : "0.00";

  return { baseImponible, reduccionActividad, minimo, cuotaIntegra, cuotaLiquida, tipoEfectivo };
}

/* ══════════════════════════════════════════
   TABLAS AMORTIZACIÓN OFICIALES (RD 634/2015)
══════════════════════════════════════════ */
export const TABLAS_AMORTIZACION = {
  "Equipos informáticos":          { coefMax: 26, periodoMax: 10 },
  "Aplicaciones informáticas":     { coefMax: 33, periodoMax: 6  },
  "Maquinaria":                    { coefMax: 12, periodoMax: 18 },
  "Elementos de transporte":       { coefMax: 16, periodoMax: 14 },
  "Mobiliario":                    { coefMax: 10, periodoMax: 20 },
  "Instalaciones":                 { coefMax: 10, periodoMax: 20 },
  "Edificios y construcciones":    { coefMax: 3,  periodoMax: 68 },
  "Herramientas":                  { coefMax: 25, periodoMax: 8  },
  "Activos eficiencia energética": { coefMax: 30, periodoMax: 8  },
  "Fondos de comercio":            { coefMax: 5,  periodoMax: 20 },
};

export function calcAmortizacion({ valorAdquisicion, fechaAlta, tipo, coefElegido }) {
  const tabla = TABLAS_AMORTIZACION[tipo];
  if (!tabla) return null;
  const coef = Math.min(coefElegido || tabla.coefMax, tabla.coefMax);
  const cuotaAnual = valorAdquisicion * coef / 100;
  const vidaUtil   = Math.ceil(100 / coef);
  const añosAlta   = new Date().getFullYear() - new Date(fechaAlta || Date.now()).getFullYear();
  const amortAcum  = Math.min(valorAdquisicion, cuotaAnual * Math.max(0, añosAlta));
  return { cuotaAnual, coef, vidaUtil, amortAcum, valorNeto: valorAdquisicion - amortAcum };
}

/* ══════════════════════════════════════════
   GASTOS DEDUCIBLES — Guía AEAT 2024
══════════════════════════════════════════ */
export const GASTOS_DEDUCIBLES = {
  "Cuota RETA (SS autónomos)": {
    deducible: "100% — sin límite",
    ref: "Art. 30.2.1ª LIRPF"
  },
  "Seguro RC profesional": {
    deducible: "100% de la prima si es exclusivamente profesional",
    ref: "Art. 28.1 LIRPF"
  },
  "Alquiler oficina/local": {
    deducible: "100% si es exclusivamente para la actividad",
    ref: "Art. 29 LIRPF"
  },
  "Suministros (vivienda-oficina)": {
    deducible: "30% × % vivienda afecta. Límite: 30% de rendimientos netos",
    ref: "Art. 30.2.5ª LIRPF / DGT V2369-15"
  },
  "Material de oficina": {
    deducible: "100% si es necesario para la actividad",
    ref: "Art. 28.1 LIRPF"
  },
  "Formación profesional": {
    deducible: "100% si está relacionada con la actividad declarada en IAE",
    ref: "Art. 28.1 LIRPF"
  },
  "Dietas en desplazamiento": {
    deducible: "26,67€/día (España) | 53,34€/día (extranjero) sin pernocta. Con pernocta: 53,34 / 91,35€",
    ref: "Art. 9 RIRPF (por analogía para autónomos)"
  },
  "Vehículo": {
    deducible: "Solo con afectación exclusiva — muy difícil ante AEAT. Riesgo alto de regularización.",
    ref: "Art. 29 LIRPF / TEAC"
  },
  "Plan de pensiones": {
    deducible: "Hasta 1.500€/año en base general (reducción, no deducción)",
    ref: "Art. 51 LIRPF"
  },
};

/* ══════════════════════════════════════════
   PRORRATA DE IVA (art. 102-106 LIVA)
══════════════════════════════════════════ */
export function calcProrrata(operacionesSujetas, operacionesExentas) {
  const total = operacionesSujetas + operacionesExentas;
  if (!total) return { porcentaje: 100, nota: "Sin operaciones" };
  const pct = (operacionesSujetas / total) * 100;
  const redondeado = Math.ceil(pct); // siempre al entero SUPERIOR
  return {
    porcentaje: pct,
    redondeado,
    nota: redondeado < 100
      ? `Prorrata ${redondeado}%: solo puedes deducir el ${redondeado}% del IVA soportado. Regularización anual en T4.`
      : "Prorrata plena (100%): deduces todo el IVA soportado."
  };
}

/* ══════════════════════════════════════════
   EXPORTAR CASILLAS 303 / 130
══════════════════════════════════════════ */
export async function exportarDatos303() {
  const year = getYear(), trim = getTrim();
  const facs = await getFacturasTrim(year, trim);
  const r = calcModelo303Completo(facs);
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).single();
  if (!window.XLSX) return;
  const ws = window.XLSX.utils.json_to_sheet([{
    "Ejercicio": year, "Periodo": trim.replace("T",""),
    "NIF": pf?.nif||"", "Razón Social": pf?.nombre_razon_social||"",
    "Cas.01 Base ventas nacionales": (r.byOp.nacional||0).toFixed(2),
    "Cas.03 IVA 21%":  r.rep[21].toFixed(2),
    "Cas.05 IVA 10%":  r.rep[10].toFixed(2),
    "Cas.07 IVA 4%":   r.rep[4].toFixed(2),
    "Cas.09 Total IVA repercutido": r.rep.total.toFixed(2),
    "Cas.28 IVA soportado interior": r.sop.int.toFixed(2),
    "Cas.29 IVA soportado importaciones": r.sop.imp.toFixed(2),
    "Cas.40 Total IVA deducible": r.sop.total.toFixed(2),
    "Cas.64 Resultado (ingresar/compensar)": r.resultado.toFixed(2),
    "Base exenta/IC/exportaciones": (r.baseExenta||0).toFixed(2),
    "Generado con Taurix": new Date().toLocaleDateString("es-ES"),
  }]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `303_${trim}_${year}`);
  window.XLSX.writeFile(wb, `modelo_303_casillas_${year}_${trim}.xlsx`);
  toast("Casillas Modelo 303 exportadas ✅", "success");
}

export async function exportarDatos130() {
  const year = getYear(), trim = getTrim();
  const facs = await getFacturasTrim(year, trim);
  const per  = calcIRPF(facs);
  let ingA=0,gstA=0,retA=0,pagPrev=0;
  const ord = ["T1","T2","T3","T4"];
  for (let i=0; i<ord.indexOf(trim); i++) {
    const ff=await getFacturasTrim(year,ord[i]); const r=calcIRPF(ff);
    ingA+=r.ingresos; gstA+=r.gastos; retA+=r.retenciones;
    pagPrev+=Math.max(0,(r.ingresos-r.gastos)*0.20-r.retenciones);
  }
  const ingT=per.ingresos+ingA, gstT=per.gastos+gstA, retT=per.retenciones+retA;
  const rend=ingT-gstT, pago=Math.max(0,rend*0.20), res=Math.max(0,pago-retT-pagPrev);
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).single();
  if (!window.XLSX) return;
  const ws = window.XLSX.utils.json_to_sheet([{
    "Ejercicio": year, "Periodo": trim.replace("T",""),
    "NIF": pf?.nif||"", "Razón Social": pf?.nombre_razon_social||"",
    "Cas.01 Ingresos trimestre": per.ingresos.toFixed(2),
    "Cas.02 Gastos deducibles trimestre": per.gastos.toFixed(2),
    "Cas.03 Ingresos acumulados trim.anteriores": ingA.toFixed(2),
    "Cas.04 Gastos acumulados trim.anteriores": gstA.toFixed(2),
    "Cas.05 Rendimiento neto acumulado": rend.toFixed(2),
    "Cas.06 20% s/rendimiento neto acumulado": pago.toFixed(2),
    "Cas.07 Retenciones acumuladas": retT.toFixed(2),
    "Cas.08 Pagos fraccionados periodos anteriores": pagPrev.toFixed(2),
    "Cas.09 RESULTADO A INGRESAR": res.toFixed(2),
    "Generado con Taurix": new Date().toLocaleDateString("es-ES"),
  }]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `130_${trim}_${year}`);
  window.XLSX.writeFile(wb, `modelo_130_casillas_${year}_${trim}.xlsx`);
  toast("Casillas Modelo 130 exportadas ✅", "success");
}

function toast(msg, type) {
  const c = document.getElementById("toastEl");
  if (!c) return;
  const el = document.createElement("div");
  el.className = `toast t-${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(()=>el.remove(), 4000);
}
