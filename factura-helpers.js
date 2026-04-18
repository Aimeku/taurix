/* ═══════════════════════════════════════════════════════════════════
   TAURIX · factura-helpers.js
   
   Helpers fiscales compartidos por todos los motores (tax-iva,
   tax-irpf, fiscal, utils, otros-modelos, facturas).
   
   PROPÓSITO:
   Unificar la lectura del desglose de IVA de una factura, para que
   no haya 5 sitios distintos reconstruyendo cuotas con la fórmula
   ingenua `base × iva / 100` que falla con facturas multi-IVA.
   
   REGLAS:
   - Si la factura tiene `lineas` (JSON con el desglose real), se usa.
   - Si no, se cae al fallback `base × iva / 100`.
   - Todas las funciones son puras (sin supabase, sin DOM).
   - El redondeo es siempre simétrico (half-away-from-zero) para que
     rectificativas con importes negativos no desvíen el total.
   ═══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   TIPOS DE IVA VÁLIDOS EN ESPAÑA (art. 90-91 LIVA)
══════════════════════════════════════════════════════════════════ */
export const TIPOS_IVA_VALIDOS = [0, 4, 10, 21];

/* ══════════════════════════════════════════════════════════════════
   REDONDEO SIMÉTRICO — half-away-from-zero
   Math.round() de JS es asimétrico para negativos:
     Math.round(-2.5) === -2  (debería ser -3)
   Esto rompe rectificativas. Usamos redondeo simétrico.
══════════════════════════════════════════════════════════════════ */
export function redondearSimetrico(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return 0;
  const f = Math.pow(10, dec);
  return Math.sign(n) * Math.round(Math.abs(n) * f) / f;
}

/* Alias corto interno para usarlo en bucles densos */
const _r = redondearSimetrico;

/* ══════════════════════════════════════════════════════════════════
   PARSEO DE LÍNEAS
   Las líneas se persisten en `facturas.lineas` como string JSON.
   Función tolerante: acepta array, string JSON, u objeto.
══════════════════════════════════════════════════════════════════ */
export function parsearLineas(rawLineas) {
  if (!rawLineas) return [];
  if (Array.isArray(rawLineas)) return rawLineas;
  if (typeof rawLineas === "string") {
    try { return JSON.parse(rawLineas) || []; }
    catch { return []; }
  }
  return [];
}

/* ══════════════════════════════════════════════════════════════════
   PARSEO DE DESCUENTO DE LÍNEA
   Acepta "10%" → porcentaje sobre subtotal bruto
          "10"  → importe fijo
          ""    → 0
══════════════════════════════════════════════════════════════════ */
export function parseDescuentoLinea(raw, subtotalBruto) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.endsWith("%")) {
    const pct = parseFloat(s) || 0;
    return subtotalBruto * pct / 100;
  }
  return parseFloat(s) || 0;
}

/* ══════════════════════════════════════════════════════════════════
   PARSEO DE DESCUENTO GLOBAL
   Se persiste como string JSON: { tipo: "pct"|"fixed", valor: number }
══════════════════════════════════════════════════════════════════ */
export function parseDescuentoGlobal(raw, baseSinDtoGlobal) {
  if (!raw) return { amt: 0, tipo: null, valor: 0 };
  try {
    const dg = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!dg || !(dg.valor > 0)) return { amt: 0, tipo: null, valor: 0 };
    const amt = dg.tipo === "pct"
      ? baseSinDtoGlobal * dg.valor / 100
      : Math.min(dg.valor, baseSinDtoGlobal);
    return { amt: Math.max(0, amt), tipo: dg.tipo, valor: dg.valor };
  } catch {
    return { amt: 0, tipo: null, valor: 0 };
  }
}

/* ══════════════════════════════════════════════════════════════════
   DESGLOSE MULTI-IVA DE UNA FACTURA
   
   Devuelve:
     {
       21: { base, cuota },
       10: { base, cuota },
        4: { base, cuota },
        0: { base, cuota },
       base_total,      // suma de bases (después de dto global)
       cuota_total,     // suma de cuotas (0 si op sin IVA repercutido)
       dto_global_amt,  // descuento global aplicado
     }
   
   Lógica:
   1. Si `factura.lineas` es parseable y no vacío → desglose real por línea.
   2. Si no → fallback: toda la base al tipo `factura.iva`.
   3. Si la operación está en OP_SIN_IVA_REPERCUTIDO (exportación,
      intracomunitaria, exento, ISP), la cuota_total es 0 pero las
      bases por tipo se mantienen (necesarias para desglose interno
      del 303 y del 349).
══════════════════════════════════════════════════════════════════ */

const OP_SIN_IVA_REPERCUTIDO = new Set([
  "exportacion", "intracomunitaria", "inversion_sujeto_pasivo", "exento",
]);

export function desglosarIva(factura) {
  const map = {
    21: { base: 0, cuota: 0 },
    10: { base: 0, cuota: 0 },
     4: { base: 0, cuota: 0 },
     0: { base: 0, cuota: 0 },
  };

  const op          = factura.tipo_operacion || "nacional";
  const baseFact    = Number(factura.base) || 0;
  const ivaFact     = Number(factura.iva ?? factura.iva_pct ?? 0);
  const lineasArr   = parsearLineas(factura.lineas);

  // ── 1. Calcular base sin descuento global (solo con descuentos de línea)
  let baseSinDtoGlobal = 0;
  lineasArr.forEach(l => {
    const subBruto = (Number(l.cantidad) || 0) * (Number(l.precio) || 0);
    const descLin  = parseDescuentoLinea(l.descuento, subBruto);
    const subNeto  = Math.max(0, subBruto - descLin);
    baseSinDtoGlobal += subNeto;
  });

  // ── 2. Aplicar descuento global proporcional (ratio = baseFinal / baseSinDto)
  const dg      = parseDescuentoGlobal(factura.descuento_global, baseSinDtoGlobal);
  const baseFin = Math.max(0, baseSinDtoGlobal - dg.amt);
  const ratio   = baseSinDtoGlobal > 0 ? baseFin / baseSinDtoGlobal : 0;

  // ── 3. Si hay líneas, desglosar por tipo
  if (lineasArr.length > 0 && baseSinDtoGlobal > 0) {
    lineasArr.forEach(l => {
      const subBruto = (Number(l.cantidad) || 0) * (Number(l.precio) || 0);
      const descLin  = parseDescuentoLinea(l.descuento, subBruto);
      const subNeto  = Math.max(0, subBruto - descLin);
      const baseReal = subNeto * ratio;             // con dto global aplicado
      const pct      = TIPOS_IVA_VALIDOS.includes(Number(l.iva)) ? Number(l.iva) : 21;
      map[pct].base  += baseReal;
      // Cuota por línea; se redondeará a nivel de factura+tipo luego
      map[pct].cuota += baseReal * pct / 100;
    });

    // ── 4. Redondear cada par (factura, tipo IVA) a 2 decimales
    //      Así la suma entre facturas es estable (Hallazgo 10).
    for (const pct of TIPOS_IVA_VALIDOS) {
      map[pct].base  = _r(map[pct].base);
      map[pct].cuota = _r(map[pct].cuota);
    }

  } else {
    // ── Fallback: factura antigua sin lineas o con lineas vacías.
    //    Usar base e iva principales. Sigue generando base correcta
    //    aunque sin multi-IVA real.
    const pct = TIPOS_IVA_VALIDOS.includes(ivaFact) ? ivaFact : 21;
    map[pct].base  = _r(baseFact);
    map[pct].cuota = _r(baseFact * pct / 100);
  }

  // ── 5. Totales
  const base_total  = _r(map[21].base + map[10].base + map[4].base + map[0].base);
  const cuota_bruta = map[21].cuota + map[10].cuota + map[4].cuota + map[0].cuota;
  // En ops sin IVA repercutido la cuota no se factura, aunque la base sí exista
  const cuota_total = OP_SIN_IVA_REPERCUTIDO.has(op) ? 0 : _r(cuota_bruta);

  return {
    ...map,
    base_total,
    cuota_total,
    dto_global_amt: _r(dg.amt),
    tipo_operacion: op,
  };
}

/* ══════════════════════════════════════════════════════════════════
   IRPF DE UNA FACTURA — retención aplicada sobre la base final
══════════════════════════════════════════════════════════════════ */
export function cuotaIrpfFactura(factura, desglose = null) {
  const d = desglose || desglosarIva(factura);
  const pctIrpf = Number(factura.irpf_retencion ?? factura.irpf ?? factura.irpf_pct ?? 0);
  if (!pctIrpf) return { pct: 0, cuota: 0 };
  return { pct: pctIrpf, cuota: _r(d.base_total * pctIrpf / 100) };
}

/* ══════════════════════════════════════════════════════════════════
   TOTAL DE UNA FACTURA (para mostrar en listados, emails, etc.)
   total = base + IVA repercutido − IRPF
══════════════════════════════════════════════════════════════════ */
export function totalFactura(factura) {
  const d    = desglosarIva(factura);
  const irpf = cuotaIrpfFactura(factura, d);
  return {
    base_total:  d.base_total,
    cuota_iva:   d.cuota_total,
    cuota_irpf:  irpf.cuota,
    total:       _r(d.base_total + d.cuota_total - irpf.cuota),
    desglose_iva: {
      21: d[21], 10: d[10], 4: d[4], 0: d[0],
    },
  };
}

/* ══════════════════════════════════════════════════════════════════
   DEDUCIBILIDAD DEL IVA SOPORTADO (art. 97 LIVA)
   
   Criterio correcto:
   - Factura completa con NIF receptor → deducible.
   - Factura simplificada (ticket) solo deducible si reúne los
     requisitos del art. 7.2 RD 1619/2012 (datos del destinatario).
   - Regla histórica de Taurix "TIQ-" se mantiene como fallback de
     compatibilidad, pero el campo canónico es `tipo_documento`.
══════════════════════════════════════════════════════════════════ */
export function esDeducibleIVA(factura) {
  // Campo canónico nuevo (Hallazgo 11)
  if (factura.tipo_documento) {
    if (factura.tipo_documento === "factura_completa") return true;
    if (factura.tipo_documento === "ticket_no_deducible") return false;
    if (factura.tipo_documento === "factura_simplificada") {
      // Deducible solo si hay NIF del receptor
      return !!(factura.cliente_nif || factura.receptor_nif);
    }
  }

  // Fallback legacy: heurística TIQ-
  const esTicket = (factura.numero_factura || "").startsWith("TIQ-");
  const tieneIva = Number(factura.iva ?? factura.iva_pct ?? 0) > 0;
  if (!esTicket) return true;                   // factura normal
  return tieneIva;                              // ticket solo si tiene IVA > 0 registrado
}

/* ══════════════════════════════════════════════════════════════════
   MENCIONES LEGALES OBLIGATORIAS EN FACTURA
   Art. 6.1.j / 6.1.m / 6.1.n RD 1619/2012
   
   Se usan en el PDF y en la preview para que las operaciones sin
   IVA repercutido lleven la mención literal exigida por la ley.
══════════════════════════════════════════════════════════════════ */
export const MENCIONES_LEGALES = {
  exento:                  "Operación exenta del IVA (art. 20 LIVA)",
  intracomunitaria:        "Operación exenta — Entrega intracomunitaria (art. 25 LIVA) / VAT exempt — Intra-Community supply",
  exportacion:             "Operación exenta — Exportación (art. 21 LIVA) / VAT exempt — Export",
  inversion_sujeto_pasivo: "Inversión del sujeto pasivo (art. 84.Uno.2º LIVA) / Reverse charge",
  importacion:             null,  // el IVA se liquida en aduana, no hay mención especial
  nacional:                null,
};

export function mencionLegal(tipo_operacion) {
  return MENCIONES_LEGALES[tipo_operacion] || null;
}

/* ══════════════════════════════════════════════════════════════════
   CÓDIGOS AEAT DE RECTIFICACIÓN (art. 80 LIVA)
   Usados en el SII y exigidos como metadato en rectificativas.
══════════════════════════════════════════════════════════════════ */
export const MOTIVOS_RECTIFICACION = {
  R1: "Art. 80.1 y 80.2 LIVA y error fundado en derecho (operaciones canceladas, modificadas, etc.)",
  R2: "Art. 80.3 LIVA — Concurso de acreedores del destinatario",
  R3: "Art. 80.4 LIVA — Créditos incobrables",
  R4: "Resto de causas",
  R5: "Rectificación de facturas simplificadas",
};

export function codigoRectificacionDesdeCausa(causaTexto) {
  // Mapeo desde el texto de la UI legacy → código AEAT
  const t = (causaTexto || "").toLowerCase();
  if (t.includes("concurso"))                     return "R2";
  if (t.includes("incobrable") || t.includes("impagado")) return "R3";
  if (t.includes("simplificada") || t.includes("ticket"))  return "R5";
  if (t.includes("devolución") || t.includes("error") ||
      t.includes("descuento") || t.includes("datos"))      return "R1";
  return "R4";
}

/* ══════════════════════════════════════════════════════════════════
   RETENCIÓN IRPF APLICABLE SEGÚN TIPO DE CLIENTE
   
   Regla (art. 76 RIRPF): la retención la practica el pagador cuando
   es empresario o profesional. Si el cliente es particular
   (consumidor final), NO procede retención.
══════════════════════════════════════════════════════════════════ */
export function retencionAplicaCliente({ tipo_cliente, tipo_factura, regimen_emisor }) {
  if (regimen_emisor === "sociedad")  return { aplica: false, motivo: "Sociedades no sufren retención art. 99.2 LIRPF en sus propias facturas" };
  if (tipo_factura === "recibida")    return { aplica: false, motivo: "En facturas recibidas la retención la practica el emisor, no el receptor" };
  if (tipo_cliente === "particular")  return { aplica: false, motivo: "El cliente particular no es retenedor (art. 76 RIRPF)" };
  return { aplica: true, motivo: null };
}

/* ══════════════════════════════════════════════════════════════════
   DETECCIÓN DE TRIMESTRE SIN PASAR POR new Date()
   Evita problemas de zona horaria (Hallazgo 27).
   Entrada: fecha ISO "YYYY-MM-DD".
══════════════════════════════════════════════════════════════════ */
export function trimestreDeFecha(fechaISO) {
  if (!fechaISO || typeof fechaISO !== "string") return "T1";
  const mes = parseInt(fechaISO.slice(5, 7), 10);
  if (!mes || mes < 1 || mes > 12) return "T1";
  return "T" + (Math.floor((mes - 1) / 3) + 1);
}

export function yearDeFecha(fechaISO) {
  if (!fechaISO || typeof fechaISO !== "string") return new Date().getFullYear();
  const y = parseInt(fechaISO.slice(0, 4), 10);
  return y || new Date().getFullYear();
}
