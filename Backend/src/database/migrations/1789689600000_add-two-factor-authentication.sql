-- Up Migration

ALTER TABLE public.users
    ADD COLUMN is_2fa_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN totp_secret_encrypted text
        CHECK (btrim(totp_secret_encrypted) <> ''),
    ADD COLUMN totp_last_used_step bigint NOT NULL DEFAULT -1
        CHECK (totp_last_used_step >= -1),
    ADD CONSTRAINT users_two_factor_secret_check
        CHECK (NOT is_2fa_enabled OR totp_secret_encrypted IS NOT NULL);

COMMENT ON COLUMN public.users.totp_secret_encrypted IS
    'Encrypted TOTP secret, including its nonce and authentication tag. Keep the encryption key outside the database. May be set before setup is confirmed.';

COMMENT ON COLUMN public.users.totp_last_used_step IS
    'Last accepted TOTP time step to prevent code reuse; -1 means unused. Reset when the secret is replaced or removed.';

-- Down Migration

ALTER TABLE public.users
    DROP CONSTRAINT users_two_factor_secret_check,
    DROP COLUMN totp_last_used_step,
    DROP COLUMN totp_secret_encrypted,
    DROP COLUMN is_2fa_enabled;
