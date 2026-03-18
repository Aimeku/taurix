/* ═══════════════════════════════════════════════════════
   TAURIX · validaciones.js
   
   Validaciones fiscales críticas — NUNCA enviar a Hacienda
   sin validar el NIF/CIF del cliente:
   · NIF persona física (DNI + letra)
   · CIF empresa (letra + dígito control)
   · NIE extranjero (X/Y/Z + DNI)
   · VAT intracomunitario (formato europeo)
   · IBAN (algoritmo módulo 97)
   · VIES lookup (verificación VAT UE en tiempo real)
   ═══════════════════════════════════════════════════════ */

/* ══════════════════════════
   NIF PERSONA FÍSICA (DNI)
   Algoritmo oficial AEAT
══════════════════════════ */
export function validarNIF(nif) {
  if (!nif) return { valido: false, tipo: null, msg: "NIF vacío" };
  const n = nif.trim().toUpperCase().replace(/[\s\-\.]/g, "");

  // NIF estándar: 8 dígitos + 1 letra
  if (/^[0-9]{8}[A-Z]$/.test(n)) {
    const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
    const num = parseInt(n.substring(0, 8));
    const letraCalc = letras[num % 23];
    const letraDoc  = n.charAt(8);
    if (letraCalc === letraDoc) {
      return { valido: true, tipo: "NIF", msg: "NIF válido" };
    }
    return { valido: false, tipo: "NIF", msg: `Letra incorrecta. Debería ser ${letraCalc}` };
  }

  // NIE: X, Y o Z + 7 dígitos + letra
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(n)) {
    const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
    const sustituto = n.replace("X","0").replace("Y","1").replace("Z","2");
    const num = parseInt(sustituto.substring(0, 8));
    const letraCalc = letras[num % 23];
    const letraDoc  = n.charAt(8);
    if (letraCalc === letraDoc) {
      return { valido: true, tipo: "NIE", msg: "NIE válido" };
    }
    return { valido: false, tipo: "NIE", msg: `Letra incorrecta. Debería ser ${letraCalc}` };
  }

  return { valido: false, tipo: null, msg: "Formato no reconocido (NIF: 8 dígitos + letra · NIE: X/Y/Z + 7 dígitos + letra)" };
}

/* ══════════════════════════
   CIF SOCIEDAD
   Algoritmo oficial AEAT
══════════════════════════ */
export function validarCIF(cif) {
  if (!cif) return { valido: false, tipo: null, msg: "CIF vacío" };
  const n = cif.trim().toUpperCase().replace(/[\s\-\.]/g, "");

  if (!/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(n)) {
    return { valido: false, tipo: "CIF", msg: "Formato CIF incorrecto (letra + 7 dígitos + dígito/letra control)" };
  }

  const letra   = n.charAt(0);
  const digitos = n.substring(1, 8);
  const control = n.charAt(8);

  let sumaPares = 0, sumaImpares = 0;
  for (let i = 0; i < 7; i++) {
    const d = parseInt(digitos[i]);
    if ((i + 1) % 2 === 0) {
      sumaPares += d;
    } else {
      const doble = d * 2;
      sumaImpares += doble > 9 ? doble - 9 : doble;
    }
  }

  const suma = sumaPares + sumaImpares;
  const unidad = (10 - (suma % 10)) % 10;
  const letraControl = "JABCDEFGHI"[unidad];

  // Algunas letras admiten dígito o letra de control
  const letrasLetrasControl = "PQSW";
  const letrasDigitosControl = "ABEH";

  let valido = false;
  if (letrasLetrasControl.includes(letra)) {
    valido = control === letraControl;
  } else if (letrasDigitosControl.includes(letra)) {
    valido = control === String(unidad);
  } else {
    valido = control === String(unidad) || control === letraControl;
  }

  if (!valido) {
    return { valido: false, tipo: "CIF",
      msg: `Dígito de control incorrecto. Debería ser ${unidad} o ${letraControl}` };
  }

  const tipos = {
    A: "Sociedad Anónima", B: "Sociedad de Responsabilidad Limitada",
    C: "Sociedad Colectiva", D: "Sociedad Comanditaria",
    E: "Comunidad de Bienes / Herencia Yacente",
    F: "Sociedad Cooperativa", G: "Asociación",
    H: "Comunidad de propietarios", J: "Sociedad Civil",
    N: "Entidad extranjera", P: "Corporación Local",
    Q: "Organismo Autónomo del Estado", R: "Congregación / Institución Religiosa",
    S: "Órgano de la Administración del Estado",
    U: "Unión Temporal de Empresas", V: "Otros tipos",
    W: "Establecimiento permanente de entidad no residente",
  };

  return { valido: true, tipo: "CIF", subtipo: tipos[letra] || letra, msg: `CIF válido — ${tipos[letra] || letra}` };
}

/* ══════════════════════════
   VALIDACIÓN GENÉRICA NIF/CIF/NIE
══════════════════════════ */
export function validarIdentificadorFiscal(id) {
  if (!id) return { valido: false, msg: "Identificador vacío" };
  const n = id.trim().toUpperCase();

  // Intentar como CIF primero si empieza por letra válida de empresa
  if (/^[ABCDEFGHJNPQRSUVW]/i.test(n)) {
    const cifResult = validarCIF(n);
    if (cifResult.valido) return cifResult;
  }

  // Intentar como NIF/NIE
  return validarNIF(n);
}

/* ══════════════════════════
   VAT INTRACOMUNITARIO
   Formatos por país UE
══════════════════════════ */
const VAT_PATTERNS = {
  AT: /^ATU[0-9]{8}$/,
  BE: /^BE[01][0-9]{9}$/,
  BG: /^BG[0-9]{9,10}$/,
  CY: /^CY[0-9]{8}[A-Z]$/,
  CZ: /^CZ[0-9]{8,10}$/,
  DE: /^DE[0-9]{9}$/,
  DK: /^DK[0-9]{8}$/,
  EE: /^EE[0-9]{9}$/,
  EL: /^EL[0-9]{9}$/,  // Grecia
  ES: /^ES[A-Z0-9][0-9]{7}[A-Z0-9]$/,
  FI: /^FI[0-9]{8}$/,
  FR: /^FR[A-Z0-9]{2}[0-9]{9}$/,
  HR: /^HR[0-9]{11}$/,
  HU: /^HU[0-9]{8}$/,
  IE: /^IE[0-9][A-Z0-9\+\*][0-9]{5}[A-Z]{1,2}$/,
  IT: /^IT[0-9]{11}$/,
  LT: /^LT([0-9]{9}|[0-9]{12})$/,
  LU: /^LU[0-9]{8}$/,
  LV: /^LV[0-9]{11}$/,
  MT: /^MT[0-9]{8}$/,
  NL: /^NL[0-9]{9}B[0-9]{2}$/,
  PL: /^PL[0-9]{10}$/,
  PT: /^PT[0-9]{9}$/,
  RO: /^RO[0-9]{2,10}$/,
  SE: /^SE[0-9]{12}$/,
  SI: /^SI[0-9]{8}$/,
  SK: /^SK[0-9]{10}$/,
  // No UE pero con VAT
  GB: /^GB([0-9]{9}|[0-9]{12}|GD[0-9]{3}|HA[0-9]{3})$/,
};

export function validarVAT(vat) {
  if (!vat) return { valido: false, msg: "VAT vacío" };
  const n = vat.trim().toUpperCase().replace(/[\s\-\.]/g, "");

  // Extraer prefijo país (2 letras)
  const pais = n.substring(0, 2);
  const pattern = VAT_PATTERNS[pais];

  if (!pattern) {
    return {
      valido: null, // no podemos verificar
      msg: `País ${pais}: formato no verificable localmente. Usa VIES para validar.`
    };
  }

  if (pattern.test(n)) {
    return { valido: true, pais, msg: `VAT ${pais} con formato correcto` };
  }

  return { valido: false, pais, msg: `Formato VAT ${pais} incorrecto` };
}

/* ══════════════════════════
   VIES — Verificación en tiempo real
   (Servicio oficial Comisión Europea)
   Nota: requiere proxy CORS en producción
══════════════════════════ */
export async function verificarVIES(vatNumber) {
  const n = vatNumber.trim().toUpperCase().replace(/[\s\-\.]/g, "");
  const pais = n.substring(0, 2);
  const numero = n.substring(2);

  try {
    // Intentar via API pública de la CE (puede fallar por CORS en browser)
    const url = `https://ec.europa.eu/taxation_customs/vies/services/checkVatService`;
    const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <soapenv:Body>
        <urn:checkVat>
          <urn:countryCode>${pais}</urn:countryCode>
          <urn:vatNumber>${numero}</urn:vatNumber>
        </urn:checkVat>
      </soapenv:Body>
    </soapenv:Envelope>`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body,
    });

    const text = await resp.text();
    const isValid = text.includes("<valid>true</valid>");
    const nameMatch = text.match(/<name>(.*?)<\/name>/);
    const addressMatch = text.match(/<address>(.*?)<\/address>/s);

    return {
      valido: isValid,
      nombre: nameMatch?.[1]?.replace("---", "")?.trim() || "—",
      direccion: addressMatch?.[1]?.replace("---", "")?.trim() || "—",
      pais,
      vatNumber: n,
      msg: isValid ? "✅ VAT válido en VIES" : "❌ VAT no encontrado en VIES"
    };
  } catch (e) {
    // Fallback: solo validación de formato
    const formatResult = validarVAT(n);
    return {
      valido: formatResult.valido,
      msg: `VIES no disponible (CORS). Validación de formato: ${formatResult.msg}. Verifica en https://ec.europa.eu/taxation_customs/vies/`,
      viesUrl: `https://ec.europa.eu/taxation_customs/vies/?locale=es&action=check&form_build_id=&form_id=taxation_vies_check_form&country_code=${pais}&vatNumber=${numero}`,
    };
  }
}

/* ══════════════════════════
   IBAN — Algoritmo módulo 97
   ISO 13616 / Real Decreto 1/2010
══════════════════════════ */
export function validarIBAN(iban) {
  if (!iban) return { valido: false, msg: "IBAN vacío" };
  const n = iban.trim().toUpperCase().replace(/[\s\-]/g, "");

  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,}$/.test(n)) {
    return { valido: false, msg: "Formato IBAN incorrecto" };
  }

  // Mover los 4 primeros caracteres al final
  const rearranged = n.substring(4) + n.substring(0, 4);

  // Convertir letras a números (A=10, B=11, ... Z=35)
  const numStr = rearranged.split("").map(c => {
    const code = c.charCodeAt(0);
    return code >= 65 ? code - 55 : c;
  }).join("");

  // Módulo 97 con BigInt para evitar overflow
  const mod = BigInt(numStr) % BigInt(97);

  if (mod === BigInt(1)) {
    const pais = n.substring(0, 2);
    const longitudes = {
      ES: 24, DE: 22, FR: 27, IT: 27, PT: 25, NL: 18,
      BE: 16, GB: 22, AT: 20, CH: 21, PL: 28, SE: 24,
    };
    const longEsperada = longitudes[pais];
    if (longEsperada && n.length !== longEsperada) {
      return { valido: false, msg: `IBAN ${pais} debe tener ${longEsperada} caracteres (tiene ${n.length})` };
    }
    return { valido: true, pais, msg: "IBAN válido", formateado: formatIBAN(n) };
  }

  return { valido: false, msg: `Dígitos de control incorrectos (resto ${mod}, debería ser 1)` };
}

function formatIBAN(iban) {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

/* ══════════════════════════
   VALIDAR FECHA FACTURA
   Comprueba plazos legales
══════════════════════════ */
export function validarFechaFactura(fecha, tipo) {
  if (!fecha) return { valido: false, msg: "Fecha requerida" };
  const d = new Date(fecha + "T12:00:00");
  const hoy = new Date();

  // Fecha futura > 1 año — muy inusual
  const diffDias = Math.floor((d - hoy) / 86400000);
  if (diffDias > 365) {
    return { valido: false, msg: "La fecha de factura está más de 1 año en el futuro. Verifica." };
  }

  // Factura emitida: debe emitirse cuando se produce el devengo del IVA
  // o en plazo máximo de 30 días desde el devengo (art. 11 RIVA)
  if (tipo === "emitida" && diffDias < -90) {
    return {
      valido: null, // advertencia, no error
      msg: "⚠️ La factura tiene más de 90 días de antigüedad. Verifica que no haya problemas de devengo."
    };
  }

  return { valido: true, msg: "Fecha válida" };
}

/* ══════════════════════════
   VALIDAR FACTURA COMPLETA
   Antes de emitir — checklist AEAT
══════════════════════════ */
export function validarFacturaCompleta(factura) {
  const errores = [];
  const avisos  = [];

  // Campos obligatorios según art. 6 Real Decreto 1619/2012
  if (!factura.numero_factura) errores.push("Número de factura: campo obligatorio");
  if (!factura.fecha)          errores.push("Fecha de expedición: campo obligatorio");
  if (!factura.cliente_nombre) errores.push("Nombre/Razón Social del cliente: campo obligatorio");

  // NIF del emisor: siempre obligatorio
  // NIF del destinatario: obligatorio si es empresa/autónomo (no particulares)
  if (factura.tipo_cliente !== "particular" && !factura.cliente_nif) {
    errores.push("NIF/CIF del cliente: obligatorio para empresas y autónomos (art. 6.1.d RIVA)");
  }

  // Dirección: obligatoria cuando el destinatario es sujeto pasivo
  if (factura.tipo_cliente !== "particular" && !factura.cliente_direccion) {
    avisos.push("Domicilio del cliente recomendable para empresas (art. 6.1.e RIVA)");
  }

  // Descripción de la operación
  if (!factura.concepto) {
    errores.push("Descripción de los bienes/servicios: campo obligatorio (art. 6.1.f RIVA)");
  }

  // Base imponible y tipo IVA
  if (!factura.base || factura.base <= 0) {
    errores.push("Base imponible: debe ser mayor que 0");
  }

  if (factura.iva === undefined || factura.iva === null) {
    errores.push("Tipo impositivo IVA: campo obligatorio");
  }

  // Validar NIF si está presente
  if (factura.cliente_nif) {
    const pais = factura.cliente_pais || "ES";
    if (pais === "ES") {
      const valNif = validarIdentificadorFiscal(factura.cliente_nif);
      if (!valNif.valido) {
        avisos.push(`NIF/CIF del cliente posiblemente incorrecto: ${valNif.msg}`);
      }
    } else if (["DE","FR","IT","PT","NL","BE","PL","SE","AT","FI","IE"].includes(pais)) {
      const valVat = validarVAT(factura.cliente_nif);
      if (valVat.valido === false) {
        avisos.push(`VAT UE posiblemente incorrecto: ${valVat.msg}`);
      }
    }
  }

  // Operaciones IC: verificaciones especiales
  if (factura.tipo_operacion === "intracomunitaria") {
    if (!factura.cliente_nif) {
      errores.push("Operación intracomunitaria: el VAT del cliente es OBLIGATORIO (art. 25 LIVA)");
    }
    if (factura.iva !== 0) {
      avisos.push("Las entregas intracomunitarias están exentas — el IVA debería ser 0% (art. 25 LIVA)");
    }
  }

  // ISP: el IVA debe ser 0
  if (factura.tipo_operacion === "inversion_sujeto_pasivo" && factura.iva !== 0) {
    avisos.push("En inversión del sujeto pasivo la factura se emite sin IVA (art. 84 LIVA)");
  }

  return {
    valido:  errores.length === 0,
    errores,
    avisos,
    resumen: errores.length === 0
      ? (avisos.length > 0 ? "Factura válida con advertencias" : "✅ Factura válida")
      : `❌ ${errores.length} error${errores.length !== 1 ? "es" : ""} que impiden la emisión`
  };
}

/* ══════════════════════════
   UI — WIDGET DE VALIDACIÓN
   Para usar en modales de factura y cliente
══════════════════════════ */
export function renderValidacionNIF(inputEl, resultEl) {
  if (!inputEl || !resultEl) return;
  inputEl.addEventListener("blur", () => {
    const val = inputEl.value.trim();
    if (!val) { resultEl.innerHTML = ""; return; }

    const resultado = validarIdentificadorFiscal(val);
    const color = resultado.valido ? "#059669" : resultado.valido === null ? "#d97706" : "#dc2626";
    const icon  = resultado.valido ? "✅" : resultado.valido === null ? "⚠️" : "❌";

    resultEl.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:${color}">
        ${icon} ${resultado.msg}
        ${resultado.subtipo ? `· ${resultado.subtipo}` : ""}
      </span>`;
  });
}

export function renderValidacionIBAN(inputEl, resultEl) {
  if (!inputEl || !resultEl) return;
  inputEl.addEventListener("blur", () => {
    const val = inputEl.value.trim();
    if (!val) { resultEl.innerHTML = ""; return; }

    const resultado = validarIBAN(val);
    const color = resultado.valido ? "#059669" : "#dc2626";
    const icon  = resultado.valido ? "✅" : "❌";

    resultEl.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:${color}">
        ${icon} ${resultado.msg}
      </span>`;

    // Autoformatear IBAN
    if (resultado.valido && resultado.formateado) {
      inputEl.value = resultado.formateado;
    }
  });
}

/* ══════════════════════════
   MOSTRAR VALIDACIÓN EN MODAL
   Integración con modales de cliente/factura
══════════════════════════ */
export function initValidacionesModal() {
  // NIF en modal de cliente
  const nifCliente = document.getElementById("mc_nif");
  if (nifCliente) {
    let resultEl = document.getElementById("mc_nif_result");
    if (!resultEl) {
      resultEl = document.createElement("div");
      resultEl.id = "mc_nif_result";
      resultEl.style.marginTop = "4px";
      nifCliente.parentElement.appendChild(resultEl);
    }
    renderValidacionNIF(nifCliente, resultEl);
  }

  // NIF en factura
  const nifFact = document.getElementById("nfNif");
  if (nifFact) {
    let resultEl = document.getElementById("nfNif_result");
    if (!resultEl) {
      resultEl = document.createElement("div");
      resultEl.id = "nfNif_result";
      resultEl.style.marginTop = "4px";
      nifFact.parentElement.appendChild(resultEl);
    }
    renderValidacionNIF(nifFact, resultEl);
  }
}
