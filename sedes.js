/* ═══════════════════════════════════════════════════════════════════
   TAURIX · sedes.js
   Fase 1 — Fundación multi-sede (opt-in, no-breaking)
   ─────────────────────────────────────────────────────────────────
   Exporta:
   · initSedes()                  · Llamar tras session válida. Monta el
                                    pill en topbar y rellena el store.
   · isSedesActivo()              · ¿El user tiene la feature activa?
   · getSedesCache()              · Array de sedes cargadas (solo activas).
   · getSedeActivaId()            · UUID de la sede activa o null (= todas).
   · setSedeActivaId(id)          · Cambia sede activa (persiste + evento).
   · getSedePorId(id)             · Objeto sede o null.
   · getSedePrincipal()           · Objeto sede principal o null.
   · resolveDireccionEmisor(pf,id)· Dirección/nombre para el PDF: sede o
                                    fallback a perfil_fiscal.
   · openModalSedes()             · Modal CRUD (listado).
   · openModalNuevaSede(edit?)    · Modal de alta/edición.
   · activarSedesFlow()           · Onboarding de activación con bulk
                                    backfill opcional.
   · applySedeFilter(query, id)   · Helper para añadir .eq('sede_id',…)
                                    al builder de Supabase de forma segura.

   Eventos del DOM:
   · 'sedes:changed'   · Lista de sedes modificada (CRUD).
   · 'sedes:activated' · El user acaba de activar la feature.
   · 'sedes:selected'  · Cambio de sede activa en el selector.
   ═══════════════════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, openModal, closeModal, toast } from "./utils.js";

/* ── Estado interno (cache en memoria) ────────────────────────────── */
let _sedesActivo = false;       // perfil_fiscal.sedes_activo
let _sedes = [];                // array de sedes activas del user
let _sedesInitDone = false;     // para que los listeners solo se añadan una vez

const SS_KEY_SEDE_ACTIVA = "taurix_sede_activa"; // sessionStorage

/* ═══════════════════════════════════════════════════════════════════
   API PÚBLICA
═══════════════════════════════════════════════════════════════════ */

export function isSedesActivo() { return _sedesActivo === true; }
export function getSedesCache() { return _sedes.slice(); }
export function getSedeActivaId() {
  const v = sessionStorage.getItem(SS_KEY_SEDE_ACTIVA);
  return v && v !== "" ? v : null;
}
export function setSedeActivaId(id) {
  if (id && id !== "") sessionStorage.setItem(SS_KEY_SEDE_ACTIVA, id);
  else                 sessionStorage.removeItem(SS_KEY_SEDE_ACTIVA);
  _renderPill();
  document.dispatchEvent(new CustomEvent("sedes:selected", { detail: { sedeId: id || null } }));
}
export function getSedePorId(id) {
  if (!id) return null;
  return _sedes.find(s => s.id === id) || null;
}
export function getSedePrincipal() {
  return _sedes.find(s => s.es_principal) || null;
}

/**
 * Para el PDF o cualquier documento emitido: resuelve qué dirección/nombre
 * mostrar como emisor. La razón social y NIF SIEMPRE vienen del
 * perfil_fiscal (legalmente es el sujeto pasivo). Solo la dirección puede
 * variar por sede.
 *
 * @param {object} perfilFiscal  · Fila completa de perfil_fiscal.
 * @param {string|null} sedeId   · Sede asociada al documento (o null).
 * @returns {{nombre_razon_social, nif, domicilio_fiscal, sede_codigo, sede_nombre}}
 */
export function resolveDireccionEmisor(perfilFiscal, sedeId) {
  const out = {
    nombre_razon_social: perfilFiscal?.nombre_razon_social || "",
    nif:                 perfilFiscal?.nif || "",
    domicilio_fiscal:    perfilFiscal?.domicilio_fiscal || "",
    sede_codigo:         null,
    sede_nombre:         null
  };
  if (!sedeId || !_sedesActivo) return out;
  const s = getSedePorId(sedeId);
  if (!s) return out;

  // Construimos domicilio estructurado solo si la sede tiene dirección.
  // Si la sede no tiene dirección, mantenemos el del perfil_fiscal.
  const partes = [s.direccion, [s.codigo_postal, s.ciudad].filter(Boolean).join(" "), s.provincia]
    .filter(Boolean)
    .map(v => (v || "").trim())
    .filter(Boolean);
  if (partes.length) out.domicilio_fiscal = partes.join(", ");

  out.sede_codigo = s.codigo;
  out.sede_nombre = s.nombre;
  return out;
}

/**
 * Aplica el filtro de sede_id a un query builder de Supabase, SOLO si
 * la feature está activa y hay una sede seleccionada. Si no hay sede
 * seleccionada (= "Todas"), no toca el query. Si la feature no está
 * activa, tampoco.
 *
 * Uso:
 *   let q = supabase.from("facturas").select("*").eq("user_id", uid);
 *   q = applySedeFilter(q);
 *   const { data } = await q;
 */
export function applySedeFilter(query, explicitId) {
  if (!_sedesActivo) return query;
  const id = explicitId !== undefined ? explicitId : getSedeActivaId();
  if (!id) return query;
  return query.eq("sede_id", id);
}

/* ═══════════════════════════════════════════════════════════════════
   INIT — Llamar desde main.js tras session válida
═══════════════════════════════════════════════════════════════════ */
export async function initSedes() {
  try {
    await _loadSedesActivoFlag();
    if (_sedesActivo) await _loadSedes();
    _renderPill();
    if (!_sedesInitDone) {
      _sedesInitDone = true;
      // Validación cruzada: si la sede guardada en sessionStorage ya no
      // existe (ha sido borrada en otra pestaña), la limpiamos.
      const actual = getSedeActivaId();
      if (actual && !getSedePorId(actual)) setSedeActivaId(null);
    }
  } catch (e) {
    console.error("[initSedes]", e);
    // Fallback silencioso: la feature no carga, el resto de la app
    // funciona igual.
  }
}

async function _loadSedesActivoFlag() {
  const { data, error } = await supabase
    .from("perfil_fiscal")
    .select("sedes_activo")
    .eq("user_id", SESSION.user.id)
    .maybeSingle();
  if (error) throw error;
  _sedesActivo = !!data?.sedes_activo;
}

async function _loadSedes() {
  const { data, error } = await supabase
    .from("sedes")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .eq("activa", true)
    .order("es_principal", { ascending: false })
    .order("nombre", { ascending: true });
  if (error) throw error;
  _sedes = data || [];
}

/* ═══════════════════════════════════════════════════════════════════
   TOPBAR PILL
═══════════════════════════════════════════════════════════════════ */

function _renderPill() {
  // Si la feature no está activa: no hay pill.
  const existente = document.getElementById("sedePillTop");

  if (!_sedesActivo) {
    existente?.remove();
    return;
  }

  // Construir / actualizar el pill.
  let pill = existente;
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "sedePillTop";
    pill.className = "topbar-period-pill";
    pill.style.cssText = "gap:8px";
    // Insertar antes del .topbar-period-pill del año/trimestre
    const yearPill = document.querySelector(".topbar-period-pill");
    if (yearPill && yearPill.parentNode) {
      yearPill.parentNode.insertBefore(pill, yearPill);
    } else {
      // Fallback: al final del topbar
      document.querySelector(".app-topbar")?.appendChild(pill);
    }
  }

  const sedeActivaId = getSedeActivaId();
  const sedeActiva = getSedePorId(sedeActivaId);
  const labelActiva = sedeActiva ? `${sedeActiva.codigo} · ${sedeActiva.nombre}` : "Todas las sedes";

  pill.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         style="flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    <select id="sedeSelectTop" class="period-sel" style="max-width:180px" title="${labelActiva}">
      <option value="">Todas las sedes</option>
      ${_sedes.map(s => `
        <option value="${s.id}" ${s.id === sedeActivaId ? "selected" : ""}>
          ${_esc(s.codigo)} · ${_esc(s.nombre)}${s.es_principal ? " ★" : ""}
        </option>`).join("")}
    </select>
    <button id="sedeGestionarBtn" class="btn-lock-trim" title="Gestionar sedes"
            style="padding:4px 6px;display:flex;align-items:center;justify-content:center">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>
      </svg>
    </button>
  `;

  pill.querySelector("#sedeSelectTop").addEventListener("change", (e) => {
    setSedeActivaId(e.target.value || null);
  });
  pill.querySelector("#sedeGestionarBtn").addEventListener("click", openModalSedes);
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL · LISTADO DE SEDES
═══════════════════════════════════════════════════════════════════ */

export function openModalSedes() {
  const rows = _sedes.length
    ? _sedes.map(s => `
        <tr>
          <td style="padding:12px 10px;font-weight:700;font-family:monospace">
            ${_esc(s.codigo)}
            ${s.es_principal ? `<span style="margin-left:6px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700">★ Principal</span>` : ""}
          </td>
          <td style="padding:12px 10px"><strong>${_esc(s.nombre)}</strong></td>
          <td style="padding:12px 10px;color:var(--t3);font-size:12.5px">${_esc([s.direccion, s.ciudad].filter(Boolean).join(", ") || "—")}</td>
          <td style="padding:12px 10px;text-align:right;white-space:nowrap">
            <button class="btn-outline" style="font-size:12px;padding:6px 12px" data-action="edit" data-id="${s.id}">Editar</button>
            ${s.es_principal ? "" : `<button class="btn-outline" style="font-size:12px;padding:6px 12px;margin-left:4px" data-action="principal" data-id="${s.id}">Hacer principal</button>`}
            ${s.es_principal ? "" : `<button class="btn-outline" style="font-size:12px;padding:6px 12px;margin-left:4px;color:#b91c1c;border-color:#fecaca" data-action="delete" data-id="${s.id}">Borrar</button>`}
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--t3)">
         Aún no hay sedes. Crea la primera con el botón de arriba.
       </td></tr>`;

  openModal(`
    <div class="modal" style="max-width:820px">
      <div class="modal-hd">
        <span class="modal-title">Gestionar sedes</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
          <p style="margin:0;color:var(--t3);font-size:13px">
            Las sedes son establecimientos internos de tu empresa. Fiscalmente todo se consolida en tu NIF.
          </p>
          <button id="btnNuevaSede" class="btn-modal-save" style="flex-shrink:0">+ Nueva sede</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--brd)">
              <th style="text-align:left;padding:10px;font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Código</th>
              <th style="text-align:left;padding:10px;font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Nombre</th>
              <th style="text-align:left;padding:10px;font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Dirección</th>
              <th style="text-align:right;padding:10px;font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Acciones</th>
            </tr>
          </thead>
          <tbody id="tblSedesBody">${rows}</tbody>
        </table>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--brd);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <button id="btnDesactivarSedes" class="btn-outline" style="font-size:12.5px;padding:7px 14px;color:#b91c1c;border-color:#fecaca">
            Desactivar función de sedes
          </button>
          <span style="font-size:11.5px;color:var(--t4);flex:1;min-width:200px">
            No se pierde ningún dato. Tus sedes y asignaciones quedan guardadas para reactivar luego.
          </span>
        </div>
      </div>
    </div>
  `);

  document.getElementById("btnNuevaSede").addEventListener("click", () => openModalNuevaSede());
  document.getElementById("btnDesactivarSedes").addEventListener("click", _desactivarSedes);

  document.getElementById("tblSedesBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "edit") {
      const s = getSedePorId(id);
      if (s) openModalNuevaSede(s);
    } else if (action === "principal") {
      await _marcarPrincipal(id);
      openModalSedes(); // recargar listado
    } else if (action === "delete") {
      await _borrarSede(id);
      openModalSedes();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL · NUEVA / EDITAR SEDE
═══════════════════════════════════════════════════════════════════ */

export function openModalNuevaSede(sedeEdit = null) {
  const editing = !!sedeEdit;
  const s = sedeEdit || {};
  const esPrimera = !editing && _sedes.length === 0;

  openModal(`
    <div class="modal" style="max-width:620px">
      <div class="modal-hd">
        <span class="modal-title">${editing ? "Editar sede" : "Nueva sede"}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field">
            <label>Código *</label>
            <input id="sf_codigo" class="ff-input" maxlength="10" style="text-transform:uppercase"
                   value="${_esc(s.codigo || "")}" placeholder="OFI, TDA1..." ${editing ? "readonly" : ""}/>
            <span style="font-size:11px;color:var(--t4)">2–10 letras/números, mayúsculas</span>
          </div>
          <div class="modal-field">
            <label>Nombre *</label>
            <input id="sf_nombre" class="ff-input" value="${_esc(s.nombre || "")}" placeholder="Oficina Central"/>
          </div>
        </div>

        <h4 style="margin:20px 0 10px;font-size:12.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Dirección</h4>
        <div class="modal-field">
          <label>Dirección</label>
          <textarea id="sf_dir" class="ff-input" rows="2">${_esc(s.direccion || "")}</textarea>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>C.P.</label><input id="sf_cp" class="ff-input" value="${_esc(s.codigo_postal || "")}"/></div>
          <div class="modal-field"><label>Ciudad</label><input id="sf_ciudad" class="ff-input" value="${_esc(s.ciudad || "")}"/></div>
        </div>
        <div class="modal-field"><label>Provincia</label><input id="sf_prov" class="ff-input" value="${_esc(s.provincia || "")}"/></div>

        <h4 style="margin:20px 0 10px;font-size:12.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Contacto (opcional)</h4>
        <div class="modal-grid2">
          <div class="modal-field"><label>Teléfono</label><input id="sf_tel" class="ff-input" value="${_esc(s.telefono || "")}"/></div>
          <div class="modal-field"><label>Email</label><input id="sf_email" type="email" class="ff-input" value="${_esc(s.email || "")}"/></div>
        </div>

        <h4 style="margin:20px 0 10px;font-size:12.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">
          Fiscal (opcional)
        </h4>
        <div class="modal-field">
          <label>Epígrafe IAE</label>
          <input id="sf_iae" class="ff-input" value="${_esc(s.epigrafe_iae || "")}" placeholder="Solo si declaras por establecimiento (modelo 840)"/>
        </div>

        ${esPrimera ? `
          <label style="display:flex;align-items:flex-start;gap:10px;margin-top:20px;padding:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;cursor:pointer">
            <input type="checkbox" id="sf_principal" checked style="margin-top:2px"/>
            <span style="font-size:13px">
              <strong>Marcar como sede principal</strong><br>
              <span style="color:var(--t3);font-size:12px">
                Será la que se use por defecto en nuevos documentos. Puedes cambiarla después.
              </span>
            </span>
          </label>
        ` : (!editing || !s.es_principal) ? `
          <label style="display:flex;align-items:center;gap:10px;margin-top:20px">
            <input type="checkbox" id="sf_principal" ${s.es_principal ? "checked" : ""}/>
            <span style="font-size:13px">Marcar como sede principal</span>
          </label>
        ` : ""}
      </div>

      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button id="btnGuardarSede" class="btn-modal-save">${editing ? "Guardar cambios" : "Crear sede"}</button>
      </div>
    </div>
  `);

  document.getElementById("sf_codigo").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  document.getElementById("btnGuardarSede").addEventListener("click", async () => {
    const codigo = document.getElementById("sf_codigo").value.trim().toUpperCase();
    const nombre = document.getElementById("sf_nombre").value.trim();
    if (!codigo || codigo.length < 2) { toast("El código es obligatorio (mínimo 2 caracteres)", "error"); return; }
    if (!/^[A-Z0-9]{2,10}$/.test(codigo)) { toast("El código solo admite letras mayúsculas y números", "error"); return; }
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }

    const payload = {
      codigo,
      nombre,
      direccion:     document.getElementById("sf_dir").value.trim() || null,
      codigo_postal: document.getElementById("sf_cp").value.trim() || null,
      ciudad:        document.getElementById("sf_ciudad").value.trim() || null,
      provincia:     document.getElementById("sf_prov").value.trim() || null,
      telefono:      document.getElementById("sf_tel").value.trim() || null,
      email:         document.getElementById("sf_email").value.trim() || null,
      epigrafe_iae:  document.getElementById("sf_iae").value.trim() || null,
    };

    const principalEl = document.getElementById("sf_principal");
    const marcarPrincipal = principalEl ? principalEl.checked : false;

    try {
      if (editing) {
        const { error } = await supabase.from("sedes")
          .update(payload).eq("id", s.id).eq("user_id", SESSION.user.id);
        if (error) throw error;
        if (marcarPrincipal && !s.es_principal) {
          await _marcarPrincipalInterno(s.id);
        }
        toast("Sede actualizada", "success");
      } else {
        // Antes de insertar: ¿hay una sede con ese código ya (aunque desactivada)?
        // Si la hay y está desactivada, reactivarla con los nuevos datos.
        // Si está activa, se produce el error 23505 habitual.
        const { data: existente } = await supabase.from("sedes")
          .select("id, activa").eq("user_id", SESSION.user.id)
          .eq("codigo", payload.codigo).maybeSingle();

        if (existente && !existente.activa) {
          // Reactivar
          if (marcarPrincipal) {
            await supabase.from("sedes")
              .update({ es_principal: false })
              .eq("user_id", SESSION.user.id)
              .eq("es_principal", true);
          }
          const { error } = await supabase.from("sedes")
            .update({ ...payload, activa: true, es_principal: marcarPrincipal })
            .eq("id", existente.id);
          if (error) throw error;
          toast("Sede reactivada", "success");
        } else {
          // Si marcamos principal, primero quitamos el flag de las demás
          if (marcarPrincipal) {
            await supabase.from("sedes")
              .update({ es_principal: false })
              .eq("user_id", SESSION.user.id)
              .eq("es_principal", true);
          }
          const insert = { ...payload, user_id: SESSION.user.id, es_principal: marcarPrincipal };
          const { error } = await supabase.from("sedes").insert(insert);
          if (error) throw error;
          toast("Sede creada", "success");
        }
      }
      closeModal();
      await _loadSedes();
      _renderPill();
      document.dispatchEvent(new CustomEvent("sedes:changed"));
      // Si veníamos del modal de listado, reabrirlo refrescado
      if (document.querySelector(".modal") === null) openModalSedes();
    } catch (e) {
      console.error("[guardarSede]", e);
      if (e.code === "23505") toast("Ya existe una sede con ese código", "error");
      else toast("Error al guardar la sede", "error");
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   OPERACIONES CRUD INTERNAS
═══════════════════════════════════════════════════════════════════ */

async function _marcarPrincipal(id) {
  const ok = await _marcarPrincipalInterno(id);
  if (ok) {
    await _loadSedes();
    _renderPill();
    document.dispatchEvent(new CustomEvent("sedes:changed"));
    toast("Sede principal actualizada", "success");
  }
}

async function _marcarPrincipalInterno(id) {
  try {
    // Paso 1: quitar principal de la actual (si hay)
    await supabase.from("sedes")
      .update({ es_principal: false })
      .eq("user_id", SESSION.user.id)
      .eq("es_principal", true);
    // Paso 2: marcar la nueva
    const { error } = await supabase.from("sedes")
      .update({ es_principal: true })
      .eq("id", id).eq("user_id", SESSION.user.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("[_marcarPrincipalInterno]", e);
    toast("No se pudo marcar como principal", "error");
    return false;
  }
}

async function _borrarSede(id) {
  const sede = getSedePorId(id);
  if (!sede) return;
  if (sede.es_principal) { toast("No puedes borrar la sede principal", "error"); return; }

  // Comprobar si tiene documentos asociados (en TODAS las tablas con sede_id)
  const usage = await _contarUsoSede(id);
  const total = usage._total || 0;

  // Construir resumen legible solo con las tablas que tienen > 0
  const etiquetas = {
    facturas: "facturas", albaranes: "albaranes", presupuestos: "presupuestos",
    proformas: "proformas", gastos: "gastos", trabajos: "trabajos",
    empleados: "empleados", nominas: "nóminas",
    facturas_recurrentes: "facturas recurrentes", gastos_recurrentes: "gastos recurrentes"
  };
  const resumen = Object.entries(etiquetas)
    .filter(([k]) => (usage[k] || 0) > 0)
    .map(([k, lbl]) => `${usage[k]} ${lbl}`)
    .join(", ");

  const confirmMsg = total > 0
    ? `Esta sede tiene ${total} registro${total !== 1 ? "s" : ""} asociado${total !== 1 ? "s" : ""} (${resumen}).\n\n¿Desactivarla? Los registros quedarán sin sede asignada pero no se perderán.`
    : "¿Borrar esta sede definitivamente?\n\nNo tiene ningún documento asociado.";

  if (!confirm(confirmMsg)) return;

  try {
    if (total > 0) {
      // Soft delete: solo desactivar
      const { error } = await supabase.from("sedes")
        .update({ activa: false }).eq("id", id).eq("user_id", SESSION.user.id);
      if (error) throw error;
      toast("Sede desactivada", "success");
    } else {
      // Hard delete
      const { error } = await supabase.from("sedes")
        .delete().eq("id", id).eq("user_id", SESSION.user.id);
      if (error) throw error;
      toast("Sede borrada", "success");
    }
    // Si la sede borrada era la activa, reset
    if (getSedeActivaId() === id) setSedeActivaId(null);
    await _loadSedes();
    _renderPill();
    document.dispatchEvent(new CustomEvent("sedes:changed"));
  } catch (e) {
    console.error("[_borrarSede]", e);
    toast("Error al borrar la sede", "error");
  }
}

async function _contarUsoSede(id) {
  // Cuenta registros de la sede en TODAS las tablas con sede_id.
  // Si alguna tabla no existe en la BD aún (ej. "nominas"), el error
  // se captura silenciosamente y ese conteo queda en 0.
  const tablas = ["facturas","albaranes","presupuestos","proformas","gastos",
                  "trabajos","empleados","nominas","facturas_recurrentes","gastos_recurrentes"];
  const head = (t) => supabase.from(t).select("id", { count: "exact", head: true })
    .eq("user_id", SESSION.user.id).eq("sede_id", id);
  try {
    const results = await Promise.all(tablas.map(t =>
      head(t).then(r => ({ t, count: r.count || 0, error: r.error }))
             .catch(() => ({ t, count: 0, error: null }))
    ));
    const out = {};
    let total = 0;
    for (const r of results) {
      out[r.t] = r.count;
      total += r.count;
    }
    out._total = total;
    return out;
  } catch (e) {
    console.error("[_contarUsoSede]", e);
    return { _total: 0 };
  }
}

async function _desactivarSedes() {
  const ok = confirm(
    "¿Desactivar la función de sedes?\n\n" +
    "Tus sedes y las asignaciones en documentos quedarán guardadas. " +
    "Podrás reactivar la función en cualquier momento sin perder nada."
  );
  if (!ok) return;
  try {
    const { error } = await supabase.from("perfil_fiscal")
      .update({ sedes_activo: false }).eq("user_id", SESSION.user.id);
    if (error) throw error;
    _sedesActivo = false;
    setSedeActivaId(null);
    _renderPill();
    closeModal();
    toast("Función de sedes desactivada", "success");
    document.dispatchEvent(new CustomEvent("sedes:changed"));
  } catch (e) {
    console.error("[_desactivarSedes]", e);
    toast("Error al desactivar", "error");
  }
}

/* ═══════════════════════════════════════════════════════════════════
   ACTIVACIÓN — Flujo opt-in
═══════════════════════════════════════════════════════════════════ */

/**
 * Muestra un modal de activación de la feature. Crea la primera sede
 * (copia datos desde perfil_fiscal como sugerencia) y pregunta si
 * asignar todos los documentos existentes a esa sede.
 */
export async function activarSedesFlow() {
  // Si ya está activa, simplemente abrir la gestión
  if (_sedesActivo) { openModalSedes(); return; }

  // Leer perfil_fiscal para pre-rellenar
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("domicilio_fiscal, nombre_razon_social")
    .eq("user_id", SESSION.user.id).maybeSingle();

  const nombreSugerido = pf?.nombre_razon_social
    ? (pf.nombre_razon_social.length > 30 ? "Sede Principal" : pf.nombre_razon_social)
    : "Sede Principal";

  openModal(`
    <div class="modal" style="max-width:600px">
      <div class="modal-hd">
        <span class="modal-title">Activar gestión multi-sede</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p style="color:var(--t3);font-size:13.5px;line-height:1.6;margin-top:0">
          La función de sedes te permite organizar tu empresa por establecimientos
          (oficina, tienda, almacén…). <strong>Fiscalmente no cambia nada</strong>:
          tu IVA, IRPF e IS siguen liquidándose sobre tu NIF. La sede es una
          dimensión organizativa interna.
        </p>

        <div style="background:var(--bg2);border-radius:10px;padding:16px;margin:16px 0">
          <strong style="display:block;margin-bottom:10px;font-size:13px">Vamos a crear tu primera sede:</strong>
          <div class="modal-field">
            <label>Código *</label>
            <input id="sf_act_codigo" class="ff-input" maxlength="10" value="CENTRAL" style="text-transform:uppercase"/>
          </div>
          <div class="modal-field">
            <label>Nombre *</label>
            <input id="sf_act_nombre" class="ff-input" value="${_esc(nombreSugerido)}"/>
          </div>
          <div class="modal-field">
            <label>Dirección</label>
            <textarea id="sf_act_dir" class="ff-input" rows="2">${_esc(pf?.domicilio_fiscal || "")}</textarea>
          </div>
        </div>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:14px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;cursor:pointer">
          <input type="checkbox" id="sf_act_backfill" checked style="margin-top:2px"/>
          <span style="font-size:13px">
            <strong>Asignar todos mis documentos existentes a esta sede</strong><br>
            <span style="color:#92400e;font-size:12px">
              Recomendado. Todas las facturas, gastos y demás que ya tienes se
              marcarán como emitidos desde esta sede. Desactiva si prefieres
              dejarlos "sin sede" y asignarlos manualmente.
            </span>
          </span>
        </label>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button id="btnConfActivarSedes" class="btn-modal-save">Activar sedes</button>
      </div>
    </div>
  `);

  document.getElementById("sf_act_codigo").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  document.getElementById("btnConfActivarSedes").addEventListener("click", async () => {
    const codigo = document.getElementById("sf_act_codigo").value.trim().toUpperCase();
    const nombre = document.getElementById("sf_act_nombre").value.trim();
    const direccion = document.getElementById("sf_act_dir").value.trim() || null;
    const backfill = document.getElementById("sf_act_backfill").checked;

    if (!/^[A-Z0-9]{2,10}$/.test(codigo)) { toast("Código inválido (2–10 letras/números)", "error"); return; }
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }

    const btn = document.getElementById("btnConfActivarSedes");
    btn.disabled = true; btn.textContent = "Activando…";

    try {
      // 1) Crear (o reactivar) la sede principal
      //    Si ya existe una sede con ese código pero está desactivada
      //    (caso: el usuario desactivó la feature antes y vuelve a activarla),
      //    la reactivamos en vez de intentar crear una duplicada — que
      //    chocaría con la UNIQUE (user_id, codigo).
      let sede;
      const { data: sedeExistente } = await supabase.from("sedes")
        .select("*").eq("user_id", SESSION.user.id).eq("codigo", codigo).maybeSingle();

      if (sedeExistente) {
        if (sedeExistente.activa) {
          throw { code: "23505", message: "Ya existe una sede activa con ese código" };
        }
        // Reactivar. Quitamos principal de las demás (por si hubiera alguna
        // activa, cosa improbable al estar la feature desactivada, pero
        // defensivo) y luego reactivamos esta marcándola principal.
        await supabase.from("sedes")
          .update({ es_principal: false })
          .eq("user_id", SESSION.user.id)
          .eq("es_principal", true);
        const { data: sedeReact, error: eReact } = await supabase.from("sedes")
          .update({
            activa: true,
            es_principal: true,
            nombre, direccion
          })
          .eq("id", sedeExistente.id)
          .select("*").single();
        if (eReact) throw eReact;
        sede = sedeReact;
      } else {
        const { data: sedeNueva, error: eIns } = await supabase.from("sedes")
          .insert({
            user_id: SESSION.user.id,
            codigo, nombre, direccion,
            es_principal: true
          })
          .select("*").single();
        if (eIns) throw eIns;
        sede = sedeNueva;
      }

      // 2) Activar el flag en perfil_fiscal
      const { error: ePf } = await supabase.from("perfil_fiscal")
        .update({ sedes_activo: true }).eq("user_id", SESSION.user.id);
      if (ePf) throw ePf;

      // 3) Backfill opcional
      if (backfill) {
        const tablas = ["facturas","albaranes","presupuestos","proformas","gastos",
                        "trabajos","empleados","nominas","facturas_recurrentes","gastos_recurrentes"];
        for (const t of tablas) {
          // Best-effort: si alguna tabla aún no tiene sede_id (migración no ejecutada),
          // logueamos pero seguimos.
          try {
            const { error } = await supabase.from(t)
              .update({ sede_id: sede.id })
              .eq("user_id", SESSION.user.id)
              .is("sede_id", null);
            if (error) console.warn(`[backfill ${t}]`, error.message);
          } catch (e) {
            console.warn(`[backfill ${t} excepción]`, e);
          }
        }
      }

      _sedesActivo = true;
      await _loadSedes();
      _renderPill();
      closeModal();
      toast("Función de sedes activada ✓", "success");
      document.dispatchEvent(new CustomEvent("sedes:activated"));
      document.dispatchEvent(new CustomEvent("sedes:changed"));
    } catch (e) {
      console.error("[activarSedesFlow]", e);
      if (e.code === "23505") toast("Ya existe una sede con ese código", "error");
      else toast("Error al activar: " + (e.message || "inténtalo de nuevo"), "error");
      btn.disabled = false; btn.textContent = "Activar sedes";
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════════════════════════════ */

/**
 * Devuelve el HTML de un selector de sede listo para inyectar en un
 * formulario de creación/edición de documento.
 *
 * Si la feature no está activa, devuelve "" (el formulario queda igual
 * que antes, como si la feature no existiera).
 *
 * Si no hay sedes creadas, también devuelve "" — no tiene sentido
 * mostrar un select vacío.
 *
 * @param {object}  opts
 * @param {string}  opts.inputId    · id del <select>. Debe ser único.
 * @param {string?} opts.selectedId · UUID preseleccionado; si se omite,
 *                                    usa la sede activa del topbar,
 *                                    y si tampoco hay, la principal.
 * @param {string?} opts.label      · Label encima del select. Default "Sede".
 * @param {boolean?} opts.required  · Si true, NO incluye opción "Sin sede".
 * @param {string?}  opts.wrapperClass · Clase del div contenedor. Default "modal-field".
 * @returns {string} HTML o ""
 */
export function renderSedeSelector({ inputId, selectedId, label = "Sede", required = false, wrapperClass = "modal-field" }) {
  if (!_sedesActivo) return "";
  if (_sedes.length === 0) return "";

  // Si no se pasó selectedId explícito, usamos la sede activa del topbar
  // o, en su defecto, la principal.
  let sel = selectedId;
  if (sel === undefined) {
    sel = getSedeActivaId() || getSedePrincipal()?.id || null;
  }

  const opcionVacia = required
    ? ""
    : `<option value="" ${!sel ? "selected" : ""}>— Sin sede asignada —</option>`;

  const opciones = _sedes.map(s => `
    <option value="${s.id}" ${s.id === sel ? "selected" : ""}>
      ${_esc(s.codigo)} · ${_esc(s.nombre)}${s.es_principal ? " ★" : ""}
    </option>
  `).join("");

  return `
    <div class="${wrapperClass}">
      <label>${_esc(label)}${required ? " *" : ""}</label>
      <select id="${_esc(inputId)}" class="ff-input">
        ${opcionVacia}
        ${opciones}
      </select>
    </div>
  `;
}

/**
 * Lee el valor de un selector renderizado con renderSedeSelector.
 * Devuelve null si la feature no está activa, si el select no existe
 * o si el usuario seleccionó "Sin sede asignada".
 *
 * Seguro de llamar siempre: en formularios donde no se inyectó el
 * selector (porque la feature está inactiva), devolverá null y se
 * guardará sede_id = null, que es el comportamiento correcto.
 */
export function readSedeIdFromForm(inputId) {
  if (!_sedesActivo) return null;
  const el = document.getElementById(inputId);
  if (!el) return null;
  const v = el.value;
  return v && v !== "" ? v : null;
}

/**
 * Devuelve el HTML de un chip visual compacto con el código de la sede,
 * para mostrar en listados. Devuelve "" si:
 *   - la feature está inactiva
 *   - no se proporcionó sede_id
 *   - hay una sede concreta seleccionada en el topbar (en ese caso todas
 *     las filas son de esa sede, sería ruido visual)
 *
 * Pensado para pegarlo a continuación del concepto en una celda de tabla.
 */
export function renderSedeChip(sedeId) {
  if (!_sedesActivo) return "";
  if (!sedeId) return "";
  // Si ya estamos filtrando por una sede concreta, no mostramos chip
  // en cada fila (sería redundante).
  if (getSedeActivaId()) return "";
  const s = getSedePorId(sedeId);
  if (!s) return "";
  return `<span style="display:inline-block;margin-left:6px;padding:1px 7px;background:var(--ox-lt);color:var(--ox);border-radius:10px;font-size:10px;font-weight:700;font-family:var(--font-mono,monospace);vertical-align:middle" title="Sede: ${_esc(s.nombre)}">${_esc(s.codigo)}</span>`;
}

function _esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Exponer activar globalmente para atajos (ej: botón en Ajustes)
window._activarSedes = activarSedesFlow;
