-- Up Migration

ALTER TABLE public.videos ADD COLUMN show_locked_card boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE public.videos DROP COLUMN show_locked_card;
