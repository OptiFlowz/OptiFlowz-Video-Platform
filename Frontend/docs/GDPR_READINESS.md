# GDPR readiness review

Last reviewed: 2026-08-25
Latest implementation update: 2026-09-05 (account deletion integration and current frontend status; release verification remains pending).

This document records the frontend controls implemented in this repository and the non-frontend work still required. It is an engineering checklist, not a legal certification.

## Implemented in the frontend

- Optional personalization is off by default. The AI assistant remains visible and uses its own confirmation before chat use.
- The first privacy layer offers equally accessible accept, reject, and customize actions.
- Choices are granular, timestamped, versioned, persistent, and available again from the footer, account settings, and Privacy Policy.
- Personalization can be withdrawn in the privacy controls. The AI widget uses its own confirmation; the platform preference does not unload the widget or prove withdrawal of consent inside that external service.
- Google Identity and Google Fonts are no longer loaded globally. The AI widget is loaded normally and its own confirmation controls chat use.
- Personalized recommendation endpoints are not called and personalized results are not shown while personalization is disabled.
- Registration distinguishes agreement to the Terms and acknowledgement of the Privacy Policy from optional consent. Optional profile data is labelled optional.
- Users can edit profile data and open pre-addressed electronic requests for access/portability, restriction, objection, and consent withdrawal.
- Account settings now includes a separate deletion confirmation and calls authenticated `DELETE /api/users/me` without a body. Only `{ "success": true, "deleted": true }` triggers removal of authentication state, cancellation/clearing of query caches, and a full redirect to login. Privacy and language preferences are retained. HTTP 409 keeps the session and offers an email erasure-request route; other failures display an error. The destructive request has not been run as part of this frontend work.
- Platform navigation and controls now use effective permissions from `GET /api/users/me/permissions`, including analytics permissions. This is UI access control, not verification of backend authorization or report disclosure limits.
- Authentication failure removes only authentication state instead of erasing privacy and language choices.
- The Privacy Policy now maps data categories to purposes and legal bases and describes sources, required data, recipients, optional services, transfers, retention criteria, rights, and complaint routes.

## Required backend and operational work

These items cannot be completed or verified from the frontend repository:

1. Replace browser-stored bearer tokens with `Secure`, `HttpOnly`, appropriately scoped `SameSite` cookies. Add CSRF protection where cookie authentication is used and verify CORS rules.
2. Implement an authenticated data-access/export endpoint that covers all account, profile, viewing, progress, quiz, certificate, playlist, reaction, comment, and support data in a structured machine-readable format. The current UI provides an electronic request route but cannot create a complete server-side export.
3. Maintain a documented rights-request workflow: identity verification, one-month deadlines, extension notices, refusal reasons, request logs, and escalation to the privacy owner.
4. **Partially implemented:** self-service account deletion UI is connected to the supplied authenticated deletion endpoint. The supplied contract reports HTTP 409 when linked database records block deletion. Still verify the actual deletion/anonymization scope, provide a manual erasure process for blocked requests, and cover linked records, primary storage, processors, search indexes, logs, and backup expiry. A successful account-row deletion alone does not establish complete erasure across these systems.
5. Approve concrete retention periods for each database table/log class and automate deletion or anonymization. The notice currently states retention criteria because verified operational periods were not available.
6. Confirm the complete processor/subprocessor inventory and execute Article 28 data-processing agreements. Verify Mux, infrastructure, email, Google sign-in, and AI-assistant configurations, retention, telemetry, training use, and subprocessors.
7. Document every international transfer mechanism, conduct transfer impact assessments where needed, and make copies of relevant safeguards available on request.
8. Determine whether an EU representative under Article 27 and/or a DPO under Articles 37–39 is required. Publish the correct contact details if appointed.
9. Maintain the record of processing activities, documented lawful-basis assessment, and legitimate-interest assessments. Complete a DPIA if the final scale, profiling, medical-professional context, or other risk factors require one.
10. Create and test an incident-response and personal-data-breach process, including processor escalation and 72-hour supervisory-authority assessment/notification.
11. Store auditable server-side consent evidence if optional processing occurs on the backend. On withdrawal, stop all related backend processing; the frontend currently stops calls/display but cannot control jobs or models running server-side.
12. **Frontend permission checks implemented; backend/report verification pending:** verify that analytics and organization reports enforce effective permissions server-side, aggregation thresholds, purpose limitation, and do not expose user-level activity beyond what is necessary.
13. Review the Privacy Policy with counsel against the actual production architecture. Do not publish unverified claims about processors, safeguards, security controls, or retention. Provide legally reviewed translations for every market in which the Platform is offered; the detailed notice added here is currently English-only.

## Verification before release

- In a fresh browser profile, confirm the AI launcher is visible before the platform privacy choice, while Google Identity and Google Fonts remain absent until a user sign-in action requires them.
- Confirm Reject optional leaves core login, video, language, and security functions usable.
- Confirm opening the AI assistant displays its built-in privacy confirmation before messages can be sent.
- Confirm personalized recommendation API calls are absent while personalization is off and resume only after opt-in.
- Confirm keyboard access, focus visibility, responsive layout, and translations for the privacy controls.
- Confirm changing the privacy preference version prompts for a new choice where the processing purpose materially changes.
- With a disposable test account, confirm deletion requires explicit confirmation, sends the authenticated DELETE request without a body, and clears authentication/query caches only after confirmed success. Confirm HTTP 409 and other failures retain the session (except expired authentication), preserve the account screen, and offer the manual contact route. Confirm cancel, pending-state controls, keyboard focus, mobile layout, and translations. No live account deletion was attempted during implementation.
