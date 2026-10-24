-- Up Migration

CREATE TYPE public.certificate_status AS ENUM ('issued', 'revoked');

-- One global, concurrency-safe counter. The year is a UTC label, not a reset rule.
CREATE SEQUENCE public.certificates_number_seq
    AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE FUNCTION public.generate_certificate_number()
RETURNS text AS $$
DECLARE
    next_number bigint;
BEGIN
    next_number := nextval('public.certificates_number_seq');
    RETURN 'CERT-'
        || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY')
        || '-'
        || LPAD(next_number::text, GREATEST(6, LENGTH(next_number::text)), '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE public.certificates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id),
    quiz_id uuid NOT NULL REFERENCES public.quizzes(id),
    quiz_attempt_id uuid NOT NULL UNIQUE REFERENCES public.quiz_attempts(id),
    certificate_template_id uuid REFERENCES public.certificate_templates(id) ON DELETE SET NULL,
    certificate_number varchar(100) NOT NULL UNIQUE DEFAULT public.generate_certificate_number(),
    status public.certificate_status NOT NULL DEFAULT 'issued',
    data_snapshot jsonb NOT NULL,
    template_snapshot jsonb NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_certificates_user_issued_at ON public.certificates (user_id, issued_at DESC);
CREATE INDEX idx_certificates_quiz_id ON public.certificates (quiz_id);
CREATE INDEX idx_certificates_template_id ON public.certificates (certificate_template_id)
    WHERE certificate_template_id IS NOT NULL;

-- Down Migration

DROP TABLE public.certificates;
DROP FUNCTION public.generate_certificate_number();
DROP SEQUENCE public.certificates_number_seq;
DROP TYPE public.certificate_status;
