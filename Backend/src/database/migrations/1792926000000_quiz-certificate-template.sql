-- Up Migration

-- Keep any IDs already configured in an environment. Legacy has_certificate=true
-- does not select a template automatically: unconfigured quizzes remain NULL.
ALTER TABLE public.quizzes
    ADD COLUMN IF NOT EXISTS certificate_template_id uuid;

ALTER TABLE public.quizzes
    DROP CONSTRAINT IF EXISTS quizzes_certificate_template_id_fkey;
ALTER TABLE public.quizzes
    ADD CONSTRAINT quizzes_certificate_template_id_fkey
    FOREIGN KEY (certificate_template_id)
    REFERENCES public.certificate_templates(id)
    ON DELETE SET NULL;

CREATE INDEX idx_quizzes_certificate_template
    ON public.quizzes (certificate_template_id) WHERE certificate_template_id IS NOT NULL;

ALTER TABLE public.quizzes DROP COLUMN has_certificate;

-- Historical attempt snapshots stay unchanged. New attempts snapshot the template
-- ID as JSON, rather than a foreign key that could rewrite the attempt on deletion.

-- Down Migration

ALTER TABLE public.quizzes
    ADD COLUMN has_certificate boolean NOT NULL DEFAULT false;
UPDATE public.quizzes SET has_certificate = (certificate_template_id IS NOT NULL);
DROP INDEX public.idx_quizzes_certificate_template;
ALTER TABLE public.quizzes DROP COLUMN certificate_template_id;
