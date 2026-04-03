/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-gastos.js
   Clasificación y análisis de deducibilidad de gastos

   RESPONSABILIDADES DE ESTE MÓDULO:
   1. Clasificar facturas recibidas + gastos en categorías fiscales
   2. Calcular la deducibilidad real (IRPF e IVA) por gasto
   3. Detectar gastos de riesgo alto que pueden desencadenar alertas
   4. Calcular el acumulado 347 por NIF/nombre para detectar umbral
   5. Preparar el contexto de gastos para el Modelo 190 y para Claude

   REGLAS:
   - Funciones puras — reciben datos, devuelven resultados
   - Ninguna función habla con Supabase (eso es tax-data.js)
   - Los % de deducibilidad son los de GASTOS_DEDUCIBLES en tax-rules.js
   - La asignación de categoría se hace por heurística sobre concepto
   ═══════════════════════════════════════════════════════════════════ */

import {
  GASTOS_DEDUCIBLES,
  UMBRAL_347,
} from "./tax-rules.js";

/* ══════════════════════════════════════════════════════════════════
   MAPA DE INFERENCIA DE CATEGORÍA
   Asocia palabras clave del concepto/proveedor a claves del
   catálogo GASTOS_DEDUCIBLES. El orden importa: más específico primero.
══════════════════════════════════════════════════════════════════ */

const KEYWORDS_CATEGORIA = [
  // Muy específicos primero
  { keywords: ["reta", "seguridad social", "ss autónomo", "cuota autónomo"], cat: "cuota_reta" },
  { keywords: ["responsabilidad civil", "seguro rc", "seguro profesional"], cat: "seguro_rc" },
  { keywords: ["seguro salud", "seguro médico", "sanitas", "adeslas", "asisa", "mapfre salud", "dkv"], cat: "seguro_salud" },
  { keywords: ["plan de pensiones", "plan pensiones", "aportación pensiones", "mutualidad"], cat: "plan_pensiones" },
  { keywords: ["alquiler oficina", "alquiler local", "arrendamiento local", "arrendamiento oficina"], cat: "alquiler_oficina" },
  { keywords: ["suministro", "luz", "electricidad", "agua", "gas natural", "endesa", "iberdrola", "naturgy", "repsol hogar"], cat: "suministros_vivienda" },
  { keywords: ["gestor", "asesor", "asesoría", "gestoría", "abogado", "notario", "procurador", "consultoría legal", "despacho"], cat: "servicios_profesionales" },
  { keywords: ["formación", "curso", "seminario", "máster", "udemy", "coursera", "training", "workshop", "masterclass"], cat: "formacion" },
  { keywords: ["publicidad", "marketing", "anuncio", "google ads", "meta ads", "facebook ads", "instagram ads", "seo", "campaña"], cat: "publicidad_marketing" },
  { keywords: ["software", "saas", "licencia", "suscripción", "hosting", "dominio", "servidor", "cloud", "aws", "google workspace", "microsoft 365", "office", "adobe", "slack", "notion", "figma", "github"], cat: "software_suscripciones" },
  { keywords: ["teléfono", "móvil", "internet", "vodafone", "movistar", "orange", "jazztel", "adsl", "fibra", "tarifa datos"], cat: "telefono_internet" },
  { keywords: ["dieta", "restaurante", "comida", "manutención", "hotel", "desplazamiento", "viaje", "transporte", "taxi", "parking", "peaje", "vuelo", "tren", "alojamiento"], cat: "restaurante_cliente" },
  { keywords: ["combustible", "gasolina", "gasoil", "carburante", "repsol", "cepsa", "bp", "esso"], cat: "combustible" },
  { keywords: ["vehículo", "coche", "furgoneta", "renting", "leasing vehículo", "seguro coche", "itv", "revisión vehículo"], cat: "vehiculo" },
  { keywords: ["material oficina", "papelería", "material", "tóner", "cartuchos", "papel", "lápiz", "bolígrafo", "archivador", "sello", "sobre"], cat: "material_oficina" },
];

/* ══════════════════════════════════════════════════════════════════
   CLASIFICACIÓN DE UN GASTO
══════════════════════════════════════════════════════════════════ */

/**
 * Infiere la categoría fiscal de un gasto a partir de su concepto y proveedor.
 * Devuelve null si no hay coincidencia (el gasto queda sin categorizar).
 *
 * @param {string} concepto
 * @param {string} [proveedorNombre]
 * @returns {string|null}  - Clave de GASTOS_DEDUCIBLES o null
 */
export function inferirCategoria(concepto, proveedorNombre = "") {
  const texto = `${concepto} ${proveedorNombre}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const { keywords, cat } of KEYWORDS_CATEGORIA) {
    if (keywords.some(kw => texto.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) {
      return cat;
    }
  }
  return null;
}

/**
 * Clasifica un gasto con sus porcentajes de deducibilidad reales.
 * Acepta tanto una factura recibida (TaxDocument) como un registro de gastos.
 *
 * @param {Object} gasto
 * @param {string} gasto.id
 * @param {string} gasto.concepto        - Descripción del gasto
 * @param {number} gasto.base            - Base imponible en €
 * @param {number} gasto.iva             - Cuota IVA en € (ya calculada) o en % según iva_es_pct
 * @param {boolean} [gasto.iva_es_pct]   - true si iva viene como porcentaje, false si ya es €
 * @param {string} gasto.fecha
 * @param {string} [gasto.categoria]     - Categoría ya asignada (si existe, sobrescribe inferencia)
 * @param {string} [gasto.proveedor]     - Nombre del proveedor (ayuda a la inferencia)
 * @param {number} [gasto.pct_deduccion_iva] - % IVA deducible si ya se conoce (para prorrata)
 * @returns {import('./tax-types.js').GastoClasificado}
 */
export function clasificarGasto(gasto) {
  const {
    id,
    concepto = "",
    base = 0,
    iva = 0,
    iva_es_pct = false,
    fecha,
    categoria: catPreasignada,
    proveedor = "",
    pct_deduccion_iva = 100,
  } = gasto;

  // Calcular cuota IVA real
  const cuota_iva = iva_es_pct ? _round(base * iva / 100) : _round(iva || 0);

  // Categoría: usar la pre-asignada o inferir
  const categoria = catPreasignada || inferirCategoria(concepto, proveedor) || "material_oficina";

  // Obtener regla de deducibilidad
  const regla = GASTOS_DEDUCIBLES[categoria];

  // Porcentaje de deducibilidad IRPF
  // Si la regla tiene pct null (caso suministros_vivienda), usamos 30% como valor por defecto
  // (el caller puede sobreescribir con el % real del despacho)
  const pct_irpf = regla?.pct ?? 30;

  // Porcentaje de deducibilidad IVA
  // Por defecto = pct_deduccion_iva (que tiene en cuenta prorrata)
  // Para gastos de vehículo sin afectación exclusiva, AEAT admite 50% IVA (art. 95.3 LIVA)
  let pct_iva_efectivo = pct_deduccion_iva;
  if (categoria === "vehiculo" || categoria === "combustible") {
    // Si no hay constancia de afectación exclusiva, IVA deducible = 50% (art. 95.3 LIVA)
    pct_iva_efectivo = Math.min(pct_deduccion_iva, 50);
  }

  // Importes deducibles
  const importe_deducible = _round(base * pct_irpf / 100);
  const iva_deducible     = _round(cuota_iva * pct_iva_efectivo / 100);

  return {
    id,
    concepto,
    base:               _round(base),
    cuota_iva,
    total:              _round(base + cuota_iva),
    fecha,
    categoria,
    label:              regla?.label ?? concepto,
    pct_deducible_irpf: pct_irpf,
    pct_deducible_iva:  pct_iva_efectivo,
    importe_deducible,
    iva_deducible,
    riesgo:             regla?.riesgo ?? "bajo",
    norma:              regla?.norma  ?? null,
    nota:               regla?.nota   ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════════
   CLASIFICAR ARRAY COMPLETO
══════════════════════════════════════════════════════════════════ */

/**
 * Clasifica un array de gastos/facturas recibidas.
 * Entrada: array de objetos crudos (puede ser TaxDocument[] o gastos[]).
 *
 * @param {Object[]} gastos
 * @param {number} [pctProrrataIva=100] - % de deducción IVA global (prorrata del año)
 * @returns {import('./tax-types.js').GastoClasificado[]}
 */
export function clasificarGastos(gastos, pctProrrataIva = 100) {
  return gastos.map(g => {
    // Normalizar campos según si viene de tabla facturas o tabla gastos
    const base       = Number(g.base ?? 0);
    const iva_pct    = Number(g.iva ?? g.iva_pct ?? 0);
    const cuota_iva  = g.cuota_iva != null ? Number(g.cuota_iva) : base * iva_pct / 100;
    const concepto   = g.concepto ?? g.descripcion ?? "";
    const proveedor  = g.proveedor ?? g.cliente_nombre ?? g.proveedor_nombre ?? "";
    const categoria  = g.categoria ?? null;

    return clasificarGasto({
      id:       g.id,
      concepto,
      base,
      iva:      cuota_iva,    // ya en €
      iva_es_pct: false,
      fecha:    g.fecha,
      categoria,
      proveedor,
      pct_deduccion_iva: pctProrrataIva,
    });
  });
}

/* ══════════════════════════════════════════════════════════════════
   RESUMEN DE DEDUCIBILIDAD
   Agrupación por categoría para mostrar en la UI
══════════════════════════════════════════════════════════════════ */

/**
 * Agrupa gastos clasificados por categoría y calcula totales.
 *
 * @param {import('./tax-types.js').GastoClasificado[]} gastosClasificados
 * @returns {Object[]} - Array de { categoria, label, total_base, total_deducible,
 *                       total_iva_deducible, riesgo, norma, count }
 */
export function resumenPorCategoria(gastosClasificados) {
  const mapa = {};

  for (const g of gastosClasificados) {
    if (!mapa[g.categoria]) {
      mapa[g.categoria] = {
        categoria:          g.categoria,
        label:              g.label,
        riesgo:             g.riesgo,
        norma:              g.norma,
        count:              0,
        total_base:         0,
        total_deducible:    0,
        total_iva_deducible: 0,
        pct_deducible_irpf: g.pct_deducible_irpf,
      };
    }
    mapa[g.categoria].count              += 1;
    mapa[g.categoria].total_base         += g.base;
    mapa[g.categoria].total_deducible    += g.importe_deducible;
    mapa[g.categoria].total_iva_deducible += g.iva_deducible;
  }

  // Redondear todos los totales y ordenar: primero los de más importe
  return Object.values(mapa)
    .map(r => ({
      ...r,
      total_base:          _round(r.total_base),
      total_deducible:     _round(r.total_deducible),
      total_iva_deducible: _round(r.total_iva_deducible),
    }))
    .sort((a, b) => b.total_base - a.total_base);
}

/**
 * Calcula el total de gastos deducibles en IRPF e IVA para el periodo.
 *
 * @param {import('./tax-types.js').GastoClasificado[]} gastosClasificados
 * @returns {{ total_base: number, total_deducible_irpf: number,
 *             total_iva_deducible: number, total_no_deducible: number,
 *             gasto_riesgo_alto: number }}
 */
export function totalDeducibilidad(gastosClasificados) {
  let total_base         = 0;
  let total_deducible    = 0;
  let total_iva_ded      = 0;
  let gasto_riesgo_alto  = 0;

  for (const g of gastosClasificados) {
    total_base      += g.base;
    total_deducible += g.importe_deducible;
    total_iva_ded   += g.iva_deducible;
    if (g.riesgo === "alto") gasto_riesgo_alto += g.base;
  }

  return {
    total_base:            _round(total_base),
    total_deducible_irpf:  _round(total_deducible),
    total_iva_deducible:   _round(total_iva_ded),
    total_no_deducible:    _round(total_base - total_deducible),
    gasto_riesgo_alto:     _round(gasto_riesgo_alto),
  };
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 347 — Acumulado por tercero
   Art. 33 RD 1065/2007: operaciones > UMBRAL_347 (3.005,06€)
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el acumulado anual por NIF para el Modelo 347.
 * Agrupa TODAS las operaciones (emitidas + recibidas) por contraparte.
 * El umbral de declaración es 3.005,06€ en el conjunto del año.
 *
 * @param {import('./tax-types.js').TaxDocument[]} docs  - Todos los docs del año
 * @returns {Object[]} - Array de { nif, nombre, total_emitido, total_recibido,
 *                       total_operaciones, supera_umbral }
 *                       Solo los que superan el umbral.
 */
export function calcAcumulado347(docs) {
  const mapa = {};

  for (const doc of docs) {
    if (doc.estado === "anulada") continue;

    const nif    = doc.contraparte_nif    || "SIN_NIF";
    const nombre = doc.contraparte_nombre || "Sin identificar";
    const key    = nif; // agrupar por NIF, no por nombre

    if (!mapa[key]) {
      mapa[key] = {
        nif,
        nombre,
        total_emitido:     0,
        total_recibido:    0,
        total_operaciones: 0,
      };
    }

    // El importe para el 347 = base + cuota IVA (total factura sin IRPF)
    const importe347 = _round(doc.base + (doc.cuota_iva ?? 0));

    if (doc.tipo === "emitida") {
      mapa[key].total_emitido += importe347;
    } else {
      mapa[key].total_recibido += importe347;
    }
    mapa[key].total_operaciones += importe347;
  }

  // Redondear y filtrar por umbral
  return Object.values(mapa)
    .map(r => ({
      ...r,
      total_emitido:     _round(r.total_emitido),
      total_recibido:    _round(r.total_recibido),
      total_operaciones: _round(r.total_operaciones),
      supera_umbral:     r.total_operaciones >= UMBRAL_347,
    }))
    .filter(r => r.supera_umbral)
    .sort((a, b) => b.total_operaciones - a.total_operaciones);
}

/**
 * Detecta operaciones que están próximas al umbral 347 (entre 75% y 100%).
 * Útil para alertar antes de que se supere.
 *
 * @param {import('./tax-types.js').TaxDocument[]} docs
 * @returns {Object[]} - Contrapartes entre 75% y 100% del umbral
 */
export function detectarProximosUmbral347(docs) {
  const UMBRAL_AVISO = UMBRAL_347 * 0.75;
  const mapa = {};

  for (const doc of docs) {
    if (doc.estado === "anulada" || doc.tipo !== "emitida") continue;
    const key = doc.contraparte_nif || doc.contraparte_nombre || "SIN_ID";
    if (!mapa[key]) {
      mapa[key] = { nif: doc.contraparte_nif, nombre: doc.contraparte_nombre || "Sin identificar", total: 0 };
    }
    mapa[key].total += doc.base + (doc.cuota_iva ?? 0);
  }

  return Object.values(mapa)
    .filter(r => r.total >= UMBRAL_AVISO && r.total < UMBRAL_347)
    .map(r => ({ ...r, total: _round(r.total), pct_umbral: _round((r.total / UMBRAL_347) * 100, 1) }));
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 190 — Resumen retenciones
   Art. 75.3 RIRPF: retenciones e ingresos a cuenta anuales
══════════════════════════════════════════════════════════════════ */

/**
 * Prepara los datos para el Modelo 190 (resumen anual de retenciones).
 * Agrupa las retenciones IRPF de facturas emitidas por pagador (cliente).
 *
 * @param {import('./tax-types.js').TaxDocument[]} docsEmitidos  - Solo emitidas del año
 * @returns {Object[]} - Array de { nif, nombre, base_retenciones, cuota_retenida }
 */
export function prepararModelo190(docsEmitidos) {
  const mapa = {};

  for (const doc of docsEmitidos) {
    if (doc.tipo !== "emitida") continue;
    if (!doc.cuota_irpf || doc.cuota_irpf === 0) continue;
    if (doc.estado === "anulada" || doc.estado === "borrador") continue;

    const key    = doc.contraparte_nif    || "SIN_NIF";
    const nombre = doc.contraparte_nombre || "Sin identificar";

    if (!mapa[key]) {
      mapa[key] = { nif: key, nombre, base_retenciones: 0, cuota_retenida: 0, num_facturas: 0 };
    }
    mapa[key].base_retenciones += doc.base;
    mapa[key].cuota_retenida   += doc.cuota_irpf;
    mapa[key].num_facturas     += 1;
  }

  return Object.values(mapa)
    .map(r => ({
      ...r,
      base_retenciones: _round(r.base_retenciones),
      cuota_retenida:   _round(r.cuota_retenida),
    }))
    .sort((a, b) => b.cuota_retenida - a.cuota_retenida);
}

/**
 * Calcula el total de retenciones soportadas en el año (para conciliar con 130).
 *
 * @param {import('./tax-types.js').TaxDocument[]} docsEmitidos
 * @returns {{ total_base: number, total_retenido: number, tipo_medio: number }}
 */
export function totalRetenciones190(docsEmitidos) {
  const registros = prepararModelo190(docsEmitidos);
  const total_base    = registros.reduce((s, r) => s + r.base_retenciones, 0);
  const total_retenido = registros.reduce((s, r) => s + r.cuota_retenida, 0);
  const tipo_medio = total_base > 0 ? _round((total_retenido / total_base) * 100, 2) : 0;
  return {
    total_base:    _round(total_base),
    total_retenido: _round(total_retenido),
    tipo_medio,
  };
}

/* ══════════════════════════════════════════════════════════════════
   UTILIDADES PRIVADAS
══════════════════════════════════════════════════════════════════ */

/** Redondea a N decimales */
function _round(n, dec = 2) {
  const factor = Math.pow(10, dec);
  return Math.round((n || 0) * factor) / factor;
}
