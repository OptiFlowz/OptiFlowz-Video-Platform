import LocalizedText from "~/components/library/LocalizedText";
import {
  BRAND_NAME,
  LEGAL_ENTITY_NAME,
  MARKETING_WEBSITE_URL,
  OFFICE_EMAIL,
  PLATFORM_NAME,
} from "~/changeables";
import { usePrivacyPreferences } from "~/privacy/privacyPreferences";
import { useI18n } from "~/i18n";

function PrivacyPolicyPage() {
  const { openPreferences } = usePrivacyPreferences();
  const { t } = useI18n();

  return (
    <main className="textFilledMain">
      <h1>{t("privacyPolicy.intro.h11")}</h1>
      <p className="mt-3"><LocalizedText text={t("privacyPolicy.intro.p1")} /></p>

      <p className="mb-5"><LocalizedText text={t("privacyPolicy.intro.p2")} components={{ value0: <>{LEGAL_ENTITY_NAME}</>, value1: <>{BRAND_NAME}</>, value2: <>{PLATFORM_NAME}</> }} /></p>

      <section aria-labelledby="controller">
        <h2 id="controller">{t("privacyPolicy.controller.h21")}</h2>
        <p><LocalizedText text={t("privacyPolicy.controller.p1")} components={{ value0: <>{LEGAL_ENTITY_NAME}</>, link1: <a href={MARKETING_WEBSITE_URL}></a>, value2: <>{MARKETING_WEBSITE_URL}</>, link3: <a href={`mailto:${OFFICE_EMAIL}`}></a>, value4: <>{OFFICE_EMAIL}</>, value5: "30 N Gould St Ste R, Sheridan, WY 82801, USA" }} /></p>
        <p>{t("privacyPolicy.controller.p2")}</p>
      </section>

      <section aria-labelledby="data-purpose-basis">
        <h2 id="data-purpose-basis">{t("privacyPolicy.data-purpose-basis.h21")}</h2>
        <div className="privacyTableWrapper">
          <table className="privacyTable">
            <thead>
              <tr>
                <th>{t("privacyPolicy.data-purpose-basis.th1")}</th>
                <th>{t("privacyPolicy.data-purpose-basis.th2")}</th>
                <th>{t("privacyPolicy.data-purpose-basis.th3")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t("privacyPolicy.data-purpose-basis.td1")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td2")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td3")}</td>
              </tr>
              <tr>
                <td>{t("privacyPolicy.data-purpose-basis.td4")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td5")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td6")}</td>
              </tr>
              <tr>
                <td>{t("privacyPolicy.data-purpose-basis.td7")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td8")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td9")}</td>
              </tr>
              <tr>
                <td>{t("privacyPolicy.data-purpose-basis.td10")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td11")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td12")}</td>
              </tr>
              <tr>
                <td>{t("privacyPolicy.data-purpose-basis.td13")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td14")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td15")}</td>
              </tr>
              <tr>
                <td>{t("privacyPolicy.data-purpose-basis.td16")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td17")}</td>
                <td>{t("privacyPolicy.data-purpose-basis.td18")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>{t("privacyPolicy.data-purpose-basis.p1")}</p>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources">{t("privacyPolicy.sources.h21")}</h2>
        <ul>
          <li>{t("privacyPolicy.sources.li1")}</li>
          <li>{t("privacyPolicy.sources.li2")}</li>
          <li>{t("privacyPolicy.sources.li3")}</li>
          <li>{t("privacyPolicy.sources.li4")}</li>
        </ul>
      </section>

      <section aria-labelledby="required-data">
        <h2 id="required-data">{t("privacyPolicy.required-data.h21")}</h2>
        <p>{t("privacyPolicy.required-data.p1")}</p>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">{t("privacyPolicy.sharing.h21")}</h2>
        <p>{t("privacyPolicy.sharing.p1")}</p>
        <ul>
          <li><LocalizedText text={t("privacyPolicy.sharing.li1")} components={{ value0: "Mux" }} /></li>
          <li><LocalizedText text={t("privacyPolicy.sharing.li2")} /></li>
          <li><LocalizedText text={t("privacyPolicy.sharing.li3")} components={{ value0: "ai-chatbot-platform.fly.dev" }} /></li>
          <li>{t("privacyPolicy.sharing.li4")}</li>
          <li>{t("privacyPolicy.sharing.li5")}</li>
          <li>{t("privacyPolicy.sharing.li6")}</li>
        </ul>
        <p><LocalizedText text={t("privacyPolicy.sharing.p2")} /></p>
      </section>

      <section aria-labelledby="cookies">
        <h2 id="cookies">{t("privacyPolicy.cookies.h21")}</h2>
        <p>{t("privacyPolicy.cookies.p1")}</p>
        <p>{t("privacyPolicy.cookies.p2")}</p>
        <button type="button" className="privacySettingsButton" onClick={openPreferences}>
          {t("privacyManageChoices")}
        </button>
      </section>

      <section aria-labelledby="automated">
        <h2 id="automated">{t("privacyPolicy.automated.h21")}</h2>
        <p>{t("privacyPolicy.automated.p1")}</p>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">{t("privacyPolicy.retention.h21")}</h2>
        <p>{t("privacyPolicy.retention.p1")}</p>
        <ul>
          <li><LocalizedText text={t("privacyPolicy.retention.li1")} /></li>
          <li><LocalizedText text={t("privacyPolicy.retention.li2")} /></li>
          <li><LocalizedText text={t("privacyPolicy.retention.li3")} /></li>
          <li><LocalizedText text={t("privacyPolicy.retention.li4")} /></li>
          <li><LocalizedText text={t("privacyPolicy.retention.li5")} /></li>
        </ul>
        <p>{t("privacyPolicy.retention.p2")}</p>
      </section>

      <section aria-labelledby="transfers">
        <h2 id="transfers">{t("privacyPolicy.transfers.h21")}</h2>
        <p><LocalizedText text={t("privacyPolicy.transfers.p1")} components={{ link0: <a href={`mailto:${OFFICE_EMAIL}`}></a>, value1: <>{OFFICE_EMAIL}</> }} /></p>
      </section>

      <section aria-labelledby="rights">
        <h2 id="rights">{t("privacyPolicy.rights.h21")}</h2>
        <p>{t("privacyPolicy.rights.p1")}</p>
        <ul>
          <li>{t("privacyPolicy.rights.li1")}</li>
          <li>{t("privacyPolicy.rights.li2")}</li>
          <li>{t("privacyPolicy.rights.li3")}</li>
          <li>{t("privacyPolicy.rights.li4")}</li>
          <li>{t("privacyPolicy.rights.li5")}</li>
          <li>{t("privacyPolicy.rights.li6")}</li>
          <li>{t("privacyPolicy.rights.li7")}</li>
        </ul>
        <p><LocalizedText text={t("privacyPolicy.rights.p2")} components={{ link0: <a href={`mailto:${OFFICE_EMAIL}`}></a>, value1: <>{OFFICE_EMAIL}</>, link2: <a href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en" target="_blank" rel="noreferrer"></a> }} /></p>
      </section>

      <section aria-labelledby="security">
        <h2 id="security">{t("privacyPolicy.security.h21")}</h2>
        <p>{t("privacyPolicy.security.p1")}</p>
      </section>

      <section aria-labelledby="children">
        <h2 id="children">{t("privacyPolicy.children.h21")}</h2>
        <p>{t("privacyPolicy.children.p1")}</p>
      </section>

      <section aria-labelledby="changes">
        <h2 id="changes">{t("privacyPolicy.changes.h21")}</h2>
        <p>{t("privacyPolicy.changes.p1")}</p>
      </section>
    </main>
  );
}

export default PrivacyPolicyPage;
