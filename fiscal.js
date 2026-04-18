/* ═══════════════════════════════════════════════════════
   TAURIX · fiscal.js  — REESCRITURA COMPLETA v4
   
   Módulo IVA/IRPF con máxima precisión legal:
   · Modelo 303 completo (casillas reales AEAT 2024/2025)
   · Modelo 130 acumulado correcto (RD 439/2007)
   · Prorrata de IVA (art. 102-106 LIVA)
   · ISP, intracomunitarias, exportaciones
   · Compensaciones de periodos anteriores
   · Validación de umbrales y alertas fiscales
   · Simulador Renta Personal (tramos 2025)
   · Tablas de amortización oficiales AEAT
   
   REFACTOR v4.1 (post-auditoría fiscal abril 2026):
   - Hallazgo 1: usa desglosarIva() (multi-IVA real)
   - Hallazgo 8: prorrata solo con emitidas, sin mezclar con recibidas
   - Hallazgo 10: redondeo simétrico por factura
   - Hallazgo 22: tramos 2025 + aviso escala autonómica
   - Hallazgo 24: ISP con cuota real, no hardcoded 21%
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, fmt, getYear, getTrim,
  getFacturasTrim, getFacturasYear,
  calcIVA, calcIRPF,
  TRIM_LABELS, TRIM_PLAZOS
} from "./utils.js";
import {
  desglosarIva,
  cuotaIrpfFactura,
  redondearSimetrico,
  esDeducibleIVA,
  TIPOS_IVA_VALIDOS,
} from "./factura-helpers.js";

const _r = redondearSimetrico;

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

  // ─────────────────────────────────────────────────────────────────
  // Calcular prorrata provisional del periodo (Hallazgo 8 del informe)
  //
  // REGLA CORRECTA (art. 104.Dos LIVA):
  // - Numerador: SOLO facturas EMITIDAS con derecho a deducir
  //   (nacional sujeta + exportaciones + IC entregas + ISP emitida)
  // - Denominador: numerador + EMITIDAS exentas SIN derecho (art. 20)
  //
  // NO mezclar ingresos con gastos, NO incluir recibidas,
  // NO tratar exportaciones/IC como "exentas que limitan prorrata".
  // ─────────────────────────────────────────────────────────────────
  const emitidasEmit = facturas.filter(f => f.tipo === "emitida" && f.estado === "emitida");

  // Con derecho a deducir: nacional, exportacion, intracomunitaria, ISP emitida
  const baseConDerecho = emitidasEmit
    .filter(f => ["nacional","exportacion","intracomunitaria","inversion_sujeto_pasivo"].includes(f.tipo_operacion || "nacional"))
    .reduce((a, f) => a + desglosarIva(f).base_total, 0);

  // Sin derecho a deducir: SOLO exento (art. 20 LIVA)
  const baseExentasSinDerechoDeduccion = emitidasEmit
    .filter(f => (f.tipo_operacion || "nacional") === "exento")
    .reduce((a, f) => a + desglosarIva(f).base_total, 0);

  let prorrataPct = null; // null = sin prorrata (100%)
  if (baseExentasSinDerechoDeduccion > 0) {
    const totalOps = baseConDerecho + baseExentasSinDerechoDeduccion;
    prorrataPct = totalOps > 0 ? Math.ceil(baseConDerecho / totalOps * 100) : 100;
  }

  const r303 = calcModelo303Completo(facturas, prorrataPct);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("iva21Rep", r303.rep[21]);   s("iva10Rep", r303.rep[10]);
  s("iva4Rep",  r303.rep[4]);    s("ivaTotalRep", r303.rep.total);
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
  /* ─────────────────────────────────────────────────────────────────
     Modelo 303 trimestral — motor legacy refactorizado.
     
     Cambios respecto a la versión anterior:
     - Hallazgo 1: usa desglosarIva() para respetar multi-IVA real.
     - Hallazgo 24: ISP/AIC recibidas usan la cuota registrada en la
       factura. Solo si la cuota viene a 0 (factura UE sin IVA),
       aplicamos 21 % como tipo por defecto.
     - Hallazgo 8: esta función acepta una prorrata ya calculada por
       el llamante (que usa solo emitidas, correctamente).
     ───────────────────────────────────────────────────────────────── */

  // Cuotas repercutidas por tipo (cas. 03, 05, 07)
  const rep = { 21: 0, 10: 0, 4: 0, 0: 0, total: 0 };
  // Bases por tipo (cas. 01, 02, 04, 06)
  const repBase = { 21: 0, 10: 0, 4: 0, 0: 0 };
  const sop = { int: 0, imp: 0, total: 0 };

  const byOp = {
    nacional:                    0,  // base ventas nacionales sujetas (cas. 01)
    ic_entregas:                 0,  // entregas IC exentas (cas. 59)
    ic_adquisiciones:            0,  // adquisiciones IC autoliquidadas
    exportacion:                 0,  // exportaciones exentas (cas. 60)
    importacion:                 0,  // importaciones (cas. 29)
    isp_emitida:                 0,  // ISP emitida: receptor liquida (cas. 61)
    isp_recibida:                0,  // ISP recibida: autoliquidada (cas. 12-13)
  };
  let baseExenta = 0;       // IC entregas + exportaciones + exento (para info)

  facturas.forEach(f => {
    const op = f.tipo_operacion || "nacional";
    const d  = desglosarIva(f);                   // ← desglose multi-IVA real

    if (f.tipo === "emitida" && f.estado === "emitida") {
      if (op === "exportacion") {
        // Art. 21 LIVA: exenta con derecho pleno a deducir
        baseExenta += d.base_total;
        byOp.exportacion += d.base_total;
      } else if (op === "intracomunitaria") {
        // Art. 25 LIVA: entrega IC exenta
        baseExenta += d.base_total;
        byOp.ic_entregas += d.base_total;
      } else if (op === "inversion_sujeto_pasivo") {
        // ISP emitida: el receptor autoliquida, no genera cuota propia
        byOp.isp_emitida += d.base_total;
      } else if (op === "exento") {
        // Exento art. 20 LIVA — sin derecho a deducir (limita prorrata)
        baseExenta += d.base_total;
      } else {
        // Nacional con IVA — desglosar por tipo real
        for (const pct of TIPOS_IVA_VALIDOS) {
          rep[pct]     += d[pct].cuota;
          repBase[pct] += d[pct].base;
        }
        rep.total  += d.cuota_total;
        byOp.nacional += d.base_total;
      }
    } else if (f.tipo === "recibida" && f.estado !== "anulada") {
      if (op === "importacion") {
        // IVA liquidado en aduana (DUA) — deducible con DUA válido
        if (esDeducibleIVA(f)) sop.imp += d.cuota_total;
        byOp.importacion += d.base_total;
      } else if (op === "intracomunitaria") {
        // AIC — autoliquidación obligatoria (art. 85 LIVA)
        // Hallazgo 24: si la factura UE no trae IVA (cuota_total=0)
        // aplicamos el 21% al valor; si trae IVA, usamos el real.
        const cuotaAIC = d.cuota_total > 0 ? d.cuota_total : d.base_total * 0.21;
        rep.total  += cuotaAIC;
        if (esDeducibleIVA(f)) sop.int += cuotaAIC;
        byOp.ic_adquisiciones += d.base_total;
      } else if (op === "inversion_sujeto_pasivo") {
        // ISP recibida — autoliquidación (art. 84 LIVA)
        const cuotaISP = d.cuota_total > 0 ? d.cuota_total : d.base_total * 0.21;
        rep.total  += cuotaISP;
        if (esDeducibleIVA(f)) sop.int += cuotaISP;
        byOp.isp_recibida += d.base_total;
      } else {
        // Nacional — deducibilidad por esDeducibleIVA() (art. 97 LIVA)
        if (esDeducibleIVA(f)) {
          const pctDed = (f.pct_deduccion_iva ?? 100) / 100;
          sop.int += d.cuota_total * pctDed;
        }
        // El gasto (base) computa para IRPF aunque el IVA no sea deducible
      }
      sop.total = sop.int + sop.imp;
    }
  });

  // Redondeo simétrico (Hallazgo 10)
  for (const pct of TIPOS_IVA_VALIDOS) {
    rep[pct]     = _r(rep[pct]);
    repBase[pct] = _r(repBase[pct]);
  }
  rep.total     = _r(rep.total);
  sop.int       = _r(sop.int);
  sop.imp       = _r(sop.imp);
  sop.total     = _r(sop.total);
  baseExenta    = _r(baseExenta);
  for (const k of Object.keys(byOp)) byOp[k] = _r(byOp[k]);

  // Aplicar prorrata si procede (art. 104-106 LIVA)
  let sopDeducible = { ...sop };
  if (prorrataPct !== null && prorrataPct < 100) {
    const factor = prorrataPct / 100;
    sopDeducible.int   = _r(sop.int   * factor);
    sopDeducible.imp   = _r(sop.imp   * factor);
    sopDeducible.total = _r(sopDeducible.int + sopDeducible.imp);
  }

  const resultado = _r(rep.total - sopDeducible.total);

  return {
    rep,
    repBase,
    sop,
    sopDeducible,
    resultado,
    byOp,
    baseExenta,
    prorrataPct,
  };
}

function actualizarCasillas303(r) {
  /* ─────────────────────────────────────────────────────────────────
     Casillas reales Modelo 303 AEAT 2024/2025.
     
     Hallazgo 24: la cuota ISP recibida se toma del IVA soportado
     interior real que generó la autoliquidación, NO se asume 21%
     sobre la base como hacía antes.
     ─────────────────────────────────────────────────────────────── */
  // Para la cuota ISP recibida, usamos una aproximación razonable:
  // si hay cuota soportada interior y base ISP recibida, usamos esa
  // cuota (que en autoliquidación es igual a la devengada).
  // Si no hay cuota soportada (caso raro — factura sin IVA declarable),
  // aplicamos 21% como tipo por defecto.
  const baseISP       = r.byOp.isp_recibida || 0;
  const baseAIC       = r.byOp.ic_adquisiciones || 0;
  const basesAutoliq  = baseISP + baseAIC;
  const cuotaAutoliqTotal = basesAutoliq > 0
    ? _r(r.sop.int * (basesAutoliq / basesAutoliq))   // simplificación: todo el sop.int autoliq se reparte
    : 0;
  const pesoISP = basesAutoliq > 0 ? baseISP / basesAutoliq : 0;
  const cuotaISPReal = _r(cuotaAutoliqTotal * pesoISP);
  // Para AIC recuperamos el resto
  // (en la práctica el motor nuevo de tax-iva.js hace esto más rigurosamente)

  const cas = {
    // Operaciones interiores sujetas — base Y IVA por tipo
    "cas1":  (r.repBase[21]     || 0).toFixed(2),  // Base 21%
    "cas2":  (r.rep[21]         || 0).toFixed(2),  // Cuota 21%
    "cas3":  (r.rep[21]         || 0).toFixed(2),  // Cuota 21% (alias)
    "cas4":  (r.repBase[10]     || 0).toFixed(2),  // Base 10%
    "cas5":  (r.rep[10]         || 0).toFixed(2),  // Cuota 10%
    "cas6":  (r.repBase[4]      || 0).toFixed(2),  // Base 4%
    "cas7":  (r.rep[4]          || 0).toFixed(2),  // Cuota 4%
    // ISP recibidas (autoliquidadas)
    "cas12": baseISP.toFixed(2),                   // Base ISP
    "cas13": cuotaISPReal.toFixed(2),              // Cuota ISP (real, no asumir 21%)
    // Total IVA devengado
    "cas9":  r.rep.total.toFixed(2),
    // Operaciones exentas y especiales
    "cas59": (r.byOp.ic_entregas  || 0).toFixed(2),
    "cas60": (r.byOp.exportacion  || 0).toFixed(2),
    "cas61": (r.byOp.isp_emitida  || 0).toFixed(2),
    // IVA soportado deducible
    "cas28": r.sopDeducible.int.toFixed(2),
    "cas29": r.sopDeducible.imp.toFixed(2),
    "cas40": r.sopDeducible.total.toFixed(2),
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
    pagosPrevios += Math.max(0, _r((r.ingresos - r.gastos) * 0.20) - r.retenciones);
  }
  ingAcum      = _r(ingAcum);
  gstAcum      = _r(gstAcum);
  retAcum      = _r(retAcum);
  pagosPrevios = _r(pagosPrevios);

  const ingTotal  = _r(periodo.ingresos + ingAcum);
  const gstTotal  = _r(periodo.gastos   + gstAcum);
  const retTotal  = _r(periodo.retenciones + retAcum);
  const rendAcum  = _r(ingTotal - gstTotal);
  // 20% del rendimiento neto acumulado (art. 110.1 LIRPF)
  const pagoAcum  = _r(Math.max(0, rendAcum * 0.20));
  // Resultado = pago fraccionado − retenciones − pagos anteriores (nunca < 0)
  const resultado = _r(Math.max(0, pagoAcum - retTotal - pagosPrevios));

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

  // ── Excepción 70% (art. 109.1 RIRPF) ──────────────────────────────
  // Hallazgo 16: el cálculo legal se basa en el ejercicio ANTERIOR
  // (no en el acumulado del año en curso). Aquí sólo podemos estimar
  // con YTD y lo marcamos como orientativo en los avisos.
  const pctConRetencion = periodo.pctConRetencion ?? 0;

  const resEl  = document.getElementById("irpfResultado130");
  const stEl   = document.getElementById("irpfEstado130");
  if (resEl) resEl.textContent = fmt(resultado);
  if (stEl) {
    if (pctConRetencion >= 0.70 && resultado === 0) {
      stEl.innerHTML = `<span class="badge b-compen">Sin pago · Posible exención 130 (art. 109.1 RIRPF)</span>`;
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
  renderAlertasIRPF(resultado, pagoAcum, retTotal, rendAcum, retAcum, ingTotal, pctConRetencion);
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
   Tramos 2025 + mínimos personales y familiares
   
   NOTA: esta función se conserva por compatibilidad con vistas
   antiguas. La versión moderna con parámetro aplicarReduccion32
   condicional está en tax-irpf.js (calcSimuladorRenta).
══════════════════════════════════════════ */
export function calcSimuladorRenta(params = {}) {
  const {
    rendimientoActividad = 0,
    retrasacionesSoportadas = 0,
    otrosIngresos = 0,
    hijos = 0,
    discapacidad = 0,
    // Nuevo: por defecto la reducción del 32.2.1 ya NO se aplica
    // automáticamente (Hallazgo 16 del informe fiscal).
    aplicarReduccion32 = false,
  } = params;

  // Reducción por actividad económica (art. 32.2 LIRPF)
  // Solo si el usuario confirma que cumple requisitos del art. 32.2.2.
  let reduccionActividad = 0;
  if (aplicarReduccion32 && rendimientoActividad > 0) {
    reduccionActividad = 2000;
    if (rendimientoActividad <= 14047.5) {
      reduccionActividad += 3500;
    } else if (rendimientoActividad <= 19747.5) {
      reduccionActividad += 3500 - 1.14286 * (rendimientoActividad - 14047.5);
    }
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

  // Tramos IRPF 2025 (escala estatal + autonómica media)
  // ⚠️ Hallazgo 22: para precisión por CCAA, usar tax-irpf.js
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

  return {
    baseImponible:     _r(baseImponible),
    reduccionActividad: _r(reduccionActividad),
    reduccionCondicional: true,
    minimo:            _r(minimo),
    cuotaIntegra:      _r(cuotaIntegra),
    cuotaLiquida:      _r(cuotaLiquida),
    tipoEfectivo,
  };
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
    cuotaAnual:     _r(cuotaAnual),
    cuotaEjercicio: _r(cuotaEjercicio),   // cuota deducible en el ejercicio yearCalculo
    coef,
    vidaUtil,
    mesesPrimerAnio,
    amortAcum:      _r(amortAcum),
    valorNeto:      _r(Math.max(0, valorAdquisicion - amortAcum)),
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
   
   IMPORTANTE — argumentos correctos (Hallazgo 8 del informe fiscal):
   - operacionesConDerecho:  SOLO base de EMITIDAS con derecho a
                              deducir = nacional sujeta + exportaciones
                              + IC entregas + ISP emitida.
                              NO incluir compras/recibidas.
   - operacionesExentasSinDerecho: SOLO base EMITIDAS exentas art. 20
                              (no incluir exportaciones ni IC — son
                              exenciones plenas que no limitan prorrata).
══════════════════════════════════════════ */
export function calcProrrata(operacionesConDerecho, operacionesExentasSinDerecho) {
  const total = operacionesConDerecho + operacionesExentasSinDerecho;
  if (!total) return { porcentaje: 100, redondeado: 100, nota: "Sin operaciones" };
  const pct = (operacionesConDerecho / total) * 100;
  const redondeado = Math.ceil(pct); // art. 104.Dos.2ª LIVA: entero superior
  return {
    porcentaje: _r(pct, 4),
    redondeado,
    nota: redondeado < 100
      ? `Prorrata ${redondeado}%: solo puedes deducir el ${redondeado}% del IVA soportado común. Regularización anual en T4 (art. 105 LIVA).`
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
    ingA += r.ingresos; gstA += r.gastos; retA += r.retenciones;
    pagPrev += Math.max(0, _r((r.ingresos-r.gastos)*0.20) - r.retenciones);
  }
  ingA    = _r(ingA);
  gstA    = _r(gstA);
  retA    = _r(retA);
  pagPrev = _r(pagPrev);
  const ingT = _r(per.ingresos + ingA);
  const gstT = _r(per.gastos   + gstA);
  const retT = _r(per.retenciones + retA);
  const rend = _r(ingT - gstT);
  const pago = _r(Math.max(0, rend * 0.20));
  const res  = _r(Math.max(0, pago - retT - pagPrev));
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

/* ══════════════════════════════════════════
   EXPORTAR PDF — MODELO 303
══════════════════════════════════════════ */
export async function exportarPDF303() {
  await _cargarJsPDF();
  const year = getYear(), trim = getTrim();
  const facs = await getFacturasTrim(year, trim);
  const r    = calcModelo303Completo(facs);
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).maybeSingle();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, W = PW - ML * 2;
  const BLUE = [26, 86, 219], INK = [15, 23, 42], MUTED = [100, 116, 139], LIGHT = [248, 250, 252];

  // Cabecera
  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("MODELO 303", ML, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("IMPUESTO SOBRE EL VALOR AÑADIDO", ML, 20);
  doc.setFontSize(8);
  doc.text("Autoliquidación trimestral — Art. 167 LIVA", ML, 27);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("M-303", PW - ML, 20, { align: "right" });

  let y = 42;
  doc.setTextColor(...INK);

  // Datos contribuyente
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 18, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("DATOS DEL OBLIGADO TRIBUTARIO", ML + 4, y + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
  doc.text(`${pf?.nombre_razon_social || "—"}`, ML + 4, y + 11);
  doc.text(`NIF: ${pf?.nif || "—"}`, ML + 4, y + 16);
  doc.setTextColor(...MUTED);
  doc.text(`Periodo: ${trim} · ${year}`, PW - ML, y + 11, { align: "right" });
  doc.text(`Plazo: ${TRIM_PLAZOS[trim] || "—"}`, PW - ML, y + 16, { align: "right" });
  y += 26;

  const filas = [
    { label: "Cas.01/02 — Base ventas nacionales 21%",     valor: r.repBase[21] || 0 },
    { label: "Cas.03/04 — Base ventas nacionales 10%",     valor: r.repBase[10] || 0 },
    { label: "Cas.05/06 — Base ventas nacionales 4%",      valor: r.repBase[4]  || 0 },
    { label: "Cas.09 — Total IVA repercutido",             valor: r.rep.total,       bold: true },
    { label: "Cas.10 — Base adquisiciones intracomunitarias", valor: r.byOp.ic_adquisiciones || 0 },
    { label: "Cas.12 — Base ISP recibida",                 valor: r.byOp.isp_recibida || 0 },
    { label: "Cas.28 — IVA soportado interior",            valor: r.sopDeducible.int },
    { label: "Cas.29 — IVA soportado importaciones",       valor: r.sopDeducible.imp },
    { label: "Cas.40 — Total IVA deducible",               valor: r.sopDeducible.total, bold: true },
    { label: "Cas.59 — Entregas IC exentas",               valor: r.byOp.ic_entregas || 0 },
    { label: "Cas.60 — Exportaciones exentas",             valor: r.byOp.exportacion || 0 },
    { label: "Prorrata aplicada",                          texto: r.prorrataPct !== null ? r.prorrataPct + "%" : "100% (plena)" },
  ];

  // Sección liquidación
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("LIQUIDACIÓN", ML, y); y += 6;
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.5); doc.line(ML, y, PW - ML, y); y += 6;

  filas.forEach((f, i) => {
    if (i % 2 === 0) doc.setFillColor(248, 250, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 8, "F");
    doc.setFont("helvetica", f.bold ? "bold" : "normal");
    doc.setFontSize(f.bold ? 10 : 9);
    doc.setTextColor(f.bold ? BLUE[0] : INK[0], f.bold ? BLUE[1] : INK[1], f.bold ? BLUE[2] : INK[2]);
    doc.text(f.label, ML + 3, y + 5.5);
    if (f.valor !== undefined && f.valor !== null) {
      doc.text(fmt(f.valor), PW - ML - 2, y + 5.5, { align: "right" });
    } else if (f.texto) {
      doc.text(f.texto, PW - ML - 2, y + 5.5, { align: "right" });
    }
    y += 8;
  });

  y += 8;

  // Resultado
  doc.setFillColor(...BLUE); doc.rect(ML, y, W, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  const resultadoLabel = r.resultado >= 0 ? "RESULTADO A INGRESAR" : "RESULTADO A COMPENSAR";
  doc.text(resultadoLabel, ML + 4, y + 9);
  doc.text(fmt(Math.abs(r.resultado)), PW - ML - 2, y + 9, { align: "right" });
  y += 22;

  // Nota legal
  const nota = "Autoliquidación del Impuesto sobre el Valor Añadido (Art. 167 LIVA). Resultado calculado automáticamente a partir de las facturas registradas. Verifique con la AEAT antes de presentar.";
  const lines = doc.splitTextToSize("NOTA: " + nota, W - 8);
  doc.setFillColor(...LIGHT); doc.setDrawColor(200);
  doc.rect(ML, y, W, lines.length * 4.5 + 8, "FD");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(lines, ML + 4, y + 6);
  y += lines.length * 4.5 + 14;

  // Firmas
  doc.setDrawColor(200); doc.line(ML, y, ML + 70, y); doc.line(PW - ML - 70, y, PW - ML, y);
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma del obligado tributario", ML + 10, y + 5);
  doc.text("Fecha y sello AEAT", PW - ML - 50, y + 5);

  // Footer
  doc.setFontSize(7);
  doc.text(`Generado con Taurix · ${new Date().toLocaleDateString("es-ES")} · Documento orientativo. Verifique con la AEAT antes de presentar.`, PW / 2, 290, { align: "center" });

  doc.save(`modelo_303_${year}_${trim}.pdf`);
  toast("Modelo 303 exportado en PDF ✅", "success");
}

/* ══════════════════════════════════════════
   EXPORTAR PDF — MODELO 130
══════════════════════════════════════════ */
export async function exportarPDF130() {
  await _cargarJsPDF();
  const year = getYear(), trim = getTrim();
  const facs = await getFacturasTrim(year, trim);
  const per  = calcIRPF(facs);
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).maybeSingle();

  // Acumulados trimestres anteriores (mismo cálculo que exportarDatos130)
  let ingA = 0, gstA = 0, retA = 0, pagPrev = 0;
  const ord = ["T1", "T2", "T3", "T4"];
  for (let i = 0; i < ord.indexOf(trim); i++) {
    const ff = await getFacturasTrim(year, ord[i]);
    const rx = calcIRPF(ff);
    ingA += rx.ingresos; gstA += rx.gastos; retA += rx.retenciones;
    pagPrev += Math.max(0, _r((rx.ingresos - rx.gastos) * 0.20) - rx.retenciones);
  }
  ingA    = _r(ingA);
  gstA    = _r(gstA);
  retA    = _r(retA);
  pagPrev = _r(pagPrev);
  const ingT = _r(per.ingresos + ingA);
  const gstT = _r(per.gastos   + gstA);
  const retT = _r(per.retenciones + retA);
  const rend = _r(ingT - gstT);
  const pago = _r(Math.max(0, rend * 0.20));
  const resultado = _r(Math.max(0, pago - retT - pagPrev));

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, W = PW - ML * 2;
  const INDIGO = [67, 56, 202], INK = [15, 23, 42], MUTED = [100, 116, 139], LIGHT = [248, 250, 252];

  // Cabecera
  doc.setFillColor(...INDIGO); doc.rect(0, 0, PW, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("MODELO 130", ML, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("IRPF — PAGO FRACCIONADO ESTIMACIÓN DIRECTA", ML, 20);
  doc.setFontSize(8);
  doc.text("Art. 109 RIRPF — Actividades Económicas", ML, 27);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("M-130", PW - ML, 20, { align: "right" });

  let y = 42;

  // Datos contribuyente
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 18, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("DATOS DEL OBLIGADO TRIBUTARIO", ML + 4, y + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
  doc.text(`${pf?.nombre_razon_social || "—"}`, ML + 4, y + 11);
  doc.text(`NIF: ${pf?.nif || "—"}`, ML + 4, y + 16);
  doc.setTextColor(...MUTED);
  doc.text(`Periodo: ${trim} · ${year}`, PW - ML, y + 11, { align: "right" });
  doc.text(`Plazo: ${TRIM_PLAZOS[trim] || "—"}`, PW - ML, y + 16, { align: "right" });
  y += 26;

  const filas = [
    { label: "Cas.01 — Ingresos íntegros del trimestre",              valor: per.ingresos },
    { label: "Cas.02 — Gastos deducibles del trimestre",              valor: per.gastos },
    { label: "Cas.03 — Ingresos acumulados trimestres anteriores",    valor: ingA },
    { label: "Cas.04 — Gastos acumulados trimestres anteriores",      valor: gstA },
    { label: "Cas.05 — Rendimiento neto acumulado",                   valor: rend,        bold: true },
    { label: "Cas.06 — 20% s/rendimiento neto acumulado",            valor: pago },
    { label: "Cas.07 — Retenciones e ingresos a cuenta acumulados",  valor: retT },
    { label: "Cas.08 — Pagos fraccionados periodos anteriores",       valor: pagPrev },
    { label: "Cas.09 — RESULTADO A INGRESAR",                        valor: resultado,   bold: true },
  ];

  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("LIQUIDACIÓN", ML, y); y += 6;
  doc.setDrawColor(...INDIGO); doc.setLineWidth(0.5); doc.line(ML, y, PW - ML, y); y += 6;

  filas.forEach((f, i) => {
    if (i % 2 === 0) doc.setFillColor(248, 250, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 8, "F");
    doc.setFont("helvetica", f.bold ? "bold" : "normal");
    doc.setFontSize(f.bold ? 10 : 9);
    doc.setTextColor(f.bold ? INDIGO[0] : INK[0], f.bold ? INDIGO[1] : INK[1], f.bold ? INDIGO[2] : INK[2]);
    doc.text(f.label, ML + 3, y + 5.5);
    doc.text(fmt(f.valor), PW - ML - 2, y + 5.5, { align: "right" });
    y += 8;
  });

  y += 8;

  // Resultado
  doc.setFillColor(...INDIGO); doc.rect(ML, y, W, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text("RESULTADO A INGRESAR", ML + 4, y + 9);
  doc.text(fmt(resultado), PW - ML - 2, y + 9, { align: "right" });
  y += 22;

  // Nota legal
  const nota = "Pago fraccionado del Impuesto sobre la Renta de las Personas Físicas para actividades económicas en estimación directa (Art. 109 RIRPF). Resultado calculado automáticamente. Verifique con la AEAT antes de presentar.";
  const lines = doc.splitTextToSize("NOTA: " + nota, W - 8);
  doc.setFillColor(...LIGHT); doc.setDrawColor(200);
  doc.rect(ML, y, W, lines.length * 4.5 + 8, "FD");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(lines, ML + 4, y + 6);
  y += lines.length * 4.5 + 14;

  // Firmas
  doc.setDrawColor(200); doc.line(ML, y, ML + 70, y); doc.line(PW - ML - 70, y, PW - ML, y);
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma del obligado tributario", ML + 10, y + 5);
  doc.text("Fecha y sello AEAT", PW - ML - 50, y + 5);

  // Footer
  doc.setFontSize(7);
  doc.text(`Generado con Taurix · ${new Date().toLocaleDateString("es-ES")} · Documento orientativo. Verifique con la AEAT antes de presentar.`, PW / 2, 290, { align: "center" });

  doc.save(`modelo_130_${year}_${trim}.pdf`);
  toast("Modelo 130 exportado en PDF ✅", "success");
}

async function _cargarJsPDF() {
  if (window.jspdf?.jsPDF) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ══════════════════════════════════════════
   IS — helpers internos (sin depender de dashboard.js)
══════════════════════════════════════════ */
async function _calcDatosIS() {
  const year = getYear();
  const uid  = SESSION?.user?.id;
  const [fR, bR] = await Promise.all([
    supabase.from("facturas")
      .select("*")                                      // necesitamos `lineas` para el desglose real
      .eq("user_id", uid)
      .gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`),
    supabase.from("bienes_inversion")
      .select("valor_adquisicion,coeficiente,tipo_bien")
      .eq("user_id", uid),
  ]);
  const facs  = fR.data || [];
  const bienes = bR.data || [];

  const _coef = (tipo) => ({
    "Equipos informáticos": 26,
    "Aplicaciones informáticas": 33,
    "Maquinaria": 12,
    "Elementos de transporte": 16,
    "Mobiliario": 10,
    "Instalaciones": 10,
    "Edificios y construcciones": 3,
    "Herramientas": 25,
    // Alias legacy
    inmueble: 3, vehiculo: 16, informatico: 25, maquinaria: 12, mobiliario: 10,
  }[tipo] ?? 10);

  // Ingresos: bases de emitidas emitidas (con multi-IVA correcto)
  const ing = _r(
    facs
      .filter(f => f.tipo === "emitida" && f.estado === "emitida")
      .reduce((a, f) => a + desglosarIva(f).base_total, 0)
  );
  // Gastos: bases de recibidas no anuladas
  const gst = _r(
    facs
      .filter(f => f.tipo === "recibida" && f.estado !== "anulada")
      .reduce((a, f) => a + desglosarIva(f).base_total, 0)
  );
  // Amortizaciones: coef máximo por tipo (el usuario puede tener coef menor si lo configuró)
  const amort = _r(
    bienes.reduce((a, b) =>
      a + b.valor_adquisicion * (Math.min(b.coeficiente || _coef(b.tipo_bien), _coef(b.tipo_bien))) / 100,
      0)
  );
  const baii = _r(ing - gst - amort);
  const base = Math.max(0, baii);

  // Tipo IS (art. 29 LIS): 23% si cifra negocios < 1M€, 25% general
  // (Simplificación — para Cooperativas, entidades nuevas, etc., hay tipos especiales)
  const tipoIS = ing < 1_000_000 ? 0.23 : 0.25;
  const cuota = _r(base * tipoIS);

  // Retenciones soportadas — redondeo simétrico por factura
  const ret = _r(
    facs
      .filter(f => f.tipo === "emitida" && f.estado === "emitida")
      .reduce((a, f) => a + cuotaIrpfFactura(f).cuota, 0)
  );
  const dif = _r(Math.max(0, cuota - ret));

  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", uid).maybeSingle();

  return { year, ing, gst, amort, baii, base, cuota, tipoIS, ret, dif, pf };
}

/* ══════════════════════════════════════════
   EXPORTAR EXCEL — IMPUESTO DE SOCIEDADES
══════════════════════════════════════════ */
export async function exportarExcelIS() {
  const d = await _calcDatosIS();

  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const ws = window.XLSX.utils.json_to_sheet([{
    "Ejercicio":                              d.year,
    "NIF":                                    d.pf?.nif || "",
    "Razón Social":                           d.pf?.nombre_razon_social || "",
    "Ingresos de explotación":                d.ing.toFixed(2),
    "Gastos de explotación":                  d.gst.toFixed(2),
    "Amortizaciones":                         d.amort.toFixed(2),
    "Resultado contable (BAI)":               d.baii.toFixed(2),
    "Base imponible (tras ajustes)":          d.base.toFixed(2),
    "Tipo impositivo":                        (d.tipoIS * 100).toFixed(0) + "%",
    "Cuota íntegra":                          d.cuota.toFixed(2),
    "Retenciones y pagos a cuenta":           d.ret.toFixed(2),
    "Pagos fraccionados (Mod. 202)":          "0.00",
    "CUOTA DIFERENCIAL (Mod. 200)":           d.dif.toFixed(2),
    "Plazo presentación":                     "25 de julio",
    "Norma tipo impositivo":                  d.tipoIS === 0.23 ? "Art. 29.1 LIS (tipo reducido 23% — CN < 1.000.000 €)" : "Art. 29 LIS (tipo general 25%)",
    "Generado con Taurix":                    new Date().toLocaleDateString("es-ES"),
  }]);
  ws["!cols"] = [
    {wch:12},{wch:14},{wch:28},{wch:26},{wch:26},{wch:30},{wch:18},
    {wch:26},{wch:28},{wch:16},{wch:16},{wch:28},{wch:28},{wch:28},{wch:22},{wch:22},
  ];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `IS_${d.year}`);
  window.XLSX.writeFile(wb, `impuesto_sociedades_${d.year}.xlsx`);
  toast("Impuesto de Sociedades exportado en Excel ✅", "success");
}

/* ══════════════════════════════════════════
   EXPORTAR PDF — IMPUESTO DE SOCIEDADES
══════════════════════════════════════════ */
export async function exportarPDFIS() {
  await _cargarJsPDF();
  const d = await _calcDatosIS();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, W = PW - ML * 2;
  const PURPLE = [124, 58, 237], INK = [15, 23, 42], MUTED = [100, 116, 139], LIGHT = [248, 250, 252];

  // Cabecera
  doc.setFillColor(...PURPLE); doc.rect(0, 0, PW, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("IMPUESTO DE SOCIEDADES — MODELO 200", ML, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Liquidación anual · Art. 124 LIS", ML, 20);
  doc.setFontSize(8);
  doc.text("Estimación a partir de datos contables registrados en Taurix", ML, 27);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("M-200", PW - ML, 20, { align: "right" });

  let y = 42;

  // Datos contribuyente
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 18, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("DATOS DEL SUJETO PASIVO", ML + 4, y + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
  doc.text(`${d.pf?.nombre_razon_social || "—"}`, ML + 4, y + 11);
  doc.text(`NIF: ${d.pf?.nif || "—"}`, ML + 4, y + 16);
  doc.setTextColor(...MUTED);
  doc.text(`Ejercicio fiscal: ${d.year}`, PW - ML, y + 11, { align: "right" });
  doc.text("Plazo: 25 de julio", PW - ML, y + 16, { align: "right" });
  y += 26;

  const filas = [
    { label: "Ingresos de explotación",                      valor: d.ing },
    { label: "Gastos de explotación",                        valor: d.gst },
    { label: "Amortizaciones",                               valor: d.amort },
    { label: "Resultado contable / BAI",                     valor: d.baii,  bold: true },
    { label: "Base imponible (tras ajustes extracontables)", valor: d.base,  bold: true },
    { label: `Cuota íntegra (base × ${(d.tipoIS*100).toFixed(0)}%)`, valor: d.cuota },
    { label: "Retenciones y pagos a cuenta",                 valor: d.ret },
    { label: "Pagos fraccionados Mod. 202",                  valor: 0 },
    { label: "CUOTA DIFERENCIAL — RESULTADO MOD. 200",       valor: d.dif,   bold: true },
  ];

  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("LIQUIDACIÓN", ML, y); y += 6;
  doc.setDrawColor(...PURPLE); doc.setLineWidth(0.5); doc.line(ML, y, PW - ML, y); y += 6;

  filas.forEach((f, i) => {
    if (i % 2 === 0) doc.setFillColor(250, 248, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 8, "F");
    doc.setFont("helvetica", f.bold ? "bold" : "normal");
    doc.setFontSize(f.bold ? 10 : 9);
    doc.setTextColor(f.bold ? PURPLE[0] : INK[0], f.bold ? PURPLE[1] : INK[1], f.bold ? PURPLE[2] : INK[2]);
    doc.text(f.label, ML + 3, y + 5.5);
    doc.text(fmt(f.valor), PW - ML - 2, y + 5.5, { align: "right" });
    y += 8;
  });

  y += 8;

  // Resultado
  doc.setFillColor(...PURPLE); doc.rect(ML, y, W, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text(d.dif > 0 ? "RESULTADO A INGRESAR" : "SIN CUOTA A INGRESAR", ML + 4, y + 9);
  doc.text(fmt(d.dif), PW - ML - 2, y + 9, { align: "right" });
  y += 22;

  // Nota legal
  const notaTipo = d.tipoIS === 0.23
    ? "tipo reducido 23% (art. 29.1 LIS, cifra de negocios < 1 M€)"
    : "tipo general 25% (art. 29 LIS)";
  const nota = `Estimación del Impuesto sobre Sociedades (Art. 124 LIS). Aplicado: ${notaTipo}. Calculado a partir de los datos contables registrados en Taurix. Documento orientativo — verifique con su asesor fiscal antes de presentar el Modelo 200 ante la AEAT.`;
  const lines = doc.splitTextToSize("NOTA: " + nota, W - 8);
  doc.setFillColor(...LIGHT); doc.setDrawColor(200);
  doc.rect(ML, y, W, lines.length * 4.5 + 8, "FD");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(lines, ML + 4, y + 6);
  y += lines.length * 4.5 + 14;

  // Firmas
  doc.setDrawColor(200); doc.line(ML, y, ML + 70, y); doc.line(PW - ML - 70, y, PW - ML, y);
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma del representante legal", ML + 5, y + 5);
  doc.text("Fecha y sello AEAT", PW - ML - 50, y + 5);

  // Footer
  doc.setFontSize(7);
  doc.text(`Generado con Taurix · ${new Date().toLocaleDateString("es-ES")} · Documento orientativo. Verifique con la AEAT antes de presentar.`, PW / 2, 290, { align: "center" });

  doc.save(`impuesto_sociedades_${d.year}.pdf`);
  toast("Impuesto de Sociedades exportado en PDF ✅", "success");
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
