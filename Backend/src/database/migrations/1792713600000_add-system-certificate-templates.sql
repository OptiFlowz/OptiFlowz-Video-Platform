-- Up Migration

ALTER TABLE public.certificate_templates
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN is_system boolean NOT NULL DEFAULT false,
    ADD COLUMN is_default boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT certificate_templates_owner_check CHECK (
        (is_system = true AND user_id IS NULL)
        OR (is_system = false AND user_id IS NOT NULL)
    ),
    ADD CONSTRAINT certificate_templates_default_system_check CHECK (
        is_default = false OR is_system = true
    );

-- One global default at most; private templates can never be the system default.
CREATE UNIQUE INDEX certificate_templates_single_default_idx
ON public.certificate_templates (is_default) WHERE is_default = true;

CREATE INDEX idx_certificate_templates_system
ON public.certificate_templates (id) WHERE is_system = true;

INSERT INTO public.certificate_templates (
    id, user_id, is_system, is_default, name, description,
    html_template, css_template, page_format, orientation
) VALUES (
    'b2a08625-4827-4e8a-9cde-d22f30b929ce', NULL, true, true,
    'Classic', 'Default system certificate of completion with a blue geometric design.',
    $certificate_html$<div class="certificate-content">
    <div class="decoration" aria-hidden="true">
      <div class="shape shape--navy"></div>
      <div class="shape shape--blue"></div>
      <div class="shape shape--accent"></div>
      <div class="shape shape--light"></div>
      <div class="shape shape--paper"></div>
      <div class="contour contour--one"></div>
      <div class="contour contour--two"></div>
      <div class="contour contour--three"></div>
    </div>
    <div class="frame" aria-hidden="true"></div>
    <div class="content">
      <header class="heading">
        <h1>CERTIFICATE</h1>
        <p>OF COMPLETION</p>
      </header>
      <section class="recipient">
        <p class="intro">This is to certify that</p>
        <h2 id="recipient-name">{{user.full_name}}</h2>
        <div class="recipient__line" aria-hidden="true"></div>
        <p class="description">has successfully passed the assessment</p>
        <h3 id="course-title">{{quiz.title}}</h3>
        <dl class="results">
          <div class="result">
            <dt>Final score</dt>
            <dd><span id="score">{{result.score_percentage}}</span>%</dd>
          </div>
          <div class="result">
            <dt>Points earned</dt>
            <dd><span id="earned">{{result.earned_points}}</span> / <span id="maximum">{{result.max_points}}</span></dd>
          </div>
        </dl>
      </section>
      <footer class="completion">
        <div>
          <p class="completion__value" id="completion-date">{{certificate.issued_at}}</p>
          <p class="completion__label">Date of issue</p>
        </div>
        <div>
          <p class="completion__value" id="certificate-number">{{certificate.number}}</p>
          <p class="completion__label">Certificate number</p>
        </div>
      </footer>
    </div>
  </div>$certificate_html$,
    $certificate_css$.certificate-content {
  --paper: #f8fbff;
  --ink: #102443;
  --muted: #5d708a;
  --blue-accent-1: #003e8e;
  --blue-accent-2: #338cff;
  --blue-accent-3: #4c9aff;
  --blue-deep: #072956;
  --blue-light: #dcecff;
  --blue-pale: #eef5ff;
  --frame: #b9d7ff;
  --contour: rgba(51, 140, 255, .12);
  --font: "Avenir Next", "Montserrat", Arial, sans-serif;
}

@page { size: letter landscape; margin: 0; }
.certificate-content, .certificate-content * { box-sizing: border-box; }
.certificate-content {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.certificate-content {
  position: relative;
  isolation: isolate;
  width: 11in;
  height: 8.5in;
  overflow: hidden;
  background: var(--paper);
  break-inside: avoid;
}
.certificate-content .decoration { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.certificate-content .shape { position: absolute; }
.certificate-content .shape--navy { inset: 0 0 0 auto; width: 3.3in; background: var(--blue-deep); }
.certificate-content .shape--blue { top: 2.5in; right: .38in; width: 3.3in; height: 7.5in; border-radius: 50%; transform: rotate(35deg); background: var(--blue-accent-1); }
.certificate-content .shape--accent { top: -3.05in; right: -.25in; width: 5.4in; height: 7.1in; border-radius: 48%; transform: rotate(29deg); background: linear-gradient(135deg, var(--blue-light) 15%, var(--blue-accent-3) 65%, var(--blue-accent-2) 100%); }
.certificate-content .shape--light { top: -1.4in; right: .9in; width: 5.15in; height: 9.5in; border-radius: 48%; transform: rotate(28deg); background: linear-gradient(100deg, var(--paper) 20%, var(--blue-pale) 65%, var(--blue-light) 100%); }
.certificate-content .shape--paper { top: -1.5in; left: -4.15in; width: 13.2in; height: 12in; border-radius: 47%; transform: rotate(18deg); background: var(--paper); }
.certificate-content .contour { position: absolute; width: 4.5in; height: 11in; border: 1px solid var(--contour); border-radius: 50%; transform: rotate(32deg); }
.certificate-content .contour--one { top: -1.3in; right: 1.3in; }
.certificate-content .contour--two { top: -1.25in; right: 1.43in; }
.certificate-content .contour--three { top: -1.2in; right: 1.56in; }
.certificate-content .frame { position: absolute; z-index: 1; inset: .25in; border: 1.5px solid var(--frame); border-radius: .25in; pointer-events: none; }
.certificate-content .content { position: relative; z-index: 2; display: flex; flex-direction: column; height: 100%; padding: .85in .72in .7in; }
.certificate-content .heading h1 { margin: 0; color: var(--blue-accent-1); font-size: 64px; font-weight: 500; line-height: 1.08; letter-spacing: -.035em; }
.certificate-content .heading p { margin: 10px 0 0; font-size: 25px; font-weight: 600; line-height: 1.2; letter-spacing: .025em; }
.certificate-content .recipient { width: 7in; margin-top: .55in; }
.certificate-content .intro, .certificate-content .description { margin: 0; color: var(--muted); font-size: 17px; line-height: 1.5; }
.certificate-content .recipient h2 { max-width: 6.8in; margin: 6px 0 0; font-size: 43px; font-weight: 700; line-height: 1.15; letter-spacing: -.02em; overflow-wrap: anywhere; }
.certificate-content .recipient__line { width: 4.1in; height: 1px; margin: 19px 0 19px; background: var(--blue-accent-2); }
.certificate-content .recipient h3 { max-width: 6.9in; margin: 9px 0 0; color: var(--blue-accent-1); font-size: 28px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.certificate-content .results { display: flex; align-items: center; gap: 32px; margin: 28px 0 0; }
.certificate-content .result { display: flex; flex-direction: column; gap: 4px; }
.certificate-content .result + .result { border-left: 1px solid var(--frame); padding-left: 32px; }
.certificate-content .result dt { color: var(--muted); font-size: 13px; }
.certificate-content .result dd { margin: 0; font-size: 27px; font-weight: 600; line-height: 1.2; color: var(--blue-accent-1); font-variant-numeric: tabular-nums; }
.certificate-content .completion { display: flex; gap: 48px; margin-top: auto; padding-top: 24px; }
.certificate-content .completion__value { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.certificate-content .completion__label { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }$certificate_css$,
    'Letter', 'landscape'
);

-- Down Migration

-- System templates cannot exist in the previous, owner-required schema.
-- Rolling this feature back removes system templates and preserves private templates.
DELETE FROM public.certificate_templates WHERE is_system = true;

DROP INDEX public.idx_certificate_templates_system;
DROP INDEX public.certificate_templates_single_default_idx;

ALTER TABLE public.certificate_templates
    DROP CONSTRAINT certificate_templates_default_system_check,
    DROP CONSTRAINT certificate_templates_owner_check,
    DROP COLUMN is_default,
    DROP COLUMN is_system,
    ALTER COLUMN user_id SET NOT NULL;
