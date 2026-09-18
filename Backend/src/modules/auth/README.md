# Two-factor enrollment

Apply `1789689600000_add-two-factor-authentication.sql` before using this endpoint.
Set `TWO_FACTOR_ENCRYPTION_KEY` to a base64-encoded, random 32-byte key. Generate
it once and store it in the server's environment/secrets:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep this key separate from `JWT_SECRET` and stable across deployments. Changing
it makes existing TOTP secrets unreadable unless they are explicitly migrated.

`POST /api/auth/2fa/setup` requires a bearer access token and JSON body:

```json
{ "password": "current password" }
```

The response contains `success: true`, `qr` (a PNG data URL), and `manual` with `codeName` and
`yourKey` (the Base32 secret). Treat the entire response as sensitive; do not
log or cache it. QR generation happens locally without a third-party service.

Setup checks the current password, rejects already-enabled accounts, and stores
only the AES-256-GCM encrypted secret. It leaves `is_2fa_enabled` false until
confirmation succeeds.
Repeating setup replaces an unconfirmed secret. Google-only accounts need a
separate reauthentication flow before they can enroll without a local password.

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

`POST /api/auth/2fa/disable` requires a bearer access token, the current password,
and an unused authenticator code when 2FA is enabled:

```json
{ "password": "current password", "token": "123456" }
```

On success it returns `{ "success": true, "message": "2FA disabled" }`, sets
`is_2fa_enabled` false, clears `totp_secret_encrypted`, and resets
`totp_last_used_step` to -1. An invalid password, invalid/used code, or missing
required code returns 401. Concurrent account changes return 409.
If 2FA is already disabled, the password alone can cancel unconfirmed setup or
return success for an already-cleared account. It cannot disable active 2FA
without a code. A code just used for enrollment/login cannot be reused here;
wait for the next authenticator code.

All three endpoints return `success: false` with a `message` on failure, including
validation, authentication, and rate-limit errors. HTTP status codes are preserved.

Login enforcement is still to be implemented for password and Google sign-in;
setting the enabled flag alone does not yet enforce 2FA at login.

Setup, verification, and disabling each permit five requests per account per ten minutes per process.
Use a shared rate-limit store when running multiple API instances.
