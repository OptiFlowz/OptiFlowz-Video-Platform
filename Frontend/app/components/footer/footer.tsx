import { memo } from "react";
import { ArrowSVG, FacebookSVG, InstagramSVG, LinkedInSVG, XSVG, YoutubeSVG } from "~/constants";
import { Link } from "react-router";
import OptiFlowzLogo from "../../../assets/OptiFlowzLogo.webp";
import { useI18n } from "~/i18n";

function Footer(){
    const { t } = useI18n();

    return (
        <footer>
            <div>
                <div>
                    <div className="info">
                        <div className="flex gap-3 items-center">
                            <img
                                src={OptiFlowzLogo}
                                alt="OptiFlowz Logo"
                                className="w-12 h-12 object-contain shrink-0"
                            />

                            <span className="p-0">
                                <h3 className="font-normal text-2xl -mb-1.5">OptiFlowz</h3>
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
                        <Link to="mailto:support@optiflowz.com">
                            {ArrowSVG}
                            <p>{t("footerSupport")}</p>
                        </Link>
                        <Link to="https://optiflowz.com/" target="_blank">
                            {ArrowSVG}
                            <p>Platform</p>
                        </Link>
                    </nav>
                </div>

                <div className="socials">
                    <div>
                        <Link to="https://optiflowz.com/" target="_blank">{LinkedInSVG}</Link>
                        <Link to="https://optiflowz.com/" target="_blank">{YoutubeSVG}</Link>
                        <Link to="https://optiflowz.com/" target="_blank">{XSVG}</Link>
                        <Link to="https://optiflowz.com/" target="_blank">{InstagramSVG}</Link>
                        <Link to="https://optiflowz.com/" target="_blank">{FacebookSVG}</Link>
                    </div>
                    <Link to="https://optiflowz.com" target="_blank">{t("footerPoweredBy")}&nbsp;<img loading="lazy" src={OptiFlowzLogo} alt="OptiFlowz Logo" /></Link>
                </div>

                <span className="accentLogo">
                    <img src={OptiFlowzLogo} alt="OptiFlowz Logo" />
                </span>
            </div>

            <span>{new Date().getFullYear()} © {t("footerCopyright")}</span>
        </footer>
    );
}

export default memo(Footer);
