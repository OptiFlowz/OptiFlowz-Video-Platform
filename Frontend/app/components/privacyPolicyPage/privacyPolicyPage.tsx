import {
  BRAND_NAME,
  LEGAL_ENTITY_NAME,
  MARKETING_WEBSITE_URL,
  OFFICE_EMAIL,
  PLATFORM_NAME,
} from "~/changeables";
import { usePrivacyPreferences } from "~/privacy/privacyPreferences";

function PrivacyPolicyPage() {
  const { openPreferences } = usePrivacyPreferences();

  return (
    <main className="textFilledMain">
      <h1>Privacy Policy</h1>
      <p className="mt-3"><strong>Effective date:</strong> August 25, 2026</p>

      <p className="mb-5">
        This notice explains how <strong>{LEGAL_ENTITY_NAME}</strong>, trading as <strong>{BRAND_NAME}</strong>,
        processes personal data when you use <strong>{PLATFORM_NAME}</strong> (the “Platform”). It also explains
        your choices and data-protection rights. This notice applies to the Platform website, account, video,
        playlist, quiz, comment, support, and related learning features.
      </p>

      <section aria-labelledby="controller">
        <h2 id="controller">1) Controller and privacy contact</h2>
        <p>
          <strong>Controller:</strong> {LEGAL_ENTITY_NAME}<br />
          30 N Gould St Ste R, Sheridan, WY 82801, USA<br />
          Website: <a href={MARKETING_WEBSITE_URL}>{MARKETING_WEBSITE_URL}</a><br />
          Privacy email: <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>
        </p>
        <p>
          Use the privacy email for access, correction, erasure, restriction, portability, objection, consent
          withdrawal, or questions about this notice. We may need to verify your identity before acting on a request.
        </p>
      </section>

      <section aria-labelledby="data-purpose-basis">
        <h2 id="data-purpose-basis">2) Data, purposes, and legal bases</h2>
        <div className="privacyTableWrapper">
          <table className="privacyTable">
            <thead>
              <tr>
                <th>Data</th>
                <th>Purpose</th>
                <th>Legal basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Name, email, authentication data, role, membership status, and optional profile details/photo</td>
                <td>Create and administer your account, authenticate you, provide access, and keep profile details accurate</td>
                <td>Performance of the Platform contract; legitimate interests in account administration and security</td>
              </tr>
              <tr>
                <td>Videos and playlists watched, progress, watch time, quiz attempts, certificates, likes, saves, comments, and searches</td>
                <td>Provide learning continuity and user-requested interactive features</td>
                <td>Performance of the Platform contract</td>
              </tr>
              <tr>
                <td>Viewing and interaction history</td>
                <td>Generate and display personalized recommendations</td>
                <td>Your consent; this feature is off until you enable it and can be disabled at any time</td>
              </tr>
              <tr>
                <td>IP address, device/browser and operating-system details, timestamps, request and security logs</td>
                <td>Deliver the service, prevent abuse, investigate incidents, and maintain reliability</td>
                <td>Legitimate interests in operating and securing the Platform; legal obligations where applicable</td>
              </tr>
              <tr>
                <td>Messages, reports, and support correspondence</td>
                <td>Respond to you, resolve issues, and keep a record of the request</td>
                <td>Performance of the Platform contract; legitimate interests in support and dispute handling</td>
              </tr>
              <tr>
                <td>Technical connection data and prompts sent through the AI assistant</td>
                <td>Display and operate the assistant, then answer messages after you confirm inside the chat</td>
                <td>Legitimate interests in providing the assistant interface; your confirmation and the user-requested service for chat messages</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Profile biography, profile photo, and membership status are optional. Please do not include patient,
          medical, or other special-category personal data in profiles, comments, uploads, or AI prompts.
        </p>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources">3) Where data comes from</h2>
        <ul>
          <li>directly from you when you register, edit your profile, interact with content, or contact us;</li>
          <li>automatically from your browser/device and your use of the Platform;</li>
          <li>from Google if you choose “Continue with Google” (basic identity data needed to sign you in); and</li>
          <li>from an organization that sponsors or administers your access, where applicable.</li>
        </ul>
      </section>

      <section aria-labelledby="required-data">
        <h2 id="required-data">4) What is required</h2>
        <p>
          Name, email, password or third-party sign-in credentials, and acceptance of the Terms are required to
          create a standard account. If you do not provide them, we cannot create or authenticate the account.
          Optional profile fields and personalization are not required to use the core Platform. The AI assistant is
          available as an optional user-invoked feature.
        </p>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">5) Recipients and processors</h2>
        <p>We disclose personal data only where needed to operate the Platform or meet legal obligations:</p>
        <ul>
          <li><strong>Mux</strong>, for video hosting, delivery, playback, and related technical video services;</li>
          <li><strong>Google</strong>, only when you choose Google sign-in;</li>
          <li>
            the <strong>AI assistant provider</strong> at ai-chatbot-platform.fly.dev, which delivers the assistant
            interface and processes chat messages after you confirm inside the chat;
          </li>
          <li>hosting, infrastructure, email, security, and support providers acting under contractual instructions;</li>
          <li>
            your sponsoring organization or content partner, where applicable, for access administration and
            reporting; user-level details are limited to what is necessary, and reporting should be aggregated where possible; and
          </li>
          <li>courts, regulators, law enforcement, or other parties where law requires it or legal claims make it necessary.</li>
        </ul>
        <p><strong>We do not sell personal data or use it for third-party behavioral advertising.</strong></p>
      </section>

      <section aria-labelledby="cookies">
        <h2 id="cookies">6) Cookies, local storage, and optional services</h2>
        <p>
          The Platform uses browser storage for authentication/session state, language, autoplay, navigation continuity,
          and your privacy choices. These items are necessary to provide settings or functions you request. The privacy
          choice record contains the preference version, selected categories, and the time the choice was saved.
        </p>
        <p>
          Personalized recommendations remain disabled until you choose them. The AI assistant launcher is available by
          default and its provider can receive technical connection data, such as your IP address and browser/device
          information, to deliver the widget. Before using the chat, the widget asks you to confirm its privacy notice.
          Anything you submit is sent to the assistant provider. Do not submit patient or other sensitive personal data.
        </p>
        <button type="button" className="privacySettingsButton" onClick={openPreferences}>
          Manage privacy choices
        </button>
      </section>

      <section aria-labelledby="automated">
        <h2 id="automated">7) Personalization and automated processing</h2>
        <p>
          If you enable personalization, automated methods use viewing and interaction history to rank or suggest content.
          This does not produce legal or similarly significant effects. You can turn personalization off at any time in
          Privacy choices; the Platform will then stop requesting and displaying personalized recommendations.
        </p>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">8) Retention</h2>
        <p>We apply the following retention criteria:</p>
        <ul>
          <li><strong>Account and profile data:</strong> while the account is active, then only as needed for legal obligations, security, fraud prevention, or legal claims.</li>
          <li><strong>Learning and interaction data:</strong> while needed to provide progress, history, certificates, playlists, comments, and other account features, subject to a valid rights request.</li>
          <li><strong>Authentication, security, and audit logs:</strong> for the shortest period needed to detect and investigate security or abuse and meet documented legal requirements.</li>
          <li><strong>Support and rights-request records:</strong> until the matter is closed, then for the period needed to demonstrate that the request was handled and manage legal claims.</li>
          <li><strong>Privacy choices:</strong> until you replace the choice, clear browser storage, or the preference version changes.</li>
        </ul>
        <p>
          Data may remain in restricted backups until the normal backup cycle replaces it. The operator maintains the
          detailed retention schedule used to turn these criteria into operational deletion periods.
        </p>
      </section>

      <section aria-labelledby="transfers">
        <h2 id="transfers">9) International transfers</h2>
        <p>
          The controller is in the United States, and some providers may process data outside the European Economic Area.
          Where GDPR transfer restrictions apply, transfers must rely on an adequacy decision or appropriate safeguards,
          such as the European Commission’s Standard Contractual Clauses, together with supplementary measures where
          required. Contact <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a> to ask about the safeguard relevant to your data or request a copy.
        </p>
      </section>

      <section aria-labelledby="rights">
        <h2 id="rights">10) Your rights</h2>
        <p>Where GDPR applies, and subject to its conditions and exceptions, you can:</p>
        <ul>
          <li>ask whether we process your data and receive access and a copy;</li>
          <li>correct inaccurate or incomplete data;</li>
          <li>request erasure or restriction of processing;</li>
          <li>receive data you provided in a structured, commonly used, machine-readable format and request transfer where technically feasible;</li>
          <li>object to processing based on legitimate interests;</li>
          <li>withdraw consent at any time, without affecting earlier lawful processing; and</li>
          <li>lodge a complaint with the data protection authority where you live or work, or where the alleged infringement occurred.</li>
        </ul>
        <p>
          Edit profile data from your account page, manage optional processing through Privacy choices, or send any rights
          request to <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>. We normally respond without undue delay and within
          one month. You can find EU supervisory authorities through the
          {" "}<a href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en" target="_blank" rel="noreferrer">European Data Protection Board member list</a>.
        </p>
      </section>

      <section aria-labelledby="security">
        <h2 id="security">11) Security</h2>
        <p>
          We use technical and organizational safeguards appropriate to risk, including access controls, encryption in
          transit, authentication, service monitoring, backups, and incident handling. No internet service can guarantee
          absolute security. Please use a unique password and notify us if you believe your account is compromised.
        </p>
      </section>

      <section aria-labelledby="children">
        <h2 id="children">12) Children</h2>
        <p>
          The Platform is intended for professional education and is not directed to children. Account holders must be at
          least 18 years old or the age of majority in their country, whichever is higher. Contact us if you believe a child
          provided personal data contrary to this requirement.
        </p>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">13) Changes to this notice</h2>
        <p>
          We may update this notice to reflect service, legal, or processing changes. We will post the new effective date
          here and provide a prominent in-product or email notice when a change materially affects how personal data is used.
        </p>
      </section>
    </main>
  );
}

export default PrivacyPolicyPage;
