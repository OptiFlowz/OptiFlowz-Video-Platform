-- Up Migration

CREATE INDEX quiz_attempts_expiration_idx ON public.quiz_attempts (expires_at, id)
WHERE status = 'in_progress' AND expires_at IS NOT NULL;

-- Down Migration

DROP INDEX public.quiz_attempts_expiration_idx;
