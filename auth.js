import { supabase } from "./supabase.js";

/* ══════════════════════════
   GOOGLE OAUTH
══════════════════════════ */
export async function login() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://taurix.es/",
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
    options: { emailRedirectTo: "https://taurix.es/" },
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
    redirectTo: "https://taurix.es/",
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
