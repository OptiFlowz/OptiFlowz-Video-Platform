-- Up Migration

CREATE TABLE public.certificate_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid NOT NULL
        REFERENCES public.users(id) ON DELETE CASCADE,

    name varchar(255) NOT NULL,
    description text,

    html_template text NOT NULL,
    css_template text NOT NULL DEFAULT '',

    page_format varchar(20) NOT NULL DEFAULT 'A4',
    orientation varchar(20) NOT NULL DEFAULT 'landscape',

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT certificate_templates_page_format_check
        CHECK (page_format IN ('A4', 'Letter')),

    CONSTRAINT certificate_templates_orientation_check
        CHECK (orientation IN ('portrait', 'landscape')),

    CONSTRAINT certificate_templates_html_check
        CHECK (length(btrim(html_template)) > 0)
);

CREATE INDEX idx_certificate_templates_user_id
ON public.certificate_templates (user_id);

-- Down Migration

DROP TABLE public.certificate_templates;
