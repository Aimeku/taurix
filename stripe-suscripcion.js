/* ═══════════════════════════════════════════════════════════════════
   TAURIX · stripe-suscripcion.js
   Gestión completa de suscripciones en el frontend:
     · checkSubscription()    → guard de acceso a la app
     · showPlanSelector()     → overlay de selección de plan (primera vez)
     · renderPlanTab()        → HTML del tab "Plan" en Ajustes
     · initPlanTab()          → listeners del tab "Plan"
     · abrirPortalStripe()    → redirige al portal de Stripe
   ═══════════════════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { toast }    from "./utils.js";

const PROJECT_ID   = "biiyzjzdvuahajndltap";
const ANON_KEY     = "sb_publishable_0N1Nv7SkjpynYh10lieang_uUoHRHOf";
const EDGE_BASE    = `https://${PROJECT_ID}.supabase.co/functions/v1`;

/* ── Estados válidos para acceder a la app ── */
const VALID_STATUSES = ["trialing", "active", "past_due"];

/* ── Quita el appCover (pantalla de carga inicial) ── */
export function removeAppCover() {
  const cover = document.getElementById("appCover");
  if (!cover) return;
  cover.style.opacity = "0";
  setTimeout(() => cover.remove(), 280);
}

/* ─────────────────────────────────────────────────────────────────
   checkSubscription
───────────────────────────────────────────────────────────────── */
export async function checkSubscription(userId) {
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) console.warn("[stripe-suscripcion] Error cargando sub:", error.message);

  if (sub?.is_admin) return { canAccess: true, subData: sub };

  if (!sub || !VALID_STATUSES.includes(sub.status)) {
    return { canAccess: false, subData: sub };
  }

  return { canAccess: true, subData: sub };
}

/* ─────────────────────────────────────────────────────────────────
   showPlanSelector
───────────────────────────────────────────────────────────────── */
export function showPlanSelector(subData = null) {
  removeAppCover();
  document.getElementById("planSelectorOverlay")?.remove();

  const esCancelado = subData?.status === "canceled";
  const esPastDue   = subData?.status === "past_due";

  const overlay = document.createElement("div");
  overlay.id = "planSelectorOverlay";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:#f2f3f7;
    display:flex;flex-direction:column;align-items:center;
    justify-content:flex-start;padding:48px 16px 48px;
    overflow-y:auto;font-family:var(--font,system-ui,sans-serif);
    opacity:0;transition:opacity .3s ease;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes ps-spin { to { transform:rotate(360deg); } }
      @keyframes ps-fadeup { from { opacity:0;transform:translateY(18px); } to { opacity:1;transform:translateY(0); } }

      .ps-card {
        flex:1;min-width:260px;max-width:310px;
        border-radius:20px;padding:32px 28px;
        background:#fff;
        border:2px solid #e5e7eb;
        box-shadow:0 2px 12px rgba(0,0,0,.06);
        transition:border-color .2s,box-shadow .2s,transform .2s;
        position:relative;cursor:pointer;
        animation:ps-fadeup .4s ease both;
      }
      .ps-card:hover {
        border-color:#f97316;
        box-shadow:0 8px 32px rgba(249,115,22,.14);
        transform:translateY(-3px);
      }
      .ps-card--featured {
        border-color:#f97316;
        box-shadow:0 8px 32px rgba(249,115,22,.18);
      }
      .ps-btn {
        width:100%;padding:13px;
        background:linear-gradient(135deg,#f97316,#fb923c);
        color:#fff;border:none;border-radius:12px;
        font-size:14px;font-weight:700;cursor:pointer;
        font-family:inherit;transition:opacity .15s,transform .15s;
        letter-spacing:.01em;
      }
      .ps-btn:hover { opacity:.92;transform:translateY(-1px); }
      .ps-btn:active { transform:translateY(0); }
      .ps-check {
        display:flex;align-items:flex-start;gap:10px;
        font-size:13px;color:#374151;margin-bottom:10px;line-height:1.45;
      }
      .ps-check-icon {
        width:18px;height:18px;border-radius:50%;
        background:linear-gradient(135deg,#f97316,#fb923c);
        color:#fff;font-size:10px;font-weight:800;
        display:flex;align-items:center;justify-content:center;
        flex-shrink:0;margin-top:1px;
      }
      .ps-badge-popular {
        position:absolute;top:-13px;left:50%;transform:translateX(-50%);
        background:linear-gradient(135deg,#f97316,#fb923c);
        color:#fff;font-size:11px;font-weight:700;
        padding:4px 14px;border-radius:20px;white-space:nowrap;
        box-shadow:0 2px 8px rgba(249,115,22,.35);letter-spacing:.03em;
      }
      .ps-divider {
        height:1px;background:#f3f4f6;margin:18px 0;
      }
    </style>

    <!-- Logo + título -->
    <div style="text-align:center;margin-bottom:36px;animation:ps-fadeup .35s ease both">
      <img src="Logo_Sin_Texto_transparent.png"
        style="width:60px;height:60px;border-radius:16px;margin-bottom:20px;
               box-shadow:0 4px 16px rgba(249,115,22,.2)" alt="Taurix"/>

      ${esCancelado ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:14px 22px;max-width:360px;margin:0 auto">
          <p style="font-size:14px;font-weight:700;color:#991b1b;margin:0 0 4px">Tu suscripción está cancelada</p>
          <p style="font-size:13px;color:#b91c1c;margin:0">Elige un plan para volver a tener acceso</p>
        </div>
      ` : esPastDue ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:14px 22px;max-width:360px;margin:0 auto">
          <p style="font-size:14px;font-weight:700;color:#92400e;margin:0 0 4px">Hay un problema con tu pago</p>
          <p style="font-size:13px;color:#78350f;margin:0">Actualiza tu método de pago para continuar</p>
        </div>
      ` : `
        <h1 style="font-size:26px;font-weight:800;color:#0d0f16;margin:0 0 10px;letter-spacing:-.02em">
          Elige tu plan
        </h1>
        <p style="font-size:14px;color:#6b7280;margin:0;line-height:1.6;max-width:340px">
          7 días de prueba gratuita · Sin permanencia · Cancela cuando quieras
        </p>
      `}
    </div>

    <!-- Tarjetas -->
    <div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center;width:100%;max-width:680px;margin-bottom:32px">

      <!-- Plan Autónomo -->
      <div class="ps-card" id="psCardAutonomo" data-plan="autonomo" style="animation-delay:.05s">
        <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">
          Autónomo
        </div>
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
          <span style="font-size:36px;font-weight:800;color:#0d0f16;letter-spacing:-.02em">19€</span>
          <span style="font-size:13px;color:#9ca3af;font-weight:500">/mes + IVA</span>
        </div>
        <p style="font-size:12.5px;color:#6b7280;margin:0 0 20px;line-height:1.5">
          Para freelances y trabajadores por cuenta propia
        </p>
        <div class="ps-divider"></div>
        <div style="margin-bottom:22px">
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Facturas, presupuestos y albaranes</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Modelos 130, 303 y 390</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>IRPF y gastos deducibles</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Régimen de autónomos</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Gestor IA 24h</span></div>
        </div>
        <button class="ps-btn" data-plan="autonomo">Empezar 7 días gratis</button>
      </div>

      <!-- Plan Sociedad -->
      <div class="ps-card ps-card--featured" id="psCardSociedad" data-plan="sociedad" style="animation-delay:.12s">
        <div class="ps-badge-popular">⭐ Más popular</div>
        <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">
          Sociedad
        </div>
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
          <span style="font-size:36px;font-weight:800;color:#0d0f16;letter-spacing:-.02em">29€</span>
          <span style="font-size:13px;color:#9ca3af;font-weight:500">/mes + IVA</span>
        </div>
        <p style="font-size:12.5px;color:#6b7280;margin:0 0 20px;line-height:1.5">
          Para SL, SA y pymes con trabajadores
        </p>
        <div class="ps-divider"></div>
        <div style="margin-bottom:22px">
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Todo lo del plan Autónomo</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Contabilidad y libro diario</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Impuesto de Sociedades</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>SL, SA y otras formas jurídicas</span></div>
          <div class="ps-check"><span class="ps-check-icon">✓</span><span>Múltiples sedes</span></div>
        </div>
        <button class="ps-btn" data-plan="sociedad">Empezar 7 días gratis</button>
      </div>

    </div>

    <!-- Nota legal -->
    <p style="font-size:11.5px;color:#9ca3af;text-align:center;max-width:400px;line-height:1.7;margin:0;animation:ps-fadeup .4s ease .2s both">
      Al continuar aceptas los
      <a href="#" onclick="document.getElementById('openTerminos')?.click();return false"
        style="color:#f97316;text-decoration:none;font-weight:600">Términos de servicio</a>.
      No se realizará ningún cargo hasta el día 8.
      Cancela en cualquier momento desde Ajustes.
    </p>

    <!-- Spinner -->
    <div id="planSelectorSpinner" style="display:none;margin-top:28px;text-align:center">
      <div style="width:34px;height:34px;border:3px solid #e5e7eb;border-top-color:#f97316;
                  border-radius:50%;animation:ps-spin .7s linear infinite;margin:0 auto 12px"></div>
      <p style="font-size:13px;color:#6b7280;margin:0">Redirigiendo a la pasarela de pago…</p>
    </div>

    <!-- Error -->
    <div id="planSelectorError" style="display:none;margin-top:16px;background:#fef2f2;
      border:1px solid #fecaca;border-radius:12px;padding:12px 18px;
      font-size:13px;color:#991b1b;text-align:center;max-width:420px">
    </div>
  `;

  document.body.appendChild(overlay);

  // Animación de entrada
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { overlay.style.opacity = "1"; });
  });

  // Eventos botones
  overlay.querySelectorAll(".ps-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await _iniciarCheckout(btn.dataset.plan);
    });
  });

  // Click en tarjeta
  overlay.querySelectorAll(".ps-card").forEach(card => {
    card.addEventListener("click", async () => {
      await _iniciarCheckout(card.dataset.plan);
    });
  });
}

/* ─────────────────────────────────────────────────────────────────
   _iniciarCheckout  (privado)
───────────────────────────────────────────────────────────────── */
async function _iniciarCheckout(plan) {
  const btns    = document.querySelectorAll(".ps-btn");
  const spinner = document.getElementById("planSelectorSpinner");
  const errEl   = document.getElementById("planSelectorError");

  btns.forEach(b => { b.disabled = true; b.style.opacity = ".5"; });
  if (spinner) spinner.style.display = "";
  if (errEl)   errEl.style.display   = "none";

  try {
    const session = await supabase.auth.getSession();
    const token   = session.data.session?.access_token;

    const resp = await fetch(`${EDGE_BASE}/create-checkout-session`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey":        ANON_KEY,
      },
      body: JSON.stringify({ plan }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.url) throw new Error(data.error || "Error creando sesión de pago");

    window.location.href = data.url;

  } catch (err) {
    console.error("[planSelector] Error:", err);
    btns.forEach(b => { b.disabled = false; b.style.opacity = "1"; });
    if (spinner) spinner.style.display = "none";
    if (errEl) {
      errEl.textContent = "Error al conectar con el servidor. Inténtalo de nuevo.";
      errEl.style.display = "";
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   abrirPortalStripe
───────────────────────────────────────────────────────────────── */
export async function abrirPortalStripe() {
  try {
    const session = await supabase.auth.getSession();
    const token   = session.data.session?.access_token;

    const resp = await fetch(`${EDGE_BASE}/create-portal-session`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey":        ANON_KEY,
      },
    });

    const data = await resp.json();
    if (!resp.ok || !data.url) throw new Error(data.error || "Error abriendo portal");

    window.location.href = data.url;
  } catch (err) {
    console.error("[portalStripe] Error:", err);
    toast("No se pudo abrir el portal de suscripción. Inténtalo de nuevo.", "error");
  }
}

/* ─────────────────────────────────────────────────────────────────
   renderPlanTab
───────────────────────────────────────────────────────────────── */
export function renderPlanTab(subData) {
  const status   = subData?.status  ?? "sin_plan";
  const plan     = subData?.plan    ?? null;
  const isAdmin  = subData?.is_admin ?? false;

  const statusConfig = {
    trialing:   { label: "Periodo de prueba",    color: "#0284c7", bg: "#e0f2fe" },
    active:     { label: "Activo",               color: "#15803d", bg: "#dcfce7" },
    past_due:   { label: "Pago pendiente",       color: "#b45309", bg: "#fef9c3" },
    canceled:   { label: "Cancelado",            color: "#dc2626", bg: "#fee2e2" },
    incomplete: { label: "Pendiente de activar", color: "#6b7280", bg: "#f3f4f6" },
    sin_plan:   { label: "Sin suscripción",      color: "#6b7280", bg: "#f3f4f6" },
  };
  const sc = statusConfig[status] || statusConfig["sin_plan"];
  const planLabel = plan === "sociedad" ? "Sociedad" : plan === "autonomo" ? "Autónomo" : "—";

  let fechaInfo = "";
  if (status === "trialing" && subData?.trial_ends_at) {
    const trialEnd = new Date(subData.trial_ends_at);
    const diasRestantes = Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000));
    fechaInfo = `<p style="font-size:12.5px;color:var(--t3);margin:4px 0 0">
      Periodo de prueba hasta el <strong>${trialEnd.toLocaleDateString("es-ES")}</strong>
      ${diasRestantes > 0 ? `(${diasRestantes} día${diasRestantes !== 1 ? "s" : ""} restante${diasRestantes !== 1 ? "s" : ""})` : "(hoy termina)"}
    </p>`;
  } else if (status === "active" && subData?.current_period_end) {
    const nextBill = new Date(subData.current_period_end);
    fechaInfo = `<p style="font-size:12.5px;color:var(--t3);margin:4px 0 0">
      Próximo cargo: <strong>${nextBill.toLocaleDateString("es-ES")}</strong>
    </p>`;
  } else if (status === "canceled" && subData?.current_period_end) {
    const endDate = new Date(subData.current_period_end);
    if (endDate > new Date()) {
      fechaInfo = `<p style="font-size:12.5px;color:var(--t3);margin:4px 0 0">
        Acceso hasta: <strong>${endDate.toLocaleDateString("es-ES")}</strong>
      </p>`;
    }
  }

  if (isAdmin) {
    return `
      <div style="padding:24px 28px 28px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 18px">
          <p style="font-size:13px;font-weight:700;color:#15803d;margin:0 0 4px">Cuenta de administrador</p>
          <p style="font-size:12.5px;color:#166534;margin:0">Acceso completo sin restricciones.</p>
        </div>
      </div>`;
  }

  return `
    <div style="padding:24px 28px 28px">
      <div style="background:var(--bg2,#f8f9fc);border:1px solid var(--brd);border-radius:12px;padding:16px 18px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <p style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin:0 0 4px">Plan</p>
            <p style="font-size:15px;font-weight:700;color:var(--t1);margin:0">${planLabel}</p>
            ${fechaInfo}
          </div>
          <span style="padding:4px 10px;border-radius:20px;font-size:11.5px;font-weight:700;
                       background:${sc.bg};color:${sc.color}">
            ${sc.label}
          </span>
        </div>
      </div>

      ${status === "past_due" ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-bottom:16px">
          <p style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 4px">Problema con el pago</p>
          <p style="font-size:12.5px;color:#78350f;margin:0;line-height:1.5">
            No se pudo cobrar la última factura. Actualiza tu método de pago para no perder el acceso.
          </p>
        </div>` : ""}

      ${(status === "trialing" || status === "active" || status === "past_due") ? `
        <button id="ajPlanPortalBtn"
          style="width:100%;padding:12px;background:linear-gradient(135deg,#f97316,#fb923c);color:#fff;
                 border:none;border-radius:10px;font-size:14px;font-weight:700;
                 cursor:pointer;font-family:inherit;margin-bottom:10px;transition:opacity .15s">
          Gestionar suscripción
        </button>
        <p style="font-size:11px;color:var(--t4);margin:0;line-height:1.5;text-align:center">
          Cambia de plan, actualiza tu tarjeta o cancela desde el portal de Stripe.
        </p>
      ` : `
        <button id="ajPlanReactivarBtn"
          style="width:100%;padding:12px;background:linear-gradient(135deg,#f97316,#fb923c);color:#fff;
                 border:none;border-radius:10px;font-size:14px;font-weight:700;
                 cursor:pointer;font-family:inherit;transition:opacity .15s">
          Activar suscripción
        </button>
      `}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────────
   initPlanTab
───────────────────────────────────────────────────────────────── */
export function initPlanTab(subData) {
  document.getElementById("ajPlanPortalBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Abriendo portal…";
    await abrirPortalStripe();
    btn.disabled = false;
    btn.textContent = "Gestionar suscripción";
  });

  document.getElementById("ajPlanReactivarBtn")?.addEventListener("click", () => {
    document.getElementById("ajustesModal")?.remove();
    showPlanSelector(subData);
  });
}
