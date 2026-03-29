import { passwordHideSVG, passwordShowSVG } from "~/constants";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router";
import { fetchFn } from "~/API";
import { changeElementClass } from "~/functions";
import Loader from "../loaders/loader";
import MessagePopup from "../messagePopup/messagePopup";
import backgroundImage from "../../../assets/LoginBackground.webp";
import OptiFlowzLogo from "../../../assets/OptiFlowzLogo.webp";
import { useI18n } from "~/i18n";

const StepIndicator = ({ step }: { step: number }) => (
    <div className="flex items-center justify-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
            <div
                key={s}
                className={`h-2 rounded-full transition-all ${
                    s === step ? "w-8 bg-(--accentOrange)" : s < step ? "w-2 bg-(--accentBlue)" : "w-2 bg-gray-600"
                }`}
            />
        ))}
    </div>
);

function ForgotPasswordPage() {
    const { t } = useI18n();
    const [step, setStep] = useState(1); // 1: Enter email, 2: Input code, 3: Password Change
    const [showPassword, setShowPassword] = useState(false);
    const [showPasswordConfirmed, setShowPasswordConfirmed] = useState(false);

    const [searchParams] = useSearchParams();
    const userEmail = searchParams.get("user");

    const [cooldown, setCooldown] = useState(0);
    const cooldownIntervalRef = useRef<number | null>(null);

    const email = useRef<HTMLInputElement>(null);
    const resetCode = useRef<HTMLInputElement>(null);
    const password = useRef<HTMLInputElement>(null);
    const passwordConfirm = useRef<HTMLInputElement>(null);
    const pageLoaderRef = useRef<HTMLDivElement>(null);

    let [emailValue, setEmailValue] = useState("");
    let [resetCodeValue, setResetCodeValue] = useState("");
    const [popupState, setPopupState] = useState<{
        open: boolean;
        message: string;
        actionHref?: string;
        actionLabel?: string;
        autoCloseMs?: number;
    }>({
        open: false,
        message: "",
    });

    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");

    const startCooldown = (seconds: number) => {
        if (cooldownIntervalRef.current) {
            window.clearInterval(cooldownIntervalRef.current);
            cooldownIntervalRef.current = null;
        }

        setCooldown(seconds);

        cooldownIntervalRef.current = window.setInterval(() => {
            setCooldown((prev) => {
                if (prev <= 1) {
                    if (cooldownIntervalRef.current) {
                        window.clearInterval(cooldownIntervalRef.current);
                        cooldownIntervalRef.current = null;
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    useEffect(() => {
        return () => {
            if (cooldownIntervalRef.current) {
                window.clearInterval(cooldownIntervalRef.current);
                cooldownIntervalRef.current = null;
            }
        };
    }, []);

    const sendPasswordResetEmail = () => {
        if (!email.current?.value){
            openMessagePopup(t("enterEmailAddress"), false);
            return;
        }

        setEmailValue(email.current.value.trim());

        changeElementClass({ element: pageLoaderRef.current, show: true });

        const raw = JSON.stringify({
            email: email.current.value.trim(),
        });

        const requestOptions: RequestInit = {
            method: "POST",
            headers: myHeaders,
            body: raw,
        };

        fetchFn<{ message: string }>({ route: "api/auth/passwordResetRequest", options: requestOptions })
            .then((res) => {
                if (res.message) {
                    setStep(2);
                    changeElementClass({ element: pageLoaderRef.current });
                }
            })
            .catch((err) => {
                changeElementClass({ element: pageLoaderRef.current });

                // 429 -> start cooldown
                if (err?.message?.includes("429") || err?.status === 429) {
                    startCooldown(10);
                } else {
                    startCooldown(10);
                }

                openMessagePopup(t("tooManyRequests"), false);
            });
    };

    const checkResetCode = () => {
        if (!emailValue || !resetCode.current?.value){
            openMessagePopup(t("enterResetCodeError"), false);
            return;
        }

        setResetCodeValue(resetCode.current.value.trim().toLocaleUpperCase());

        changeElementClass({ element: pageLoaderRef.current, show: true });

        const raw = JSON.stringify({
            email: emailValue,
            token: resetCode.current.value.trim().toLocaleUpperCase(),
        });

        const requestOptions: RequestInit = {
            method: "POST",
            headers: myHeaders,
            body: raw,
        };

        fetchFn<{ message: string; valid: boolean }>({ route: "api/auth/passwordReset/verify", options: requestOptions })
            .then((res) => {
                if (res?.valid) {
                    changeElementClass({ element: pageLoaderRef.current });
                    setStep(3);
                } else {
                    changeElementClass({ element: pageLoaderRef.current });
                    openMessagePopup(t("invalidResetCode"), false);
                }
            })
            .catch((err) => {
                changeElementClass({ element: pageLoaderRef.current });

                if (err?.message?.includes("429") || err?.status === 429) {
                    startCooldown(10);
                    openMessagePopup(t("tooManyRequests"), false);
                    return;
                }

                if (err?.message?.includes("400") || err?.status === 400) {
                    openMessagePopup(t("invalidResetCode"), false);
                } else {
                    openMessagePopup(t("somethingWentWrong"), false);
                }
            });
    };

    const handleFinish = () => {
        if (!emailValue || !resetCodeValue || !password.current?.value || !passwordConfirm.current?.value){
            openMessagePopup(t("enterConfirmNewPassword"), false);
            return;
        }

        if (password.current?.value != passwordConfirm.current?.value) {
            openMessagePopup(t("passwordsDontMatch"), false);
            return;
        }

        if (password.current?.value.length < 8) {
            openMessagePopup(t("passwordMinEight"), false);
            return;
        }

        localStorage.clear();

        changeElementClass({ element: pageLoaderRef.current, show: true });

        const raw = JSON.stringify({
            email: emailValue,
            token: resetCodeValue,
            newPassword: password.current.value,
        });

        const requestOptions: RequestInit = {
            method: "POST",
            headers: myHeaders,
            body: raw,
        };

        fetchFn<{ message: string; changed: boolean }>({ route: "api/auth/passwordReset", options: requestOptions }).then((res) => {
            if (res.changed) {
                changeElementClass({ element: pageLoaderRef.current });
                openMessagePopup(t("passwordChanged"), true);
            } else {
                changeElementClass({ element: pageLoaderRef.current });
                openMessagePopup(t("passwordNotChanged"), false);
            }
        });
    };

    const openMessagePopup = (text: string, isDone: boolean) => {
        setPopupState({
            open: true,
            message: text,
            ...(isDone
                ? { actionHref: "/login", actionLabel: t("login") }
                : { autoCloseMs: 2000 }),
        });
    };

    const closeMessagePopup = () => {
        setPopupState((prev) => ({ ...prev, open: false }));
    };

    return (
        <main className="login max-w-full!">
            <div>
                <div className="background">
                    <img className="w-full h-full" src={backgroundImage} alt="Background" />
                </div>
                
                <Link to="/" className="mb-10 logoDiv flex gap-5 items-center cursor-pointer hover:opacity-80 transition-opacity">
                    <img
                        src={OptiFlowzLogo}
                        alt="OptiFlowz Logo"
                        className="w-12 h-12 object-contain shrink-0"
                    />
                    <span className="p-0">
                    <h3 className="font-semibold text-[1.3rem] max-[500px]:text-[1.2rem] -mb-1.25 text-(--accentBlue)">OptiFlowz</h3>
                        <p className="font-medium text-[rgba(0,0,100,0.5)] text-sm">{t("appName")}</p>
                    </span>
                </Link>

                <div className="holder">
                    <StepIndicator step={step} />
                    <div className="form">
                        <div className={step === 1 ? "" : "hidden"}>
                            <h2 className="text-[1.8rem] font-bold text-(--accentBlue) tracking-[.1rem]">{userEmail ? t("resetYourPassword") : t("forgotPasswordTitle")}</h2>
                            <p className="weakText text-[.95rem] mt-2 mb-7.5">
                                {t("resetPasswordIntro")}
                            </p>
                            <input ref={email} className="mt-2 text-white" type="email" placeholder={t("emailAddress")} defaultValue={userEmail ? userEmail : ""} />

                            <Link
                                to="/login"
                                className="button block mt-4 text-(--accentOrange)"
                            >
                                {t("rememberedPassword")}
                            </Link>

                            <button
                                className="button w-full bg-(--accentOrange) text-white rounded-[12px] py-3 font-semibold mt-12 max-[800px]:mt-16 max-[420px]:mt-8 disabled:opacity-60 disabled:cursor-not-allowed"
                                onClick={sendPasswordResetEmail}
                                disabled={cooldown > 0}
                            >
                                {cooldown > 0 ? t("wait", { count: cooldown }) : t("next")}
                            </button>
                        </div>

                        <div className={step === 2 ? "" : "hidden"}>
                            <h2 className="text-[1.8rem] font-bold tracking-[.1rem] text-(--accentBlue)">{t("enterResetCode")}</h2>
                            <p className="weakText text-[.95rem] mt-2 mb-7.5 opacity-70">
                                {t("resetCodeIntro")}
                            </p>
                            <input ref={resetCode} className="mt-2 text-white" type="text" placeholder={t("resetCode")} />

                            <div className="flex gap-3 mt-12 max-[800px]:mt-16">
                                <button
                                    className="button flex-1 bg-(--background2) hover:bg-(--background3) text-(--accentBlue) rounded-[12px] py-3 font-semibold"
                                    onClick={() => setStep(1)}
                                >
                                    {t("previous")}
                                </button>
                                <button
                                    className="button flex-1 bg-(--accentOrange) text-white rounded-[12px] py-3 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={checkResetCode}
                                    disabled={cooldown > 0}
                                >
                                    {cooldown > 0 ? t("wait", { count: cooldown }) : t("next")}
                                </button>
                            </div>
                        </div>

                        <div className={step === 3 ? "" : "hidden"}>
                            <h2 className="text-[1.8rem] font-bold tracking-[.1rem] text-(--accentBlue) leading-8 mb-4">{t("letsChangePassword")}</h2>
                            <p className="weakText text-[.95rem] mt-2 mb-7.5 opacity-70">{t("newPasswordIntro")}</p>
                            <span className="passwordInput">
                                <input ref={password} type={showPassword ? "text" : "password"} placeholder={t("newPassword")} />
                                <button type="button" onClick={() => setShowPassword(!showPassword)}>
                                    {showPassword ? passwordHideSVG : passwordShowSVG}
                                </button>
                            </span>
                            <span className="passwordInput">
                                <input ref={passwordConfirm} type={showPasswordConfirmed ? "text" : "password"} placeholder={t("confirmNewPassword")} />
                                <button type="button" onClick={() => setShowPasswordConfirmed(!showPasswordConfirmed)}>
                                    {showPasswordConfirmed ? passwordHideSVG : passwordShowSVG}
                                </button>
                            </span>

                            <div className="flex gap-3 mt-12 max-[800px]:mt-16">
                                <button
                                    className="button flex-1 bg-(--background2) hover:bg-(--background3) text-(--accentBlue) rounded-[12px] py-3 font-semibold"
                                    onClick={() => setStep(2)}
                                >
                                    {t("previous")}
                                </button>
                                <button
                                    className="button flex-1 bg-(--accentOrange) text-white rounded-[12px] py-3 font-semibold"
                                    onClick={handleFinish}
                                >
                                    {t("changePassword")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <span className="links mx-auto mb-auto w-fit weakText text-[.85rem] text-center max-w-[calc(100vw-60px)] max-[550px]:text-[.75rem]">
                    <span>
                        <a href="mailto:support@optiflowz.com">
                            {t("support")}
                        </a>
                        ·
                        <Link
                            to="/termsOfUse"
                        >
                            {t("footerTerms")}
                        </Link>
                        ·
                        <Link
                            to="/privacyPolicy"
                        >
                            {t("footerPrivacy")}
                        </Link>
                    </span>

                    <Link className="logo" to="https://optiflowz.com" target="_blank">{t("footerPoweredBy")}&nbsp;<img loading="lazy" src={OptiFlowzLogo} alt="OptiFlowz Logo" /></Link>
                </span>

                <MessagePopup
                    open={popupState.open}
                    message={popupState.message}
                    actionHref={popupState.actionHref}
                    actionLabel={popupState.actionLabel}
                    autoCloseMs={popupState.autoCloseMs}
                    onClose={closeMessagePopup}
                />
            </div>

            <Loader ref={pageLoaderRef} classes="pageLoader displayNone" />
        </main>
    );
}

export default ForgotPasswordPage;
