-- Up Migration

-- Issued certificates retain their immutable snapshots after an attempt is deleted.
ALTER TABLE public.certificates
    ALTER COLUMN quiz_attempt_id DROP NOT NULL,
    DROP CONSTRAINT certificates_quiz_attempt_id_fkey,
    ADD CONSTRAINT certificates_quiz_attempt_id_fkey
        FOREIGN KEY (quiz_attempt_id) REFERENCES public.quiz_attempts(id)
        ON DELETE SET NULL;

-- Down Migration

-- Refuse rollback if deleted attempts have left NULL references; never delete
-- certificates or invent replacement attempts to restore the old constraint.
ALTER TABLE public.certificates
    ALTER COLUMN quiz_attempt_id SET NOT NULL,
    DROP CONSTRAINT certificates_quiz_attempt_id_fkey,
    ADD CONSTRAINT certificates_quiz_attempt_id_fkey
        FOREIGN KEY (quiz_attempt_id) REFERENCES public.quiz_attempts(id);
