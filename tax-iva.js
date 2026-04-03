/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-iva.js
   Motor de cálculo IVA — funciones puras sin efectos secundarios
   
   REGLA: Ninguna función aquí toca el DOM ni llama a Supabase.
   Recibe TaxDocument[], devuelve objetos con resultados.
   Testeable, determinista, reutilizable en modo gestor.
   
   Normas principales:
   - LIVA (Ley 37/1992)
   - Modelo 303 — versión AEAT 2024
   - Modelo 390 — resumen anual IVA
   ═══════════════════════════════════════════════════════════════════ */

import {
  TIPOS_IVA_VALIDOS,
  OP_AUTOLIQUIDACION,
  CASILLAS_303,
  TRIM_ORDEN,
} from "./tax-rules.js";

/* ══════════════════════════════════════════════════════════════════
   MODELO 303 — Pago trimestral IVA (art. 167 LIVA)
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 303 completo a partir de TaxDocument[].
 * Incluye: IVA repercutido por tipos, IVA soportado, ISP,
 * operaciones intracomunitarias, exportaciones, prorrata detectada.
 * 
 * @param {import('./tax-types.js').TaxDocument[]} docs
 * @param {number} [compensacionAnterior=0] - Cuota a compensar de T anterior
 * @returns {import('./tax-types.js').Resultado303}
 */
export function calcModelo303(docs, compensacionAnterior = 0) {
  // Acumuladores de IVA repercutido por tipo
  const rep = { tipo21: 0, tipo10: 0, tipo4: 0, tipo0: 0, total: 0 };
  // IVA soportado deducible
  const sop = { interior: 0, importacion: 0, total: 0 };
  // Bases por tipo de operación (para casillas y 347/349)
  const porOp = {
    nacional: 0,
    intracomunitaria_entrega: 0,
    intracomunitaria_adq: 0,
    exportacion: 0,
    importacion: 0,
    isp_emitida: 0,
    isp_recibida: 0,
  };
  // ISP — inversión del sujeto pasivo
  const isp = { base: 0, cuota: 0 };
  // Base de operaciones exentas (para cálculo de prorrata)
  let baseExenta = 0;

  docs.forEach(doc => {
    const base    = doc.base         ?? 0;
    const ivaPct  = doc.iva_pct      ?? 0;
    const cuota   = doc.cuota_iva    ?? (base * ivaPct / 100);
    const op      = doc.tipo_operacion ?? "nacional";
    const pctDed  = (doc.pct_deduccion_iva ?? 100) / 100;  // prorrata si < 1

    // ── FACTURAS EMITIDAS ──────────────────────────────────────────
    if (doc.tipo === "emitida" && doc.estado !== "anulada" && doc.estado !== "borrador") {

      if (op === "exportacion") {
        // Art. 21 LIVA: exenta, no genera IVA repercutido
        baseExenta += base;
        porOp.exportacion += base;

      } else if (op === "intracomunitaria") {
        // Art. 25 LIVA: entrega IC exenta
        baseExenta += base;
        porOp.intracomunitaria_entrega += base;

      } else if (op === "inversion_sujeto_pasivo") {
        // Art. 84 LIVA: ISP emitida — el receptor autoliquida
        // No se repercute IVA, pero la base va a casilla 12
        isp.base += base;
        porOp.isp_emitida += base;

      } else if (op === "exento") {
        // Exención interna (art. 20 LIVA)
        baseExenta += base;

      } else {
        // Operación nacional sujeta
        const k = TIPOS_IVA_VALIDOS.includes(ivaPct) ? ivaPct : 21;
        if      (k === 21) rep.tipo21 += cuota;
        else if (k === 10) rep.tipo10 += cuota;
        else if (k === 4)  rep.tipo4  += cuota;
        else               rep.tipo0  += cuota;
        rep.total += cuota;
        porOp.nacional += base;
      }
    }

    // ── FACTURAS RECIBIDAS ──────────────────────────────────────────
    else if (doc.tipo === "recibida") {
      const cuotaDed = cuota * pctDed;  // aplicar prorrata si procede

      if (op === "importacion") {
        // IVA liquidado en aduana (DUA) — casilla 29
        sop.importacion += cuotaDed;
        porOp.importacion += base;

      } else if (op === "intracomunitaria") {
        // Adquisición IC (AIC): se devengue (rep) y se deduce (sop) — efecto neutro
        // El declarante es sujeto pasivo por inversión (art. 86 LIVA)
        rep.total += cuota;           // devengado — casilla 37
        sop.interior += cuotaDed;     // deducible — casilla 29 interior
        porOp.intracomunitaria_adq += base;

      } else if (op === "inversion_sujeto_pasivo") {
        // ISP recibida: igual que AIC — neutralidad fiscal si deducible al 100%
        rep.total += cuota;           // devengado — casilla 13
        sop.interior += cuotaDed;     // deducible
        isp.base  += base;
        isp.cuota += cuota;
        porOp.isp_recibida += base;

      } else {
        // Recibida nacional — solo soportado
        sop.interior += cuotaDed;
        porOp.nacional += base;       // nota: sumar a nacional (compras)
      }

      sop.total = sop.interior + sop.importacion;
    }
  });

  sop.total = sop.interior + sop.importacion;
  const resultado = rep.total - sop.total;
  const resultadoConCompensacion = resultado + compensacionAnterior; // comp. es negativo

  let estadoResultado;
  if (resultadoConCompensacion > 0) {
    estadoResultado = "a_ingresar";
  } else if (resultadoConCompensacion < 0) {
    estadoResultado = "a_devolver"; // solo efectivo en T4 (art. 115 LIVA)
  } else {
    estadoResultado = "a_compensar";
  }

  // Mapa de casillas numéricas reales del modelo 303
  const casillas = _buildCasillas303(rep, sop, porOp, isp, baseExenta, resultadoConCompensacion, compensacionAnterior);

  return {
    repercutido: {
      tipo21:  _round(rep.tipo21),
      tipo10:  _round(rep.tipo10),
      tipo4:   _round(rep.tipo4),
      total:   _round(rep.total),
    },
    soportado: {
      interior:    _round(sop.interior),
      importacion: _round(sop.importacion),
      total:       _round(sop.total),
    },
    resultado:             _round(resultado),
    compensacion_anterior: _round(compensacionAnterior),
    resultado_final:       _round(resultadoConCompensacion),
    estado_resultado:      estadoResultado,
    por_operacion:         _roundObj(porOp),
    base_exenta:           _round(baseExenta),
    isp:                   { base: _round(isp.base), cuota: _round(isp.cuota) },
    casillas,
  };
}

/**
 * Construye el mapa de casillas numéricas del Modelo 303.
 * Solo para referencia interna y exportación XLSX/PDF.
 * @private
 */
function _buildCasillas303(rep, sop, porOp, isp, baseExenta, resultado, compensacion) {
  return {
    [CASILLAS_303.BASE_21]:           _round(porOp.nacional), // aproximación: base nacional
    [CASILLAS_303.CUOTA_21]:          _round(rep.tipo21),
    [CASILLAS_303.BASE_10]:           0, // se refina con desglose de facturas
    [CASILLAS_303.CUOTA_10]:          _round(rep.tipo10),
    [CASILLAS_303.BASE_4]:            0,
    [CASILLAS_303.CUOTA_4]:           _round(rep.tipo4),
    [CASILLAS_303.TOTAL_DEVENGADO]:   _round(rep.total),
    [CASILLAS_303.BASE_DEDUCIBLE_INT]:_round(sop.interior + sop.importacion), // base aprox
    [CASILLAS_303.TOTAL_DEDUCIBLE]:   _round(sop.total),
    [CASILLAS_303.RESULTADO]:         _round(resultado),
    [CASILLAS_303.COMP_ANTERIORES]:   _round(Math.abs(compensacion)),
  };
}

/* ══════════════════════════════════════════════════════════════════
   PRORRATA — art. 102-106 LIVA
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula la prorrata de IVA.
 * El % se redondea SIEMPRE al entero superior (art. 104.2.2ª LIVA).
 * 
 * @param {number} opSujetasDeducibles - Operaciones con IVA deducible
 * @param {number} opExentas           - Operaciones exentas (sin IVA)
 * @returns {{ porcentaje: number, redondeado: number, tipo: string, nota: string }}
 */
export function calcProrrata(opSujetasDeducibles, opExentas) {
  const total = opSujetasDeducibles + opExentas;
  if (!total) {
    return { porcentaje: 100, redondeado: 100, tipo: "plena", nota: "Sin operaciones." };
  }

  const pct       = (opSujetasDeducibles / total) * 100;
  const redondeado = Math.ceil(pct); // entero superior obligatorio

  const tipo = redondeado >= 100 ? "plena" : redondeado <= 0 ? "nula" : "general";

  let nota;
  if (tipo === "plena") {
    nota = "Prorrata plena: deduce el 100% del IVA soportado.";
  } else if (tipo === "nula") {
    nota = "Prorrata nula: no puedes deducir ningún IVA soportado.";
  } else {
    nota = `Prorrata general ${redondeado}%: solo puedes deducir el ${redondeado}% del IVA soportado. Regularización anual en T4 (art. 104 LIVA).`;
  }

  return { porcentaje: _round(pct, 4), redondeado, tipo, nota };
}

/**
 * Detecta si hay prorrata a partir de los documentos del año.
 * Hay prorrata cuando coexisten operaciones exentas y soportado deducible.
 * 
 * @param {import('./tax-types.js').Resultado303} resultado303
 * @returns {{ hayProrrata: boolean, prorrata: Object|null }}
 */
export function detectarProrrata(resultado303) {
  const hayExentas   = resultado303.base_exenta > 0;
  const haySoportado = resultado303.soportado.total > 0;
  const hayNacionales = resultado303.por_operacion.nacional > 0;

  if (!hayExentas || !haySoportado) {
    return { hayProrrata: false, prorrata: null };
  }

  const prorrata = calcProrrata(hayNacionales ? resultado303.por_operacion.nacional : 0, resultado303.base_exenta);
  return { hayProrrata: true, prorrata };
}

/**
 * Regularización de prorrata en T4.
 * Diferencia entre lo deducido con prorrata provisional y la definitiva.
 * 
 * @param {number} ivaDeducidoConPctProvisional - IVA total deducido en el año
 * @param {number} pctProvisional               - % prorrata provisional usado
 * @param {number} pctDefinitivo                - % prorrata definitiva calculada en T4
 * @returns {{ ajuste: number, nota: string }}
 */
export function calcRegularizacionProrrata(ivaDeducidoConPctProvisional, pctProvisional, pctDefinitivo) {
  if (pctProvisional === 0) return { ajuste: 0, nota: "Sin prorrata provisional." };

  // IVA que debería haberse deducido con el % definitivo
  const baseDeduccion = ivaDeducidoConPctProvisional / (pctProvisional / 100);
  const ivaDebiendoDeducir = baseDeduccion * (pctDefinitivo / 100);
  const ajuste = _round(ivaDebiendoDeducir - ivaDeducidoConPctProvisional);

  return {
    ajuste,
    nota: ajuste > 0
      ? `Regularización prorrata: puedes deducir ${ajuste}€ adicionales en T4.`
      : `Regularización prorrata: debes ingresar ${Math.abs(ajuste)}€ adicionales en T4.`,
  };
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 390 — Resumen anual IVA
   Consolida los 4 trimestres del año (art. 28 RIVA)
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 390 consolidando los resultados de los 4 trimestres.
 * 
 * @param {import('./tax-types.js').Resultado303[]} resultados303  - Array [T1, T2, T3, T4]
 * @returns {Object} Resultado 390
 */
export function calcModelo390(resultados303) {
  const acum = {
    rep_total:   0,
    sop_total:   0,
    tipo21:      0,
    tipo10:      0,
    tipo4:       0,
    base_exenta: 0,
    isp_base:    0,
  };

  resultados303.forEach(r => {
    if (!r) return;
    acum.rep_total   += r.repercutido?.total   ?? 0;
    acum.sop_total   += r.soportado?.total     ?? 0;
    acum.tipo21      += r.repercutido?.tipo21  ?? 0;
    acum.tipo10      += r.repercutido?.tipo10  ?? 0;
    acum.tipo4       += r.repercutido?.tipo4   ?? 0;
    acum.base_exenta += r.base_exenta          ?? 0;
    acum.isp_base    += r.isp?.base            ?? 0;
  });

  const resultado_anual = acum.rep_total - acum.sop_total;

  return {
    rep_total:    _round(acum.rep_total),
    sop_total:    _round(acum.sop_total),
    tipo21:       _round(acum.tipo21),
    tipo10:       _round(acum.tipo10),
    tipo4:        _round(acum.tipo4),
    base_exenta:  _round(acum.base_exenta),
    isp_base:     _round(acum.isp_base),
    resultado:    _round(resultado_anual),
    trimestres:   resultados303.map((r, i) => ({
      trim:       TRIM_ORDEN[i],
      resultado:  _round(r?.resultado_final ?? 0),
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════
   VALIDACIONES
══════════════════════════════════════════════════════════════════ */

/**
 * Valida la coherencia del Modelo 303 y devuelve avisos.
 * 
 * @param {import('./tax-types.js').Resultado303} r
 * @param {string} trim  - "T1"|"T2"|"T3"|"T4"
 * @returns {string[]}  - Array de mensajes de aviso (vacío si todo OK)
 */
export function validateModelo303(r, trim) {
  const avisos = [];

  // Aviso: resultado negativo fuera de T4 → solo se puede compensar, no devolver
  if (r.resultado_final < 0 && trim !== "T4") {
    avisos.push(`Resultado negativo (${r.resultado_final}€): se compensará en el siguiente trimestre. La devolución solo es posible en T4 (art. 115 LIVA).`);
  }

  // Aviso: ISP emitida sin ISP reflejada en soportado (podría ser error)
  if (r.isp.cuota > 0 && r.soportado.interior === 0) {
    avisos.push("Has declarado ISP pero sin IVA soportado interior. Revisa si el receptor tiene derecho a deducir la cuota autoliquidada.");
  }

  // Aviso: IVA soportado > IVA repercutido sin operaciones exentas (inusual)
  if (r.soportado.total > r.repercutido.total && r.base_exenta === 0) {
    avisos.push("El IVA soportado supera al repercutido sin operaciones exentas. Verifica que todas las facturas emitidas están registradas correctamente.");
  }

  return avisos;
}

/* ══════════════════════════════════════════════════════════════════
   UTILIDADES INTERNAS
══════════════════════════════════════════════════════════════════ */

/** Redondea a N decimales (default 2) */
function _round(n, dec = 2) {
  const factor = Math.pow(10, dec);
  return Math.round((n || 0) * factor) / factor;
}

/** Redondea todos los valores numéricos de un objeto */
function _roundObj(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, typeof v === "number" ? _round(v) : v])
  );
}
