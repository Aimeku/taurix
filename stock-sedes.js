/* ═══════════════════════════════════════════════════════════════════
   TAURIX · stock-sedes.js
   Fase 2 — Stock multi-sede (retrocompatible)
   ─────────────────────────────────────────────────────────────────
   ESTRATEGIA RETROCOMPATIBLE:

   Con feature sedes INACTIVA:
     → escribe/lee productos.stock_actual (comportamiento clásico).

   Con feature sedes ACTIVA Y sede asignada al documento:
     → escribe en stock_sedes(producto_id, sede_id).
     → escribe en stock_movimientos (auditoría).
     → recalcula productos.stock_actual = SUMA(stock_sedes.cantidad)
       para mantener el campo legado sincronizado (para compatibilidad
       con código que lo lea directamente, badges del selector, etc).

   Con feature sedes ACTIVA pero SIN sede en el documento:
     → no toca stock (mismo criterio que Taurix actual con productos
       tipo "servicio"). Se loguea warning para que el usuario lo note.

   Exporta:
   · descontarStockPorVenta(lineas, sedeId, docRef, docTipo)
   · ajustarStockSede(productoId, sedeId, cantidad, motivo)
   · traspasarStock(productoId, sedeOrigen, sedeDestino, cantidad, motivo)
   · getStockPorSede(productoId, sedeId)
   · getStockTotalProducto(productoId)
   · getStockDetallePorProducto(productoId)  // {sedeId, cantidad}[]
   · sincronizarStockActual(productoId)       // recalcula sum() → productos.stock_actual
   ═══════════════════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION } from "./utils.js";
import { isSedesActivo } from "./sedes.js";

/* ═══════════════════════════════════════════════════════════════════
   API PÚBLICA
═══════════════════════════════════════════════════════════════════ */

/**
 * Descuenta stock por una venta (factura / presupuesto / albarán /
 * proforma / recurrente). Llamar DESPUÉS de que el documento esté
 * guardado en BD (para poder referenciar su id).
 *
 * @param {Array} lineas    · [{producto_id, cantidad, ...}]
 * @param {string|null} sedeId · sede del documento (null si "sin sede")
 * @param {string} docRef   · uuid del documento (p.ej. factura.id)
 * @param {string} docTipo  · 'factura', 'presupuesto', 'albaran', 'proforma', 'recurrente'
 * @returns {Promise<{ok: boolean, warnings: string[]}>}
 */
export async function descontarStockPorVenta(lineas, sedeId, docRef, docTipo) {
  const warnings = [];
  const lineasConProducto = (lineas || []).filter(l => l?.producto_id && l.cantidad > 0);
  if (lineasConProducto.length === 0) return { ok: true, warnings };

  const usarMultiSede = isSedesActivo() && !!sedeId;

  for (const linea of lineasConProducto) {
    try {
      if (usarMultiSede) {
        await _descontarEnSedeConAuditoria(linea.producto_id, sedeId, linea.cantidad, docRef, docTipo);
        await sincronizarStockActual(linea.producto_id);
      } else {
        // Retrocompatible: descuento clásico en productos.stock_actual
        await _descontarClasico(linea.producto_id, linea.cantidad);
        if (isSedesActivo() && !sedeId) {
          warnings.push(`Producto sin sede asignada: stock descontado del total sin trazabilidad por sede`);
        }
      }
    } catch (e) {
      console.error("[descontarStockPorVenta] línea", linea, e);
      warnings.push(`Error en producto ${linea.producto_id}: ${e.message || e}`);
    }
  }

  return { ok: true, warnings };
}

/**
 * Ajuste manual de stock (inventario físico: "en la sede X hay N unidades").
 * Establece el valor absoluto y registra un movimiento tipo 'ajuste'.
 */
export async function ajustarStockSede(productoId, sedeId, nuevaCantidad, motivo) {
  if (!SESSION?.user?.id) throw new Error("Sin sesión");
  if (!productoId || !sedeId) throw new Error("productoId y sedeId son obligatorios");

  // Leer cantidad actual (puede no existir fila)
  const { data: actual } = await supabase.from("stock_sedes")
    .select("cantidad").eq("producto_id", productoId).eq("sede_id", sedeId).maybeSingle();

  const cantidadAnterior = actual?.cantidad ?? 0;
  const diferencia = Number(nuevaCantidad) - Number(cantidadAnterior);

  // UPSERT en stock_sedes
  const { error: eUp } = await supabase.from("stock_sedes").upsert(
    {
      user_id: SESSION.user.id,
      producto_id: productoId,
      sede_id: sedeId,
      cantidad: nuevaCantidad
    },
    { onConflict: "producto_id,sede_id" }
  );
  if (eUp) throw eUp;

  // Auditoría
  await _registrarMovimiento({
    producto_id: productoId,
    sede_origen: diferencia < 0 ? sedeId : null,
    sede_destino: diferencia > 0 ? sedeId : null,
    cantidad: Math.abs(diferencia),
    tipo: "ajuste",
    motivo: motivo || `Ajuste inventario: ${cantidadAnterior} → ${nuevaCantidad}`
  });

  await sincronizarStockActual(productoId);
  return true;
}

/**
 * Traspaso de stock entre dos sedes. Operación de dos pasos:
 *   · resta de sede origen
 *   · suma a sede destino
 *   · registra movimiento tipo 'traspaso'.
 *
 * NOTA: Supabase JS no tiene transacciones cliente-side. Si el segundo
 * paso falla, se intenta revertir el primero (compensación). No es
 * perfecto pero cubre el 99% de casos — fallos de red puntuales.
 */
export async function traspasarStock(productoId, sedeOrigen, sedeDestino, cantidad, motivo) {
  if (!SESSION?.user?.id) throw new Error("Sin sesión");
  if (!productoId || !sedeOrigen || !sedeDestino) throw new Error("Faltan parámetros");
  if (sedeOrigen === sedeDestino) throw new Error("Las sedes origen y destino deben ser distintas");
  const qty = Number(cantidad);
  if (isNaN(qty) || qty <= 0) throw new Error("Cantidad inválida");

  // Verificar stock disponible en origen
  const { data: origenActual } = await supabase.from("stock_sedes")
    .select("cantidad").eq("producto_id", productoId).eq("sede_id", sedeOrigen).maybeSingle();
  const stockOrigen = Number(origenActual?.cantidad || 0);
  if (stockOrigen < qty) {
    throw new Error(`Stock insuficiente en sede origen (disponible: ${stockOrigen}, solicitado: ${qty})`);
  }

  // Paso 1: restar en origen
  const nuevoOrigen = stockOrigen - qty;
  const { error: eO } = await supabase.from("stock_sedes")
    .update({ cantidad: nuevoOrigen })
    .eq("producto_id", productoId).eq("sede_id", sedeOrigen)
    .eq("user_id", SESSION.user.id);
  if (eO) throw eO;

  // Paso 2: sumar en destino (UPSERT)
  try {
    const { data: destActual } = await supabase.from("stock_sedes")
      .select("cantidad").eq("producto_id", productoId).eq("sede_id", sedeDestino).maybeSingle();
    const stockDestino = Number(destActual?.cantidad || 0);
    const nuevoDestino = stockDestino + qty;

    const { error: eD } = await supabase.from("stock_sedes").upsert(
      {
        user_id: SESSION.user.id,
        producto_id: productoId,
        sede_id: sedeDestino,
        cantidad: nuevoDestino
      },
      { onConflict: "producto_id,sede_id" }
    );
    if (eD) throw eD;

    // Registrar movimiento
    await _registrarMovimiento({
      producto_id: productoId,
      sede_origen: sedeOrigen,
      sede_destino: sedeDestino,
      cantidad: qty,
      tipo: "traspaso",
      motivo: motivo || "Traspaso entre sedes"
    });

    await sincronizarStockActual(productoId);
    return true;
  } catch (e) {
    // Compensación: devolver el stock al origen
    console.warn("[traspasarStock] fallo en destino, compensando origen", e);
    try {
      await supabase.from("stock_sedes")
        .update({ cantidad: stockOrigen })
        .eq("producto_id", productoId).eq("sede_id", sedeOrigen)
        .eq("user_id", SESSION.user.id);
    } catch (eComp) {
      console.error("[traspasarStock] compensación también falló", eComp);
    }
    throw e;
  }
}

/**
 * Devuelve la cantidad en una sede concreta (0 si no hay fila).
 */
export async function getStockPorSede(productoId, sedeId) {
  if (!productoId || !sedeId) return 0;
  const { data } = await supabase.from("stock_sedes")
    .select("cantidad").eq("producto_id", productoId).eq("sede_id", sedeId).maybeSingle();
  return Number(data?.cantidad || 0);
}

/**
 * Suma de stock en todas las sedes para un producto.
 * Si la feature está inactiva, devuelve productos.stock_actual.
 */
export async function getStockTotalProducto(productoId) {
  if (!isSedesActivo()) {
    const { data } = await supabase.from("productos")
      .select("stock_actual").eq("id", productoId).maybeSingle();
    return Number(data?.stock_actual || 0);
  }
  const { data } = await supabase.from("stock_sedes")
    .select("cantidad").eq("producto_id", productoId);
  return (data || []).reduce((acc, r) => acc + Number(r.cantidad || 0), 0);
}

/**
 * Desglose de stock por sede para un producto.
 * @returns {Promise<Array<{sede_id, cantidad, stock_minimo, ubicacion}>>}
 */
export async function getStockDetallePorProducto(productoId) {
  if (!productoId) return [];
  const { data } = await supabase.from("stock_sedes")
    .select("sede_id, cantidad, stock_minimo, ubicacion")
    .eq("producto_id", productoId);
  return data || [];
}

/**
 * Recalcula productos.stock_actual como SUM(stock_sedes.cantidad) para
 * mantener el campo legado coherente. Esto permite que el resto de la
 * app (listado, filtros, badges del selector de productos) siga
 * funcionando sin cambios. Best-effort: si falla, no rompe la venta.
 */
export async function sincronizarStockActual(productoId) {
  try {
    if (!productoId) return;
    const { data } = await supabase.from("stock_sedes")
      .select("cantidad").eq("producto_id", productoId);
    const total = (data || []).reduce((a, r) => a + Number(r.cantidad || 0), 0);

    await supabase.from("productos")
      .update({ stock_actual: total })
      .eq("id", productoId).eq("user_id", SESSION.user.id);
  } catch (e) {
    console.warn("[sincronizarStockActual]", e);
  }
}

/**
 * Devuelve el historial de movimientos para un producto, ordenado
 * por fecha descendente (más reciente primero). Limitado para evitar
 * cargas pesadas.
 * @param {string} productoId
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getMovimientosProducto(productoId, limit = 50) {
  if (!productoId) return [];
  const { data, error } = await supabase.from("stock_movimientos")
    .select("*")
    .eq("producto_id", productoId)
    .order("fecha", { ascending: false })
    .limit(limit);
  if (error) { console.warn("[getMovimientosProducto]", error); return []; }
  return data || [];
}

/* ═══════════════════════════════════════════════════════════════════
   PRIVADAS
═══════════════════════════════════════════════════════════════════ */

async function _descontarClasico(productoId, cantidad) {
  const { data: prod } = await supabase.from("productos")
    .select("stock_actual, tipo").eq("id", productoId).maybeSingle();
  if (!prod) return;
  if (prod.tipo === "servicio" || prod.stock_actual == null) return;
  const nuevo = Math.max(0, Number(prod.stock_actual) - Number(cantidad));
  await supabase.from("productos")
    .update({ stock_actual: nuevo })
    .eq("id", productoId).eq("user_id", SESSION.user.id);
}

async function _descontarEnSedeConAuditoria(productoId, sedeId, cantidad, docRef, docTipo) {
  // Verificar tipo (servicios no tienen stock)
  const { data: prod } = await supabase.from("productos")
    .select("tipo").eq("id", productoId).maybeSingle();
  if (!prod || prod.tipo === "servicio") return;

  // Leer stock actual en la sede
  const { data: actual } = await supabase.from("stock_sedes")
    .select("cantidad").eq("producto_id", productoId).eq("sede_id", sedeId).maybeSingle();
  const actualQty = Number(actual?.cantidad || 0);
  const nuevaQty = Math.max(0, actualQty - Number(cantidad));
  // Aviso si queda negativo: Taurix permite vender en negativo (criterio
  // actual), pero dejamos huella en consola para auditoría.
  if (actualQty < Number(cantidad)) {
    console.warn(`[stock] Venta en negativo en sede ${sedeId} del producto ${productoId}: disponible ${actualQty}, vendido ${cantidad}`);
  }

  // UPSERT — si no existía la fila, la creamos en 0 y descontamos
  const { error } = await supabase.from("stock_sedes").upsert(
    {
      user_id: SESSION.user.id,
      producto_id: productoId,
      sede_id: sedeId,
      cantidad: nuevaQty
    },
    { onConflict: "producto_id,sede_id" }
  );
  if (error) throw error;

  // Auditoría
  await _registrarMovimiento({
    producto_id: productoId,
    sede_origen: sedeId,
    sede_destino: null,
    cantidad: Number(cantidad),
    tipo: "venta",
    motivo: null,
    documento_ref: docRef || null,
    documento_tipo: docTipo || null
  });
}

async function _registrarMovimiento({ producto_id, sede_origen, sede_destino, cantidad, tipo, motivo, documento_ref, documento_tipo }) {
  try {
    await supabase.from("stock_movimientos").insert({
      user_id: SESSION.user.id,
      producto_id,
      sede_origen: sede_origen || null,
      sede_destino: sede_destino || null,
      cantidad,
      tipo,
      motivo: motivo || null,
      documento_ref: documento_ref || null,
      documento_tipo: documento_tipo || null
    });
  } catch (e) {
    // Auditoría nunca debe tirar el flujo principal
    console.warn("[stock_movimientos insert]", e);
  }
}
