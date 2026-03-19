/* ═══════════════════════════════════════════════════════
   TAURIX · colaboradores.js
   
   Sistema multi-usuario con roles:
   · Propietario (owner) — acceso total
   · Gestor (manager) — puede crear/editar todo, no borrar
   · Colaborador (editor) — facturas y clientes
   · Solo lectura (viewer) — solo ver, sin editar
   · Contable (accountant) — contabilidad + informes
   
   Flujo:
   1. Propietario invita por email
   2. Invitado recibe email con enlace
   3. Accede con su propio login
   4. Taurix detecta su rol y limita la UI
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

/* ══════════════════════════
   ROLES Y PERMISOS
══════════════════════════ */
export const ROLES = {
  owner: {
    label: "Propietario",
    color: "#1a56db",
    icon: "👑",
    desc: "Acceso completo. Puede invitar y eliminar colaboradores.",
    permisos: ["*"]
  },
  manager: {
    label: "Gestor / Asesor",
    color: "#059669",
    icon: "💼",
    desc: "Puede crear y editar todo. No puede borrar datos ni gestionar colaboradores.",
    permisos: ["facturas.read","facturas.create","facturas.update","clientes.*","presupuestos.*",
               "gastos.*","fiscal.*","contabilidad.*","informes.*","nominas.*","empleados.*"]
  },
  accountant: {
    label: "Contable",
    color: "#8b5cf6",
    icon: "🧮",
    desc: "Acceso a contabilidad, fiscal e informes. Solo lectura en facturas y clientes.",
    permisos: ["facturas.read","clientes.read","contabilidad.*","fiscal.*","informes.*",
               "nominas.read","empleados.read"]
  },
  editor: {
    label: "Colaborador",
    color: "#f59e0b",
    icon: "✏️",
    desc: "Puede crear facturas, presupuestos y gestionar clientes. Sin acceso fiscal.",
    permisos: ["facturas.read","facturas.create","facturas.update","clientes.*","presupuestos.*","productos.*"]
  },
  viewer: {
    label: "Solo lectura",
    color: "#6b7280",
    icon: "👁",
    desc: "Solo puede ver. No puede crear ni editar nada.",
    permisos: ["facturas.read","clientes.read","presupuestos.read","productos.read","informes.read"]
  },
};

// Rol actual del usuario en sesión
let ROL_ACTUAL = "owner";
let OWNER_ID   = null;  // user_id del propietario de los datos que se está viendo

/* ══════════════════════════
   VERIFICAR ROL AL INICIAR
══════════════════════════ */
export async function initColaboradores() {
  if (!SESSION) return;

  // Buscar si este usuario es colaborador en alguna cuenta
  const { data: colaboracion } = await supabase.from("colaboradores")
    .select("*, owner_id, rol, estado")
    .eq("colaborador_id", SESSION.user.id)
    .eq("estado", "activo")
    .single();

  if (colaboracion) {
    // Es colaborador — cargar datos del propietario
    ROL_ACTUAL = colaboracion.rol;
    OWNER_ID   = colaboracion.owner_id;

    // Mostrar banner de colaborador
    mostrarBannerColaborador(colaboracion);

    // Aplicar restricciones de UI según rol
    aplicarRestriccionesRol(ROL_ACTUAL);

    return { esColaborador: true, rol: ROL_ACTUAL, ownerId: OWNER_ID };
  }

  // Es propietario
  ROL_ACTUAL = "owner";
  OWNER_ID   = SESSION.user.id;

  // Actualizar badge de colaboradores en configuración
  refreshBadgeColaboradores();

  return { esColaborador: false, rol: "owner", ownerId: SESSION.user.id };
}

export function getRolActual()  { return ROL_ACTUAL; }
export function getOwnerId()    { return OWNER_ID || SESSION?.user.id; }

/* ══════════════════════════
   VERIFICAR PERMISO
══════════════════════════ */
export function tienePermiso(permiso) {
  const rol = ROLES[ROL_ACTUAL];
  if (!rol) return false;
  if (rol.permisos.includes("*")) return true;
  if (rol.permisos.includes(permiso)) return true;
  // Check wildcard: "facturas.*" cubre "facturas.read", "facturas.create", etc.
  const [recurso] = permiso.split(".");
  return rol.permisos.includes(`${recurso}.*`);
}

export function requirePermiso(permiso) {
  if (!tienePermiso(permiso)) {
    toast(`Tu rol (${ROLES[ROL_ACTUAL]?.label}) no tiene permiso para esta acción`, "error");
    return false;
  }
  return true;
}

/* ══════════════════════════
   APLICAR RESTRICCIONES UI
══════════════════════════ */
function aplicarRestriccionesRol(rol) {
  const restricciones = {
    viewer: [
      "nuevoPresupuestoBtn","nuevaFacturaBtn","nuevoProdBtn","nuevoClienteBtn",
      "gastoRapidoBtn","nuevoAsientoBtn","nuevoEmpleadoBtn","generarNominaBtn",
      "serieConfigBtn","nuevaEmpresaTopBtn","cerrarTrimestreBtn",
      "importarProdBtn","subirDocBtn","nuevaOportunidadBtn"
    ],
    editor: [
      "nuevoAsientoBtn","nuevoEmpleadoBtn","generarNominaBtn",
      "serieConfigBtn","nuevaEmpresaTopBtn","cerrarTrimestreBtn"
    ],
    accountant: [
      "nuevoPresupuestoBtn","nuevoProdBtn","gastoRapidoBtn",
      "serieConfigBtn","nuevaEmpresaTopBtn","cerrarTrimestreBtn",
      "nuevoEmpleadoBtn","nuevaOportunidadBtn","importarProdBtn"
    ],
    manager: ["nuevaEmpresaTopBtn"],
  };

  const idsOcultar = restricciones[rol] || [];
  idsOcultar.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.opacity = "0.3";
      el.style.pointerEvents = "none";
      el.title = `Sin permiso (rol: ${ROLES[rol]?.label})`;
    }
  });

  // Ocultar secciones completas del sidebar para viewer
  if (rol === "viewer") {
    ["sn-item-nueva-factura","gastoRapidoBtn"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  // Sidebar: ocultar secciones de administración para no-owners
  if (rol !== "owner" && rol !== "manager") {
    document.querySelectorAll('[data-view="auditoria"],[data-view="documentos"]').forEach(el => {
      if (rol === "viewer") el.style.display = "none";
    });
  }
}

function mostrarBannerColaborador(col) {
  const banner = document.getElementById("onboardingBanner");
  if (!banner) return;
  banner.style.display = "";
  const rol = ROLES[col.rol];
  banner.innerHTML = `
    <div style="background:${rol?.color}15;border:1px solid ${rol?.color}44;border-radius:12px;padding:12px 18px;margin:12px 20px 0;display:flex;align-items:center;gap:12px">
      <span style="font-size:20px">${rol?.icon}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--t1)">
          Accediendo como <span style="color:${rol?.color}">${rol?.label}</span> en cuenta ajena
        </div>
        <div style="font-size:12px;color:var(--t3);margin-top:2px">
          ${rol?.desc} · <button onclick="window._verMisPermisos()" style="background:none;border:none;color:${rol?.color};cursor:pointer;font-size:12px;font-weight:600;padding:0">Ver mis permisos →</button>
        </div>
      </div>
      <button onclick="window._salirDeCuenta()" style="background:none;border:1px solid var(--brd);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:var(--t3)">
        Salir de esta cuenta
      </button>
    </div>`;
}

window._verMisPermisos = () => {
  const rol = ROLES[ROL_ACTUAL];
  openModal(`
    <div class="modal" style="max-width:480px">
      <div class="modal-hd">
        <span class="modal-title">${rol?.icon} Tus permisos — ${rol?.label}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p style="font-size:13px;color:var(--t2);margin-bottom:16px;line-height:1.6">${rol?.desc}</p>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Lo que puedes hacer:</div>
        ${(rol?.permisos||[]).map(p => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--brd);font-size:12px">
            <span style="color:#059669">✓</span> ${p === "*" ? "Acceso completo a todo" : p.replace(".*"," — todas las acciones").replace(".read"," — solo lectura").replace(".create"," — crear").replace(".update"," — editar")}
          </div>`).join("")}
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
};

window._salirDeCuenta = async () => {
  await supabase.auth.signOut();
  window.location.reload();
};

/* ══════════════════════════
   GESTIÓN DE COLABORADORES
   (solo para propietarios)
══════════════════════════ */
export async function loadColaboradores() {
  const { data, error } = await supabase.from("colaboradores")
    .select("*").eq("owner_id", SESSION.user.id)
    .order("created_at", { ascending: false });
  if (error) { console.error("colaboradores:", error.message); return []; }
  return data || [];
}

async function refreshBadgeColaboradores() {
  const lista = await loadColaboradores();
  const activos = lista.filter(c => c.estado === "activo").length;
  const badge = document.getElementById("colaboradoresBadge");
  if (badge) { badge.textContent = activos || ""; badge.style.display = activos ? "" : "none"; }
}

export async function refreshColaboradoresView() {
  const lista = await loadColaboradores();
  renderColaboradoresTable(lista);
}

function renderColaboradoresTable(lista) {
  const tbody = document.getElementById("colaboradoresBody");
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = `
      <tr class="dt-empty">
        <td colspan="5">
          <div style="text-align:center;padding:32px 20px">
            <div style="font-size:40px;margin-bottom:12px">👥</div>
            <div style="font-size:14px;font-weight:600;margin-bottom:6px">Sin colaboradores aún</div>
            <div style="font-size:12px;color:var(--t3)">Invita a tu gestor, asesor o equipo para que accedan con sus propias credenciales y su rol.</div>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = lista.map(c => {
    const rol = ROLES[c.rol] || ROLES.viewer;
    const estadoBadge = {
      activo:   `<span class="badge b-cobrada">Activo</span>`,
      pendiente:`<span class="badge b-pendiente">Invitación pendiente</span>`,
      revocado: `<span class="badge" style="background:#f3f4f6;color:#6b7280">Revocado</span>`,
    }[c.estado] || "";

    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px">${c.email}</div>
        <div style="font-size:11px;color:var(--t3)">${c.nombre || ""}</div>
      </td>
      <td>
        <span style="background:${rol.color}18;color:${rol.color};padding:3px 10px;border-radius:8px;font-size:12px;font-weight:700">
          ${rol.icon} ${rol.label}
        </span>
      </td>
      <td>${estadoBadge}</td>
      <td style="font-size:12px;color:var(--t3)">${fmtDate(c.created_at?.slice(0,10))}</td>
      <td>
        <div class="tbl-act">
          ${c.estado === "activo" ? `
            <button class="ta-btn" onclick="window._editColaborador('${c.id}')" title="Cambiar rol">✏️</button>
            <button class="ta-btn ta-del" onclick="window._revocarColaborador('${c.id}')" title="Revocar acceso">🚫</button>
          ` : c.estado === "pendiente" ? `
            <button class="ta-btn" onclick="window._reenviarInvitacion('${c.id}')" title="Reenviar invitación">📧</button>
            <button class="ta-btn ta-del" onclick="window._revocarColaborador('${c.id}')" title="Cancelar">🗑️</button>
          ` : `
            <button class="ta-btn" onclick="window._reactivarColaborador('${c.id}')" title="Reactivar">🔄</button>
          `}
        </div>
      </td>
    </tr>`;
  }).join("");
}

/* ══════════════════════════
   MODAL INVITAR COLABORADOR
══════════════════════════ */
export function showInvitarColaboradorModal() {
  openModal(`
    <div class="modal" style="max-width:580px">
      <div class="modal-hd">
        <span class="modal-title">➕ Invitar colaborador</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-field"><label>Email del colaborador *</label>
          <input autocomplete="off" id="inv_email" type="email" class="ff-input" placeholder="gestor@asesoriaejemplo.com"/>
        </div>
        <div class="modal-field"><label>Nombre (opcional)</label>
          <input autocomplete="off" id="inv_nombre" class="ff-input" placeholder="Ej: María García — Gestoría López"/>
        </div>
        <div class="modal-field"><label>Rol *</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px" id="inv_roles">
            ${Object.entries(ROLES).filter(([k]) => k !== "owner").map(([key, rol]) => `
              <label style="display:flex;align-items:flex-start;gap:12px;padding:12px;border:1.5px solid var(--brd);border-radius:10px;cursor:pointer;transition:all .15s" id="inv_rol_wrap_${key}">
                <input autocomplete="off" type="radio" name="inv_rol" value="${key}" ${key === "manager" ? "checked" : ""}
                       onchange="window._onRolChange('${key}')"
                       style="margin-top:3px;accent-color:${rol.color}"/>
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:700;color:var(--t1)">${rol.icon} ${rol.label}</div>
                  <div style="font-size:12px;color:var(--t3);margin-top:2px">${rol.desc}</div>
                </div>
              </label>`).join("")}
          </div>
        </div>

        <div style="background:#eff6ff;border-radius:10px;padding:12px 16px;margin-top:8px;font-size:12px;color:#1d4ed8;line-height:1.6">
          📧 El colaborador recibirá un email con instrucciones para acceder. Podrá entrar con Google o con email/contraseña. Sus datos de acceso son independientes de los tuyos.
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="inv_save">Enviar invitación</button>
      </div>
    </div>`);

  // Highlight selected role card
  window._onRolChange = (key) => {
    Object.keys(ROLES).filter(k=>k!=="owner").forEach(k => {
      const wrap = document.getElementById(`inv_rol_wrap_${k}`);
      if (wrap) {
        wrap.style.borderColor = k === key ? ROLES[k].color : "var(--brd)";
        wrap.style.background  = k === key ? `${ROLES[k].color}08` : "";
      }
    });
  };
  // Init highlight
  window._onRolChange("manager");

  document.getElementById("inv_save").addEventListener("click", async () => {
    const email  = document.getElementById("inv_email").value.trim().toLowerCase();
    const nombre = document.getElementById("inv_nombre").value.trim();
    const rol    = document.querySelector('input[name="inv_rol"]:checked')?.value || "viewer";

    if (!email || !email.includes("@")) { toast("Email inválido", "error"); return; }

    // Comprobar si ya existe
    const { data: existente } = await supabase.from("colaboradores")
      .select("id,estado").eq("owner_id", SESSION.user.id).eq("email", email).single();

    if (existente) {
      if (existente.estado === "activo") {
        toast("Este email ya tiene acceso activo a tu cuenta", "error"); return;
      }
      // Reactivar invitación pendiente
      await supabase.from("colaboradores").update({ rol, estado:"pendiente", nombre })
        .eq("id", existente.id);
    } else {
      // Crear nueva invitación
      const { error } = await supabase.from("colaboradores").insert({
        owner_id:       SESSION.user.id,
        email,
        nombre:         nombre || null,
        rol,
        estado:         "pendiente",
        token_invitacion: crypto.randomUUID(),
        created_at:     new Date().toISOString(),
      });
      if (error) { toast("Error: " + error.message, "error"); return; }
    }

    // Enviar email de invitación via Supabase Edge Function (si está configurada)
    // Por ahora: mostrar el enlace manual
    toast(`✅ Invitación registrada para ${email}. El colaborador debe crear una cuenta en Taurix con ese email para acceder.`, "success", 7000);
    closeModal();
    await refreshColaboradoresView();
  });
}

/* ══════════════════════════
   ACCIONES SOBRE COLABORADORES
══════════════════════════ */
window._editColaborador = async (id) => {
  const lista = await loadColaboradores();
  const col = lista.find(c => c.id === id);
  if (!col) return;

  openModal(`
    <div class="modal" style="max-width:480px">
      <div class="modal-hd">
        <span class="modal-title">✏️ Cambiar rol — ${col.email}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-field"><label>Nuevo rol</label>
          <select id="edit_rol" class="ff-select">
            ${Object.entries(ROLES).filter(([k])=>k!=="owner").map(([k,r])=>`
              <option value="${k}" ${col.rol===k?"selected":""}>${r.icon} ${r.label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="edit_rol_save">Guardar</button>
      </div>
    </div>`);

  document.getElementById("edit_rol_save").addEventListener("click", async () => {
    const nuevoRol = document.getElementById("edit_rol").value;
    await supabase.from("colaboradores").update({ rol: nuevoRol }).eq("id", id);
    closeModal(); toast("Rol actualizado ✅", "success");
    await refreshColaboradoresView();
  });
};

window._revocarColaborador = (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Revocar acceso</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Revocar el acceso de este colaborador? Dejará de poder entrar a tu cuenta inmediatamente.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_rcOk">Sí, revocar</button></div></div>`);
  document.getElementById("_rcOk").addEventListener("click", async () => {
    await supabase.from("colaboradores").update({ estado:"revocado" }).eq("id", id);
    closeModal(); toast("Acceso revocado", "success");
    await refreshColaboradoresView();
  });
};

window._reactivarColaborador = async (id) => {
  await supabase.from("colaboradores").update({ estado:"activo" }).eq("id", id);
  toast("Colaborador reactivado ✅", "success");
  await refreshColaboradoresView();
};

window._reenviarInvitacion = (id) => {
  toast("Para reenviar: el colaborador debe registrarse en taurix.es con el email al que invitaste", "info", 5000);
};

/* ══════════════════════════
   INIT VIEW
══════════════════════════ */
export function initColaboradoresView() {
  document.getElementById("invitarColaboradorBtn")?.addEventListener("click", showInvitarColaboradorModal);
  refreshColaboradoresView();
}
