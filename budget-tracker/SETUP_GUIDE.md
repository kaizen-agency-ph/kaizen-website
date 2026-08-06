# Setup Guide — Budget Buddy (GitHub Pages + Firebase)

This is a **separate Firebase project** from the wedding planner. It reuses the
same GitHub repo and custom domain, living in the `budget-tracker/` subfolder,
so once deployed it's reachable at:

`https://kaizenagency.online/budget-tracker/`

## Account types

Every account has a `role` of `user` or `admin`, set when an admin creates the
account in the Admin Panel. After login, the app routes automatically:

- `user` → `dashboard.html` (the Budget Buddy tracker, synced to their account)
- `admin` → `admin.html` (add/revoke logins, trials, pricing — no budget UI)

If a user guesses the admin URL, the app checks their role and bounces them back
to their dashboard.

Each account's budget is stored in Firestore at `budgets/{uid}` and syncs across
devices automatically — no export needed. The browser's `localStorage` is kept as
an instant offline cache, and the in-app Export button remains an optional backup.

This app is static (HTML/CSS/JS) so GitHub Pages hosts it for free. Login and the
admin panel run on Firebase, also free at this scale (Spark plan). Steps 1–5 happen
once, before anything goes live.

## 1. Create a NEW Firebase project

1. Go to https://console.firebase.google.com and click **Add project**.
2. Name it (e.g. "budget-buddy-ph"), disable Google Analytics if you don't need it, click **Create project**.

## 2. Turn on Email/Password login

1. Left sidebar: **Build > Authentication > Get started**.
2. Under **Sign-in method**, enable **Email/Password**. Save.

## 3. Turn on Firestore (the database)

1. Left sidebar: **Build > Firestore Database > Create database**.
2. Choose **Production mode**. Pick a region close to your users (e.g. `asia-southeast1` for the Philippines).
3. Open the **Rules** tab, delete the default contents, paste in everything from `firestore.rules` (in this folder), and click **Publish**.

## 4. Get your web app config

1. Gear icon > **Project settings**.
2. Under **Your apps**, click the **</>** (web) icon to register a web app. Any nickname. You do NOT need Firebase Hosting — skip it.
3. Copy the `firebaseConfig` values into `js/firebase-config.js`, replacing the `YOUR_...` placeholders.

## 5. Bootstrap your first admin account

There's no signup form — accounts are admin-only. Create the first admin by hand:

1. Firebase Console > **Authentication > Users > Add user**. Enter your email and a password. Click **Add user**, then copy the **User UID**.
2. Firebase Console > **Firestore Database > Data**. Click **Start collection**, name it exactly `allowedUsers`.
3. For the **Document ID**, paste the UID. Add these fields:
   - `email` (string) — your email, exactly as entered
   - `role` (string) — `admin`
   - `addedAt` (timestamp) — click the clock icon, use "now"
4. Save. You can now log in and you'll land on the **Admin Panel** — use it to add everyone else.

## 6. Add the Firebase authorized domains

Firebase blocks auth from domains it doesn't recognize:

1. Firebase Console > **Authentication > Settings > Authorized domains**.
2. **Add domain** for each host you'll serve from — at minimum:
   - `kaizenagency.online`
   - `kaizen-agency-ph.github.io` (your Pages host)

Without this, login fails with `auth/unauthorized-domain`.

## 7. Deploy

The files already live in the same repo as the wedding planner, so deploying is
just committing and pushing:

```bash
git add budget-tracker
git commit -m "Add Budget Buddy: login, admin panel, cloud-synced tracker"
git push
```

GitHub Pages is already serving this repo, so within a minute or two the app is
live at `https://kaizenagency.online/budget-tracker/`.

## 8. Test end to end

1. Visit `/budget-tracker/`, sign in with your bootstrap admin account → you land on the Admin Panel.
2. Add a second test user (any email/password, role "user").
3. Sign out, sign back in as that user → you land on the budget dashboard, no Admin Panel link.
4. Add a transaction, refresh → it's still there (confirms Firestore sync).
5. Log in as the same user in a different browser → the same data loads.
6. Back in the admin account, revoke the test user → they're kicked out on next load.

## Notes & known limits

- **The origin lock** in `js/auth.js` (`ALLOWED_HOSTS`) blocks the app from running off an unapproved domain or a double-clicked local file. If you add a new domain later, add it there too.
- **Revoke ≠ delete the login.** Revoking removes dashboard access; the Firebase Auth login still exists (erasing it needs the Admin SDK / paid Blaze plan). Delete removes the access record permanently.
- **No self-service password reset** yet. An admin can reset by recreating the account, or you can extend `admin.js` with `sendPasswordResetEmail`.
- **Firebase config in the JS is public** — that's normal for Firebase. Security comes from `firestore.rules`, not from hiding config.
- **1 MiB per document.** Budget data is text-only, so this is plenty of headroom.
