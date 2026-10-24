-- Up Migration

-- Identify built-in designs by name and system flag; IDs differ between environments.
-- Existing private copies remain unchanged, even when they share these names.

-- Classic
UPDATE public.certificate_templates
SET html_template = replace(html_template, $qr_before$      </footer>$qr_before$, $qr_after$        <img class="certificate-qr" src="{{certificate.qr_code_data_uri}}" alt="QR Code" width="104" height="104" />
      </footer>$qr_after$),
    css_template = css_template || $qr_css$
/* Certificate verification QR */
.certificate-content .certificate-qr { position: absolute; right: .65in; bottom: .65in; width: 104px; height: 104px; object-fit: contain; }
$qr_css$,
    updated_at = now()
WHERE name = 'Classic' AND is_system = true
  AND position('certificate.qr_code_data_uri' in html_template) = 0
  AND position($qr_before$      </footer>$qr_before$ in html_template) > 0;


-- Minimal
UPDATE public.certificate_templates
SET html_template = replace(html_template, $qr_before$  </footer>$qr_before$, $qr_after$    <img class="certificate-qr" src="{{certificate.qr_code_data_uri}}" alt="QR Code" width="96" height="96" />
  </footer>$qr_after$),
    css_template = css_template || $qr_css$
/* Certificate verification QR */
.certificate-content--minimal .minimal-footer { display: flex; align-items: flex-end; gap: 24px; }
.certificate-content--minimal .minimal-details { flex: 1; min-width: 0; gap: 20px; }
.certificate-content--minimal .certificate-qr { flex: 0 0 96px; width: 96px; height: 96px; object-fit: contain; }
$qr_css$,
    updated_at = now()
WHERE name = 'Minimal' AND is_system = true
  AND position('certificate.qr_code_data_uri' in html_template) = 0
  AND position($qr_before$  </footer>$qr_before$ in html_template) > 0;



UPDATE public.certificate_templates
SET html_template = replace(html_template, '{{certificate.qr_code_data_uri}}', '{{certificate.qr_code_data_uri.size_512.dots_rounded.corners_extra-rounded.cornerdots_dot.gradient_linear_003e8e_102443_45.background_f8fbff.ecc_Q}}'), updated_at = now()
WHERE name = 'Classic' AND is_system = true;

UPDATE public.certificate_templates
SET html_template = replace(html_template, '{{certificate.qr_code_data_uri}}', '{{certificate.qr_code_data_uri.size_512.color_14243b.dots_rounded.corners_square.cornerdots_square.background_ffffff.ecc_Q}}'), updated_at = now()
WHERE name = 'Minimal' AND is_system = true;

-- Down Migration

UPDATE public.certificate_templates
SET html_template = replace(html_template, '{{certificate.qr_code_data_uri.size_512.color_14243b.dots_rounded.corners_square.cornerdots_square.background_ffffff.ecc_Q}}', '{{certificate.qr_code_data_uri}}'), updated_at = now()
WHERE name = 'Minimal' AND is_system = true;

UPDATE public.certificate_templates
SET html_template = replace(html_template, '{{certificate.qr_code_data_uri.size_512.dots_rounded.corners_extra-rounded.cornerdots_dot.gradient_linear_003e8e_102443_45.background_f8fbff.ecc_Q}}', '{{certificate.qr_code_data_uri}}'), updated_at = now()
WHERE name = 'Classic' AND is_system = true;


UPDATE public.certificate_templates
SET html_template = replace(html_template, $qr_after$        <img class="certificate-qr" src="{{certificate.qr_code_data_uri}}" alt="QR Code" width="104" height="104" />
      </footer>$qr_after$, $qr_before$      </footer>$qr_before$),
    css_template = replace(css_template, $qr_css$
/* Certificate verification QR */
.certificate-content .certificate-qr { position: absolute; right: .65in; bottom: .65in; width: 104px; height: 104px; object-fit: contain; }
$qr_css$, ''),
    updated_at = now()
WHERE name = 'Classic' AND is_system = true;


UPDATE public.certificate_templates
SET html_template = replace(html_template, $qr_after$    <img class="certificate-qr" src="{{certificate.qr_code_data_uri}}" alt="QR Code" width="96" height="96" />
  </footer>$qr_after$, $qr_before$  </footer>$qr_before$),
    css_template = replace(css_template, $qr_css$
/* Certificate verification QR */
.certificate-content--minimal .minimal-footer { display: flex; align-items: flex-end; gap: 24px; }
.certificate-content--minimal .minimal-details { flex: 1; min-width: 0; gap: 20px; }
.certificate-content--minimal .certificate-qr { flex: 0 0 96px; width: 96px; height: 96px; object-fit: contain; }
$qr_css$, ''),
    updated_at = now()
WHERE name = 'Minimal' AND is_system = true;

