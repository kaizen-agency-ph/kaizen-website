// ============================================================
// SHARED AUTH MODULE
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
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// --- Origin lock ---------------------------------------------------------
// Refuse to run unless served from an approved host. This is a DETERRENT,
// not real protection (client-side code is always copyable) — but it blocks
// the easy paths: opening a saved copy from disk (file://), or re-hosting
// the files on someone else's domain. Add your custom domain here if you set
// one up later. localhost/127.0.0.1 are kept so YOU can still test via a
// local dev server (a plain double-clicked file:// will be blocked by design).
const ALLOWED_HOSTS = ["kaizen-agency-ph.github.io", "localhost", "127.0.0.1"];
if (!ALLOWED_HOSTS.includes(location.hostname)) {
  document.documentElement.innerHTML =
    "<div style='font-family:sans-serif;padding:48px;text-align:center;color:#8C4F66'>This app can only run from its official website.</div>";
  throw new Error("Unauthorized host");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Persist the signed-in user in localStorage (Firebase defaults to IndexedDB).
// This lets the planner pages read the current UID synchronously at load to
// namespace each account's data. login() awaits this before signing in so the
// persistence mode is applied first.
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

/**
 * Looks up allowedUsers/{uid}. Returns the doc data ({email, role,
 * addedAt, active}) if the account has been granted access by an admin
 * AND hasn't been revoked, or null otherwise. This is the real
 * access-control gate — having a valid Firebase Auth login is NOT
 * enough on its own.
 *
 * Revoking access sets active:false rather than deleting the doc (so
 * the admin panel can restore it later without losing the role/history).
 * `active` missing entirely is treated as active, for docs created
 * before this field existed.
 */
export async function checkAccess(user) {
  const snap = await getDoc(doc(db, "allowedUsers", user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.active === false) return null;
  // Trial expiry = automatic revoke. With no server cron on a static host,
  // this is enforced here at access-check time: once the trial end passes,
  // the account is denied on its next page load / auth refresh.
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
 * Given an access.role ("admin" | "couple" | "coordinator"), returns the
 * page that account type should land on after login. Used by index.html
 * (post-login redirect) and requireAuth (wrong-page redirect).
 */
export function homeForRole(role) {
  if (role === "admin") return "admin.html";
  if (role === "coordinator") return "coordinator.html";
  if (role === "couple") return "couple.html";
  return "index.html";
}

/**
 * Guard for protected pages. Call this at the top of couple.html /
 * coordinator.html / admin.html. Redirects to login if not authenticated,
 * or if authenticated but not in allowedUsers. Calls onReady(user, access)
 * once checks pass.
 *
 * Options:
 *   - requireAdmin: true   -> only role "admin" may proceed (admin.html)
 *   - allowedRoles: [...]  -> only these roles may proceed (couple.html
 *                             passes ["couple"], coordinator.html passes
 *                             ["coordinator"]). A signed-in user with the
 *                             wrong role gets bounced to THEIR correct
 *                             page instead of stuck on the wrong one.
 */
export function requireAuth(onReady, { requireAdmin = false, allowedRoles = null } = {}) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const access = await checkAccess(user);
    if (!access) {
      alert("This account has not been granted access. Contact your admin.");
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
 * their own password. Firebase requires a recent login to change a password,
 * so we first re-authenticate with the CURRENT password (which also verifies
 * they're really the account owner), then set the new one. Styled inline so
 * it works identically on every page (login-styled admin, planner, etc.) and
 * on mobile (16px inputs avoid iOS zoom; card is width-capped and padded).
 */
export function openChangePasswordDialog() {
  if (document.getElementById("cp-overlay")) return;
  const user = auth.currentUser;
  if (!user) { alert("You need to be signed in to change your password."); return; }

  const inputCss = "width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:10px;border:1px solid #EBDDD8;border-radius:8px;font-size:16px;color:#3A2E3F;background:#FCFAF9;";
  const btnCss = "padding:10px 16px;border:none;border-radius:8px;background:#8C4F66;color:#fff;font-size:14px;cursor:pointer;";
  const btnGhostCss = "padding:10px 16px;border:1px solid #EBDDD8;border-radius:8px;background:#fff;color:#3A2E3F;font-size:14px;cursor:pointer;";

  const ov = document.createElement("div");
  ov.id = "cp-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(40,30,44,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Outfit',system-ui,sans-serif;";
  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border-radius:16px;padding:22px;width:100%;max-width:380px;box-shadow:0 18px 50px rgba(40,30,44,.3);color:#3A2E3F;";
  card.innerHTML =
    "<h3 style='margin:0 0 4px;font-size:1.1rem;color:#8C4F66'>Change password</h3>"
    + "<p style='margin:0 0 16px;font-size:13px;color:#7A6B79'>Enter your current password, then a new one (at least 6 characters).</p>"
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
    if (nw.length < 6) { msg.style.color = "#b3453f"; msg.textContent = "New password must be at least 6 characters."; return; }
    if (nw !== cf) { msg.style.color = "#b3453f"; msg.textContent = "New passwords don't match."; return; }
    msg.style.color = "#7A6B79"; msg.textContent = "Updating…";
    try {
      const cred = EmailAuthProvider.credential(user.email, cur);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, nw);
      msg.style.color = "#4a7c59"; msg.textContent = "Password updated ✓";
      setTimeout(close, 1200);
    } catch (err) {
      console.error(err);
      msg.style.color = "#b3453f";
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg.textContent = "Current password is incorrect.";
      else if (err.code === "auth/weak-password") msg.textContent = "New password is too weak.";
      else if (err.code === "auth/too-many-requests") msg.textContent = "Too many attempts — please wait a bit and try again.";
      else msg.textContent = "Couldn't update password. Try again.";
    }
  });
}
