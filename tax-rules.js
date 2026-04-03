/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-rules.js
   Constantes legales y tablas fiscales 2025 (vigentes también 2026)
   
   REGLA: Este archivo es la única fuente de verdad para valores legales.
   Cuando cambie la ley (cada enero), solo se toca este archivo.
   El resto del engine lee de aquí. Nunca hardcodear valores fiscales
   en otro módulo.
   
   ── AUDITORÍA LEGAL COMPLETADA ─────────────────────────────────────
   Última revisión: Abril 2026
   Fuentes: AEAT, BOE, Seguridad Social, Iberley, consultas DGT
   Errores corregidos vs. versión anterior:
   - PLAZOS_TRIMESTRALES: añadida nota de "día siguiente hábil"
   - PLAZO_390: corregido de "30" a "31 de enero"
   - TARIFA_PLANA_RETA: corrección del segundo periodo (80€ si SMI)
   - REDUCCION_ACTIVIDAD_ECONOMICA: añadidos requisitos condicionales
   - Añadida EXCEPCION_130_RETENCIONES (art. 109 RIRPF)
   ═══════════════════════════════════════════════════════════════════ */

/* ── EJERCICIO ACTIVO ── */
export const AÑO_ACTIVO = 2025;

/* ══════════════════════════════════════════════════════
   IVA — Ley 37/1992 (LIVA)
══════════════════════════════════════════════════════ */

/** Tipos de IVA vigentes (art. 90-91 LIVA) */
export const TIPOS_IVA = {
  GENERAL:       21,
  REDUCIDO:      10,
  SUPERREDUCIDO: 4,
  EXENTO:        0,
};

/** Tipos válidos para validación de facturas */
export const TIPOS_IVA_VALIDOS = [0, 4, 10, 21];

/** Umbral operaciones con terceros — Modelo 347 (art. 33 RD 1065/2007) */
export const UMBRAL_347 = 3005.06;

/** Umbral retenciones exentas en especie — Modelo 190 (RIRPF art. 75.3.b) */
export const UMBRAL_RETENCIONES_EXENTAS = 3.18; // €/día en especie

/**
 * Plazos de presentación de modelos trimestrales.
 * Fuente: AEAT — calendario fiscal 2025/2026.
 *
 * ⚠️ IMPORTANTE SOBRE DÍAS INHÁBILES:
 * Si el día límite cae en sábado, domingo o festivo nacional, el plazo
 * se traslada automáticamente al siguiente día hábil (art. 30.2 Ley 39/2015).
 * EJEMPLOS REALES:
 *   T1 2025: el 20/04 era domingo → vencimiento real: 21/04/2025
 *   T2 2025: el 20/07 era domingo → vencimiento real: 21/07/2025
 *   T3 2025: el 20/10 era lunes  → vencimiento real: 20/10/2025
 *
 * El campo `limite` contiene el día legal base (siempre el 20 para T1-T3,
 * el 30 para T4). El cálculo dinámico del día hábil real debe hacerse
 * en el código que consume este dato, no aquí.
 */
export const PLAZOS_TRIMESTRALES = {
  T1: { texto: "20 de abril (o siguiente día hábil)",   limite: "-04-20" },
  T2: { texto: "20 de julio (o siguiente día hábil)",   limite: "-07-20" },
  T3: { texto: "20 de octubre (o siguiente día hábil)", limite: "-10-20" },
  T4: { texto: "30 de enero (o siguiente día hábil)",   limite: "-01-30" }, // año siguiente
};

/**
 * Calcula la fecha límite real de presentación de un modelo,
 * trasladando al siguiente día hábil si cae en inhábil.
 * Sábado = inhábil (art. 30.2 Ley 39/2015).
 *
 * @param {number} year   - Año del plazo (puede ser el siguiente para T4)
 * @param {string} trim   - "T1"|"T2"|"T3"|"T4"
 * @returns {Date}
 */
export function calcFechaLimitePlazo(year, trim) {
  const plazo   = PLAZOS_TRIMESTRALES[trim];
  const yearPlazo = trim === "T4" ? year + 1 : year;
  const fecha   = new Date(`${yearPlazo}${plazo.limite}T23:59:59`);

  // Trasladar si cae en sábado (6) o domingo (0)
  while (fecha.getDay() === 0 || fecha.getDay() === 6) {
    fecha.setDate(fecha.getDate() + 1);
  }
  return fecha;
}

/** Plazo modelo 347 (declaración anual operaciones con terceros) */
export const PLAZO_347 = "Febrero del año siguiente (normalmente hasta el último día hábil de febrero)";

/**
 * Plazo modelo 390 (resumen anual IVA).
 * ⚠️ CORREGIDO: Es hasta el 31 de enero (no el 30).
 * El 390 se presenta junto con el 303 del T4, pero su plazo propio
 * es el 31 de enero. Si el 31 cae en inhábil, se traslada.
 */
export const PLAZO_390 = "31 de enero del año siguiente (o siguiente día hábil)";

/**
 * Plazo modelo 190 (resumen anual retenciones e ingresos a cuenta).
 * Hasta el 31 de enero del año siguiente.
 * Si cae en inhábil, se traslada al siguiente día hábil.
 */
export const PLAZO_190 = "31 de enero del año siguiente (o siguiente día hábil)";

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
 * Excepción de presentación del Modelo 130.
 * Art. 109.1 RIRPF: No obligado a presentar el 130 si en el ejercicio
 * anterior al menos el 70% de los ingresos de la actividad estuvieron
 * sujetos a retención o ingreso a cuenta.
 *
 * ⚠️ IMPACTO EN EL ENGINE:
 * El engine calcula el importe del 130 en todos los casos, lo cual es
 * correcto. Pero el asistente fiscal DEBE advertir al usuario de esta
 * excepción si su ratio de ingresos con retención supera el 70%.
 * El engine NO exime automáticamente de presentación — solo calcula.
 */
export const EXCEPCION_130_RETENCIONES = {
  pct_umbral: 0.70,  // 70% de ingresos con retención
  norma:      "Art. 109.1 RIRPF",
  nota:       "Si más del 70% de tus ingresos del ejercicio anterior estuvieron sujetos a retención, NO estás obligado a presentar el Modelo 130. Consulta con tu asesor.",
};

/**
 * Tramos IRPF 2024/2025 — escala estatal + autonómica media orientativa.
 * Fuente: art. 63 LIRPF (escala estatal) + escala autonómica media.
 *
 * ⚠️ ADVERTENCIA CRÍTICA:
 * Esta escala es ORIENTATIVA para estimaciones. La declaración real
 * (Modelo 100) requiere aplicar la escala específica de la CCAA del
 * contribuyente, que puede variar significativamente:
 *   - Madrid: tipo máximo ~47% (más baja)
 *   - Cataluña/Valencia: tipo máximo hasta 54%
 *   - Media orientativa: los tramos aquí reflejados
 * Para el cálculo del Modelo 130 (pago fraccionado), los tramos NO se
 * usan — solo se usa el 20% sobre rendimiento neto (art. 110 LIRPF).
 * Estos tramos solo se usan en el simulador de Renta (orientativo).
 */
export const TRAMOS_IRPF_2024 = [
  { desde: 0,      hasta: 12450,    tipo: 0.19, descripcion: "Primer tramo" },
  { desde: 12450,  hasta: 20200,    tipo: 0.24, descripcion: "Segundo tramo" },
  { desde: 20200,  hasta: 35200,    tipo: 0.30, descripcion: "Tercer tramo" },
  { desde: 35200,  hasta: 60000,    tipo: 0.37, descripcion: "Cuarto tramo" },
  { desde: 60000,  hasta: 300000,   tipo: 0.45, descripcion: "Quinto tramo" },
  { desde: 300000, hasta: Infinity, tipo: 0.47, descripcion: "Sexto tramo (desde 2021)" },
];

// Alias para 2025 (misma escala estatal, sin cambios en la base general)
export const TRAMOS_IRPF_2025 = TRAMOS_IRPF_2024;

/**
 * Mínimo personal y familiar (art. 57-61 LIRPF).
 * Importes vigentes para 2024/2025 sin modificaciones.
 */
export const MINIMOS_PERSONALES = {
  CONTRIBUYENTE:       5550,
  HIJO_1:              2400,
  HIJO_2:              2700,  // adicional sobre hijo_1
  HIJO_3:              4000,  // adicional sobre hijo_2
  HIJO_4_MAS:          4500,  // adicional por cada hijo a partir del 4º
  DISCAPACIDAD_33_65:  3000,
  DISCAPACIDAD_65_MAS: 9000,
  MAYORES_65:          918,
  MAYORES_75:          1122,  // adicional sobre mayores_65
};

/**
 * Reducción por rendimientos de actividades económicas (art. 32.2 LIRPF).
 *
 * ⚠️ ADVERTENCIA CRÍTICA — REQUISITOS CONDICIONADOS:
 *
 * La reducción de 2.000€ (art. 32.2.1) NO es universal. Solo aplica
 * cuando se cumplen TODOS estos requisitos (art. 32.2.2 LIRPF):
 *   a) Rendimiento neto en estimación directa
 *   b) El contribuyente NO obtiene rendimientos del trabajo
 *   c) El 70% de los ingresos del período están sujetos a retención
 *   d) No se realizan actividades a través de entidades en atribución
 *   e) Los gastos deducibles no exceden el 30% de los ingresos íntegros
 *
 * La reducción del art. 32.2.3 (rentas bajas < 12.000€ totales) sí es
 * aplicable sin los requisitos anteriores pero tiene sus propios límites.
 *
 * En el engine, esta reducción solo se usa en el SIMULADOR DE RENTA
 * (calcSimuladorRenta), donde es orientativa. El Modelo 130 NO aplica
 * reducción art. 32 — trabaja directamente con ingresos - gastos.
 *
 * Para el simulador, se aplica como estimación favorable (asumiendo que
 * el usuario cumple los requisitos), con el aviso de que puede no aplicar.
 */
export const REDUCCION_ACTIVIDAD_ECONOMICA = {
  HASTA:        14047.5,   // rendimiento neto ≤ este importe → reducción máxima
  DESDE:        19747.5,   // rendimiento neto ≥ este importe → reducción mínima
  MAX:          3500,      // reducción máxima adicional (se suma a BASE)
  BASE:         2000,      // reducción base (art. 32.2.1 — CONDICIONAL, ver arriba)
  MIN:          1000,      // reducción mínima cuando renta entre HASTA y DESDE
  CONDICIONAL:  true,      // ← NUEVO: indica que BASE requiere cumplir art. 32.2.2
  NORMA:        "Art. 32.2 LIRPF",
  AVISO:        "La reducción de 2.000€ (art. 32.2.1 LIRPF) es condicional. Requiere: estimación directa, sin rendimientos de trabajo, 70% ingresos con retención, gastos ≤ 30% ingresos. Consultar con asesor para confirmar aplicabilidad.",
};

/**
 * Reducción para rentas bajas sin los requisitos del 32.2.1 (art. 32.2.3 LIRPF).
 * Aplicable cuando el total de rentas no exentas es < 12.000€.
 */
export const REDUCCION_RENTAS_BAJAS = {
  LIMITE_TOTAL_RENTAS: 12000,
  HASTA_8000: 1620,     // reducción si renta total ≤ 8.000€
  FORMULA_TRAMO: {      // si renta entre 8.000,01 y 12.000€
    base:       1620,
    factor:     0.405,
    desde:      8000,
  },
  NORMA: "Art. 32.2.3ª LIRPF",
};

/**
 * Reducción por trabajo (art. 20 LIRPF) — para empleados.
 * No aplica directamente a autónomos puros.
 * Incluida por referencia para el modo gestor (empresas con empleados).
 */
export const REDUCCION_TRABAJO = {
  hasta_13115:       5565,
  tramo_medio_base:  13115,
  tramo_medio_factor: 1.5,
  desde_16825:       1000,
};

/**
 * Aportación máxima anual a plan de pensiones deducible (art. 51 LIRPF).
 * Reducción en base imponible general, NO deducción en cuota.
 * Límite vigente desde 2022.
 */
export const LIMITE_PLAN_PENSIONES = 1500; // €/año

/* ══════════════════════════════════════════════════════
   SEGURIDAD SOCIAL — Autónomos (RETA)
   Sistema de cotización por ingresos reales (desde 2023)
   Fuente: RD-ley 13/2022 + Orden PJC/178/2025 (vigente también 2026
   por prórroga RD-ley 16/2025 de 23 de diciembre de 2025)
══════════════════════════════════════════════════════ */

/**
 * Bases y cuotas RETA 2025 por tramo de rendimientos netos mensuales.
 * Confirmado vigentes también para 2026 (prórroga RD-ley 16/2025).
 * Rendimiento neto = ingresos - gastos deducibles - 7% gastos difícil just.
 *
 * cuotaMes: cuota mínima mensual eligiendo la base mínima del tramo.
 * baseMin: base mínima de cotización del tramo.
 * baseMax: base máxima de cotización del tramo (= máximo a elegir).
 *
 * Base máxima absoluta (todos los tramos): 4.909,50€/mes (desde 2025).
 */
export const TRAMOS_RETA_2025 = [
  // TABLA REDUCIDA (rendimientos < 1.166,70€/mes)
  { desde: 0,      hasta: 670,    cuotaMes: 200.00, baseMin: 653.59,  baseMax: 718.95,  tabla: "reducida" },
  { desde: 670,    hasta: 900,    cuotaMes: 220.00, baseMin: 718.95,  baseMax: 900.00,  tabla: "reducida" },
  { desde: 900,    hasta: 1166.7, cuotaMes: 260.50, baseMin: 849.67,  baseMax: 1166.70, tabla: "reducida" },
  // TABLA GENERAL
  { desde: 1166.7, hasta: 1300,   cuotaMes: 272.56, baseMin: 950.98,  baseMax: 1300.00, tabla: "general" },
  { desde: 1300,   hasta: 1500,   cuotaMes: 294.31, baseMin: 960.78,  baseMax: 1500.00, tabla: "general" },
  { desde: 1500,   hasta: 1700,   cuotaMes: 310.33, baseMin: 960.78,  baseMax: 1700.00, tabla: "general" },
  { desde: 1700,   hasta: 1850,   cuotaMes: 324.17, baseMin: 1143.79, baseMax: 1850.00, tabla: "general" },
  { desde: 1850,   hasta: 2030,   cuotaMes: 337.25, baseMin: 1209.86, baseMax: 2030.00, tabla: "general" },
  { desde: 2030,   hasta: 2330,   cuotaMes: 362.97, baseMin: 1274.97, baseMax: 2330.00, tabla: "general" },
  { desde: 2330,   hasta: 2760,   cuotaMes: 383.56, baseMin: 1395.89, baseMax: 2760.00, tabla: "general" },
  { desde: 2760,   hasta: 3190,   cuotaMes: 415.77, baseMin: 1549.75, baseMax: 3190.00, tabla: "general" },
  { desde: 3190,   hasta: 3620,   cuotaMes: 472.56, baseMin: 1732.03, baseMax: 3620.00, tabla: "general" },
  { desde: 3620,   hasta: 4050,   cuotaMes: 520.98, baseMin: 1732.03, baseMax: 4050.00, tabla: "general" },
  { desde: 4050,   hasta: 6000,   cuotaMes: 549.98, baseMin: 1732.03, baseMax: 4909.50, tabla: "general" },
  { desde: 6000,   hasta: Infinity, cuotaMes: 590.00, baseMin: 1732.03, baseMax: 4909.50, tabla: "general" },
];

/** Tipo de cotización RETA para contingencias comunes + cese + formación */
export const TIPO_COTIZACION_RETA = 0.3080; // 30,80% sobre base elegida

/**
 * Tarifa plana para nuevos autónomos (desde 2023).
 * ⚠️ CORREGIDO:
 * - Primer año: 80€/mes siempre (sin condición de ingresos).
 * - Segundo año (meses 13-24): 80€/mes SOLO si ingresos previstos < SMI anual.
 *   El SMI 2025 es de 16.576€/año (1.381,33€/mes × 14 pagas ÷ 12).
 * Fuente: Art. 38 ter LETA / DT 5ª RD-ley 13/2022 / Seg. Social 2025.
 */
export const TARIFA_PLANA_RETA = {
  importe_primer_año:   80,    // €/mes, sin condiciones
  duracion_primer:      12,    // meses
  importe_segundo_año:  80,    // €/mes, CONDICIONADO a ingresos < SMI
  duracion_segundo:     12,    // meses adicionales si ingresos < SMI
  condicion_segundo:    "Ingresos previstos anuales < SMI (16.576€ en 2025)",
  norma:                "Art. 38 ter LETA / DT 5ª RD-ley 13/2022",
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
  limite_anual:    25000,
};

/* ══════════════════════════════════════════════════════
   GASTOS DEDUCIBLES — Guía AEAT 2025
   Fuente: LIRPF art. 28-30, DGT consultas vinculantes
══════════════════════════════════════════════════════ */

/**
 * Catálogo de gastos deducibles con porcentaje y referencia legal.
 * riesgo: 'bajo' | 'medio' | 'alto' — probabilidad de regularización AEAT.
 *
 * ⚠️ NOTA GENERAL SOBRE DEDUCIBILIDAD:
 * La deducibilidad de todo gasto requiere:
 * 1. Factura completa (no tique para gastos > 400€ + IVA)
 * 2. Correlación con la actividad económica
 * 3. Registro contable en el libro de gastos
 * 4. El gasto no puede generar un rendimiento neto negativo artificialmente
 */
export const GASTOS_DEDUCIBLES = {
  "cuota_reta": {
    label:  "Cuota RETA (Seguridad Social autónomos)",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 30.2.1ª LIRPF",
    nota:   "Deducible en su totalidad. Sin límite. Incluye la regularización anual de cuotas.",
  },
  "seguro_rc": {
    label:  "Seguro de responsabilidad civil profesional",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 28.1 LIRPF",
    nota:   "Solo si la cobertura es exclusivamente profesional.",
  },
  "seguro_salud": {
    label:  "Seguro de salud (autónomo + cónyuge + hijos)",
    pct:    100,
    limite: 500,  // €/persona/año; 1.500€ si discapacidad ≥ 33%
    riesgo: "bajo",
    norma:  "Art. 30.2.5ª LIRPF",
    nota:   "Límite 500€/persona/año (1.500€ si discapacidad ≥ 33%). No incluye seguros de vida ni de accidentes.",
  },
  "alquiler_oficina": {
    label:  "Alquiler de oficina / local de negocio",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 29 LIRPF",
    nota:   "Solo si el local se dedica exclusivamente a la actividad. Requiere contrato de arrendamiento.",
  },
  "suministros_vivienda": {
    label:  "Suministros vivienda con despacho afecto",
    pct:    null,  // variable: 30% × % vivienda afecta
    limite: "30% rendimientos netos",
    riesgo: "medio",
    norma:  "Art. 30.2.5ª LIRPF / DGT V2369-15",
    nota:   "30% × (m² despacho / m² vivienda). Máximo 30% del rendimiento neto. Requiere comunicación de afectación a Hacienda (modelo 036).",
  },
  "material_oficina": {
    label:  "Material de oficina y papelería",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 28.1 LIRPF",
    nota:   "Necesario para la actividad. Conservar facturas. Incluye tóner, papel, material fungible.",
  },
  "servicios_profesionales": {
    label:  "Servicios profesionales (gestor, abogado, etc.)",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 28.1 LIRPF",
    nota:   "Honorarios de asesoría fiscal, jurídica y contable directamente relacionados con la actividad.",
  },
  "formacion": {
    label:  "Formación y cursos profesionales",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 28.1 LIRPF",
    nota:   "Debe estar relacionada con el epígrafe IAE declarado. Cursos, libros técnicos, congresos.",
  },
  "publicidad_marketing": {
    label:  "Publicidad y marketing",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 28.1 LIRPF",
    nota:   "Anuncios, diseño gráfico, SEO, SEM, redes sociales, ferias. Requiere factura y relación con la actividad.",
  },
  "software_suscripciones": {
    label:  "Software y suscripciones digitales",
    pct:    100,
    limite: null,
    riesgo: "bajo",
    norma:  "Art. 28.1 LIRPF",
    nota:   "SaaS, licencias, hosting, dominios, almacenamiento cloud. Uso exclusivamente profesional o proporcional si mixto.",
  },
  "telefono_internet": {
    label:  "Teléfono e internet (uso mixto)",
    pct:    50,   // criterio AEAT para uso mixto (sin prueba de uso exclusivo)
    limite: null,
    riesgo: "medio",
    norma:  "Art. 28.1 LIRPF / DGT V0293-18",
    nota:   "Sin línea exclusiva: AEAT acepta 50% sin conflicto habitual. Con línea dedicada solo a la actividad: 100%.",
  },
  "dietas_desplazamiento": {
    label:  "Dietas en desplazamiento por actividad",
    pct:    100,
    limite: null,  // límites por día/pernoctación definidos abajo
    riesgo: "medio",
    norma:  "Art. 9 RIRPF (por analogía en autónomos) / DGT consultas",
    nota:   "España sin pernocta: 26,67€/día. España con pernocta: 53,34€/día. Extranjero sin pernocta: 48,08€/día. Extranjero con pernocta: 91,35€/día. Requiere justificación del desplazamiento y destino.",
    limites_dietas: {
      españa_sin_pernocta:      26.67,
      españa_con_pernocta:      53.34,
      extranjero_sin_pernocta:  48.08,
      extranjero_con_pernocta:  91.35,
    },
  },
  "vehiculo": {
    label:  "Vehículo (afectación exclusiva actividad)",
    pct:    100,
    limite: null,
    riesgo: "alto",
    norma:  "Art. 29 LIRPF / TEAC Resolución 2014",
    nota:   "⚠️ RIESGO MUY ALTO. Solo deducible con afectación EXCLUSIVA a la actividad (no uso particular). La AEAT regulariza sistemáticamente. En la práctica, imposible de justificar en vehículos turismo salvo taxistas, instructores de conducción, etc. Para vehículos de empresa, el IVA admite 50% (art. 95.3 LIVA) pero el IRPF exige exclusividad.",
  },
  "combustible": {
    label:  "Combustible (vehículo exclusivo profesional)",
    pct:    100,
    limite: null,
    riesgo: "alto",
    norma:  "Art. 29 LIRPF",
    nota:   "⚠️ RIESGO MUY ALTO. Solo si el vehículo tiene afectación exclusiva a la actividad (ver gasto 'vehiculo'). Sin esa afectación, el combustible tampoco es deducible.",
  },
  "restaurante_cliente": {
    label:  "Atención a clientes (restaurantes, comidas)",
    pct:    100,
    limite: null,
    riesgo: "medio",
    norma:  "Art. 28.1 LIRPF / DGT V2099-14",
    nota:   "Requiere factura completa (no tique), anotar asistentes y empresa representada. Sin estos datos, la AEAT puede denegar la deducción.",
  },
  "plan_pensiones": {
    label:  "Aportación a plan de pensiones",
    pct:    100,
    limite: 1500,  // €/año (desde 2022)
    riesgo: "bajo",
    norma:  "Art. 51 LIRPF",
    nota:   "Reducción en base imponible general (no deducción en cuota). Límite: 1.500€/año. Admite 4.250€ adicionales si la empresa también cotiza (planes de empleo).",
  },
};

/* ══════════════════════════════════════════════════════
   TIPOS DE OPERACIÓN — Vocabulario interno Taurix
   Alineado con los valores ya en uso en facturas.js
══════════════════════════════════════════════════════ */

export const TIPOS_OPERACION = {
  NACIONAL:                "nacional",
  INTRACOMUNITARIA:        "intracomunitaria",
  EXPORTACION:             "exportacion",
  IMPORTACION:             "importacion",
  INVERSION_SUJETO_PASIVO: "inversion_sujeto_pasivo",
  EXENTO:                  "exento",
};

/** Tipos de operación que no repercuten IVA en la factura */
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
   Modelo 303 (AEAT versión 2024/2025)
══════════════════════════════════════════════════════ */

export const CASILLAS_303 = {
  // Devengado — operaciones interiores
  BASE_21:          1,
  CUOTA_21:         3,
  BASE_10:          5,
  CUOTA_10:         7,
  BASE_4:           9,
  CUOTA_4:          11,
  // Inversión sujeto pasivo
  BASE_ISP:         12,
  CUOTA_ISP:        13,
  // Adquisiciones intracomunitarias
  BASE_AIC:         36,
  CUOTA_AIC:        37,
  // Importaciones
  BASE_IMP:         38,
  CUOTA_IMP:        39,
  // Total devengado (suma de todo lo anterior)
  TOTAL_DEVENGADO:  27,
  // Deducible — operaciones interiores
  BASE_DEDUCIBLE_INT:  28,
  CUOTA_DEDUCIBLE_INT: 29,
  // Total IVA deducible
  TOTAL_DEDUCIBLE:  40,
  // Resultado de la liquidación
  RESULTADO:        64,
  // Compensaciones de periodos anteriores
  COMP_ANTERIORES:  78,
  // Resultado final a ingresar
  RESULTADO_FINAL:  86,
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
