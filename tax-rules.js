/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-rules.js
   Constantes legales y tablas fiscales 2024-2025
   
   REGLA: Este archivo es la única fuente de verdad para valores legales.
   Cuando cambie la ley (cada enero), solo se toca este archivo.
   El resto del engine lee de aquí. Nunca hardcodear valores fiscales
   en otro módulo.
   ═══════════════════════════════════════════════════════════════════ */

/* ── EJERCICIO ACTIVO ── */
export const AÑO_ACTIVO = 2025;

/* ══════════════════════════════════════════════════════
   IVA — Ley 37/1992 (LIVA)
══════════════════════════════════════════════════════ */

/** Tipos de IVA vigentes (art. 90-91 LIVA) */
export const TIPOS_IVA = {
  GENERAL:   21,
  REDUCIDO:  10,
  SUPERREDUCIDO: 4,
  EXENTO:    0,
};

/** Tipos válidos para validación de facturas */
export const TIPOS_IVA_VALIDOS = [0, 4, 10, 21];

/** Umbral operaciones con terceros — Modelo 347 (art. 33 RD 1065/2007) */
export const UMBRAL_347 = 3005.06;

/** Umbral retenciones — Modelo 190 (RIRPF art. 75.3.b) */
export const UMBRAL_RETENCIONES_EXENTAS = 3.18; // €/día en especie

/**
 * Plazos de presentación de modelos trimestrales.
 * Fuente: AEAT — calendario fiscal 2025
 */
export const PLAZOS_TRIMESTRALES = {
  T1: { texto: "20 de abril",   limite: "-04-20" },
  T2: { texto: "20 de julio",   limite: "-07-20" },
  T3: { texto: "20 de octubre", limite: "-10-20" },
  T4: { texto: "30 de enero",   limite: "-01-30" }, // año siguiente
};

/** Plazo modelo 347 (declaración anual) */
export const PLAZO_347 = "Febrero del año siguiente";
/** Plazo modelo 390 (resumen anual IVA) */
export const PLAZO_390 = "30 de enero del año siguiente";
/** Plazo modelo 190 (resumen anual retenciones) */
export const PLAZO_190 = "31 de enero del año siguiente";

/* ══════════════════════════════════════════════════════
   IRPF — Ley 35/2006 (LIRPF) + RD 439/2007 (RIRPF)
══════════════════════════════════════════════════════ */

/**
 * Porcentaje de pago fraccionado Modelo 130.
 * Art. 110.1 LIRPF: 20% sobre rendimiento neto acumulado.
 */
export const PCT_PAGO_FRACCIONADO_130 = 0.20;

/**
 * Porcentaje de retención estándar para profesionales.
 * Art. 101.5 LIRPF: 15% general.
 */
export const PCT_RETENCION_PROFESIONAL = 0.15;

/**
 * Retención reducida primer/segundo/tercer año de actividad.
 * Art. 95.1.b) RIRPF: 7% durante año inicio y 2 siguientes.
 */
export const PCT_RETENCION_REDUCIDA = 0.07;

/**
 * Tramos IRPF 2024 — escala estatal + autonómica media (art. 63 LIRPF).
 * Nota: la escala autonómica varía por CCAA. Aquí se usa la media orientativa.
 * Para cálculo exacto del Modelo 100 se requeriría la escala de la CCAA del usuario.
 */
export const TRAMOS_IRPF_2024 = [
  { desde: 0,      hasta: 12450,    tipo: 0.19 },
  { desde: 12450,  hasta: 20200,    tipo: 0.24 },
  { desde: 20200,  hasta: 35200,    tipo: 0.30 },
  { desde: 35200,  hasta: 60000,    tipo: 0.37 },
  { desde: 60000,  hasta: 300000,   tipo: 0.45 },
  { desde: 300000, hasta: Infinity, tipo: 0.47 },
];

/**
 * Mínimo personal y familiar (art. 57-61 LIRPF).
 */
export const MINIMOS_PERSONALES = {
  CONTRIBUYENTE: 5550,
  HIJO_1:        2400,
  HIJO_2:        2700,  // adicional sobre hijo_1
  HIJO_3:        4000,  // adicional sobre hijo_2
  HIJO_4_MAS:    4500,  // adicional por cada hijo a partir del 4º
  DISCAPACIDAD_33_65: 3000,
  DISCAPACIDAD_65_MAS: 9000,
  MAYORES_65:    918,
  MAYORES_75:    1122,  // adicional sobre mayores_65
};

/**
 * Reducción por obtención de rendimientos de actividades económicas (art. 32.2 LIRPF).
 * Vigente desde 2023 — importes actualizados.
 */
export const REDUCCION_ACTIVIDAD_ECONOMICA = {
  HASTA:      14047.5,   // rendimiento neto ≤ este importe → reducción máxima
  DESDE:      19747.5,   // rendimiento neto ≥ este importe → reducción mínima (1.000€)
  MAX:        3500,       // reducción máxima adicional (se suma a base de 2.000€)
  BASE:       2000,       // reducción base siempre aplicable
  MIN:        1000,       // reducción mínima cuando renta entre HASTA y DESDE
};

/**
 * Reducción por trabajo (art. 20 LIRPF) — referencia para empleados.
 * No aplica directamente a autónomos pero útil para comparativas.
 */
export const REDUCCION_TRABAJO = {
  hasta_13115: 5565,
  tramo_medio_base: 13115,
  tramo_medio_factor: 1.5,
  desde_16825: 1000,
};

/**
 * Aportación máxima anual a plan de pensiones deducible (art. 51 LIRPF).
 * Reducción en base imponible general, no deducción en cuota.
 */
export const LIMITE_PLAN_PENSIONES = 1500; // €/año (desde 2022)

/* ══════════════════════════════════════════════════════
   SEGURIDAD SOCIAL — Autónomos (RETA)
   Sistema de cotización por ingresos reales (desde 2023)
══════════════════════════════════════════════════════ */

/**
 * Bases y cuotas RETA 2025 por tramo de rendimientos netos.
 * RD 504/2022 y sucesivas actualizaciones.
 * Rendimiento neto = ingresos - gastos deducibles - 7% gastos difícil justificación.
 */
export const TRAMOS_RETA_2025 = [
  { desde: 0,      hasta: 670,    cuotaMes: 200.00, baseMin: 653.59,  baseMax: 718.95  },
  { desde: 670,    hasta: 900,    cuotaMes: 220.00, baseMin: 718.95,  baseMax: 900.00  },
  { desde: 900,    hasta: 1166.7, cuotaMes: 260.50, baseMin: 849.67,  baseMax: 1166.70 },
  { desde: 1166.7, hasta: 1300,   cuotaMes: 272.56, baseMin: 950.98,  baseMax: 1300.00 },
  { desde: 1300,   hasta: 1500,   cuotaMes: 294.31, baseMin: 960.78,  baseMax: 1500.00 },
  { desde: 1500,   hasta: 1700,   cuotaMes: 310.33, baseMin: 960.78,  baseMax: 1700.00 },
  { desde: 1700,   hasta: 1850,   cuotaMes: 324.17, baseMin: 1143.79, baseMax: 1850.00 },
  { desde: 1850,   hasta: 2030,   cuotaMes: 337.25, baseMin: 1209.86, baseMax: 2030.00 },
  { desde: 2030,   hasta: 2330,   cuotaMes: 362.97, baseMin: 1274.97, baseMax: 2330.00 },
  { desde: 2330,   hasta: 2760,   cuotaMes: 383.56, baseMin: 1395.89, baseMax: 2760.00 },
  { desde: 2760,   hasta: 3190,   cuotaMes: 415.77, baseMin: 1549.75, baseMax: 3190.00 },
  { desde: 3190,   hasta: Infinity, cuotaMes: 530.98, baseMin: 1732.03, baseMax: 4720.50 },
];

/** Tipo de cotización RETA para contingencias comunes + cese + formación */
export const TIPO_COTIZACION_RETA = 0.3080; // 30,80% sobre base elegida

/** Reducción cuota RETA para nuevos autónomos (Tarifa Plana 2023) */
export const TARIFA_PLANA_RETA = {
  importe: 80,    // €/mes primer año
  duracion_meses: 12,
  importe_segundo: null, // desde 2023 no hay segundo año reducido automático
};

/* ══════════════════════════════════════════════════════
   AMORTIZACIONES — RD 634/2015 (Reglamento IS)
   Aplicable por remisión en estimación directa (LIRPF art. 28)
══════════════════════════════════════════════════════ */

/**
 * Tabla de amortización oficial (Anexo RD 634/2015).
 * coefMax: coeficiente lineal máximo (%)
 * periodoMax: periodo máximo de amortización (años)
 */
export const TABLAS_AMORTIZACION = {
  "Equipos informáticos":          { coefMax: 26, periodoMax: 10,  descripcion: "Ordenadores, servidores, tablets" },
  "Aplicaciones informáticas":     { coefMax: 33, periodoMax: 6,   descripcion: "Software, licencias, desarrollo" },
  "Maquinaria":                    { coefMax: 12, periodoMax: 18,  descripcion: "Maquinaria en general" },
  "Elementos de transporte":       { coefMax: 16, periodoMax: 14,  descripcion: "Vehículos, furgonetas" },
  "Mobiliario":                    { coefMax: 10, periodoMax: 20,  descripcion: "Muebles de oficina" },
  "Instalaciones":                 { coefMax: 10, periodoMax: 20,  descripcion: "Instalaciones en local" },
  "Edificios y construcciones":    { coefMax: 3,  periodoMax: 68,  descripcion: "Inmuebles en propiedad" },
  "Herramientas":                  { coefMax: 25, periodoMax: 8,   descripcion: "Útiles y herramientas" },
  "Activos eficiencia energética": { coefMax: 30, periodoMax: 8,   descripcion: "Paneles solares, climatización eficiente" },
  "Fondos de comercio":            { coefMax: 5,  periodoMax: 20,  descripcion: "Fondo de comercio adquirido" },
  "Ganado vacuno, porcino, ovino": { coefMax: 22, periodoMax: 8,   descripcion: "Ganado de explotación" },
  "Patentes y marcas":             { coefMax: 33, periodoMax: 6,   descripcion: "Propiedad industrial" },
};

/**
 * Libertad de amortización para activos nuevos < 300€ (art. 12.3 LIS).
 * Límite anual: 25.000€.
 */
export const LIBERTAD_AMORTIZACION_PEQUEÑOS = {
  limite_unitario: 300,
  limite_anual: 25000,
};

/* ══════════════════════════════════════════════════════
   GASTOS DEDUCIBLES — Guía AEAT 2024
   Fuente: LIRPF art. 28-30, DGT consultas vinculantes
══════════════════════════════════════════════════════ */

/**
 * Catálogo de gastos deducibles con porcentaje y referencia legal.
 * riesgo: 'bajo' | 'medio' | 'alto' — probabilidad de regularización AEAT
 */
export const GASTOS_DEDUCIBLES = {
  "cuota_reta": {
    label: "Cuota RETA (Seguridad Social autónomos)",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 30.2.1ª LIRPF",
    nota: "Deducible en su totalidad. Sin límite.",
  },
  "seguro_rc": {
    label: "Seguro de responsabilidad civil profesional",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 28.1 LIRPF",
    nota: "Solo si la cobertura es exclusivamente profesional.",
  },
  "seguro_salud": {
    label: "Seguro de salud (autónomo + cónyuge + hijos)",
    pct: 100,
    limite: 500, // €/persona/año; 1.500€ si discapacidad
    riesgo: "bajo",
    norma: "Art. 30.2.5ª LIRPF",
    nota: "Límite 500€/persona (1.500€ si discapacidad). No incluye otros seguros de vida.",
  },
  "alquiler_oficina": {
    label: "Alquiler de oficina / local de negocio",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 29 LIRPF",
    nota: "Solo si el local se dedica exclusivamente a la actividad.",
  },
  "suministros_vivienda": {
    label: "Suministros vivienda con despacho afecto",
    pct: null, // variable: 30% × % vivienda afecta
    limite: "30% rendimientos netos",
    riesgo: "medio",
    norma: "Art. 30.2.5ª LIRPF / DGT V2369-15",
    nota: "30% × (m² despacho / m² vivienda). Máximo 30% del rendimiento neto. Requiere afectación formal.",
  },
  "material_oficina": {
    label: "Material de oficina y papelería",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 28.1 LIRPF",
    nota: "Necesario para la actividad. Conservar facturas.",
  },
  "servicios_profesionales": {
    label: "Servicios profesionales (gestor, abogado, etc.)",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 28.1 LIRPF",
    nota: "Incluye honorarios de asesoría fiscal y legal directamente relacionados con la actividad.",
  },
  "formacion": {
    label: "Formación y cursos profesionales",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 28.1 LIRPF",
    nota: "Debe estar relacionada con el epígrafe IAE de la actividad declarada.",
  },
  "publicidad_marketing": {
    label: "Publicidad y marketing",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 28.1 LIRPF",
    nota: "Anuncios, diseño gráfico, SEO, redes sociales, etc.",
  },
  "software_suscripciones": {
    label: "Software y suscripciones digitales",
    pct: 100,
    limite: null,
    riesgo: "bajo",
    norma: "Art. 28.1 LIRPF",
    nota: "SaaS, licencias, hosting, dominios. Uso exclusivamente profesional.",
  },
  "telefono_internet": {
    label: "Teléfono e internet (uso mixto)",
    pct: 50,  // AEAT acepta 50% como criterio orientativo para uso mixto
    limite: null,
    riesgo: "medio",
    norma: "Art. 28.1 LIRPF / DGT V0293-18",
    nota: "Sin línea exclusiva: AEAT suele aceptar 50% sin conflicto. Con línea dedicada: 100%.",
  },
  "dietas_desplazamiento": {
    label: "Dietas en desplazamiento por actividad",
    pct: 100,
    limite: null,  // límites específicos por día/pernoctación
    riesgo: "medio",
    norma: "Art. 9 RIRPF (por analogía en autónomos)",
    nota: "España sin pernocta: 26,67€/día. España con pernocta: 53,34€/día. Extranjero: 48,08€/91,35€.",
    limites_dietas: {
      españa_sin_pernocta: 26.67,
      españa_con_pernocta: 53.34,
      extranjero_sin_pernocta: 48.08,
      extranjero_con_pernocta: 91.35,
    },
  },
  "vehiculo": {
    label: "Vehículo (afectación exclusiva actividad)",
    pct: 100,
    limite: null,
    riesgo: "alto",
    norma: "Art. 29 LIRPF / TEAC Resolución 2014",
    nota: "⚠️ Solo deducible con afectación EXCLUSIVA a la actividad. AEAT regulariza habitualmente el uso mixto. Riesgo alto.",
  },
  "combustible": {
    label: "Combustible (vehículo exclusivo profesional)",
    pct: 100,
    limite: null,
    riesgo: "alto",
    norma: "Art. 29 LIRPF",
    nota: "⚠️ Solo si el vehículo está afecto exclusivamente. Mismo riesgo que la deducción del vehículo.",
  },
  "restaurante_cliente": {
    label: "Restaurante / comida con cliente (atención a clientes)",
    pct: 100,
    limite: null,
    riesgo: "medio",
    norma: "Art. 28.1 LIRPF / DGT V2099-14",
    nota: "Requiere justificación de la relación comercial. Conservar: factura completa (no ticket), asistentes, empresa.",
  },
  "plan_pensiones": {
    label: "Aportación a plan de pensiones",
    pct: 100,
    limite: 1500,
    riesgo: "bajo",
    norma: "Art. 51 LIRPF",
    nota: "Reducción en base imponible general (no es deducción en cuota). Límite: 1.500€/año desde 2022.",
  },
};

/* ══════════════════════════════════════════════════════
   TIPOS DE OPERACIÓN — Vocabulario interno Taurix
   Alineado con los valores ya en uso en facturas.js
══════════════════════════════════════════════════════ */

export const TIPOS_OPERACION = {
  NACIONAL:                 "nacional",
  INTRACOMUNITARIA:         "intracomunitaria",
  EXPORTACION:              "exportacion",
  IMPORTACION:              "importacion",
  INVERSION_SUJETO_PASIVO:  "inversion_sujeto_pasivo",
  EXENTO:                   "exento",
};

/** Tipos de operación que no aplican IVA al total de la factura */
export const OP_SIN_IVA = [
  "intracomunitaria",
  "exportacion",
  "inversion_sujeto_pasivo",
  "exento",
];

/** Tipos donde el receptor autoliquida el IVA (art. 84 LIVA) */
export const OP_AUTOLIQUIDACION = [
  "inversion_sujeto_pasivo",
  "intracomunitaria",
];

/* ══════════════════════════════════════════════════════
   MODELOS FISCALES — Referencia de casillas clave
   Modelo 303 (AEAT versión 2024)
══════════════════════════════════════════════════════ */

export const CASILLAS_303 = {
  // Devengado
  BASE_21:        1,
  CUOTA_21:       3,
  BASE_10:        5,
  CUOTA_10:       7,
  BASE_4:         9,
  CUOTA_4:        11,
  // ISP
  BASE_ISP:       12,
  CUOTA_ISP:      13,
  // Adq. intracomunitarias
  BASE_AIC:       36,
  CUOTA_AIC:      37,
  // Importaciones
  BASE_IMP:       38,
  CUOTA_IMP:      39,
  // Total devengado
  TOTAL_DEVENGADO: 27,
  // Deducible
  BASE_DEDUCIBLE_INT: 28,
  CUOTA_DEDUCIBLE_INT: 29, // no, es 28 base y 29 cuota según versión
  // Cuota deducible total
  TOTAL_DEDUCIBLE:  40,
  // Resultado
  RESULTADO:       64,
  // Compensaciones
  COMP_ANTERIORES: 78,
  // Resultado final a ingresar
  RESULTADO_FINAL: 86,
};

/* ══════════════════════════════════════════════════════
   PERIODOS — Constantes de trimestres y fechas
   (espejo de TRIM_* en utils.js para que el engine
    funcione sin importar el DOM)
══════════════════════════════════════════════════════ */

export const TRIM_RANGOS = {
  T1: ["01-01", "03-31"],
  T2: ["04-01", "06-30"],
  T3: ["07-01", "09-30"],
  T4: ["10-01", "12-31"],
};

export const TRIM_LABELS = {
  T1: "Enero – Marzo",
  T2: "Abril – Junio",
  T3: "Julio – Septiembre",
  T4: "Octubre – Diciembre",
};

export const TRIM_ORDEN = ["T1", "T2", "T3", "T4"];

/** Devuelve los trimestres anteriores al dado (sin incluirlo) */
export function trimAnteriores(trim) {
  const idx = TRIM_ORDEN.indexOf(trim);
  return TRIM_ORDEN.slice(0, idx);
}

/** Devuelve el rango de fechas ISO para un año y trimestre */
export function getFechaRangoTrim(year, trim) {
  const [ini, fin] = TRIM_RANGOS[trim];
  return { ini: `${year}-${ini}`, fin: `${year}-${fin}` };
}

/** Devuelve el rango de fechas ISO para un año completo */
export function getFechaRangoAnual(year) {
  return { ini: `${year}-01-01`, fin: `${year}-12-31` };
}
