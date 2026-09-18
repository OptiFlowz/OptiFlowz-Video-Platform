# Two-factor authentication

New Google accounts store `password_hash = NULL`. Apply
`1789689600001_allow-null-user-password.sql` before deploying that signup change.
Existing password hashes are preserved: generated placeholders cannot reliably
be distinguished from passwords a user actually set. Password login rejects
accounts with a null hash. Password-based 2FA setup/disable return a clear error;
these accounts can use Google reauthentication for both management endpoints.
Google login and its 2FA login step already support a null password hash.

Apply `1789689600000_add-two-factor-authentication.sql` before using this endpoint.
Set `TWO_FACTOR_ENCRYPTION_KEY` to a base64-encoded, random 32-byte key. Generate
it once and store it in the server's environment/secrets:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep this key separate from `JWT_SECRET` and stable across deployments. Changing
it makes existing TOTP secrets unreadable unless they are explicitly migrated.

Optionally set the authenticator issuer name in `.env`:

```dotenv
TWO_FACTOR_ISSUER="OptiFlowz"
```

Missing or blank values default to `OptiFlowz`. This name is used in newly
generated QR codes and manual setup labels; existing authenticator entries
keep their previously enrolled name.

`POST /api/auth/2fa/setup` requires a bearer access token and JSON body:

```json
{ "password": "current password" }
```

Alternatively, send a fresh Google OAuth authorization code:

```json
{ "googleCode": "fresh Google authorization code" }
```

Send exactly one of `password` or `googleCode`. Google verification exchanges the
code using the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_REDIRECT_URI` configuration. Request `openid email profile` scopes, as
for Google login. The server verifies the returned ID token, its audience and
verified email, and enforces `GOOGLE_ALLOWED_HD` if configured. Its Google subject
must already be linked to the authenticated user in `auth_identities`; matching
email alone is insufficient. This works for linked accounts with or without a
local password and never creates or links accounts.

Obtain a new authorization code for each request; codes are single-use and cannot
be reused from login. A failed later check (such as an invalid authenticator code)
also requires a new Google code on retry. A fresh authorization code confirms
the Google account; it does not necessarily force Google to ask for its password.

The response contains `success: true`, `qr` (a PNG data URL), and `manual` with `codeName` and
`yourKey` (the Base32 secret). Treat the entire response as sensitive; do not
log or cache it. QR generation happens locally without a third-party service.

Setup verifies the password or linked Google account, rejects already-enabled accounts, and stores
only the AES-256-GCM encrypted secret. It leaves `is_2fa_enabled` false until
confirmation succeeds.
Repeating setup replaces an unconfirmed secret.

`POST /api/auth/2fa/verify` confirms enrollment. It requires the same bearer access
token and a six-digit authenticator code as a string (preserving leading zeros):

```json
{ "token": "123456" }
```

On success it returns `{ "success": true, "message": "2FA enabled" }`, sets `is_2fa_enabled` true,
and records the accepted TOTP time step to prevent reuse. Codes are accepted from
the current 30-second time step or one step either side. It rejects invalid/used
codes (401), missing setup (400), and already-enabled or concurrently changed
accounts (409). It does not return the secret or an access token.

`POST /api/auth/2fa/disable` requires a bearer access token, the current password or a fresh Google code,
and an unused authenticator code when 2FA is enabled:

```json
{ "password": "current password", "token": "123456" }
```

Or, with Google reauthentication:

```json
{ "googleCode": "fresh Google authorization code", "token": "123456" }
```

On success it returns `{ "success": true, "message": "2FA disabled" }`, sets
`is_2fa_enabled` false, clears `totp_secret_encrypted`, and resets
`totp_last_used_step` to -1. An invalid password, invalid/used code, or missing
required code returns 401. Concurrent account changes return 409.
If 2FA is already disabled, password or Google verification alone can cancel unconfirmed setup or
return success for an already-cleared account. It cannot disable active 2FA
without a code. A code just used for enrollment/login cannot be reused here;
wait for the next authenticator code.

All 2FA endpoints return `success: false` with a `message` on failure, including
validation, authentication, and rate-limit errors. HTTP status codes are preserved.

## Account settings status

`GET /api/auth/me` includes `user.is_2fa_enabled` for the authenticated account.
It also returns `user.login_methods`, for example `{ "password": false, "google": true }`.
`password` indicates a non-null password hash; `google` indicates an existing
Google link in `auth_identities`. Legacy generated password hashes count as set.
The response includes `success: true` on success and `success: false` on errors.
The frontend reads this boolean when opening account settings and updates its
profile cache only after setup verification or disabling succeeds. Deploy this
profile field together with the 2FA endpoints for both frontend installations.

## Login with password or Google

Set `TWO_FACTOR_TOKEN_SECRET` to a separate random secret of at least 32 bytes.
Run the key-generation command above again to produce a new value; do not reuse
`JWT_SECRET` or `TWO_FACTOR_ENCRYPTION_KEY`. It must be the same on every API instance.
Changing it invalidates pending 2FA logins, without changing stored TOTP secrets.

Both `POST /api/auth/login` (`{ "email": "...", "password": "..." }`) and
`POST /api/auth/oauth/google` (`{ "code": "..." }`) check the first factor and
then use the same login gate. Accounts without 2FA receive `success: true`,
`token`, and `user` immediately. Accounts with 2FA receive HTTP 200 with:

```json
{
  "success": false,
  "requires2fa": true,
  "twoFactorToken": "<temporary JWT>"
}
```

This response has no access token or user profile. `success` stays false because
login is not complete. The temporary JWT expires after five minutes and is
accepted only by `POST /api/auth/2fa/login`, with this body:

```json
{ "twoFactorToken": "<temporary JWT>", "otp": "123456" }
```

No bearer access token, repeated password, or repeated Google authorization code
is needed for this request. On successful verification it returns HTTP 200 with
`success: true`, `token`, and `user`. Google logins also retain `provider`,
`is_new_user`, and `linked_existing_account` in the completed response.
Only completed logins update `last_login_at`. `/2fa/verify` continues to confirm
enrollment; it is not the login endpoint.

Temporary JWTs have a dedicated signing key, audience, issuer, purpose, and expiry.
Normal auth middleware rejects them. They are bound to the account's current
password hash, encrypted TOTP secret, authorization version, and last used TOTP
step. Password changes, secret replacement, disabling 2FA, or authorization
changes invalidate them. A successful OTP use invalidates all pending login
tokens for that account, including the token just used; it cannot be reused
with the next OTP. No challenge table is needed. OTP consumption and access-token
issuance happen under a user row lock in one database transaction.

Setup, verification, disabling, and 2FA login each permit five requests per account
per ten minutes per process. Login limits use the signed account ID, so obtaining
a new temporary token does not reset the limit.
Use a shared rate-limit store when running multiple API instances.
