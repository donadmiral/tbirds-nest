# Platinum Operations

Use the staff account created in the same Supabase project as this deployment. The sign-in panel identifies the backend as QA, production, or unverified. A Supabase dashboard login and an IntoBank account are separate identities and do not grant Platinum staff permission.

## Staff authentication

The owner requested optional authenticator setup on 29 October 2026. The deployed server policy accepts an authenticated AAL1 or AAL2 session after verifying its token, live native session, active staff record and allowed role. It is a source-controlled server policy, not a browser flag. Password authentication, session revocation, staff roles, command audit and idempotency remain enforced.

Staff can choose **Account security** at `/security?setup=1` to enroll an authenticator. Existing factors are retained. Password recovery for an account that already enrolled an authenticator still requires that factor. No staff membership, permission or password changes are made by this policy update. The database command admission policy must match the released server policy.

## Password recovery

The **Forgot password?** link opens `/reset-password/request`. Email is sent only after the user submits that form. The result never discloses whether the address exists. The recovery link must be opened in the same browser within ten minutes; the SDK performs a PKCE exchange using a short-lived HttpOnly verifier cookie. A different browser, expired/reused code, or nonstaff account cannot establish an admin recovery session.

The callback is `/reset-password/callback`. Add the exact full callback URL for each authorized deployment to that Supabase project's Auth redirect allowlist. Vercel's `VERCEL_URL` and `VERCEL_BRANCH_URL` are trusted exact origins automatically. For an additional custom QA alias, configure `ADMIN_AUTH_ORIGINS` as comma-separated HTTPS origins. Production also accepts `https://admin.platinumcircles.app`. Wildcards, paths, query strings, credentials, and untrusted submitted origins are rejected. This repository setting does not configure the hosted Supabase allowlist.

The reset flow requires an active staff account and a live recovery session. Its signed HttpOnly cookie is scoped to `/reset-password`, expires server-side after ten minutes, and keeps its original deadline when MFA elevates the session. Existing authenticators are required before changing an MFA-protected password. Recovery never enrolls, removes or disables MFA; it never grants staff access or creates a normal admin session. Password updates use the end-user Auth SDK. The server then requests global session revocation and clears its cookies. A failed revocation is explicitly reported as a partial outcome, not a failed password update.

A successful reset changes only the password in the backend shown on this page. It does not copy or synchronize production, QA, Supabase dashboard or IntoBank passwords. Lost authenticators require a separate authorized recovery process.

## Local checks

Run `node node_modules/typescript/bin/tsc --noEmit` and `node --test --test-concurrency=2 tests/*.cjs` from this directory. Tests mock email delivery and never send a recovery email. Hosted acceptance still needs a user-requested email, successful same-browser recovery, retained MFA, expired-link rejection, and a fresh sign-in after reset.
