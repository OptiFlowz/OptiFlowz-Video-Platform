-- Up Migration

-- Block issuance while existing numbers initialize the yearly counters.
LOCK TABLE public.certificates IN ACCESS EXCLUSIVE MODE;

CREATE TABLE public.certificate_number_counters (
    year integer PRIMARY KEY,
    last_number bigint NOT NULL CHECK (last_number > 0)
);

INSERT INTO public.certificate_number_counters (year, last_number)
SELECT split_part(certificate_number, '-', 2)::integer,
       max(split_part(certificate_number, '-', 3)::bigint)
FROM public.certificates
WHERE certificate_number ~ '^CERT-[0-9]{4}-[0-9]+$'
GROUP BY split_part(certificate_number, '-', 2)::integer
HAVING max(split_part(certificate_number, '-', 3)::bigint) > 0;

CREATE OR REPLACE FUNCTION public.generate_certificate_number()
RETURNS text AS $$
DECLARE
    certificate_year integer := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'UTC')::integer;
    next_number bigint;
BEGIN
    -- The unique year key serializes concurrent increments, including the first
    -- issuance of a new year. Each year starts independently without a cron job.
    INSERT INTO public.certificate_number_counters AS counters (year, last_number)
    VALUES (certificate_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_number = counters.last_number + 1
    RETURNING last_number INTO next_number;

    RETURN 'CERT-' || certificate_year::text || '-'
        || LPAD(next_number::text, GREATEST(6, LENGTH(next_number::text)), '0');
END;
$$ LANGUAGE plpgsql;

-- Down Migration

LOCK TABLE public.certificates IN ACCESS EXCLUSIVE MODE;

-- Resume the original sequence above all allocated/persisted suffixes.
SELECT setval('public.certificates_number_seq', GREATEST(
    (SELECT last_value FROM public.certificates_number_seq),
    COALESCE((SELECT max(last_number) FROM public.certificate_number_counters), 1),
    COALESCE((SELECT max(split_part(certificate_number, '-', 3)::bigint)
              FROM public.certificates
              WHERE certificate_number ~ '^CERT-[0-9]{4}-[0-9]+$'), 1)
), true);

CREATE OR REPLACE FUNCTION public.generate_certificate_number()
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

DROP TABLE public.certificate_number_counters;
