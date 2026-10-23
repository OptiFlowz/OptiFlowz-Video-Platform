-- Up Migration

INSERT INTO public.certificate_templates (
    id, user_id, is_system, is_default, name, description,
    html_template, css_template, page_format, orientation
) VALUES (
    'd6d99b35-407b-4d93-a63b-d485131da43f', NULL, true, false,
    'Modern', 'Modern system certificate of completion with blue accents and a circular score display.',
    $certificate_html$<div class="certificate-content certificate-content--modern">
  <div class="modern-art" aria-hidden="true">
    <div class="modern-wash"></div>
    <div class="modern-ribbon modern-ribbon--top"></div>
    <div class="modern-ribbon modern-ribbon--bottom"></div>
    <div class="modern-arc modern-arc--one"></div>
    <div class="modern-arc modern-arc--two"></div>
  </div>
  <div class="modern-layout">
    <header class="modern-heading">
      <h1>Certificate</h1>
      <p>of completion</p>
    </header>

    <section class="modern-recipient">
      <p class="modern-label">Awarded to</p>
      <h2 id="recipient-name">{{user.full_name}}</h2>
      <p class="modern-description">For successfully passing the assessment</p>
      <h3 id="course-title">{{quiz.title}}</h3>
    </section>

    <aside class="modern-result" aria-label="Assessment result">
      <div class="modern-score-label">Final score</div>
      <div class="modern-score"><span id="score">{{result.score_percentage}}</span><span class="modern-percent">%</span></div>
      <div class="modern-points"><span id="earned">{{result.earned_points}}</span> / <span id="maximum">{{result.max_points}}</span> points</div>
    </aside>

    <footer class="modern-footer">
      <div>
        <p class="modern-meta-label">Date of issue</p>
        <p class="modern-meta-value" id="completion-date">{{certificate.issued_at}}</p>
      </div>
      <div>
        <p class="modern-meta-label">Certificate number</p>
        <p class="modern-meta-value" id="certificate-number">{{certificate.number}}</p>
      </div>
    </footer>
  </div>
</div>$certificate_html$,
    $certificate_css$@page { size: letter landscape; margin: 0; }

.certificate-content--modern {
  --modern-paper: #fbfdff;
  --modern-ink: #10284c;
  --modern-muted: #647b98;
  --modern-blue: #003e8e;
  --modern-accent: #338cff;
  --modern-sky: #4c9aff;
  --modern-deep: #072d66;
  --modern-wash: #e6f1ff;
  --modern-ice: #f4f9ff;
  --modern-line: #bdd7f8;
  --modern-white: #ffffff;
  --modern-ring: rgba(51, 140, 255, .16);
  --modern-glow: rgba(51, 140, 255, .11);
  --modern-clear: transparent;
  --modern-font: "Avenir Next", "Montserrat", Arial, sans-serif;
  box-sizing: border-box;
  position: relative;
  isolation: isolate;
  width: 11in;
  height: 8.5in;
  overflow: hidden;
  background: var(--modern-paper);
  color: var(--modern-ink);
  font-family: var(--modern-font);
  font-size: 16px;
  line-height: 1.4;
  break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.certificate-content--modern * { box-sizing: border-box; }
.certificate-content--modern .modern-art { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.certificate-content--modern .modern-wash {
  position: absolute; right: -200px; top: -100px; width: 770px; height: 1120px;
  border-radius: 50%; transform: rotate(29deg);
  background: radial-gradient(ellipse at 45% 50%, var(--modern-wash), var(--modern-ice) 58%, var(--modern-paper) 75%);
}
.certificate-content--modern .modern-ribbon { position: absolute; }
.certificate-content--modern .modern-ribbon--top {
  width: 690px; height: 540px; top: -365px; right: -135px;
  border-radius: 42% 58% 43% 57% / 48% 44% 56% 52%; transform: rotate(-25deg);
  background: linear-gradient(120deg, var(--modern-blue) 18%, var(--modern-accent) 62%, var(--modern-sky));
}
.certificate-content--modern .modern-ribbon--bottom {
  width: 515px; height: 750px; right: -330px; bottom: -330px;
  border-radius: 53% 47% 44% 56% / 57% 43% 57% 43%; transform: rotate(32deg);
  background: linear-gradient(150deg, var(--modern-sky), var(--modern-accent) 30%, var(--modern-blue) 65%, var(--modern-deep));
}
.certificate-content--modern .modern-arc {
  position: absolute; width: 530px; height: 1020px; right: -110px; top: -85px;
  border: 1px solid var(--modern-ring); border-radius: 50%; transform: rotate(33deg);
}
.certificate-content--modern .modern-arc--two { right: -132px; top: -70px; }
.certificate-content--modern .modern-layout {
  position: relative; display: flex; flex-direction: column;
  height: 100%; padding: .8in .78in .67in;
}
.certificate-content--modern .modern-heading h1 {
  margin: 0; font-size: 65px; font-weight: 500; line-height: 1.12; letter-spacing: -.045em;
}
.certificate-content--modern .modern-heading > p {
  margin: 5px 0 0; color: var(--modern-blue); font-size: 26px; font-weight: 400; letter-spacing: -.015em;
}
.certificate-content--modern .modern-recipient { width: 6.15in; margin-top: .77in; }
.certificate-content--modern .modern-label { margin: 0 0 12px; color: var(--modern-muted); font-size: 16px; }
.certificate-content--modern .modern-recipient h2 {
  margin: 0; font-size: 49px; font-weight: 600; line-height: 1.12; letter-spacing: -.035em; overflow-wrap: anywhere;
}
.certificate-content--modern .modern-description { margin: 30px 0 12px; color: var(--modern-muted); font-size: 16px; line-height: 1.5; }
.certificate-content--modern .modern-recipient h3 {
  max-width: 5.75in; margin: 0; color: var(--modern-blue); font-size: 28px; font-weight: 500; line-height: 1.35; letter-spacing: -.02em; overflow-wrap: anywhere;
}
.certificate-content--modern .modern-result {
  position: absolute; right: .64in; top: 3.02in;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 224px; height: 224px; border-radius: 50%;
  border: 1px solid var(--modern-white);
  background: linear-gradient(145deg, var(--modern-white), var(--modern-ice));
  box-shadow: 0 20px 55px var(--modern-glow), 0 0 0 12px var(--modern-ring);
  color: var(--modern-blue);
}
.certificate-content--modern .modern-score-label { font-size: 14px; color: var(--modern-muted); }
.certificate-content--modern .modern-score { display: flex; align-items: baseline; gap: 3px; margin-top: 7px; font-size: 65px; font-weight: 500; line-height: 1.1; letter-spacing: -.065em; font-variant-numeric: tabular-nums; }
.certificate-content--modern .modern-percent { font-size: 28px; letter-spacing: -.03em; }
.certificate-content--modern .modern-points { margin-top: 8px; font-size: 15px; font-variant-numeric: tabular-nums; color: var(--modern-muted); }
.certificate-content--modern .modern-footer { display: flex; gap: 64px; width: 6.45in; margin-top: auto; padding-top: 24px; border-top: 1px solid var(--modern-line); }
.certificate-content--modern .modern-meta-label { margin: 0 0 6px; color: var(--modern-muted); font-size: 12px; }
.certificate-content--modern .modern-meta-value { margin: 0; font-size: 15px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }$certificate_css$,
    'Letter', 'landscape'
);

-- Down Migration

DELETE FROM public.certificate_templates
WHERE id = 'd6d99b35-407b-4d93-a63b-d485131da43f' AND is_system = true;
