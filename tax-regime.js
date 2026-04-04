/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-regime.js
   Mapeado de regímenes fiscales a grupos de cálculo

   RESPONSABILIDAD:
   Única fuente de verdad sobre qué grupo fiscal corresponde
   a cada régimen del selector UI. El resto del engine NO hace
   comparaciones directas de strings de régimen — siempre pasa
   por las funciones de este módulo.

   GRUPOS:
   ┌─────────────────────────────────────────────────────────────┐
   │ AUTONOMO          → IRPF (130) + IVA (303)                  │
   │   - autonomo_ed   Estimación Directa                        │
   │   - autonomo_es   Estimación Simplificada (+5% gasto EDS)   │
   │                                                             │
   │ AUTONOMO_MODULOS  → Módulos (131) + IVA (303)               │
   │   - autonomo_mod  Estimación Objetiva por módulos           │
   │                   ⚠️ No usa ingresos/gastos reales          │
   │                                                             │
   │ SOCIEDAD          → IS (200/202) + IVA (303)                │
   │   - sociedad      SL / SA (misma lógica IS en España)       │
   └─────────────────────────────────────────────────────────────┘

   USO:
     import { getTipoContribuyente, GRUPOS } from './tax-regime.js';
     const tipo = getTipoContribuyente(perfil.regime);
     if (tipo === GRUPOS.SOCIEDAD) { ... }
   ═══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   GRUPOS — constantes internas del engine
   Nunca usar los strings de regime directamente fuera de este módulo
══════════════════════════════════════════════════════════════════ */

export const GRUPOS = {
  AUTONOMO:         "AUTONOMO",
  AUTONOMO_MODULOS: "AUTONOMO_MODULOS",
  SOCIEDAD:         "SOCIEDAD",
};

/* ══════════════════════════════════════════════════════════════════
   MAPA de régimen UI → grupo del engine
══════════════════════════════════════════════════════════════════ */

const REGIME_MAP = {
  // Grupo AUTONOMO — tributan IRPF, usan 130 + 303
  autonomo_ed:                      GRUPOS.AUTONOMO,
  autonomo_es:                      GRUPOS.AUTONOMO,   // +5% gastos EDS en cálculo
  estimacion_directa_simplificada:  GRUPOS.AUTONOMO,   // alias legacy

  // Grupo AUTONOMO_MODULOS — DESACTIVADO TEMPORALMENTE
  // El Modelo 131 requiere tablas AEAT por epígrafe IAE, no ingresos/gastos reales.
  // Pendiente: implementar tax-modulos.js con cálculo por parámetros objetivos.
  // Mientras tanto, autonomo_mod cae al grupo AUTONOMO para no romper nada.
  // TODO: cuando tax-modulos.js esté listo, restaurar → GRUPOS.AUTONOMO_MODULOS
  autonomo_mod:                     GRUPOS.AUTONOMO,

  // Grupo SOCIEDAD — tributan IS, usan 200/202 + 303
  sociedad:                         GRUPOS.SOCIEDAD,   // SL y SA, misma lógica IS
};

/* ══════════════════════════════════════════════════════════════════
   API PÚBLICA
══════════════════════════════════════════════════════════════════ */

/**
 * Devuelve el grupo fiscal interno para un régimen del selector UI.
 * Si el régimen no está mapeado, devuelve AUTONOMO como fallback seguro.
 *
 * @param {string|null|undefined} regime - Valor del campo regime en perfil_fiscal
 * @returns {'AUTONOMO'|'AUTONOMO_MODULOS'|'SOCIEDAD'}
 */
export function getTipoContribuyente(regime) {
  return REGIME_MAP[regime] ?? GRUPOS.AUTONOMO;
}

/**
 * true si el régimen tributa por IRPF (autónomo normal o simplificado)
 * @param {string} regime
 */
export function esAutonomo(regime) {
  return getTipoContribuyente(regime) === GRUPOS.AUTONOMO;
}

/**
 * true si el régimen tributa por módulos (131)
 * @param {string} regime
 */
export function esModulos(regime) {
  return getTipoContribuyente(regime) === GRUPOS.AUTONOMO_MODULOS;
}

/**
 * true si el régimen tributa por IS (SL/SA)
 * @param {string} regime
 */
export function esSociedad(regime) {
  return getTipoContribuyente(regime) === GRUPOS.SOCIEDAD;
}

/**
 * true si el régimen tributa por IRPF (incluye módulos)
 * Útil para decidir si mostrar retenciones IRPF en facturas.
 * @param {string} regime
 */
export function esPersonaFisica(regime) {
  const tipo = getTipoContribuyente(regime);
  return tipo === GRUPOS.AUTONOMO || tipo === GRUPOS.AUTONOMO_MODULOS;
}

/**
 * true si la estimación directa simplificada aplica el 5% adicional de
 * gastos de difícil justificación (art. 30.2.4ª LIRPF).
 * Solo aplica a autonomo_es.
 * @param {string} regime
 */
export function aplicaGastoEDS(regime) {
  return regime === "autonomo_es";
}

/**
 * Tipo IS aplicable según ingresos (art. 29 LIS):
 * - 23% si cifra de negocios < 1.000.000 € (entidad de reducida dimensión)
 * - 25% tipo general
 * @param {number} ingresos - Cifra de negocios del ejercicio
 * @returns {{ tipo: number, esPyme: boolean, norma: string }}
 */
export function getTipoIS(ingresos) {
  const esPyme = ingresos < 1_000_000;
  return {
    tipo:    esPyme ? 0.23 : 0.25,
    tipoPct: esPyme ? 23   : 25,
    esPyme,
    norma:   esPyme
      ? "Art. 29.1 LIS — tipo reducido 23% (CN < 1.000.000 €)"
      : "Art. 29 LIS — tipo general 25%",
  };
}

/**
 * Descripción legible del régimen para mostrar en UI.
 * @param {string} regime
 * @returns {string}
 */
export function labelRegimen(regime) {
  return {
    autonomo_ed:                     "Autónomo · Estimación Directa",
    autonomo_es:                     "Autónomo · Estimación Simplificada",
    autonomo_mod:                    "Autónomo · Módulos (Est. Objetiva)",
    sociedad:                        "Sociedad (SL / SA)",
    estimacion_directa_simplificada: "Autónomo · Est. Directa Simplificada",
  }[regime] ?? regime ?? "No configurado";
}

/**
 * Modelos fiscales obligatorios según el grupo del contribuyente.
 * Útil para el asistente IA y para el calendario fiscal.
 * @param {string} regime
 * @returns {{ trimestrales: string[], anuales: string[], notas: string[] }}
 */
export function getModelosObligatorios(regime) {
  const tipo = getTipoContribuyente(regime);

  switch (tipo) {
    case GRUPOS.SOCIEDAD:
      return {
        trimestrales: ["303", "202"],
        anuales:      ["200", "390", "347"],
        notas: [
          "Modelo 303: IVA trimestral (T1→20abr, T2→20jul, T3→20oct, T4→30ene)",
          "Modelo 202: Pago fraccionado IS (1º→20abr, 2º→20oct, 3º→20dic)",
          "Modelo 200: Declaración anual IS (25 días tras 6 meses del cierre — julio)",
          "Modelo 390: Resumen anual IVA (31 enero año siguiente)",
          "Modelo 347: Operaciones con terceros > 3.005,06 € (febrero año siguiente)",
        ],
      };

    case GRUPOS.AUTONOMO_MODULOS:
      return {
        trimestrales: ["303", "131"],
        anuales:      ["390", "347", "100"],
        notas: [
          "Modelo 303: IVA trimestral",
          "Modelo 131: Pago fraccionado IRPF por módulos (no usa ingresos/gastos reales)",
          "Modelo 100: Declaración anual IRPF (abril-junio año siguiente)",
          "⚠️ Los módulos se calculan según parámetros objetivos (art. 31 LIRPF)",
        ],
      };

    case GRUPOS.AUTONOMO:
    default:
      return {
        trimestrales: ["303", "130"],
        anuales:      ["390", "347", "100"],
        notas: [
          "Modelo 303: IVA trimestral (T1→20abr, T2→20jul, T3→20oct, T4→30ene)",
          "Modelo 130: Pago fraccionado IRPF — 20% del rendimiento neto acumulado (art. 110 LIRPF)",
          "Modelo 100: Declaración anual IRPF (abril-junio año siguiente)",
          "Modelo 390: Resumen anual IVA (31 enero año siguiente)",
          "Modelo 347: Operaciones con terceros > 3.005,06 € (febrero año siguiente)",
          aplicaGastoEDS(regime)
            ? "Est. Simplificada: deducción adicional 5% gastos de difícil justificación (art. 30.2.4ª LIRPF)"
            : "",
        ].filter(Boolean),
      };
  }
}
