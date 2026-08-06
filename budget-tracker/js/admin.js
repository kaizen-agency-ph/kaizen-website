import { requireAuth, logout, db, openChangePasswordDialog } from "./auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as signOutSecondary
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let adminEmail = "";

document.getElementById("logout-link").addEventListener("click", (e) => { e.preventDefault(); logout(); });
document.getElementById("change-pass-link").addEventListener("click", (e) => { e.preventDefault(); openChangePasswordDialog(); });

/**
 * Creates a Firebase Auth account WITHOUT signing the admin out: spin up a
 * throwaway second Firebase App, create the user on ITS auth object, tear it
 * down. Self-registering an Auth account grants NOTHING on its own — access
 * is gated by the allowedUsers doc, which only an admin can write (rules).
 */
async function createSecondaryUser(email, password) {
  const secondary = initializeApp(firebaseConfig, "Secondary-" + Date.now());
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOutSecondary(secondaryAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}

async function findAllowedUserByEmail(email) {
  const q = query(collection(db, "allowedUsers"), where("email", "==", email));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

function trialMillisFromInput(dateStr) {
  return dateStr ? new Date(dateStr + "T23:59:59").getTime() : null;
}

document.getElementById("create-user").addEventListener("click", async () => {
  const email = document.getElementById("new-email").value.trim();
  const password = document.getElementById("new-password").value;
  const role = document.getElementById("new-role").value;
  const trialEndsAt = trialMillisFromInput(document.getElementById("new-trial").value);
  const errorEl = document.getElementById("create-error");
  errorEl.textContent = "";

  if (!email || password.length < 6) {
    errorEl.textContent = "Enter an email and a password of at least 6 characters.";
    return;
  }

  try {
    const uid = await createSecondaryUser(email, password);
    await setDoc(doc(db, "allowedUsers", uid), {
      email, role, active: true, trialEndsAt,
      addedAt: serverTimestamp(), addedBy: adminEmail
    });
    clearCreateForm();
    await loadUsers();
  } catch (err) {
    console.error(err);
    if (err.code === "auth/email-already-in-use") {
      const existing = await findAllowedUserByEmail(email);
      if (existing && existing.active === false) {
        await setDoc(doc(db, "allowedUsers", existing.id), {
          email, role, active: true, trialEndsAt,
          restoredAt: serverTimestamp(), restoredBy: adminEmail
        }, { merge: true });
        clearCreateForm();
        await loadUsers();
      } else if (existing) {
        errorEl.textContent = "That email already has active access — no need to recreate it.";
      } else {
        errorEl.textContent = "That email already has a login but no access record to restore. Find their UID in Firebase Console → Authentication → Users, then add it under allowedUsers in Firestore (same as the admin bootstrap).";
      }
    } else {
      errorEl.textContent = "Couldn't create the account: " + err.message;
    }
  }
});

function clearCreateForm() {
  document.getElementById("new-email").value = "";
  document.getElementById("new-password").value = "";
  document.getElementById("new-trial").value = "";
}

let allUsers = [];
let pricing = null; // { user: <php/month> } or null

async function loadUsers() {
  const snap = await getDocs(collection(db, "allowedUsers"));
  allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderStats();
  renderTable();
}

async function loadPricing() {
  try {
    const snap = await getDoc(doc(db, "settings", "pricing"));
    pricing = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error("Couldn't load pricing (check firestore.rules includes settings/{docId} and is published):", err);
    pricing = null;
  }
  document.getElementById("price-user").value = pricing && pricing.user != null ? formatPeso(pricing.user) : "";
  renderStats();
}

function peso(n) { return "₱" + Number(n || 0).toLocaleString(); }
function digitsOnly(v) { return String(v == null ? "" : v).replace(/[^0-9.]/g, ""); }
function formatPeso(v) { const n = Number(digitsOnly(v)); return n ? "₱" + n.toLocaleString() : ""; }
(() => {
  const inp = document.getElementById("price-user");
  if (!inp) return;
  inp.addEventListener("focus", () => { inp.value = digitsOnly(inp.value); });
  inp.addEventListener("blur", () => { inp.value = formatPeso(inp.value); });
})();

function isExpired(u) { return !!(u.trialEndsAt && Date.now() > Number(u.trialEndsAt)); }

function trialInfo(u) {
  if (!u.trialEndsAt) return { text: "—", color: "var(--muted)" };
  const ms = Number(u.trialEndsAt) - Date.now();
  if (ms <= 0) return { text: "Expired", color: "var(--danger)" };
  const days = Math.ceil(ms / 86400000);
  return { text: days + " day" + (days > 1 ? "s" : "") + " left", color: days <= 3 ? "#b5850f" : "var(--muted)" };
}

function ymd(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function renderStats() {
  const active = allUsers.filter((u) => u.active !== false && !isExpired(u));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const count = (role) => active.filter((u) => u.role === role).length;
  const isRecent = (u) => {
    const t = u.addedAt && u.addedAt.toDate ? u.addedAt.toDate().getTime() : null;
    return t != null && t >= weekAgo;
  };
  const nUsers = count("user");

  document.getElementById("stat-total").textContent = active.length;
  document.getElementById("stat-users").textContent = nUsers;
  document.getElementById("stat-admins").textContent = count("admin");
  document.getElementById("stat-new").textContent = active.filter(isRecent).length;

  const revEl = document.getElementById("stat-revenue");
  if (!pricing || pricing.user == null) { revEl.textContent = "Set pricing"; return; }
  revEl.textContent = peso(nUsers * (Number(pricing.user) || 0));
}

document.getElementById("save-pricing").addEventListener("click", async () => {
  const errorEl = document.getElementById("pricing-error");
  errorEl.textContent = "";
  const userVal = digitsOnly(document.getElementById("price-user").value);
  if (userVal === "") { errorEl.textContent = "Enter a price."; return; }
  try {
    await setDoc(doc(db, "settings", "pricing"), {
      user: Number(userVal),
      updatedAt: serverTimestamp(),
      updatedBy: adminEmail
    });
    await loadPricing();
    const tag = document.getElementById("pricing-saved");
    tag.classList.add("show");
    setTimeout(() => tag.classList.remove("show"), 1500);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Couldn't save pricing: " + err.message;
  }
});

function renderTable() {
  const filter = document.getElementById("role-filter").value;
  const rows = filter ? allUsers.filter((u) => u.role === filter) : allUsers;

  const body = document.getElementById("users-body");
  body.innerHTML = "";
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="hint" style="text-align:center;padding:20px 0">No accounts match this filter.</td></tr>';
    return;
  }
  rows.forEach((data) => {
    const revoked = data.active === false;
    const expired = isExpired(data);
    const tr = document.createElement("tr");
    if (revoked || expired) tr.style.opacity = "0.55";
    const added = data.addedAt && data.addedAt.toDate ? data.addedAt.toDate().toLocaleDateString() : "—";
    const actionBtn = revoked
      ? `<button class="btn" data-id="${data.id}" data-action="restore">Restore</button>`
      : `<button class="btn danger" data-id="${data.id}" data-action="revoke">Revoke</button>`;
    const deleteBtn = `<button class="icon-btn" title="Delete permanently" data-id="${data.id}" data-action="delete" style="margin-left:8px;font-size:1rem">🗑</button>`;
    let statusBadge;
    if (revoked) statusBadge = '<span class="badge" style="background:#f1e1e1;color:#8a6d6d">Revoked</span>';
    else if (expired) statusBadge = '<span class="badge" style="background:#f3e3e3;color:#9b4b4b">Expired</span>';
    else statusBadge = '<span class="badge user">Active</span>';
    const ti = trialInfo(data);
    tr.innerHTML = `
      <td>${escapeHtml(data.email || "")}</td>
      <td><span class="badge ${data.role}">${data.role}</span></td>
      <td>${statusBadge}</td>
      <td>
        <input type="date" class="trial-input" data-id="${data.id}" value="${ymd(data.trialEndsAt)}" style="font-size:0.82rem;padding:6px 8px;margin-bottom:4px;max-width:150px" />
        <div style="font-size:0.72rem;color:${ti.color}">${ti.text}</div>
      </td>
      <td>${added}</td>
      <td style="white-space:nowrap">${actionBtn}${deleteBtn}</td>
    `;
    body.appendChild(tr);
  });
  body.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = allUsers.filter((u) => u.id === btn.dataset.id)[0];
      const email = row ? row.email : "this account";
      if (!confirm("Permanently delete " + email + "?\n\nThis removes their access record entirely and CANNOT be undone (unlike Revoke). To also erase their login itself, delete them in Firebase Console → Authentication → Users.")) return;
      await deleteDoc(doc(db, "allowedUsers", btn.dataset.id));
      await loadUsers();
    });
  });
  body.querySelectorAll(".trial-input").forEach((inp) => {
    inp.addEventListener("change", async () => {
      await setDoc(doc(db, "allowedUsers", inp.dataset.id), {
        trialEndsAt: trialMillisFromInput(inp.value),
        trialUpdatedAt: serverTimestamp(),
        trialUpdatedBy: adminEmail
      }, { merge: true });
      await loadUsers();
    });
  });
  body.querySelectorAll('[data-action="revoke"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Revoke this person's access? You can restore it later without recreating the account.")) return;
      await setDoc(doc(db, "allowedUsers", btn.dataset.id), {
        active: false, revokedAt: serverTimestamp(), revokedBy: adminEmail
      }, { merge: true });
      await loadUsers();
    });
  });
  body.querySelectorAll('[data-action="restore"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      await setDoc(doc(db, "allowedUsers", btn.dataset.id), {
        active: true, restoredAt: serverTimestamp(), restoredBy: adminEmail
      }, { merge: true });
      await loadUsers();
    });
  });
}

document.getElementById("role-filter").addEventListener("change", renderTable);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

requireAuth(async (user, access) => {
  adminEmail = access.email || user.email;
  document.getElementById("user-email").textContent = adminEmail;
  await loadUsers();
  await loadPricing();
}, { requireAdmin: true });
