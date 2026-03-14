import { supabase } from "./supabase.js";

/* ══════════════════════════
   GOOGLE OAUTH
══════════════════════════ */
export async function login() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://aimeku.github.io/tugestor/",
        queryParams: { prompt: "consent", access_type: "offline" },
      },
    });
    if (error) throw error;
  } catch (err) {
    console.error("Login Google error:", err.message);
  }
}

/* ══════════════════════════
   EMAIL + CONTRASEÑA
══════════════════════════ */
export async function loginEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes("Invalid login credentials")) throw new Error("Email o contraseña incorrectos.");
    if (error.message.includes("Email not confirmed"))       throw new Error("Confirma tu email antes de entrar. Revisa tu bandeja de entrada.");
    throw new Error(error.message);
  }
  return data;
}

export async function registerEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: "https://aimeku.github.io/tugestor/" },
  });
  if (error) {
    if (error.message.includes("already registered") || error.message.includes("User already registered"))
      throw new Error("Este email ya tiene una cuenta. Inicia sesión.");
    if (error.message.includes("Password should be"))
      throw new Error("La contraseña debe tener al menos 6 caracteres.");
    throw new Error(error.message);
  }
  return { needsConfirm: !data.session };
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "https://aimeku.github.io/tugestor/",
  });
  if (error) throw new Error(error.message);
}

/* ══════════════════════════
   LOGOUT
══════════════════════════ */
export async function logout() {
  await supabase.auth.signOut();
  window.location.reload();
}

/* ══════════════════════════
   SESIÓN ACTUAL
══════════════════════════ */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/* ══════════════════════════
   MODAL DE AUTENTICACIÓN
══════════════════════════ */
export function showAuthModal() {
  document.getElementById("authModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "authModal";
  modal.innerHTML = `
    <div class="auth-overlay" id="authOverlay">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo-wrap">
            <img src="Logo_Sin_Texto_transparent.png" alt="Taurix" class="auth-logo-bull"/>
          </div>
          <h2 class="auth-title" id="authTitle">Accede a Taurix</h2>
          <p class="auth-sub" id="authSub">La herramienta fiscal que mereces</p>
        </div>
        <div class="auth-tabs" id="authTabs">
          <button class="auth-tab active" data-tab="login">Entrar</button>
          <button class="auth-tab" data-tab="register">Crear cuenta</button>
        </div>
        <div class="auth-error" id="authError" style="display:none"></div>
        <div class="auth-success" id="authSuccess" style="display:none"></div>

        <!-- LOGIN -->
        <div class="auth-panel" id="panelLogin">
          <button class="auth-google-btn" id="authGoogleBtn">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continuar con Google
          </button>
          <div class="auth-divider"><span>o con email</span></div>
          <div class="auth-field"><label>Email</label><input type="email" id="loginEmail" placeholder="tu@email.com" autocomplete="email"/></div>
          <div class="auth-field"><label>Contraseña</label>
            <div class="auth-pw-wrap">
              <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password"/>
              <button type="button" class="auth-pw-toggle" data-target="loginPassword">👁</button>
            </div>
          </div>
          <button class="auth-forgot" id="authForgotBtn">¿Olvidaste la contraseña?</button>
          <button class="auth-submit" id="loginSubmitBtn"><span>Entrar</span></button>
          <p class="auth-switch">¿No tienes cuenta? <button class="auth-link" data-tab="register">Créate una gratis →</button></p>
        </div>

        <!-- REGISTRO -->
        <div class="auth-panel" id="panelRegister" style="display:none">
          <button class="auth-google-btn" id="authGoogleBtn2">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Registrarse con Google
          </button>
          <div class="auth-divider"><span>o con email</span></div>
          <div class="auth-field"><label>Email</label><input type="email" id="registerEmail" placeholder="tu@email.com" autocomplete="email"/></div>
          <div class="auth-field"><label>Contraseña <span style="color:var(--t4);font-weight:400">(mín. 6 caracteres)</span></label>
            <div class="auth-pw-wrap">
              <input type="password" id="registerPassword" placeholder="••••••••" autocomplete="new-password"/>
              <button type="button" class="auth-pw-toggle" data-target="registerPassword">👁</button>
            </div>
          </div>
          <div class="auth-field"><label>Confirmar contraseña</label>
            <div class="auth-pw-wrap">
              <input type="password" id="registerPassword2" placeholder="••••••••" autocomplete="new-password"/>
              <button type="button" class="auth-pw-toggle" data-target="registerPassword2">👁</button>
            </div>
          </div>
          <button class="auth-submit" id="registerSubmitBtn"><span>Crear cuenta gratis</span></button>
          <p class="auth-switch">¿Ya tienes cuenta? <button class="auth-link" data-tab="login">Inicia sesión →</button></p>
        </div>

        <!-- RECUPERAR CONTRASEÑA -->
        <div class="auth-panel" id="panelForgot" style="display:none">
          <p style="font-size:13.5px;color:var(--t2);margin-bottom:18px;line-height:1.6">Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.</p>
          <div class="auth-field"><label>Email</label><input type="email" id="forgotEmail" placeholder="tu@email.com"/></div>
          <button class="auth-submit" id="forgotSubmitBtn"><span>Enviar enlace</span></button>
          <button class="auth-forgot" id="backToLoginBtn">← Volver al inicio de sesión</button>
        </div>

        <button class="auth-close" id="authCloseBtn">×</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const showError   = msg => { const e=document.getElementById("authError");   e.textContent=msg; e.style.display=msg?"":"none"; document.getElementById("authSuccess").style.display="none"; };
  const showSuccess = msg => { const e=document.getElementById("authSuccess"); e.textContent=msg; e.style.display=msg?"":"none"; document.getElementById("authError").style.display="none"; };
  const setLoading  = (btn, loading, label) => {
    btn.disabled=loading;
    btn.innerHTML=loading ? `<span class="auth-spinner"></span><span>Un momento…</span>` : `<span>${label}</span>`;
  };

  const switchTab = tab => {
    document.querySelectorAll(".auth-tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
    ["login","register","forgot"].forEach(p => {
      document.getElementById("panel"+p.charAt(0).toUpperCase()+p.slice(1)).style.display = p===tab?"":"none";
    });
    document.getElementById("authTabs").style.display = tab==="forgot"?"none":"";
    showError(""); showSuccess("");
    const titles={login:"Accede a Taurix",register:"Crea tu cuenta gratis",forgot:"Recuperar contraseña"};
    document.getElementById("authTitle").textContent=titles[tab];
  };

  document.querySelectorAll(".auth-tab,.auth-link").forEach(el=>el.addEventListener("click",()=>switchTab(el.dataset.tab)));
  document.querySelectorAll(".auth-pw-toggle").forEach(btn=>btn.addEventListener("click",()=>{
    const input=document.getElementById(btn.dataset.target);
    input.type=input.type==="password"?"text":"password";
    btn.textContent=input.type==="password"?"👁":"🙈";
  }));

  ["panelLogin","panelRegister","panelForgot"].forEach((pid,i)=>{
    const submitIds=["loginSubmitBtn","registerSubmitBtn","forgotSubmitBtn"];
    document.getElementById(pid)?.addEventListener("keydown",e=>{if(e.key==="Enter") document.getElementById(submitIds[i])?.click();});
  });

  [document.getElementById("authGoogleBtn"),document.getElementById("authGoogleBtn2")].forEach(btn=>btn?.addEventListener("click",login));

  document.getElementById("loginSubmitBtn").addEventListener("click", async ()=>{
    const email=document.getElementById("loginEmail").value.trim();
    const pw=document.getElementById("loginPassword").value;
    if(!email||!pw){showError("Rellena email y contraseña.");return;}
    const btn=document.getElementById("loginSubmitBtn");
    setLoading(btn,true,"Entrar");
    try { await loginEmail(email,pw); modal.remove(); window.location.reload(); }
    catch(e){ showError(e.message); setLoading(btn,false,"Entrar"); }
  });

  document.getElementById("registerSubmitBtn").addEventListener("click", async ()=>{
    const email=document.getElementById("registerEmail").value.trim();
    const pw1=document.getElementById("registerPassword").value;
    const pw2=document.getElementById("registerPassword2").value;
    if(!email){showError("Introduce tu email.");return;}
    if(pw1.length<6){showError("La contraseña debe tener al menos 6 caracteres.");return;}
    if(pw1!==pw2){showError("Las contraseñas no coinciden.");return;}
    const btn=document.getElementById("registerSubmitBtn");
    setLoading(btn,true,"Crear cuenta gratis");
    try {
      const {needsConfirm}=await registerEmail(email,pw1);
      if(needsConfirm){ showSuccess(`✅ Cuenta creada. Revisa tu email (${email}) para confirmarla y luego inicia sesión.`); switchTab("login"); }
      else { modal.remove(); window.location.reload(); }
    } catch(e){ showError(e.message); setLoading(btn,false,"Crear cuenta gratis"); }
  });

  document.getElementById("authForgotBtn").addEventListener("click",()=>switchTab("forgot"));
  document.getElementById("backToLoginBtn").addEventListener("click",()=>switchTab("login"));
  document.getElementById("forgotSubmitBtn").addEventListener("click", async ()=>{
    const email=document.getElementById("forgotEmail").value.trim();
    if(!email){showError("Introduce tu email.");return;}
    const btn=document.getElementById("forgotSubmitBtn");
    setLoading(btn,true,"Enviar enlace");
    try { await resetPassword(email); showSuccess(`📧 Enlace enviado a ${email}. Revisa tu bandeja de entrada.`); setLoading(btn,false,"Enviar enlace"); }
    catch(e){ showError(e.message); setLoading(btn,false,"Enviar enlace"); }
  });

  document.getElementById("authCloseBtn").addEventListener("click",()=>modal.remove());
  document.getElementById("authOverlay").addEventListener("click",e=>{if(e.target.id==="authOverlay")modal.remove();});
  document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){modal.remove();document.removeEventListener("keydown",esc);}});

  supabase.auth.onAuthStateChange((event,session)=>{
    if((event==="SIGNED_IN"||event==="TOKEN_REFRESHED")&&session){ modal.remove(); window.location.reload(); }
  });

  setTimeout(()=>document.getElementById("loginEmail")?.focus(),100);
}
