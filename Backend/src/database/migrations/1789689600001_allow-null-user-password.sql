-- Up Migration

ALTER TABLE public.users
    ALTER COLUMN password_hash DROP NOT NULL;

-- Down Migration

-- Refuse rollback while passwordless accounts exist; do not invent passwords
-- or remove accounts to restore the constraint.
ALTER TABLE public.users
    ALTER COLUMN password_hash SET NOT NULL;
