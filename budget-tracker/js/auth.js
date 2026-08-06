// ============================================================
// SHARED AUTH MODULE — Budget Buddy
// Handles Firebase init, sign-in/out, and the "allowedUsers" gate.
// Imported by index.html (login), dashboard.html, and admin.html.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// --- Origin lock ---------------------------------------------------------
// Refuse to run unless served from an approved host. A DETERRENT, not real
// protection (client-side code is copyable) — but it blocks opening a saved
// copy from disk (file://) or re-hosting on someone else's domain. Add your
// custom domain / Pages host here. localhost is kept for local dev servers.
const ALLOWED_HOSTS = ["kaizenagency.online", "www.kaizenagency.online", "kaizen-agency-ph.github.io", "localhost", "127.0.0.1"];
if (!ALLOWED_HOSTS.includes(location.hostname)) {
  document.documentElement.innerHTML =
    "<div style='font-family:sans-serif;padding:48px;text-align:center;color:#6C63FF'>This app can only run from its official website.</div>";
  throw new Error("Unauthorized host");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Persist the signed-in user in localStorage so the dashboard can read the
// current UID synchronously at load to namespace each account's data.
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

// ---- Cloud sync (Firestore) --------------------------------------------
// Each account's whole budget is stored as one JSON string in budgets/{uid}
// so it syncs across devices and browsers. Stored as a string to sidestep
// Firestore's nested-array constraints; the only limit that matters is the
// 1 MiB per-document cap (plenty for text-only budget data).
export async function cloudLoad(uid) {
  try {
    const snap = await getDoc(doc(db, "budgets", uid));
    return snap.exists() ? snap.data() : null; // { data: "<json>", savedAt }
  } catch (e) {
    console.error("Cloud load failed:", e);
    return null;
  }
}
export async function cloudSave(uid, jsonStr) {
  return setDoc(doc(db, "budgets", uid), {
    data: jsonStr,
    savedAt: Date.now(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/**
 * Looks up allowedUsers/{uid}. Returns the doc data ({email, role, addedAt,
 * active, trialEndsAt}) if the account has been granted access by an admin
 * AND hasn't been revoked/expired, or null otherwise. This is the real
 * access-control gate — a valid Firebase Auth login is NOT enough on its own.
 */
export async function checkAccess(user) {
  const snap = await getDoc(doc(db, "allowedUsers", user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.active === false) return null;
  // Trial expiry = automatic revoke, enforced here at access-check time
  // (a static host has no server cron).
  if (data.trialEndsAt && Date.now() > Number(data.trialEndsAt)) return null;
  return data;
}

/** Sign in with email/password. Throws on failure (bad credentials). */
export async function login(email, password) {
  await persistenceReady;
  return signInWithEmailAndPassword(auth, email, password);
}

/** Sign the current user out and send them back to the login page. */
export async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}

/**
 * Given an access.role ("admin" | "user"), returns the page that account
 * type should land on after login. Used by index.html (post-login redirect)
 * and requireAuth (wrong-page redirect).
 */
export function homeForRole(role) {
  if (role === "admin") return "admin.html";
  if (role === "user") return "dashboard.html";
  return "index.html";
}

/**
 * Guard for protected pages. Call at the top of dashboard.html / admin.html.
 * Redirects to login if not authenticated, or if authenticated but not in
 * allowedUsers. Calls onReady(user, access) once checks pass.
 *
 * Options:
 *   - requireAdmin: true -> only role "admin" may proceed (admin.html)
 */
export function requireAuth(onReady, { requireAdmin = false, allowedRoles = null } = {}) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const access = await checkAccess(user);
    if (!access) {
      alert("This account has not been granted access, or its trial has ended. Contact your admin.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }
    if (requireAdmin && access.role !== "admin") {
      window.location.href = homeForRole(access.role);
      return;
    }
    if (allowedRoles && !allowedRoles.includes(access.role)) {
      window.location.href = homeForRole(access.role);
      return;
    }
    onReady(user, access);
  });
}

/**
 * Opens a small self-contained modal that lets the signed-in user change
 * their own password. Firebase requires a recent login, so we re-authenticate
 * with the CURRENT password first, then set the new one. Styled inline so it
 * works identically on every page and on mobile (16px inputs avoid iOS zoom).
 */
export function openChangePasswordDialog() {
  if (document.getElementById("cp-overlay")) return;
  const user = auth.currentUser;
  if (!user) { alert("You need to be signed in to change your password."); return; }

  const inputCss = "width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:10px;border:2px solid #F0E2D6;border-radius:10px;font-size:16px;color:#2A2440;background:#FBF1E9;";
  const btnCss = "padding:10px 16px;border:none;border-radius:10px;background:#6C63FF;color:#fff;font-size:14px;font-weight:700;cursor:pointer;";
  const btnGhostCss = "padding:10px 16px;border:2px solid #F0E2D6;border-radius:10px;background:#fff;color:#2A2440;font-size:14px;font-weight:700;cursor:pointer;";

  const ov = document.createElement("div");
  ov.id = "cp-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(30,24,55,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;";
  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border-radius:18px;padding:24px;width:100%;max-width:380px;box-shadow:0 18px 50px rgba(108,99,255,.28);color:#2A2440;";
  card.innerHTML =
    "<h3 style='margin:0 0 4px;font-size:1.15rem;color:#6C63FF;font-family:\"Bricolage Grotesque\",sans-serif'>Change password</h3>"
    + "<p style='margin:0 0 16px;font-size:13px;color:#8A7F9C'>Enter your current password, then a new one (at least 6 characters).</p>"
    + "<input id='cp-current' type='password' placeholder='Current password' autocomplete='current-password' style='" + inputCss + "' />"
    + "<input id='cp-new' type='password' placeholder='New password' autocomplete='new-password' style='" + inputCss + "' />"
    + "<input id='cp-confirm' type='password' placeholder='Confirm new password' autocomplete='new-password' style='" + inputCss + "' />"
    + "<div id='cp-msg' style='min-height:18px;font-size:13px;margin:2px 0 12px'></div>"
    + "<div style='display:flex;gap:10px;justify-content:flex-end'>"
    + "<button id='cp-cancel' style='" + btnGhostCss + "'>Cancel</button>"
    + "<button id='cp-save' style='" + btnCss + "'>Update password</button>"
    + "</div>";
  ov.appendChild(card);
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  card.querySelector("#cp-cancel").addEventListener("click", close);
  setTimeout(() => { try { card.querySelector("#cp-current").focus(); } catch (e) {} }, 30);

  card.querySelector("#cp-save").addEventListener("click", async () => {
    const cur = card.querySelector("#cp-current").value;
    const nw = card.querySelector("#cp-new").value;
    const cf = card.querySelector("#cp-confirm").value;
    const msg = card.querySelector("#cp-msg");
    if (nw.length < 6) { msg.style.color = "#e0544e"; msg.textContent = "New password must be at least 6 characters."; return; }
    if (nw !== cf) { msg.style.color = "#e0544e"; msg.textContent = "New passwords don't match."; return; }
    msg.style.color = "#8A7F9C"; msg.textContent = "Updating…";
    try {
      const cred = EmailAuthProvider.credential(user.email, cur);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, nw);
      msg.style.color = "#2FB89B"; msg.textContent = "Password updated ✓";
      setTimeout(close, 1200);
    } catch (err) {
      console.error(err);
      msg.style.color = "#e0544e";
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg.textContent = "Current password is incorrect.";
      else if (err.code === "auth/weak-password") msg.textContent = "New password is too weak.";
      else if (err.code === "auth/too-many-requests") msg.textContent = "Too many attempts — please wait a bit and try again.";
      else msg.textContent = "Couldn't update password. Try again.";
    }
  });
}
