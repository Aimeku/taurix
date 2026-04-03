/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-alerts.js
   Motor de alertas fiscales inteligente

   RESPONSABILIDADES:
   1. Generar alertas accionables a partir de los resultados del engine
   2. Detectar plazos próximos (Modelo 303, 130, 347, 390, 190...)
   3. Alertar sobre situaciones de riesgo fiscal (prorrata, 347, ISP...)
   4. Detectar anomalías en la facturación (sin IRPF, IVA incorrecto...)
   5. Recordatorios de reserva fiscal y planificación

   REGLA:
   - Solo funciones puras. Reciben datos calculados, devuelven TaxAlert[].
   - El ÚNICO efecto secundario permitido es en tax-data.js (persistirAlertas).
   - El engine llama a estas funciones; la UI las consume.
   - NO duplica lógica del alertas.js existente — lo complementa.
     alertas.js gestiona la UI y deadlines de calendario.
     tax-alerts.js genera alertas basadas en DATOS REALES calculados.
   ═══════════════════════════════════════════════════════════════════ */

import {
  UMBRAL_347,
  PLAZOS_TRIMESTRALES,
  TRIM_ORDEN,
  PCT_RETENCION_PROFESIONAL,
  PCT_RETENCION_REDUCIDA,
} from "./tax-rules.js";

/* ══════════════════════════════════════════════════════════════════
   ENTRY POINT PRINCIPAL
   Genera todas las alertas para un periodo dado.
   Llama a las funciones especializadas y consolida.
══════════════════════════════════════════════════════════════════ */

/**
 * Genera el conjunto completo de alertas fiscales para un trimestre.
 * Devuelve un array ordenado por severidad (crítica → alta → media → baja).
 *
 * @param {Object} params
 * @param {import('./tax-types.js').Resultado303}    params.r303
 * @param {import('./tax-types.js').Resultado130}    params.r130
 * @param {import('./tax-types.js').ProyeccionAnual} params.proyeccion
 * @param {import('./tax-types.js').PerfilFiscal}    params.perfil
 * @param {import('./tax-types.js').TaxDocument[]}   params.docs       - Docs del año completo (para 347)
 * @param {Object[]}  params.acumulado347                              - Output de calcAcumulado347()
 * @param {Object[]}  params.proximosUmbral347                         - Output de detectarProximosUmbral347()
 * @param {string}    params.trim
 * @param {number}    params.year
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function generarAlertas(params) {
  const {
    r303,
    r130,
    proyeccion,
    perfil,
    docs = [],
    acumulado347 = [],
    proximosUmbral347 = [],
    trim,
    year,
  } = params;

  const alertas = [
    ...alertasPlazos(trim, year, r303, r130),
    ...alertasIVA(r303, trim),
    ...alertasIRPF(r130, proyeccion, perfil),
    ...alertas347(acumulado347, proximosUmbral347, trim),
    ...alertasRetenciones(docs, perfil),
    ...alertasFacturacion(docs, trim),
    ...alertasReservaFiscal(r130, proyeccion),
  ];

  // Deduplicar por tipo (puede haber colisiones si se llama varias veces)
  const deduplicadas = _deduplicar(alertas);

  // Ordenar: crítica → alta → media → baja
  const ORDEN = { critica: 0, alta: 1, media: 2, baja: 3 };
  return deduplicadas.sort((a, b) => (ORDEN[a.severidad] ?? 3) - (ORDEN[b.severidad] ?? 3));
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS DE PLAZOS
   Genera alertas cuando un plazo de presentación está próximo.
   No duplica el calendario de alertas.js — aquí trabajamos con
   el resultado real calculado para dar el importe exacto.
══════════════════════════════════════════════════════════════════ */

/**
 * @param {string} trim
 * @param {number} year
 * @param {import('./tax-types.js').Resultado303} r303
 * @param {import('./tax-types.js').Resultado130} r130
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasPlazos(trim, year, r303, r130) {
  const alertas = [];
  const hoy     = new Date();

  // Calcular fecha límite real del trimestre
  const plazoObj = PLAZOS_TRIMESTRALES[trim];
  if (!plazoObj) return alertas;

  // T4 presenta en enero del año siguiente
  const yearPlazo = trim === "T4" ? year + 1 : year;
  const fechaStr  = `${yearPlazo}${plazoObj.limite}`;
  const fechaPlazo = new Date(fechaStr + "T23:59:59");
  const diasRestantes = Math.ceil((fechaPlazo - hoy) / 86400000);

  if (diasRestantes < 0 || diasRestantes > 45) return alertas; // Fuera de ventana de aviso

  const urgente = diasRestantes <= 7;
  const sev     = urgente ? "critica" : diasRestantes <= 20 ? "alta" : "media";

  // Alerta Modelo 303
  if (r303) {
    const importeStr = r303.resultado_final > 0
      ? `${_fmt(r303.resultado_final)} a ingresar`
      : r303.resultado_final < 0
        ? `${_fmt(Math.abs(r303.resultado_final))} a ${trim === "T4" ? "devolver" : "compensar"}`
        : "resultado cero";

    alertas.push({
      id:         `plazo_303_${year}_${trim}`,
      tipo:       "plazo",
      severidad:  sev,
      modelo:     "303",
      mensaje:    diasRestantes === 0
        ? `⚠️ Hoy vence el Modelo 303 (IVA ${trim}). ${importeStr}.`
        : `Modelo 303 — IVA ${trim}: vence en ${diasRestantes} día${diasRestantes !== 1 ? "s" : ""} (${plazoObj.texto}). ${importeStr}.`,
      norma:      "Art. 167 LIVA",
      accion:     "Ver Modelo 303",
      accion_url: "#fiscal-303",
      resuelta:   false,
    });
  }

  // Alerta Modelo 130
  if (r130) {
    const importeStr130 = r130.resultado > 0
      ? `${_fmt(r130.resultado)} a ingresar`
      : "resultado cero (no hay pago)";

    alertas.push({
      id:         `plazo_130_${year}_${trim}`,
      tipo:       "plazo",
      severidad:  sev,
      modelo:     "130",
      mensaje:    diasRestantes === 0
        ? `⚠️ Hoy vence el Modelo 130 (IRPF ${trim}). ${importeStr130}.`
        : `Modelo 130 — IRPF ${trim}: vence en ${diasRestantes} día${diasRestantes !== 1 ? "s" : ""} (${plazoObj.texto}). ${importeStr130}.`,
      norma:      "Art. 110 LIRPF",
      accion:     "Ver Modelo 130",
      accion_url: "#fiscal-130",
      resuelta:   false,
    });
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS IVA (Modelo 303)
══════════════════════════════════════════════════════════════════ */

/**
 * @param {import('./tax-types.js').Resultado303} r303
 * @param {string} trim
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasIVA(r303, trim) {
  if (!r303) return [];
  const alertas = [];

  // Prorrata detectada
  if (r303.base_exenta > 0 && r303.soportado.total > 0) {
    const pct = r303.por_operacion?.nacional > 0
      ? Math.ceil(r303.por_operacion.nacional / (r303.por_operacion.nacional + r303.base_exenta) * 100)
      : 0;
    alertas.push({
      id:        `prorrata_${trim}`,
      tipo:      "prorrata",
      severidad: "alta",
      modelo:    "303",
      mensaje:   `Prorrata de IVA detectada: tienes ${_fmt(r303.base_exenta)} en operaciones exentas. Porcentaje deducción estimado: ${pct}%. Regularización anual obligatoria en T4 (art. 104-106 LIVA). El IVA soportado ya deducido puede necesitar ajuste.`,
      norma:     "Art. 102-106 LIVA",
      accion:    "Ver detalle IVA",
      accion_url: "#fiscal-303",
      resuelta:  false,
    });
  }

  // Resultado negativo fuera de T4 (solo compensable, no devolvible)
  if (r303.resultado_final < 0 && trim !== "T4") {
    alertas.push({
      id:        `iva_negativo_${trim}`,
      tipo:      "info",
      severidad: "media",
      modelo:    "303",
      mensaje:   `IVA negativo de ${_fmt(Math.abs(r303.resultado_final))}: se compensará en el próximo trimestre. La devolución en efectivo solo es posible en T4 (art. 115 LIVA), salvo inscripción en el Registro de Devolución Mensual (ROM).`,
      norma:     "Art. 115 LIVA",
      accion:    "Ver Modelo 303",
      accion_url: "#fiscal-303",
      resuelta:  false,
    });
  }

  // ISP declarada
  if (r303.isp?.cuota > 0) {
    alertas.push({
      id:        `isp_${trim}`,
      tipo:      "isp",
      severidad: "media",
      modelo:    "303",
      mensaje:   `Inversión del sujeto pasivo (ISP): ${_fmt(r303.isp.cuota)} declarados. Verifica que el IVA devengado (casilla 12-13) y el deducible (casilla 40) están correctamente reflejados en el Modelo 303. El efecto neto debe ser cero si la actividad es 100% deducible.`,
      norma:     "Art. 84 LIVA",
      accion:    "Ver Modelo 303",
      accion_url: "#fiscal-303",
      resuelta:  false,
    });
  }

  // IVA soportado excesivamente alto respecto al repercutido sin exentas (posible error)
  if (
    r303.soportado.total > r303.repercutido.total * 2 &&
    r303.base_exenta === 0 &&
    r303.repercutido.total > 0
  ) {
    alertas.push({
      id:        `iva_soportado_alto_${trim}`,
      tipo:      "info",
      severidad: "baja",
      modelo:    "303",
      mensaje:   `El IVA soportado (${_fmt(r303.soportado.total)}) dobla al repercutido (${_fmt(r303.repercutido.total)}) sin operaciones exentas. Comprueba que no hay facturas recibidas duplicadas o mal clasificadas.`,
      norma:     null,
      accion:    "Ver facturas recibidas",
      accion_url: "#facturas",
      resuelta:  false,
    });
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS IRPF (Modelo 130)
══════════════════════════════════════════════════════════════════ */

/**
 * @param {import('./tax-types.js').Resultado130} r130
 * @param {import('./tax-types.js').ProyeccionAnual} proyeccion
 * @param {import('./tax-types.js').PerfilFiscal} perfil
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasIRPF(r130, proyeccion, perfil) {
  if (!r130) return [];
  const alertas = [];

  // Tipo efectivo proyectado alto (> 35%) — riesgo de sorpresa en Renta
  if (proyeccion?.tipo_efectivo > 35) {
    alertas.push({
      id:        "renta_alta",
      tipo:      "renta_alta",
      severidad: "alta",
      modelo:    "130",
      mensaje:   `Tipo efectivo proyectado: ${proyeccion.tipo_efectivo}%. La cuota estimada de la Renta es ${_fmt(proyeccion.cuota_renta_estimada)}. Se recomienda reservar ${_fmt(proyeccion.reserva_mensual)}/mes. Considera aportaciones a plan de pensiones para reducir la base imponible (art. 51 LIRPF, límite 1.500€/año).`,
      norma:     "Art. 51 LIRPF",
      accion:    "Ver proyección anual",
      accion_url: "#fiscal-130",
      resuelta:  false,
    });
  }

  // Retenciones bajas respecto al tipo esperado
  const tipoEfectRetenciones = r130.ingresos_total > 0
    ? (r130.retenciones_acum / r130.ingresos_total) * 100
    : 0;

  // Si el tipo de retención medio está por debajo del mínimo esperado (7%)
  if (
    r130.ingresos_total > 5000 &&
    tipoEfectRetenciones < (PCT_RETENCION_REDUCIDA * 100 * 0.9) // < 6.3% (10% de margen sobre el 7%)
  ) {
    alertas.push({
      id:        "retenciones_bajas",
      tipo:      "retenciones_bajas",
      severidad: "media",
      modelo:    "130",
      mensaje:   `Tipo de retención medio de tus facturas: ${_round(tipoEfectRetenciones, 1)}%. Si emites facturas sin IRPF (operaciones con particulares, exportaciones, etc.) es correcto. Si facturas a empresas, revisa que aplicas la retención del ${perfil?.fecha_alta ? PCT_RETENCION_REDUCIDA * 100 + "%" : PCT_RETENCION_PROFESIONAL * 100 + "%"} en todos los casos que corresponde.`,
      norma:     "Art. 101 LIRPF / Art. 95 RIRPF",
      accion:    "Ver facturas emitidas",
      accion_url: "#facturas",
      resuelta:  false,
    });
  }

  // Primer año de actividad — retención reducida disponible
  if (perfil?.fecha_alta) {
    const añoAlta = new Date(perfil.fecha_alta).getFullYear();
    const añoActual = r130.year;
    if (añoActual <= añoAlta + 2 && añoActual >= añoAlta) {
      alertas.push({
        id:        "primer_año",
        tipo:      "primer_año",
        severidad: "baja",
        modelo:    "130",
        mensaje:   `Retención reducida disponible: estás en el año ${añoActual - añoAlta + 1} de actividad (alta: ${perfil.fecha_alta}). Puedes aplicar el 7% en lugar del 15% hasta fin de ${añoAlta + 2} (art. 95.1.b RIRPF). Comunícalo a tus clientes.`,
        norma:     "Art. 95.1.b) RIRPF",
        accion:    "Ver perfil fiscal",
        accion_url: "#perfil",
        resuelta:  false,
      });
    }
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS MODELO 347
══════════════════════════════════════════════════════════════════ */

/**
 * @param {Object[]} acumulado347   - Output de calcAcumulado347()
 * @param {Object[]} proximosUmbral - Output de detectarProximosUmbral347()
 * @param {string}   trim
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertas347(acumulado347, proximosUmbral347, trim) {
  const alertas = [];

  // Operaciones que YA superan el umbral
  if (acumulado347.length > 0) {
    const nombres = acumulado347.slice(0, 3).map(r => r.nombre).join(", ");
    const total   = acumulado347.reduce((s, r) => s + r.total_operaciones, 0);
    alertas.push({
      id:        "umbral_347",
      tipo:      "umbral_347",
      severidad: trim === "T4" ? "alta" : "media",
      modelo:    "347",
      mensaje:   `${acumulado347.length} cliente${acumulado347.length > 1 ? "s/proveedores" : ""} superan el umbral de declaración 347 (${_fmt(UMBRAL_347)}): ${nombres}${acumulado347.length > 3 ? "…" : ""}. Total acumulado: ${_fmt(total)}. El Modelo 347 debe presentarse en febrero del año siguiente.`,
      norma:     "Art. 33 RD 1065/2007",
      accion:    "Ver operaciones 347",
      accion_url: "#fiscal-347",
      resuelta:  false,
    });
  }

  // Operaciones próximas al umbral
  if (proximosUmbral347.length > 0) {
    proximosUmbral347.forEach(r => {
      alertas.push({
        id:        `umbral_347_proximo_${r.nif || r.nombre}`,
        tipo:      "umbral_347",
        severidad: "baja",
        modelo:    "347",
        mensaje:   `${r.nombre} acumula ${_fmt(r.total)} (${r.pct_umbral}% del umbral 347). Si supera los ${_fmt(UMBRAL_347)} antes de fin de año, deberás declararlo en el Modelo 347.`,
        norma:     "Art. 33 RD 1065/2007",
        accion:    null,
        accion_url: null,
        resuelta:  false,
      });
    });
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS DE RETENCIONES
   Analiza el conjunto de facturas emitidas para detectar
   facturas sin retención cuando debería haberla.
══════════════════════════════════════════════════════════════════ */

/**
 * @param {import('./tax-types.js').TaxDocument[]} docs
 * @param {import('./tax-types.js').PerfilFiscal}  perfil
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasRetenciones(docs, perfil) {
  const alertas = [];

  const emitidas = docs.filter(d =>
    d.tipo === "emitida" &&
    d.estado !== "anulada" &&
    d.estado !== "borrador"
  );

  // Facturas emitidas a empresas nacionales sin retención
  // Criterio: operación nacional + IVA > 0 (no exenta) + irpf_pct === 0
  const sinRetencion = emitidas.filter(d =>
    d.tipo_operacion === "nacional" &&
    d.iva_pct > 0 &&      // tiene IVA → es B2B sujeto
    (d.irpf_pct ?? 0) === 0
  );

  if (sinRetencion.length > 0) {
    const totalBase = sinRetencion.reduce((s, d) => s + d.base, 0);
    alertas.push({
      id:        "sin_retencion",
      tipo:      "retenciones_bajas",
      severidad: "media",
      modelo:    "130",
      mensaje:   `${sinRetencion.length} factura${sinRetencion.length > 1 ? "s" : ""} emitida${sinRetencion.length > 1 ? "s" : ""} sin retención IRPF sobre base ${_fmt(totalBase)}. Si son a empresas o profesionales, deberías aplicar el ${PCT_RETENCION_PROFESIONAL * 100}% (o ${PCT_RETENCION_REDUCIDA * 100}% si es primer/segundo/tercer año). Si son a particulares o exportaciones, es correcto.`,
      norma:     "Art. 101.5 LIRPF",
      accion:    "Ver facturas emitidas",
      accion_url: "#facturas",
      resuelta:  false,
    });
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS DE FACTURACIÓN
   Anomalías en la propia facturación del periodo.
══════════════════════════════════════════════════════════════════ */

/**
 * @param {import('./tax-types.js').TaxDocument[]} docs
 * @param {string} trim
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasFacturacion(docs, trim) {
  const alertas = [];

  const emitidas = docs.filter(d =>
    d.tipo === "emitida" && d.estado !== "anulada" && d.estado !== "borrador"
  );

  // Sin facturación en el periodo
  if (emitidas.length === 0) {
    alertas.push({
      id:        `sin_facturacion_${trim}`,
      tipo:      "info",
      severidad: "baja",
      modelo:    null,
      mensaje:   `Sin facturas emitidas en ${trim}. Si no hay actividad, los Modelos 303 y 130 se presentan igualmente con resultado cero. No presentarlos puede acarrear sanción de 200€ por modelo (art. 198 LGT).`,
      norma:     "Art. 198 LGT",
      accion:    "Nueva factura",
      accion_url: "#nueva-factura",
      resuelta:  false,
    });
  }

  // Facturas rectificativas sin la factura original identificada
  const rectificativas = docs.filter(d => d.es_rectificativa === true);
  if (rectificativas.length > 0) {
    alertas.push({
      id:        `rectificativas_${trim}`,
      tipo:      "info",
      severidad: "baja",
      modelo:    "303",
      mensaje:   `${rectificativas.length} factura${rectificativas.length > 1 ? "s" : ""} rectificativa${rectificativas.length > 1 ? "s" : ""} en el periodo. Verifica que la factura original está referenciada y que el ajuste de IVA está correctamente reflejado en el Modelo 303 (art. 89-90 LIVA).`,
      norma:     "Art. 89-90 LIVA",
      accion:    "Ver facturas",
      accion_url: "#facturas",
      resuelta:  false,
    });
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS DE RESERVA FISCAL
   Avisa si la reserva proyectada es insuficiente.
══════════════════════════════════════════════════════════════════ */

/**
 * @param {import('./tax-types.js').Resultado130} r130
 * @param {import('./tax-types.js').ProyeccionAnual} proyeccion
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasReservaFiscal(r130, proyeccion) {
  if (!r130 || !proyeccion) return [];
  const alertas = [];

  // Información de reserva mensual recomendada (siempre que haya ingresos)
  if (proyeccion.reserva_mensual > 0 && r130.ingresos_total > 0) {
    alertas.push({
      id:        "reserva_fiscal",
      tipo:      "info",
      severidad: "baja",
      modelo:    null,
      mensaje:   `Reserva fiscal recomendada: ${_fmt(proyeccion.reserva_mensual)}/mes. Con ${_fmt(r130.ingresos_total)} facturados YTD y una proyección de ${_fmt(proyeccion.ingresos_proyect)} anuales, la cuota estimada de Renta es ${_fmt(proyeccion.cuota_renta_estimada)}. Tipo efectivo estimado: ${proyeccion.tipo_efectivo}%.`,
      norma:     null,
      accion:    null,
      accion_url: null,
      resuelta:  false,
    });
  }

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   GENERACIÓN DE ALERTAS PARA MODELO 349
   Operaciones intracomunitarias declarables.
══════════════════════════════════════════════════════════════════ */

/**
 * Genera alerta si hay operaciones intracomunitarias que obligan al 349.
 * El Modelo 349 es trimestral si las operaciones IC superan 50.000€,
 * mensual si superan 100.000€, anual si son menores.
 *
 * @param {import('./tax-types.js').TaxDocument[]} docs
 * @param {string} trim
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
export function alertasModelo349(docs, trim) {
  const alertas = [];

  const operacionesIC = docs.filter(d =>
    d.tipo_operacion === "intracomunitaria" &&
    d.estado !== "anulada"
  );

  if (operacionesIC.length === 0) return alertas;

  const totalIC = operacionesIC.reduce((s, d) => s + d.base, 0);
  const periocidad = totalIC > 100000 ? "mensual" : totalIC > 50000 ? "trimestral" : "anual";

  alertas.push({
    id:        `modelo_349_${trim}`,
    tipo:      "info",
    severidad: periocidad === "mensual" ? "alta" : periocidad === "trimestral" ? "media" : "baja",
    modelo:    "349",
    mensaje:   `Operaciones intracomunitarias en ${trim}: ${_fmt(totalIC)}. ${
      periocidad === "mensual"
        ? "Obligación de presentación MENSUAL del Modelo 349 (>100.000€ IC)."
        : periocidad === "trimestral"
          ? "Obligación de presentación TRIMESTRAL del Modelo 349 (>50.000€ IC)."
          : "Presentación ANUAL del Modelo 349 (operaciones IC < 50.000€ anuales)."
    } Plazo: 20 del mes siguiente al periodo.`,
    norma:     "Art. 79 LIVA / RD 1624/1992",
    accion:    "Ver operaciones IC",
    accion_url: "#fiscal-349",
    resuelta:  false,
  });

  return alertas;
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS PARA CONSTRUIR CONTEXTO CLAUDE
   Prepara un resumen compacto de alertas para enviar al LLM.
══════════════════════════════════════════════════════════════════ */

/**
 * Serializa las alertas activas en formato compacto para el contexto de Claude.
 * Solo incluye alertas de severidad alta o crítica para no saturar el contexto.
 *
 * @param {import('./tax-types.js').TaxAlert[]} alertas
 * @returns {string}  - Texto estructurado para incluir en el system prompt de Claude
 */
export function serializarAlertasParaClaude(alertas) {
  const importantes = alertas.filter(a =>
    a.severidad === "critica" || a.severidad === "alta"
  );

  if (!importantes.length) return "Sin alertas fiscales urgentes.";

  return importantes.map(a =>
    `[${a.severidad.toUpperCase()}] ${a.modelo ? "Mod." + a.modelo + " — " : ""}${a.mensaje}${a.norma ? " (" + a.norma + ")" : ""}`
  ).join("\n");
}

/* ══════════════════════════════════════════════════════════════════
   UTILIDADES PRIVADAS
══════════════════════════════════════════════════════════════════ */

/**
 * Elimina alertas duplicadas por id.
 * @param {import('./tax-types.js').TaxAlert[]} alertas
 * @returns {import('./tax-types.js').TaxAlert[]}
 */
function _deduplicar(alertas) {
  const vistos = new Set();
  return alertas.filter(a => {
    if (vistos.has(a.id)) return false;
    vistos.add(a.id);
    return true;
  });
}

/** Formatea un número como moneda */
function _fmt(n) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n || 0);
}

/** Redondea a N decimales */
function _round(n, dec = 2) {
  const factor = Math.pow(10, dec);
  return Math.round((n || 0) * factor) / factor;
}
