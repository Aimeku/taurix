/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-iva.js
   Motor de cálculo IVA — funciones puras sin efectos secundarios
   
   REGLA: Ninguna función aquí toca el DOM ni llama a Supabase.
   Recibe TaxDocument[], devuelve objetos con resultados.
   Testeable, determinista, reutilizable en modo gestor.
   
   Normas principales:
   - LIVA (Ley 37/1992)
   - Modelo 303 — versión AEAT 2024/2025
   - Modelo 390 — resumen anual IVA
   
   REFACTORIZACIÓN v2 (post-auditoría fiscal 2026):
   - Hallazgo 1: usa `doc.desglose_iva` (multi-IVA real) en vez de
     `base × iva_pct / 100`.
   - Hallazgo 8: prorrata correcta — solo emitidas, distinguir entre
     exentas con derecho (art. 21, 25, ISP) y sin derecho (art. 20).
     Corrige bug que mezclaba `por_operacion.nacional` de emitidas y
     recibidas en la misma variable.
   - Hallazgo 10: redondeo simétrico por factura+tipo, ya garantizado
     por `desglosarIva()` en factura-helpers.js.
   - Hallazgo 17: el 390 incluye bases exentas aunque la cuota sea 0.
   - Hallazgo 24: ISP recibida usa la cuota real del documento, sin
     asumir 21 % por defecto.
   ═══════════════════════════════════════════════════════════════════ */

import {
  TIPOS_IVA_VALIDOS,
  OP_AUTOLIQUIDACION,
  CASILLAS_303,
  TRIM_ORDEN,
} from "./tax-rules.js";
import { redondearSimetrico } from "../factura-helpers.js";

const _r = redondearSimetrico;

/* ══════════════════════════════════════════════════════════════════
   MODELO 303 — Pago trimestral IVA (art. 167 LIVA)
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 303 completo a partir de TaxDocument[].
 * 
 * Incluye: IVA repercutido por tipos, IVA soportado, ISP,
 * operaciones intracomunitarias, exportaciones, prorrata detectada.
 * 
 * @param {import('./tax-types.js').TaxDocument[]} docs
 * @param {number} [compensacionAnterior=0] - Cuota a compensar de T anterior (positiva)
 * @param {number|null} [prorrataPctOverride=null] - % prorrata manual (0-100). null=auto-detectar
 * @returns {import('./tax-types.js').Resultado303}
 */
export function calcModelo303(docs, compensacionAnterior = 0, prorrataPctOverride = null) {
  // ── Acumuladores ─────────────────────────────────────────────────
  // IVA repercutido por tipo (emitidas nacionales)
  const rep = { tipo21: 0, tipo10: 0, tipo4: 0, tipo0: 0, total: 0 };
  // Bases por tipo (para casillas 01, 04, 06 del 303)
  const repBase = { tipo21: 0, tipo10: 0, tipo4: 0, tipo0: 0 };
  // IVA soportado bruto (antes de prorrata)
  const sopBruto = { interior: 0, importacion: 0 };
  // Autoliquidaciones (AIC + ISP recibidas) — se suman aparte:
  // devengado en casilla 13 (ISP) o 37 (AIC) Y deducible en casilla 40
  const autoliq = { rep: 0, sopBruto: 0 };
  // Base de IC adquiridas (para casilla 36)
  let baseIcAdq = 0;
  // Bases por tipo de operación — separadas emitidas/recibidas
  const porOp = {
    nacional_emitidas:         0,   // base ventas nacionales sujetas (casilla 01+04+06)
    nacional_recibidas:        0,   // base compras nacionales (informativo)
    intracomunitaria_entrega:  0,   // casilla 59 (exenta con derecho — no limita prorrata)
    intracomunitaria_adq:      0,   // casilla 36 (autoliquidada)
    exportacion:               0,   // casilla 60 (exenta con derecho)
    importacion:               0,   // base importaciones (informativo — IVA en aduana)
    isp_emitida:               0,   // casilla 61 (emitida sin IVA — receptor liquida)
    isp_recibida:              0,   // base ISP recibida autoliquidada (casilla 12)
    exento_sin_derecho:        0,   // exento art. 20 LIVA (limita prorrata)
  };

  // ── Primer pase: acumular bases y cuotas por operación ──────────
  docs.forEach(doc => {
    const d  = doc.desglose_iva;
    if (!d) return;
    const op = doc.tipo_operacion || "nacional";
    const pctDed = (doc.pct_deduccion_iva ?? 100) / 100;

    // ── FACTURAS EMITIDAS ──────────────────────────────────────────
    if (doc.tipo === "emitida" && doc.estado === "emitida") {

      if (op === "exportacion") {
        // Art. 21 LIVA: exenta con derecho pleno a deducir
        porOp.exportacion += d.base_total;

      } else if (op === "intracomunitaria") {
        // Art. 25 LIVA: entrega IC exenta con derecho pleno a deducir
        porOp.intracomunitaria_entrega += d.base_total;

      } else if (op === "inversion_sujeto_pasivo") {
        // Art. 84 LIVA: ISP emitida. No se repercute IVA; receptor
        // autoliquida. Va a casilla 61 del 303 (informativa).
        porOp.isp_emitida += d.base_total;

      } else if (op === "exento") {
        // Exención interna (art. 20 LIVA) — SIN derecho a deducir.
        // Única categoría de emitidas que limita la prorrata.
        porOp.exento_sin_derecho += d.base_total;

      } else {
        // Nacional sujeta: desglosar por tipo de IVA real
        rep.tipo21 += d[21].cuota;
        rep.tipo10 += d[10].cuota;
        rep.tipo4  += d[4].cuota;
        rep.tipo0  += d[0].cuota;
        rep.total  += d.cuota_total;
        repBase.tipo21 += d[21].base;
        repBase.tipo10 += d[10].base;
        repBase.tipo4  += d[4].base;
        repBase.tipo0  += d[0].base;
        porOp.nacional_emitidas += d.base_total;
      }
    }

    // ── FACTURAS RECIBIDAS ─────────────────────────────────────────
    else if (doc.tipo === "recibida" && doc.estado !== "anulada") {
      const cuotaReal = d.cuota_total;   // suma real de cuotas por tipo
      const deducible = doc.deducible_iva !== false;

      if (op === "importacion") {
        // IVA liquidado en aduana (DUA) — deducible si hay documento aduanero
        // Hallazgo 11: deducibilidad gobernada por deducible_iva del doc normalizado
        if (deducible) sopBruto.importacion += cuotaReal * pctDed;
        porOp.importacion += d.base_total;

      } else if (op === "intracomunitaria") {
        // AIC — Art. 85 LIVA: autoliquidación (rep Y sop simultáneamente).
        // Si la factura del proveedor europeo viene sin IVA (lo normal),
        // cuotaReal = 0; entonces aplicamos el tipo que corresponda al bien/servicio.
        // Para ser conservadores: si cuota = 0, asumimos 21 % (configurable por doc).
        // Hallazgo 24: preferimos la cuota registrada; solo si no hay, 21 %.
        const cuotaAIC = cuotaReal > 0 ? cuotaReal : d.base_total * 0.21;
        autoliq.rep      += cuotaAIC;
        if (deducible) autoliq.sopBruto += cuotaAIC * pctDed;
        porOp.intracomunitaria_adq += d.base_total;
        baseIcAdq += d.base_total;

      } else if (op === "inversion_sujeto_pasivo") {
        // ISP recibida — Art. 84 LIVA. Igual que AIC: autoliquidación.
        // Hallazgo 24: cuota real en lugar de asumir 21 %.
        const cuotaISP = cuotaReal > 0 ? cuotaReal : d.base_total * 0.21;
        autoliq.rep      += cuotaISP;
        if (deducible) autoliq.sopBruto += cuotaISP * pctDed;
        porOp.isp_recibida += d.base_total;

      } else {
        // Recibida nacional (compra doméstica)
        if (deducible) sopBruto.interior += cuotaReal * pctDed;
        porOp.nacional_recibidas += d.base_total;
      }
    }
  });

  // ── Cálculo de prorrata (Hallazgo 8) ─────────────────────────────
  // Numerador: operaciones con derecho a deducir
  //   = nacional_emitidas + exportacion + IC entregas + ISP emitida
  // Denominador: numerador + exento_sin_derecho (art. 20)
  // Exportación, IC y ISP NO limitan la prorrata (exención plena).
  let prorrataPct = 100;
  let hayProrrata = false;
  if (prorrataPctOverride !== null && prorrataPctOverride !== undefined) {
    prorrataPct = Math.max(0, Math.min(100, prorrataPctOverride));
    hayProrrata = prorrataPct < 100;
  } else {
    const conDerecho = porOp.nacional_emitidas + porOp.exportacion +
                       porOp.intracomunitaria_entrega + porOp.isp_emitida;
    const sinDerecho = porOp.exento_sin_derecho;
    if (sinDerecho > 0 && (conDerecho + sinDerecho) > 0) {
      hayProrrata = true;
      // Art. 104.Dos.2º LIVA: redondeo al entero superior
      prorrataPct = Math.ceil(conDerecho / (conDerecho + sinDerecho) * 100);
    }
  }

  // ── Aplicar prorrata al IVA soportado de operaciones comunes ────
  // La prorrata solo afecta al IVA soportado "común" (interior + importación).
  // Las autoliquidaciones (AIC/ISP recibida) ya están registradas en rep y sop
  // por igual importe; aplicar prorrata a la parte deducible replicaría bien
  // la neutralidad rota cuando hay prorrata < 100.
  const factorProrrata = prorrataPct / 100;
  const sop = {
    interior:    _r(sopBruto.interior * factorProrrata),
    importacion: _r(sopBruto.importacion * factorProrrata),
    autoliq:     _r(autoliq.sopBruto * factorProrrata),
    total:       0,
  };
  sop.total = _r(sop.interior + sop.importacion + sop.autoliq);

  // ── Totales devengado / deducible / resultado ───────────────────
  const totalDevengado = _r(rep.total + autoliq.rep);
  const totalDeducible = sop.total;
  const resultado      = _r(totalDevengado - totalDeducible);
  // compensacionAnterior SIEMPRE llega positiva (saldo a compensar disponible).
  // Se RESTA del resultado de este periodo (art. 99.5 LIVA).
  const resultadoConCompensacion = _r(resultado - Math.abs(compensacionAnterior || 0));

  let estadoResultado;
  if (resultadoConCompensacion > 0)      estadoResultado = "a_ingresar";
  else if (resultadoConCompensacion < 0) estadoResultado = "a_devolver";   // solo efectiva en T4 (art. 115 LIVA) o REDEME
  else                                   estadoResultado = "a_compensar";

  // ── Mapa de casillas numéricas reales del modelo 303 ────────────
  const casillas = _buildCasillas303({
    rep, repBase, sop, porOp, autoliq, baseIcAdq,
    resultado: resultadoConCompensacion,
    compensacion: Math.abs(compensacionAnterior || 0),
  });

  // Base exenta total (para la variable legacy `baseExenta` esperada por UI antigua)
  const baseExentaTotal = _r(
    porOp.exportacion + porOp.intracomunitaria_entrega + porOp.exento_sin_derecho
  );

  return {
    repercutido: {
      tipo21:  _r(rep.tipo21),
      tipo10:  _r(rep.tipo10),
      tipo4:   _r(rep.tipo4),
      tipo0:   _r(rep.tipo0),
      total:   _r(rep.total),
    },
    repercutido_bases: {
      tipo21: _r(repBase.tipo21),
      tipo10: _r(repBase.tipo10),
      tipo4:  _r(repBase.tipo4),
      tipo0:  _r(repBase.tipo0),
    },
    soportado: {
      interior:    sop.interior,
      importacion: sop.importacion,
      autoliq:     sop.autoliq,          // IVA soportado de AIC + ISP recibidas
      total:       sop.total,
    },
    soportado_bruto: {
      interior:    _r(sopBruto.interior),
      importacion: _r(sopBruto.importacion),
      autoliq:     _r(autoliq.sopBruto),
      total:       _r(sopBruto.interior + sopBruto.importacion + autoliq.sopBruto),
    },
    autoliquidado: {
      rep: _r(autoliq.rep),              // casilla 13 (ISP) + casilla 37 (AIC)
      sop: sop.autoliq,
    },
    devengado_total:       totalDevengado,
    deducible_total:       totalDeducible,
    resultado:             _r(resultado),
    compensacion_anterior: _r(Math.abs(compensacionAnterior || 0)),
    resultado_final:       resultadoConCompensacion,
    estado_resultado:      estadoResultado,
    por_operacion:         _roundObj(porOp),
    base_exenta:           baseExentaTotal,
    isp: {
      base_emitida:  _r(porOp.isp_emitida),
      base_recibida: _r(porOp.isp_recibida),
      cuota_recibida_autoliq: _r(autoliq.rep - (baseIcAdq > 0 ?
        docs.filter(d => d.tipo_operacion === "intracomunitaria" && d.tipo === "recibida")
             .reduce((s, d) => s + (d.desglose_iva.cuota_total > 0
                ? d.desglose_iva.cuota_total : d.desglose_iva.base_total * 0.21), 0) : 0)),
    },
    prorrata: {
      aplicada: hayProrrata,
      pct:      prorrataPct,
      // ajuste = IVA no deducido por prorrata
      ajuste_no_deducido: _r(
        (sopBruto.interior + sopBruto.importacion + autoliq.sopBruto) *
        (1 - factorProrrata)
      ),
    },
    casillas,
  };
}

/**
 * Construye el mapa de casillas numéricas del Modelo 303.
 * @private
 */
function _buildCasillas303({ rep, repBase, sop, porOp, autoliq, baseIcAdq, resultado, compensacion }) {
  // IMPORTANTE: los NÚMEROS de casilla deben reflejar el Modelo 303 vigente
  // (Orden HAC/819/2024 para 2025). Las constantes vienen de tax-rules.js.
  return {
    // Devengado — interior por tipo
    [CASILLAS_303.BASE_21]:   _r(repBase.tipo21),
    [CASILLAS_303.CUOTA_21]:  _r(rep.tipo21),
    [CASILLAS_303.BASE_10]:   _r(repBase.tipo10),
    [CASILLAS_303.CUOTA_10]:  _r(rep.tipo10),
    [CASILLAS_303.BASE_4]:    _r(repBase.tipo4),
    [CASILLAS_303.CUOTA_4]:   _r(rep.tipo4),
    // ISP recibida (autoliquidada)
    [CASILLAS_303.BASE_ISP]:  _r(porOp.isp_recibida),
    [CASILLAS_303.CUOTA_ISP]: _r(autoliq.rep * (porOp.isp_recibida / Math.max(1, porOp.isp_recibida + baseIcAdq))),
    // AIC (adquisiciones intracomunitarias)
    [CASILLAS_303.BASE_AIC]:  _r(baseIcAdq),
    [CASILLAS_303.CUOTA_AIC]: _r(autoliq.rep - autoliq.rep * (porOp.isp_recibida / Math.max(1, porOp.isp_recibida + baseIcAdq))),
    // Importaciones
    [CASILLAS_303.BASE_IMP]:  _r(porOp.importacion),
    [CASILLAS_303.CUOTA_IMP]: _r(sop.importacion),
    // Totales
    [CASILLAS_303.TOTAL_DEVENGADO]:      _r(rep.total + autoliq.rep),
    [CASILLAS_303.BASE_DEDUCIBLE_INT]:   _r(porOp.nacional_recibidas),
    [CASILLAS_303.CUOTA_DEDUCIBLE_INT]:  sop.interior,
    [CASILLAS_303.TOTAL_DEDUCIBLE]:      sop.total,
    // Resultado
    [CASILLAS_303.RESULTADO]:      _r(resultado + compensacion), // pre-compensación
    [CASILLAS_303.COMP_ANTERIORES]: _r(compensacion),
    [CASILLAS_303.RESULTADO_FINAL]: _r(resultado),
  };
}

/* ══════════════════════════════════════════════════════════════════
   PRORRATA — art. 102-106 LIVA
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula la prorrata general de IVA.
 * El % se redondea al entero superior (art. 104.Dos.2ª LIVA).
 * 
 * IMPORTANTE (Hallazgo 8 del informe):
 * - Numerador = solo OPERACIONES CON DERECHO A DEDUCIR.
 *   Incluye: nacional sujeta + exportaciones + IC entregas + ISP emitida.
 *   NO incluye compras (recibidas) — solo ventas/emitidas.
 * - Denominador = numerador + exento sin derecho (art. 20 LIVA).
 *   NO se incluyen exportaciones/IC en el denominador "como exentas",
 *   porque son exenciones plenas.
 * 
 * @param {number} opSujetasConDerecho - Base de operaciones con derecho (emitidas)
 * @param {number} opExentasSinDerecho - Base exenta sin derecho (art. 20 LIVA)
 * @returns {{ porcentaje: number, redondeado: number, tipo: string, nota: string }}
 */
export function calcProrrata(opSujetasConDerecho, opExentasSinDerecho) {
  const total = opSujetasConDerecho + opExentasSinDerecho;
  if (!total) {
    return { porcentaje: 100, redondeado: 100, tipo: "plena", nota: "Sin operaciones." };
  }

  const pct        = (opSujetasConDerecho / total) * 100;
  const redondeado = Math.ceil(pct);              // entero superior (art. 104.Dos.2ª)

  const tipo = redondeado >= 100 ? "plena" : redondeado <= 0 ? "nula" : "general";

  let nota;
  if (tipo === "plena") {
    nota = "Prorrata plena: deduce el 100% del IVA soportado.";
  } else if (tipo === "nula") {
    nota = "Prorrata nula: no puedes deducir ningún IVA soportado.";
  } else {
    nota = `Prorrata general ${redondeado}%: solo puedes deducir el ${redondeado}% del IVA soportado común. Regularización anual en T4 (art. 105 LIVA).`;
  }

  return { porcentaje: _r(pct, 4), redondeado, tipo, nota };
}

/**
 * Detecta si hay prorrata a partir del Resultado303.
 * 
 * @param {import('./tax-types.js').Resultado303} resultado303
 * @returns {{ hayProrrata: boolean, prorrata: Object|null }}
 */
export function detectarProrrata(resultado303) {
  const exentoSinDerecho = resultado303.por_operacion.exento_sin_derecho || 0;
  const haySoportado     = resultado303.soportado_bruto?.total > 0;

  if (exentoSinDerecho <= 0 || !haySoportado) {
    return { hayProrrata: false, prorrata: null };
  }

  const conDerecho = (resultado303.por_operacion.nacional_emitidas || 0) +
                     (resultado303.por_operacion.exportacion || 0) +
                     (resultado303.por_operacion.intracomunitaria_entrega || 0) +
                     (resultado303.por_operacion.isp_emitida || 0);

  const prorrata = calcProrrata(conDerecho, exentoSinDerecho);
  return { hayProrrata: prorrata.redondeado < 100, prorrata };
}

/**
 * Regularización de prorrata en T4 (diferencia entre provisional y definitiva).
 * 
 * @param {number} ivaDeducidoConPctProvisional
 * @param {number} pctProvisional
 * @param {number} pctDefinitivo
 * @returns {{ ajuste: number, nota: string }}
 */
export function calcRegularizacionProrrata(ivaDeducidoConPctProvisional, pctProvisional, pctDefinitivo) {
  if (pctProvisional === 0) return { ajuste: 0, nota: "Sin prorrata provisional." };

  const baseDeduccion      = ivaDeducidoConPctProvisional / (pctProvisional / 100);
  const ivaDebiendoDeducir = baseDeduccion * (pctDefinitivo / 100);
  const ajuste             = _r(ivaDebiendoDeducir - ivaDeducidoConPctProvisional);

  return {
    ajuste,
    nota: ajuste > 0
      ? `Regularización prorrata: puedes deducir ${ajuste}€ adicionales en T4.`
      : `Regularización prorrata: debes ingresar ${Math.abs(ajuste)}€ adicionales en T4.`,
  };
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 390 — Resumen anual IVA (art. 71.4 RIVA)
   Consolida los 4 trimestres del año
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 390 consolidando los resultados de los 4 trimestres.
 * 
 * Hallazgo 17 del informe: el 390 incluye también operaciones exentas,
 * exportaciones, IC y ISP — no solo las que generaron cuota de IVA.
 * 
 * @param {import('./tax-types.js').Resultado303[]} resultados303 - [T1, T2, T3, T4]
 * @returns {Object} Resultado 390
 */
export function calcModelo390(resultados303) {
  const acum = {
    rep_total:         0,
    sop_total:         0,
    tipo21_cuota:      0,
    tipo10_cuota:      0,
    tipo4_cuota:       0,
    tipo21_base:       0,
    tipo10_base:       0,
    tipo4_base:        0,
    base_exportacion:  0,
    base_ic_entrega:   0,
    base_ic_adq:       0,
    base_isp_emitida:  0,
    base_isp_recibida: 0,
    base_exento:       0,
    ajuste_prorrata:   0,
  };

  resultados303.forEach(r => {
    if (!r) return;
    acum.rep_total         += r.repercutido?.total         ?? 0;
    acum.sop_total         += r.soportado?.total           ?? 0;
    acum.tipo21_cuota      += r.repercutido?.tipo21        ?? 0;
    acum.tipo10_cuota      += r.repercutido?.tipo10        ?? 0;
    acum.tipo4_cuota       += r.repercutido?.tipo4         ?? 0;
    acum.tipo21_base       += r.repercutido_bases?.tipo21  ?? 0;
    acum.tipo10_base       += r.repercutido_bases?.tipo10  ?? 0;
    acum.tipo4_base        += r.repercutido_bases?.tipo4   ?? 0;
    acum.base_exportacion  += r.por_operacion?.exportacion ?? 0;
    acum.base_ic_entrega   += r.por_operacion?.intracomunitaria_entrega ?? 0;
    acum.base_ic_adq       += r.por_operacion?.intracomunitaria_adq ?? 0;
    acum.base_isp_emitida  += r.por_operacion?.isp_emitida ?? 0;
    acum.base_isp_recibida += r.por_operacion?.isp_recibida ?? 0;
    acum.base_exento       += r.por_operacion?.exento_sin_derecho ?? 0;
    acum.ajuste_prorrata   += r.prorrata?.ajuste_no_deducido ?? 0;
  });

  const resultado_anual = _r(acum.rep_total - acum.sop_total);

  return {
    // Cuotas totales
    rep_total:    _r(acum.rep_total),
    sop_total:    _r(acum.sop_total),
    resultado:    resultado_anual,
    // Cuotas por tipo
    tipo21_cuota: _r(acum.tipo21_cuota),
    tipo10_cuota: _r(acum.tipo10_cuota),
    tipo4_cuota:  _r(acum.tipo4_cuota),
    // Bases por tipo (interior)
    tipo21_base:  _r(acum.tipo21_base),
    tipo10_base:  _r(acum.tipo10_base),
    tipo4_base:   _r(acum.tipo4_base),
    // Operaciones especiales (para casillas específicas del 390)
    base_exportacion:    _r(acum.base_exportacion),       // cas. 103
    base_ic_entrega:     _r(acum.base_ic_entrega),        // cas. 99
    base_ic_adq:         _r(acum.base_ic_adq),            // cas. 81
    base_isp_emitida:    _r(acum.base_isp_emitida),       // cas. 122
    base_isp_recibida:   _r(acum.base_isp_recibida),      // cas. 30/36 según desglose
    base_exento:         _r(acum.base_exento),            // cas. 105 (exentas sin derecho)
    ajuste_prorrata:     _r(acum.ajuste_prorrata),        // IVA no deducido por prorrata
    // Info trimestres
    trimestres:   resultados303.map((r, i) => ({
      trim:       TRIM_ORDEN[i],
      resultado:  _r(r?.resultado_final ?? 0),
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════
   VALIDACIONES — avisos al usuario
══════════════════════════════════════════════════════════════════ */

/**
 * Valida la coherencia del Modelo 303 y devuelve avisos.
 * @param {import('./tax-types.js').Resultado303} r
 * @param {string} trim  - "T1"|"T2"|"T3"|"T4"
 * @returns {string[]}
 */
export function validateModelo303(r, trim) {
  const avisos = [];

  // Aviso: resultado negativo fuera de T4 → solo se puede compensar, no devolver
  if (r.resultado_final < 0 && trim !== "T4") {
    avisos.push(`Resultado negativo (${_r(Math.abs(r.resultado_final))}€): se compensará en el siguiente trimestre. La devolución solo es posible en T4 (art. 115 LIVA) o si estás inscrito en el REDEME.`);
  }

  // Aviso: resultado negativo en T4 → elegir compensar vs devolver
  if (r.resultado_final < 0 && trim === "T4") {
    avisos.push(`Resultado negativo en T4 (${_r(Math.abs(r.resultado_final))}€). Puedes solicitar la devolución a la AEAT o compensarlo en el T1 del año siguiente.`);
  }

  // Aviso: prorrata activa
  if (r.prorrata?.aplicada) {
    avisos.push(`Prorrata de IVA aplicada al ${r.prorrata.pct}% (art. 104-106 LIVA). IVA soportado no deducido: ${_r(r.prorrata.ajuste_no_deducido)}€. En T4 regulariza con la prorrata definitiva.`);
  }

  // Aviso: ISP emitida sin ISP reflejada (auditoría cruzada)
  if (r.isp.base_emitida > 0) {
    avisos.push(`Operaciones ISP emitidas (${_r(r.isp.base_emitida)}€): verifica que la factura lleva la mención "Inversión del sujeto pasivo" (art. 6.1.m RD 1619/2012).`);
  }

  // Aviso: exportaciones + IC → exención plena (no limita prorrata)
  if ((r.por_operacion.exportacion || 0) > 0 || (r.por_operacion.intracomunitaria_entrega || 0) > 0) {
    avisos.push(`Exportaciones y entregas IC están exentas CON derecho pleno a deducir (art. 94 LIVA). No limitan la prorrata.`);
  }

  // Aviso: IVA soportado > IVA repercutido sin operaciones exentas
  if (r.soportado.total > r.repercutido.total &&
      (r.por_operacion.exportacion || 0) === 0 &&
      (r.por_operacion.intracomunitaria_entrega || 0) === 0) {
    avisos.push("El IVA soportado supera al repercutido sin operaciones exentas que lo justifiquen. Verifica que todas las facturas emitidas están registradas correctamente.");
  }

  return avisos;
}

/* ══════════════════════════════════════════════════════════════════
   UTILIDADES INTERNAS
══════════════════════════════════════════════════════════════════ */

function _roundObj(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, typeof v === "number" ? _r(v) : v])
  );
}
