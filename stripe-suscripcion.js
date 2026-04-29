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
  cover.style.transition = "opacity .25s ease";
  cover.style.opacity = "0";
  setTimeout(() => cover.remove(), 260);
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
  document.getElementById("planSelectorOverlay")?.remove();

  const esCancelado = subData?.status === "canceled";
  const esPastDue   = subData?.status === "past_due";

  const overlay = document.createElement("div");
  overlay.id = "planSelectorOverlay";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:var(--bg1,#f2f3f7);
    display:flex;flex-direction:column;align-items:center;
    justify-content:flex-start;padding:48px 16px 48px;
    overflow-y:auto;font-family:var(--font,system-ui,sans-serif);
    opacity:1;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes ps-spin { to { transform:rotate(360deg); } }
      #planSelectorOverlay .lp-plan:hover { transform: none !important; }
      #planSelectorOverlay .lp-plan-btn--autonomo:hover,
      #planSelectorOverlay .lp-plan-btn--pro:hover { transform: none !important; }
    </style>

    <!-- Logo -->
    <img src="Logo_Sin_Texto_transparent.png"
      style="width:56px;height:56px;border-radius:14px;margin-bottom:24px;
             box-shadow:0 4px 16px rgba(249,115,22,.2)" alt="Taurix"/>

    <!-- Título / aviso -->
    ${esCancelado ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;
                  padding:14px 22px;max-width:400px;margin:0 0 28px;text-align:center">
        <p style="font-size:14px;font-weight:700;color:#991b1b;margin:0 0 4px">Tu suscripción está cancelada</p>
        <p style="font-size:13px;color:#b91c1c;margin:0">Elige un plan para volver a tener acceso</p>
      </div>
    ` : esPastDue ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;
                  padding:14px 22px;max-width:400px;margin:0 0 28px;text-align:center">
        <p style="font-size:14px;font-weight:700;color:#92400e;margin:0 0 4px">Hay un problema con tu pago</p>
        <p style="font-size:13px;color:#78350f;margin:0">Actualiza tu método de pago para continuar</p>
      </div>
    ` : `
      <h1 style="font-family:var(--font-hd,'Plus Jakarta Sans',system-ui);
                 font-size:clamp(24px,4vw,36px);font-weight:900;
                 color:var(--t1,#0d0f16);margin:0 0 10px;
                 letter-spacing:-1.5px;text-align:center">
        Elige tu plan
      </h1>
      <p class="lp-section-sub" style="text-align:center;margin-bottom:40px;font-size:15px">
        Elige el plan que se adapta a tu actividad · Sin permanencia · Cancela cuando quieras
      </p>
    `}

    <!-- Tarjetas — reutiliza exactamente las clases de la landing -->
    <div class="lp-planes lp-planes--2col" style="width:100%;margin-bottom:28px">

      <!-- Plan Autónomo -->
      <div class="lp-plan lp-plan--autonomo plan-select-card" data-plan="autonomo" style="cursor:pointer">
        <div class="lp-plan-badge lp-plan-badge--autonomo">⏳ Oferta por tiempo limitado</div>
        <div class="lp-plan-tier-label">AUTÓNOMOS</div>
        <div class="lp-plan-name">Plan Autónomo</div>
        <div class="lp-plan-tagline">Para freelances y trabajadores por cuenta propia</div>
        <div class="lp-plan-price-wrap">
          <span class="lp-plan-eur-tachado">29€</span>
          <div class="lp-plan-price">
            <span class="lp-plan-eur">19€</span>
            <span class="lp-plan-per">/mes IVA inc.</span>
          </div>
        </div>
        <div class="lp-plan-promo">Precio bloqueado de por vida</div>
        <div class="lp-plan-promo" style="background:linear-gradient(135deg,#0284c7,#0ea5e9);color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;margin-top:4px;display:inline-block">7 días de prueba gratuita</div>
        <ul class="lp-plan-features" style="margin-top:18px">
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>Facturas, presupuestos y albaranes sin límite</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>IVA (Modelo 303) e IRPF (Modelo 130)</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>IRPF y gastos deducibles</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>Régimen de autónomos</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>Gestor IA — tu asesor 24h</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>Dashboard fiscal en tiempo real</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>Tesorería y control de cobros</strong></li>
          <li><span class="lp-check lp-check--autonomo">✓</span> <strong>Libros oficiales AEAT en PDF</strong></li>
        </ul>
        <button class="lp-plan-btn lp-plan-btn--autonomo plan-select-btn" data-plan="autonomo">
          Empezar 7 días gratis →
        </button>
        <div class="lp-plan-note">Sin permanencia · Cancela cuando quieras</div>
      </div>

      <!-- Plan Sociedad -->
      <div class="lp-plan lp-plan--sociedad lp-plan--featured plan-select-card" data-plan="sociedad" style="cursor:pointer">
        <div class="lp-plan-badge lp-plan-badge--star">⏳ Oferta por tiempo limitado</div>
        <div class="lp-plan-tier-label lp-plan-tier-label--sociedad">SOCIEDADES</div>
        <div class="lp-plan-name">Plan Sociedades</div>
        <div class="lp-plan-tagline">Para SL, SA y pymes con trabajadores</div>
        <div class="lp-plan-price-wrap">
          <span class="lp-plan-eur-tachado">59€</span>
          <div class="lp-plan-price">
            <span class="lp-plan-eur lp-plan-eur--sociedad">29€</span>
            <span class="lp-plan-per">/mes IVA inc.</span>
          </div>
        </div>
        <div class="lp-plan-promo lp-plan-promo--sociedad">Precio bloqueado de por vida</div>
        <div class="lp-plan-promo lp-plan-promo--sociedad" style="background:linear-gradient(135deg,#0284c7,#0ea5e9);color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;margin-top:4px;display:inline-block">7 días de prueba gratuita</div>
        <ul class="lp-plan-features" style="margin-top:18px">
          <li><span class="lp-check lp-check--pro">✓</span> <strong>Todo lo del plan Autónomo</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>IVA (Modelo 303) e Impuesto de Sociedades</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>Contabilidad y libro diario</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>Gestión de clientes y gastos deducibles</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>Gestor IA — tu asesor 24h</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>Dashboard fiscal en tiempo real</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>SL, SA y otras formas jurídicas</strong></li>
          <li><span class="lp-check lp-check--pro">✓</span> <strong>Múltiples sedes</strong></li>
        </ul>
        <button class="lp-plan-btn lp-plan-btn--pro plan-select-btn" data-plan="sociedad">
          Empezar 7 días gratis →
        </button>
        <div class="lp-plan-note">Sin permanencia · Cancela cuando quieras</div>
      </div>

    </div>

    <!-- Nota legal -->
    <p style="font-size:12px;color:var(--t4,#9ca3af);text-align:center;
              max-width:420px;line-height:1.7;margin:0">
      Al continuar aceptas los
      <a href="#" onclick="document.getElementById('openTerminos')?.click();return false"
        style="color:var(--ox,#f97316);text-decoration:none;font-weight:600">Términos de servicio</a>.
      No se realizará ningún cargo hasta el día 8.
      Cancela en cualquier momento desde Ajustes.
    </p>

    <!-- Spinner -->
    <div id="planSelectorSpinner" style="display:none;margin-top:28px;text-align:center">
      <div style="width:32px;height:32px;border:3px solid var(--brd,#e5e7eb);
                  border-top-color:var(--ox,#f97316);border-radius:50%;
                  animation:ps-spin .7s linear infinite;margin:0 auto 12px"></div>
      <p style="font-size:13px;color:var(--t3,#6b7280);margin:0">Redirigiendo a la pasarela de pago…</p>
    </div>

    <!-- Error -->
    <div id="planSelectorError" style="display:none;margin-top:16px;background:#fef2f2;
      border:1px solid #fecaca;border-radius:12px;padding:12px 18px;
      font-size:13px;color:#991b1b;text-align:center;max-width:420px">
    </div>
  `;

  document.body.appendChild(overlay);

  // removeAppCover fade out (overlay ya visible debajo)
  removeAppCover();

  // Eventos botones
  overlay.querySelectorAll(".plan-select-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await _iniciarCheckout(btn.dataset.plan);
    });
  });

  // Click en tarjeta también activa
  overlay.querySelectorAll(".plan-select-card").forEach(card => {
    card.addEventListener("click", async () => {
      await _iniciarCheckout(card.dataset.plan);
    });
  });
}

/* ─────────────────────────────────────────────────────────────────
   _iniciarCheckout  (privado)
───────────────────────────────────────────────────────────────── */
async function _iniciarCheckout(plan) {
  const btns    = document.querySelectorAll(".plan-select-btn");
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
