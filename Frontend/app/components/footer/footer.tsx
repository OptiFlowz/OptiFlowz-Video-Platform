import { memo } from "react";
import { ArrowSVG, FacebookSVG, InstagramSVG, LinkedInSVG, XSVG, YoutubeSVG } from "~/constants";
import { Link } from "react-router";
import { LOGO, BRAND_NAME, MARKETING_WEBSITE_URL, SOCIAL_LINKS, SUPPORT_EMAIL, POWERED_BY_NAME, POWERED_BY_LOGO } from "~/changeables";
import { useI18n } from "~/i18n";
import { usePrivacyPreferences } from "~/privacy/privacyPreferences";

function Footer() {
    const { t } = useI18n();
    const { openPreferences } = usePrivacyPreferences();

    return (
        <footer>
            <div>
                <div>
                    <div className="info">
                        <div className="flex gap-3 items-center">
                            <img
                                src={LOGO}
                                alt={BRAND_NAME + " Logo"}
                                className="w-12 h-12 object-contain shrink-0"
                            />

                            <span className="p-0">
                                <h3 className="font-normal text-2xl -mb-1.5">{BRAND_NAME}</h3>
                                <p className="font-extralight text-md">{t("appName")}</p>
                            </span>
                        </div>

                        <div className="mt-7">
                            <h2 className="text-lg">{t("footerGdprTitle")}</h2>

                            <p className="max-w-87.5 opacity-70 font-light">{t("footerGdprText")}</p>
                        </div>
                    </div>

                    <nav>
                        <Link to="/">
                            {ArrowSVG}
                            <p>{t("navHome")}</p>
                        </Link>
                        <Link to="/account">
                            {ArrowSVG}
                            <p>{t("footerAccount")}</p>
                        </Link>
                        <Link to="/termsOfUse">
                            {ArrowSVG}
                            <p>{t("footerTerms")}</p>
                        </Link>
                        <Link to="/privacyPolicy">
                            {ArrowSVG}
                            <p>{t("footerPrivacy")}</p>
                        </Link>
                        <button type="button" onClick={openPreferences}>
                            {ArrowSVG}
                            <p>{t("footerPrivacyChoices")}</p>
                        </button>
                        <Link to={`mailto:${SUPPORT_EMAIL}`}>
                            {ArrowSVG}
                            <p>{t("footerSupport")}</p>
                        </Link>
                        <Link to={MARKETING_WEBSITE_URL} target="_blank">
                            {ArrowSVG}
                            <p>{BRAND_NAME}</p>
                        </Link>
                    </nav>
                </div>

                <div className="socials">
                    <div>
                        <Link to={SOCIAL_LINKS.linkedin} target="_blank">{LinkedInSVG}</Link>
                        <Link to={SOCIAL_LINKS.youtube} target="_blank">{YoutubeSVG}</Link>
                        <Link to={SOCIAL_LINKS.twitter} target="_blank">{XSVG}</Link>
                        <Link to={SOCIAL_LINKS.instagram} target="_blank">{InstagramSVG}</Link>
                        <Link to={SOCIAL_LINKS.facebook} target="_blank">{FacebookSVG}</Link>
                    </div>
                    <Link to={MARKETING_WEBSITE_URL} target="_blank">
                        {t("footerPoweredBy")}&nbsp;<img loading="lazy" src={POWERED_BY_LOGO} alt={POWERED_BY_NAME + " Logo"} />
                    </Link>
                </div>
            </div>

            <span className="footerCopyright">
                <p className="inline text-(--accentBlue2) italic">{t("footerCopyright")}</p>
                &nbsp;-&nbsp;Copyright © {new Date().getFullYear()}&nbsp;-&nbsp;All rights reserved
            </span>
        </footer>
    );
}

export default memo(Footer);
