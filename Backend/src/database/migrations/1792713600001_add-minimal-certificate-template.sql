-- Up Migration

INSERT INTO public.certificate_templates (
    id, user_id, is_system, is_default, name, description,
    html_template, css_template, page_format, orientation
) VALUES (
    'a7e155eb-2c60-4fe0-9533-521eab6cc579', NULL, true, false,
    'Minimal', 'Minimal system certificate of completion with a clean typographic layout.',
    $certificate_html$<div class="certificate-content certificate-content--minimal">
  <header class="minimal-heading">
    <div class="minimal-accent" aria-hidden="true"></div>
    <h1>Certificate of completion</h1>
  </header>

  <section class="minimal-recipient">
    <p class="minimal-intro">This is to certify that</p>
    <h2 id="recipient-name">{{user.full_name}}</h2>
    <p class="minimal-description">has successfully passed the assessment</p>
    <h3 id="course-title">{{quiz.title}}</h3>
  </section>

  <footer class="minimal-footer">
    <dl class="minimal-details">
      <div>
        <dt>Final score</dt>
        <dd class="minimal-score"><span id="score">{{result.score_percentage}}</span>%</dd>
      </div>
      <div>
        <dt>Points earned</dt>
        <dd><span id="earned">{{result.earned_points}}</span> / <span id="maximum">{{result.max_points}}</span></dd>
      </div>
      <div>
        <dt>Date of issue</dt>
        <dd id="completion-date">{{certificate.issued_at}}</dd>
      </div>
      <div>
        <dt>Certificate number</dt>
        <dd id="certificate-number">{{certificate.number}}</dd>
      </div>
    </dl>
  </footer>
</div>$certificate_html$,
    $certificate_css$/* Standalone stylesheet for the minimal certificate. */
@page { size: letter landscape; margin: 0; }

.certificate-content--minimal {
  --certificate-paper: #ffffff;
  --certificate-ink: #14243b;
  --certificate-muted: #627185;
  --certificate-blue: #003e8e;
  --certificate-accent: #338cff;
  --certificate-line: #dce3ec;
  --certificate-font: "Avenir Next", "Montserrat", Arial, sans-serif;

  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 11in;
  height: 8.5in;
  padding: .83in .85in .75in;
  overflow: hidden;
  background: var(--certificate-paper);
  color: var(--certificate-ink);
  font-family: var(--certificate-font);
  font-size: 16px;
  line-height: 1.4;
  break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.certificate-content--minimal * { box-sizing: border-box; }
.certificate-content--minimal .minimal-accent {
  width: 48px;
  height: 3px;
  margin-bottom: 24px;
  background: var(--certificate-accent);
}
.certificate-content--minimal .minimal-heading h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -.025em;
}
.certificate-content--minimal .minimal-recipient {
  margin-top: .95in;
  max-width: 8.8in;
}
.certificate-content--minimal .minimal-intro,
.certificate-content--minimal .minimal-description {
  margin: 0;
  color: var(--certificate-muted);
  font-size: 17px;
  line-height: 1.5;
}
.certificate-content--minimal .minimal-recipient h2 {
  margin: 12px 0 24px;
  color: var(--certificate-blue);
  font-size: 56px;
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -.035em;
  overflow-wrap: anywhere;
}
.certificate-content--minimal .minimal-recipient h3 {
  max-width: 8in;
  margin: 12px 0 0;
  font-size: 27px;
  line-height: 1.35;
  font-weight: 500;
  letter-spacing: -.015em;
  overflow-wrap: anywhere;
}
.certificate-content--minimal .minimal-footer {
  margin-top: auto;
  border-top: 1px solid var(--certificate-line);
  padding-top: 24px;
}
.certificate-content--minimal .minimal-details {
  display: grid;
  grid-template-columns: .8fr .9fr 1.3fr 1.5fr;
  gap: 28px;
  margin: 0;
}
.certificate-content--minimal .minimal-details dt {
  margin: 0 0 9px;
  color: var(--certificate-muted);
  font-size: 12px;
  font-weight: 400;
}
.certificate-content--minimal .minimal-details dd {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.certificate-content--minimal .minimal-details .minimal-score {
  color: var(--certificate-blue);
  font-weight: 600;
}$certificate_css$,
    'Letter', 'landscape'
);

-- Down Migration

DELETE FROM public.certificate_templates
WHERE id = 'a7e155eb-2c60-4fe0-9533-521eab6cc579' AND is_system = true;
