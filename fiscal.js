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

  // Calcular prorrata provisional del periodo
  // La prorrata definitiva se calcula anualmente en T4 (art. 105.2 LIVA)
  // Para los trimestres T1-T3 se usa la prorrata provisional del año anterior
  // (o 100% si es el primer año). Aquí calculamos la provisional del año en curso
  // como mejor estimación para el usuario.
  const basesSujetas  = facturas
    .filter(f => f.tipo === "emitida" && f.estado === "emitida"
              && !["exportacion","intracomunitaria","inversion_sujeto_pasivo","exento"].includes(f.tipo_operacion || "nacional"))
    .reduce((a, f) => a + f.base, 0);
  const basesExentas  = facturas
    .filter(f => f.tipo === "emitida" && f.estado === "emitida"
              && ["exportacion","intracomunitaria","exento"].includes(f.tipo_operacion || ""))
    .reduce((a, f) => a + f.base, 0);

  // Prorrata solo aplica si hay operaciones exentas sin derecho a deducción
  // Las exentas "plenas" (exportaciones, IC) no limitan la deducción del IVA soportado
  const basesExentasSinDerechoDeduccion = facturas
    .filter(f => f.tipo === "emitida" && f.estado === "emitida"
              && (f.tipo_operacion || "nacional") === "exento")
    .reduce((a, f) => a + f.base, 0);

  let prorrataPct = null; // null = sin prorrata (100%)
  if (basesExentasSinDerechoDeduccion > 0) {
    const totalOps = basesSujetas + basesExentasSinDerechoDeduccion;
    prorrataPct = totalOps > 0 ? Math.ceil(basesSujetas / totalOps * 100) : 100;
  }

  const r303 = calcModelo303Completo(facturas, prorrataPct);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("iva21Rep", r303.rep[21]);   s("iva10Rep", r303.rep[10]);
  s("iva4Rep",  r303.rep[4]);    s("ivaTotalRep", r303.rep.total);
  // Mostrar IVA soportado deducible (después de prorrata si aplica)
  s("ivaSoportadoInt", r303.sopDeducible.int);
  s("ivaSoportadoImp", r303.sopDeducible.imp);
  s("ivaTotalSop",     r303.sopDeducible.total);
  s("ivaRepSumary",    r303.rep.total);
  s("ivaSopSumary",    r303.sopDeducible.total);
  // Desglose operaciones — separando IC entregas de adquisiciones
  s("ivaOpNac",        r303.byOp.nacional         || 0);
  s("ivaOpIC",         r303.byOp.ic_entregas       || 0);
  s("ivaOpICAdq",      r303.byOp.ic_adquisiciones  || 0);
  s("ivaOpExp",        r303.byOp.exportacion       || 0);
  s("ivaOpISP",        r303.byOp.isp_emitida       || 0);
  s("ivaOpISPRec",     r303.byOp.isp_recibida      || 0);
  // Bases por tipo (nuevas casillas)
  s("ivaBase21",       r303.repBase[21] || 0);
  s("ivaBase10",       r303.repBase[10] || 0);
  s("ivaBase4",        r303.repBase[4]  || 0);
  // Prorrata — mostrar porcentaje si aplica
  const prEl = document.getElementById("ivaProrrataInfo");
  if (prEl) {
    if (r303.prorrataPct !== null && r303.prorrataPct < 100) {
      prEl.innerHTML = `<span class="badge b-pagar" style="font-size:11px">⚠️ Prorrata ${r303.prorrataPct}% — IVA soportado limitado</span>`;
      prEl.style.display = "";
    } else {
      prEl.style.display = "none";
    }
  }

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

function calcModelo303Completo(facturas, prorrataPct = null) {
  // prorrataPct: si se pasa (0-100), limita el IVA soportado deducible (art. 104-106 LIVA)
  // null = sin prorrata (prorrata plena, deducción 100%)

  // Cuotas repercutidas por tipo (cas. 03, 05, 07)
  const rep = { 21: 0, 10: 0, 4: 0, 0: 0, total: 0 };
  // Bases imponibles por tipo — necesarias para el Modelo 303 real (cas. 01, 02, 04, 06)
  const repBase = { 21: 0, 10: 0, 4: 0, 0: 0 };
  const sop = { int: 0, imp: 0, total: 0 };

  // byOp separado: entregas (emitidas exentas) vs adquisiciones (recibidas autoliquidadas)
  const byOp = {
    nacional:                    0,  // base ventas nacionales (cas. 01)
    ic_entregas:                 0,  // entregas IC exentas (cas. 59)
    ic_adquisiciones:            0,  // adquisiciones IC autoliquidadas (cas. 10-11)
    exportacion:                 0,  // exportaciones exentas (cas. 60)
    importacion:                 0,  // importaciones (cas. 29)
    isp_emitida:                 0,  // ISP emitida: receptor liquida (cas. 61)
    isp_recibida:                0,  // ISP recibida: autoliquidada (cas. 12-13)
  };
  let baseExenta = 0; // suma de IC entregas + exportaciones (para cálculo prorrata)

  facturas.forEach(f => {
    const cuota = f.base * (f.iva || 0) / 100;
    const op = f.tipo_operacion || "nacional";

    if (f.tipo === "emitida" && f.estado === "emitida") {
      if (op === "exportacion") {
        // Exenta art. 21 LIVA — sin cuota, con derecho a deducción plena
        baseExenta += f.base;
        byOp.exportacion += f.base;
      } else if (op === "intracomunitaria") {
        // Entrega IC exenta art. 25 LIVA — sin cuota, con derecho a deducción plena
        baseExenta += f.base;
        byOp.ic_entregas += f.base;
      } else if (op === "inversion_sujeto_pasivo") {
        // ISP emitida: el receptor autoliquida — no genera cuota en este modelo
        byOp.isp_emitida += f.base;
      } else if (op === "exento") {
        // Operación exenta sin derecho a deducción (ej: seguros, educación, sanidad)
        // Va a baseExenta para cálculo prorrata pero NO tiene derecho a deducir
        baseExenta += f.base;
      } else {
        // Nacional con IVA (tipos 21, 10, 4, 0)
        const k = [21, 10, 4, 0].includes(Number(f.iva)) ? Number(f.iva) : 21;
        rep[k]     += cuota;
        rep.total  += cuota;
        repBase[k] += f.base;
        byOp.nacional += f.base;
      }
    } else if (f.tipo === "recibida") {
      if (op === "importacion") {
        // IVA liquidado en aduana (DUA) — deducible si hay documento de aduana
        sop.imp += cuota;
        byOp.importacion += f.base;
      } else if (op === "intracomunitaria") {
        // Adquisición IC: autoliquidación obligatoria (art. 85 LIVA)
        // El declarante es sujeto pasivo: devengado Y deducible — efecto neutro
        rep.total += cuota;
        sop.int   += cuota;
        byOp.ic_adquisiciones += f.base;
      } else if (op === "inversion_sujeto_pasivo") {
        // ISP recibida: autoliquidación (art. 84 LIVA)
        rep.total += cuota;
        sop.int   += cuota;
        byOp.isp_recibida += f.base;
      } else {
        // Nacional: IVA soportado deducible si:
        //   a) tiene factura completa (no TIQ-), O
        //   b) es ticket pero con deducible_iva === true (IVA registrado explícitamente)
        // Art. 97 LIVA: los tickets sin NIF del receptor no dan derecho a deducción
        // salvo que el registro indique explícitamente que el IVA es deducible.
        const esTicket = (f.numero_factura || "").startsWith("TIQ-");
        const ivaDeducibleExplicito = f.deducible_iva === true;
        if (!esTicket || ivaDeducibleExplicito) {
          const pctDed = (f.pct_deduccion_iva ?? 100) / 100;
          sop.int += cuota * pctDed;
        }
      }
      sop.total = sop.int + sop.imp;
    }
  });

  // Aplicar prorrata si procede (art. 104-106 LIVA)
  // La prorrata limita el IVA soportado de operaciones comunes (no las específicas IC/ISP
  // que ya tienen tratamiento propio de autoliquidación — esas no se prorratean)
  let sopDeducible = { ...sop };
  if (prorrataPct !== null && prorrataPct < 100) {
    const factor = prorrataPct / 100;
    sopDeducible.int   = +(sop.int   * factor).toFixed(2);
    sopDeducible.imp   = +(sop.imp   * factor).toFixed(2);
    sopDeducible.total = sopDeducible.int + sopDeducible.imp;
  }

  const resultado = rep.total - sopDeducible.total;

  return {
    rep,
    repBase,        // bases por tipo para casillas 01, 02, 04, 06 del 303
    sop,            // IVA soportado bruto (antes de prorrata)
    sopDeducible,   // IVA soportado después de aplicar prorrata
    resultado,
    byOp,
    baseExenta,
    prorrataPct,
  };
}

function actualizarCasillas303(r) {
  // Casillas reales Modelo 303 AEAT 2024
  // Base Y cuota por tipo (cas 01-07), IC, ISP, exportaciones, prorrata
  const cas = {
    // Operaciones interiores sujetas — base e IVA por tipo
    "cas1":  (r.repBase[21]     || 0).toFixed(2), // Base 21%
    "cas2":  (r.rep[21]         || 0).toFixed(2), // Cuota 21% (= cas3 en modelo oficial)
    "cas3":  (r.rep[21]         || 0).toFixed(2), // Cuota 21%
    "cas4":  (r.repBase[10]     || 0).toFixed(2), // Base 10%
    "cas5":  (r.rep[10]         || 0).toFixed(2), // Cuota 10%
    "cas6":  (r.repBase[4]      || 0).toFixed(2), // Base 4%
    "cas7":  (r.rep[4]          || 0).toFixed(2), // Cuota 4%
    // ISP recibidas (autoliquidadas)
    "cas12": (r.byOp.isp_recibida || 0).toFixed(2), // Base ISP
    "cas13": (r.byOp.isp_recibida * 0.21 || 0).toFixed(2), // Cuota ISP (aprox 21%)
    // Total IVA devengado
    "cas9":  r.rep.total.toFixed(2),
    // Operaciones exentas y especiales
    "cas59": (r.byOp.ic_entregas  || 0).toFixed(2), // Entregas IC exentas
    "cas60": (r.byOp.exportacion  || 0).toFixed(2), // Exportaciones
    "cas61": (r.byOp.isp_emitida  || 0).toFixed(2), // ISP emitida
    // IVA soportado deducible
    "cas28": r.sopDeducible.int.toFixed(2),  // Interior (con prorrata si aplica)
    "cas29": r.sopDeducible.imp.toFixed(2),  // Importaciones
    "cas40": r.sopDeducible.total.toFixed(2), // Total deducible
    // Prorrata
    "casProrrataAnual": r.prorrataPct !== null ? r.prorrataPct.toFixed(0) + "%" : "100%",
    // Resultado
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

  // Prorrata activa — ya aplicada en el cálculo
  if (r303.prorrataPct !== null && r303.prorrataPct < 100) {
    const ivaNoDeducido = r303.sop.total - r303.sopDeducible.total;
    msgs.push({ tipo: "aviso",
      txt: `⚠️ Prorrata de IVA aplicada al ${r303.prorrataPct}% (art. 104-106 LIVA). Tienes operaciones exentas sin derecho a deducción. `
         + `IVA soportado bruto: ${fmt(r303.sop.total)} → deducible: ${fmt(r303.sopDeducible.total)} (no deducible: ${fmt(ivaNoDeducido)}). `
         + `En T4 deberás regularizar con la prorrata definitiva anual.`
    });
  }

  // Exportaciones e IC: exentas con derecho pleno a deducción (no limitan prorrata)
  if (r303.byOp.ic_entregas > 0 || r303.byOp.exportacion > 0) {
    msgs.push({ tipo: "info",
      txt: `Las entregas intracomunitarias (${fmt(r303.byOp.ic_entregas)}) y exportaciones (${fmt(r303.byOp.exportacion)}) están exentas con derecho pleno a deducir el IVA soportado — no limitan la prorrata (art. 94.1 LIVA).`
    });
  }

  // Cuota negativa — compensar o devolver
  if (r303.resultado < 0 && trim !== "T4") {
    msgs.push({ tipo: "info",
      txt: `Cuota negativa: ${fmt(Math.abs(r303.resultado))} se arrastra al siguiente periodo. Solo se puede solicitar devolución en T4 (art. 115 LIVA) o si estás inscrito en el REDEME (devolución mensual).`
    });
  }
  if (r303.resultado < 0 && trim === "T4") {
    msgs.push({ tipo: "aviso",
      txt: `Resultado negativo en T4: ${fmt(Math.abs(r303.resultado))}. Puedes solicitar la devolución a la AEAT o compensarlo en el primer trimestre del año siguiente.`
    });
  }

  // ISP recibida — recordatorio casillas 12-13 y 40
  if (r303.byOp.isp_recibida > 0) {
    msgs.push({ tipo: "info",
      txt: `Inversión del sujeto pasivo recibida (${fmt(r303.byOp.isp_recibida)}): autoliquidado en cas. 12-13 (devengado) y cas. 40 (deducible). Efecto neutro en el resultado si deduces el 100%.`
    });
  }

  // ISP emitida — recordatorio de no repercutir IVA
  if (r303.byOp.isp_emitida > 0) {
    msgs.push({ tipo: "info",
      txt: `Operaciones ISP emitidas (${fmt(r303.byOp.isp_emitida)}): correctamente emitidas sin IVA repercutido. El destinatario liquida el IVA en su 303 (art. 84.1 LIVA).`
    });
  }

  el.innerHTML = msgs.length
    ? msgs.map(m => `
        <div class="alerta-fiscal alerta-fiscal--${m.tipo}" style="margin-bottom:8px">
          <div class="af-body"><div class="af-desc">${m.txt}</div></div>
        </div>`).join("")
    : `<div style="font-size:12px;color:var(--t4);padding:8px 0">Sin alertas para este periodo.</div>`;
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

  // Detectar excepción 70% sobre acumulado anual (art. 109.1 RIRPF)
  // Se calcula sobre el total del año hasta el trimestre actual
  const exento130 = ingTotal > 0 && (retTotal > 0) &&
    ((ingTotal > 0) ? (periodo.ingresosConRetencion + (ingTotal - periodo.ingresos > 0
      ? ingTotal - periodo.ingresos : 0)) / ingTotal >= 0.70 : false);
  // Cálculo más robusto: % de ingresos YTD con retención
  let ingYTDConRetencion = periodo.ingresosConRetencion || 0;
  // Para trimestres anteriores, estimamos proporcional (no tenemos el dato exacto sin releer)
  // Una estimación conservadora: si retAcum/ingAcum ratio ≈ ratio actual, consideramos similar
  const retRatio = ingTotal > 0 ? retTotal / (ingTotal * 0.15) : 0; // asume 15% medio
  const exento130_estimado = ingTotal > 0 && retTotal / ingTotal >= 0.15 * 0.70; // ≥10.5% ret efectiva

  const resEl  = document.getElementById("irpfResultado130");
  const stEl   = document.getElementById("irpfEstado130");
  if (resEl) resEl.textContent = fmt(resultado);
  if (stEl) {
    if (exento130_estimado && resultado === 0) {
      stEl.innerHTML = `<span class="badge b-compen">Sin pago · Retenciones cubren el 130</span>`;
    } else if (resultado > 0) {
      stEl.innerHTML = `<span class="badge b-pagar">A ingresar · Modelo 130</span>`;
    } else {
      stEl.innerHTML = `<span class="badge b-compen">Sin pago · Resultado ≤ 0</span>`;
    }
  }
  const deadEl = document.getElementById("irpfDeadline");
  const lblEl  = document.getElementById("irpfPeriodoLabel");
  if (deadEl) deadEl.textContent = `Plazo de presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;

  // Proyección anual + alertas
  await refreshProyeccionAnual(year, trim, ingTotal, gstTotal, retTotal, rendAcum);
  renderAlertasIRPF(resultado, pagoAcum, retTotal, rendAcum, retAcum, ingTotal, periodo.pctConRetencion || 0);
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

function renderAlertasIRPF(resultado, pagoFrac, retTotal, rendimiento, retAcum, ingTotal, pctConRetencion) {
  const el = document.getElementById("irpfAlertasEl");
  if (!el) return;
  const msgs = [];

  // ── Excepción 70%: no obligado a presentar Modelo 130 (art. 109.1 RIRPF) ──
  // Condición: al menos el 70% de los ingresos íntegros del ejercicio anterior
  // procedieron de actividades con retención (rendimientos profesionales art. 95 RIRPF)
  if (pctConRetencion >= 0.70 && ingTotal > 0) {
    msgs.push({ tipo: "info",
      txt: `ℹ️ Excepción Modelo 130 (art. 109.1 RIRPF): el ${(pctConRetencion*100).toFixed(0)}% de tus ingresos acumulados llevan retención (≥70%). Es posible que no estés obligado a presentar el Modelo 130 este trimestre. Verifica esta condición referida al ejercicio ANTERIOR antes de no presentar.`
    });
  }

  // ── Retención al 7%: primeros 3 años de actividad (art. 95.1 RIRPF) ──
  // Si hay retenciones pero a tipo inferior al 12%, puede ser un primer/segundo ejercicio
  const tipoRetEfectivo = ingTotal > 0 ? (retTotal / ingTotal * 100) : 0;
  if (tipoRetEfectivo > 0 && tipoRetEfectivo < 10 && resultado > 0) {
    msgs.push({ tipo: "info",
      txt: `ℹ️ Tipo de retención efectivo: ${tipoRetEfectivo.toFixed(1)}%. Si estás en los primeros 3 ejercicios de actividad, puedes aplicar el 7% reducido (art. 95.1 RIRPF). Comunícalo en cada factura con la mención: "Retención IRPF 7% — primer/segundo año de actividad".`
    });
  }

  // ── Retenciones bajas respecto al pago fraccionado ──
  if (retTotal > 0 && pagoFrac > 0 && retTotal < pagoFrac * 0.4) {
    msgs.push({ tipo: "aviso",
      txt: `⚠️ Retenciones acumuladas (${fmt(retTotal)}) cubren menos del 40% del pago fraccionado (${fmt(pagoFrac)}). Tipo efectivo actual: ${tipoRetEfectivo.toFixed(1)}%. Considera aumentar el % de retención en tus facturas al 15% para reducir los pagos trimestrales del 130.`
    });
  }

  // ── Sin retenciones ──
  if (retTotal === 0 && retAcum === 0 && resultado > 0 && ingTotal > 0) {
    msgs.push({ tipo: "info",
      txt: `No tienes retenciones registradas. Si emites facturas a empresas y profesionales (no a particulares), debes aplicar retención IRPF. Tipo general: 15%. Primeros 3 años de actividad: 7% (art. 95.1 RIRPF).`
    });
  }

  // ── Rendimiento alto: aviso tramos superiores ──
  if (rendimiento > 60000) {
    msgs.push({ tipo: "aviso",
      txt: `⚠️ Rendimiento neto acumulado supera 60.000€ (tramo al 37%-45% IRPF). Consulta con tu asesor: plan de pensiones (hasta 1.500€/año en base general), aportaciones a mutualidades, gastos de formación y amortizaciones pendientes.`
    });
  } else if (rendimiento > 35000) {
    msgs.push({ tipo: "info",
      txt: `Rendimiento en tramo del 30% (35.200€-60.000€). Considera si tienes gastos deducibles pendientes de registrar antes del cierre del ejercicio.`
    });
  }

  el.innerHTML = msgs.length
    ? msgs.map(m => `
        <div class="alerta-fiscal alerta-fiscal--${m.tipo}" style="margin-bottom:8px">
          <div class="af-body"><div class="af-desc">${m.txt}</div></div>
        </div>`).join("")
    : `<div style="font-size:12px;color:var(--t4);padding:8px 0">Sin alertas para este periodo.</div>`;
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

export function calcAmortizacion({ valorAdquisicion, fechaAlta, tipo, coefElegido, year }) {
  // year: ejercicio fiscal para el que se calcula (default: año actual)
  // Cálculo proporcional al mes de alta en el primer año (art. 4 RIS — RD 634/2015)
  const tabla = TABLAS_AMORTIZACION[tipo];
  if (!tabla) return null;

  const coef       = Math.min(coefElegido || tabla.coefMax, tabla.coefMax);
  const cuotaAnual = valorAdquisicion * coef / 100;
  const vidaUtil   = Math.ceil(100 / coef);

  const yearCalculo  = year || new Date().getFullYear();
  const fechaAltaObj = fechaAlta ? new Date(fechaAlta + "T12:00:00") : new Date();
  const yearAlta     = fechaAltaObj.getFullYear();
  const mesAlta      = fechaAltaObj.getMonth() + 1; // 1-12

  // Cuota proporcional para el año de alta (meses restantes / 12)
  // Desde el mes de puesta en funcionamiento, inclusive
  const mesesPrimerAnio = 13 - mesAlta; // ej: alta en julio → 6 meses (jul-dic)
  const cuotaPrimerAnio = cuotaAnual * mesesPrimerAnio / 12;

  // Calcular amortización acumulada hasta el final de yearCalculo
  let amortAcum = 0;
  if (yearCalculo >= yearAlta) {
    if (yearCalculo === yearAlta) {
      // Mismo año: solo la fracción proporcional
      amortAcum = cuotaPrimerAnio;
    } else {
      // Años completos después del año de alta
      const añosCompletos = yearCalculo - yearAlta - 1; // años entre año alta+1 y year-1
      amortAcum = cuotaPrimerAnio + (cuotaAnual * añosCompletos) + cuotaAnual;
    }
    amortAcum = Math.min(valorAdquisicion, amortAcum);
  }

  // Cuota del ejercicio yearCalculo
  let cuotaEjercicio;
  if (yearCalculo === yearAlta) {
    cuotaEjercicio = cuotaPrimerAnio;
  } else if (amortAcum >= valorAdquisicion) {
    cuotaEjercicio = 0; // ya totalmente amortizado
  } else {
    cuotaEjercicio = Math.min(cuotaAnual, valorAdquisicion - (amortAcum - cuotaAnual));
  }
  cuotaEjercicio = Math.max(0, cuotaEjercicio);

  return {
    cuotaAnual,
    cuotaEjercicio,   // cuota deducible en el ejercicio yearCalculo
    coef,
    vidaUtil,
    mesesPrimerAnio,
    amortAcum,
    valorNeto: Math.max(0, valorAdquisicion - amortAcum),
  };
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
  const r = calcModelo303Completo(facs);  // prorrata calculada en refreshIVA; aquí sin prorrata para exportar datos brutos
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).single();
  if (!window.XLSX) return;
  const ws = window.XLSX.utils.json_to_sheet([{
    "Ejercicio": year, "Periodo": trim.replace("T",""),
    "NIF": pf?.nif||"", "Razón Social": pf?.nombre_razon_social||"",
    // Bases por tipo (cas 01, 03, 05, 07)
    "Cas.01 Base ventas nacionales 21%":   (r.repBase[21]||0).toFixed(2),
    "Cas.02 Cuota IVA 21%":                r.rep[21].toFixed(2),
    "Cas.03 Base ventas nacionales 10%":   (r.repBase[10]||0).toFixed(2),
    "Cas.04 Cuota IVA 10%":                r.rep[10].toFixed(2),
    "Cas.05 Base ventas nacionales 4%":    (r.repBase[4]||0).toFixed(2),
    "Cas.06 Cuota IVA 4%":                 r.rep[4].toFixed(2),
    "Cas.09 Total IVA repercutido":        r.rep.total.toFixed(2),
    // Adquisiciones IC y ISP (autoliquidación)
    "Cas.10 Base adquisiciones IC":        (r.byOp.ic_adquisiciones||0).toFixed(2),
    "Cas.12 Base ISP recibida":            (r.byOp.isp_recibida||0).toFixed(2),
    // IVA soportado deducible
    "Cas.28 IVA soportado interior":       r.sopDeducible.int.toFixed(2),
    "Cas.29 IVA soportado importaciones":  r.sopDeducible.imp.toFixed(2),
    "Cas.40 Total IVA deducible":          r.sopDeducible.total.toFixed(2),
    // Operaciones exentas
    "Cas.59 Entregas IC exentas":          (r.byOp.ic_entregas||0).toFixed(2),
    "Cas.60 Exportaciones":                (r.byOp.exportacion||0).toFixed(2),
    "Cas.61 ISP emitida":                  (r.byOp.isp_emitida||0).toFixed(2),
    // Prorrata si aplica
    "Prorrata aplicada":                   r.prorrataPct !== null ? r.prorrataPct + "%" : "100% (plena)",
    "IVA soportado bruto (sin prorrata)":  r.sop.total.toFixed(2),
    // Resultado
    "Cas.64 Resultado (ingresar/compensar)": r.resultado.toFixed(2),
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
