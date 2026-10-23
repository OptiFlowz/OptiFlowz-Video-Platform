import LocalizedText from "~/components/library/LocalizedText";
import { useI18n } from "~/i18n";
import { BRAND_NAME, PLATFORM_NAME, OFFICE_EMAIL, LEGAL_ENTITY_NAME } from "~/changeables";

function TermsOfUsePage(){
    const { t } = useI18n();
    return (
        <main className="textFilledMain">
            <h1>{t("termsOfUse.intro.h11")}</h1>
            <p className="mt-3"><LocalizedText text={t("termsOfUse.intro.p1")} /></p>

            <p><LocalizedText text={t("termsOfUse.intro.p2")} components={{ value0: <>{PLATFORM_NAME}</>, value1: <>{BRAND_NAME}</> }} /></p>

            <p className="mb-5">{t("termsOfUse.intro.p3")}</p>

            <section aria-labelledby="who">
                <h2 id="who">{t("termsOfUse.who.h21")}</h2>
                <ul>
                <li><LocalizedText text={t("termsOfUse.who.li1")} /></li>
                <li><LocalizedText text={t("termsOfUse.who.li2")} /></li>
                <li>{t("termsOfUse.who.li3")}</li>
                </ul>
            </section>

            <section aria-labelledby="educational">
                <h2 id="educational">{t("termsOfUse.educational.h21")}</h2>
                <ul>
                <li><LocalizedText text={t("termsOfUse.educational.li1")} /></li>
                <li>{t("termsOfUse.educational.li2")}</li>
                <li><LocalizedText text={t("termsOfUse.educational.li3")} /></li>
                </ul>
            </section>

            <section aria-labelledby="account">
                <h2 id="account">{t("termsOfUse.account.h21")}</h2>
                <ul>
                <li>{t("termsOfUse.account.li1")}</li>
                <li>{t("termsOfUse.account.li2")}</li>
                <li>{t("termsOfUse.account.li3")}</li>
                <li>{t("termsOfUse.account.li4")}</li>
                </ul>
            </section>

            <section aria-labelledby="features">
                <h2 id="features">{t("termsOfUse.features.h21")}</h2>
                <p>{t("termsOfUse.features.p1")}</p>
                <ul>
                <li>{t("termsOfUse.features.li1")}</li>
                <li>{t("termsOfUse.features.li2")}</li>
                <li>{t("termsOfUse.features.li3")}</li>
                <li>{t("termsOfUse.features.li4")}</li>
                </ul>

                <p><LocalizedText text={t("termsOfUse.features.p2")} /></p>

                <p><LocalizedText text={t("termsOfUse.features.p3")} /></p>
            </section>

            <section aria-labelledby="acceptable">
                <h2 id="acceptable">{t("termsOfUse.acceptable.h21")}</h2>
                <p>{t("termsOfUse.acceptable.p1")}</p>
                <ul>
                <li>{t("termsOfUse.acceptable.li1")}</li>
                <li>{t("termsOfUse.acceptable.li2")}</li>
                <li>{t("termsOfUse.acceptable.li3")}</li>
                <li>{t("termsOfUse.acceptable.li4")}</li>
                <li>{t("termsOfUse.acceptable.li5")}</li>
                <li>{t("termsOfUse.acceptable.li6")}</li>
                </ul>
            </section>

            <section aria-labelledby="professional">
                <h2 id="professional">{t("termsOfUse.professional.h21")}</h2>
                <ul>
                <li><LocalizedText text={t("termsOfUse.professional.li1")} /></li>
                <li>{t("termsOfUse.professional.li2")}</li>
                <li>{t("termsOfUse.professional.li3")}</li>
                </ul>
            </section>

            <section aria-labelledby="ip">
                <h2 id="ip">{t("termsOfUse.ip.h21")}</h2>
                <ul>
                <li><LocalizedText text={t("termsOfUse.ip.li1")} components={{ value0: "OptiFlowz" }} /></li>
                <li>{t("termsOfUse.ip.li2")}</li>
                <li><LocalizedText text={t("termsOfUse.ip.li3")} components={{ value0: "OptiFlowz" }} /></li>
                </ul>
            </section>

            <section aria-labelledby="usercontent">
                <h2 id="usercontent">{t("termsOfUse.usercontent.h21")}</h2>
                <p><LocalizedText text={t("termsOfUse.usercontent.p1")} /></p>
                <ul>
                <li>{t("termsOfUse.usercontent.li1")}</li>
                <li><LocalizedText text={t("termsOfUse.usercontent.li2")} components={{ value0: "OptiFlowz" }} /></li>
                <li>{t("termsOfUse.usercontent.li3")}</li>
                </ul>
            </section>

            <section aria-labelledby="thirdparty">
                <h2 id="thirdparty">{t("termsOfUse.thirdparty.h21")}</h2>
                <p>{t("termsOfUse.thirdparty.p1")}</p>
            </section>

            <section aria-labelledby="changes">
                <h2 id="changes">{t("termsOfUse.changes.h21")}</h2>
                <ul>
                <li>{t("termsOfUse.changes.li1")}</li>
                <li>{t("termsOfUse.changes.li2")}</li>
                </ul>
            </section>

            <section aria-labelledby="termination">
                <h2 id="termination">{t("termsOfUse.termination.h21")}</h2>
                <p>{t("termsOfUse.termination.p1")}</p>
            </section>

            <section aria-labelledby="disclaimer">
                <h2 id="disclaimer">{t("termsOfUse.disclaimer.h21")}</h2>
                <p>{t("termsOfUse.disclaimer.p1")}</p>
            </section>

            <section aria-labelledby="liability">
                <h2 id="liability">{t("termsOfUse.liability.h21")}</h2>
                <p><LocalizedText text={t("termsOfUse.liability.p1")} components={{ value0: <>{BRAND_NAME}</> }} /></p>
            </section>

            <section aria-labelledby="law">
                <h2 id="law">{t("termsOfUse.law.h21")}</h2>
                <p><LocalizedText text={t("termsOfUse.law.p1")} /></p>
            </section>

            <section aria-labelledby="contact">
                <h2 id="contact">{t("termsOfUse.contact.h21")}</h2>
                <p><LocalizedText text={t("termsOfUse.contact.p1")} components={{ value0: <>{LEGAL_ENTITY_NAME}</>, link1: <a href={`mailto:${OFFICE_EMAIL}`}></a>, value2: <>{OFFICE_EMAIL}</>, value3: "30 N Gould St Ste R, Sheridan, WY 82801, USA" }} /></p>
            </section>
            </main>
    );
}

export default TermsOfUsePage;
