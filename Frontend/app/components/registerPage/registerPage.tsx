import { passwordHideSVG, passwordShowSVG } from "~/constants";
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { AuthFetchT } from "~/types";
import { fetchFn } from "~/API";
import OptiFlowzLogo from "../../../assets/OptiFlowzLogo.webp";
import { changeElementClass, getStoredUser } from "~/functions";
import Loader from "../loaders/loader";
import MessagePopup from "../messagePopup/messagePopup";
import backgroundImage from "../../../assets/LoginBackground.webp";
import { useI18n } from "~/i18n";

const StepIndicator = ({ step }: { step: number }) => (
    <div className="flex items-center justify-center gap-2 mb-6">
        {[1, 2].map((s) => (
            <div
                key={s}
                className={`h-2 rounded-full transition-all ${
                    s === step
                        ? "w-8 bg-(--accentOrange)"
                        : s < step
                        ? "w-2 bg-(--accentBlue)"
                        : "w-2 bg-gray-600"
                }`}
            />
        ))}
    </div>
);

function SetupWizardPage() {
    const { t } = useI18n();
    const [step, setStep] = useState(1); // 1: Account, 2: Bio, 2: Should be Categories
    const [showPassword, setShowPassword] = useState(false);
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

    const [searchParams] = useSearchParams();
    const redirect = searchParams.get("redirect");
    
    const email = useRef<HTMLInputElement>(null);
    const password = useRef<HTMLInputElement>(null);
    const firstName = useRef<HTMLInputElement>(null);
    const lastName = useRef<HTMLInputElement>(null);
    const bio = useRef<HTMLTextAreaElement>(null);
    const eaesMember = useRef<HTMLInputElement>(null);
    const pageLoaderRef = useRef<HTMLDivElement>(null);
    const isRegisteringRef = useRef<number>(0);

    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");

    const navigate = useNavigate();

    useLayoutEffect(() => {
        if(getStoredUser())
            navigate("/");
        else
            changeElementClass({element: pageLoaderRef.current});
    }, []);

    useEffect(() => {
        const handleEnterPress = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;

            const target = e.target as HTMLElement | null;
            const tagName = target?.tagName?.toLowerCase();

            if (tagName === "textarea") return;

            e.preventDefault();

            if (step === 1) {
                handleNextStep();
            } else if (step === 2) {
                handleFinish();
            }
        };

        window.addEventListener("keydown", handleEnterPress);
        return () => window.removeEventListener("keydown", handleEnterPress);
    }, [step]);

    const handleFinish = () => {
        const fullName = `${firstName.current?.value || ""} ${lastName.current?.value || ""}`.trim();
        if(!email.current?.value || !password.current?.value || !fullName) return;

        const raw = JSON.stringify({
            "full_name": fullName,
            "email": email.current.value,
            "password": password.current.value,
            "description": bio.current?.value || "",
            "eaes_member": eaesMember.current?.checked
        });

        const requestOptions: RequestInit = {
            method: "POST",
            headers: myHeaders,
            body: raw,
        };

        //DISABLE MULTIPLE BUTTON CLICKS
        isRegisteringRef.current = isRegisteringRef.current + 1;

        if(isRegisteringRef.current !== 1) return;

        changeElementClass({element: pageLoaderRef.current, show: true});

        fetchFn<AuthFetchT>({route: "api/auth/register", options: requestOptions})
        .then((res) => {
            if("message" in res && (res.message == "Invalid credentials" || res.message == "Invalid data"))
                openMessagePopup(t("invalidCredentials"), false);
            
            if("token" in res && res.token){
                const fallback = "/login";
                const redirectTo = redirect ? `/login?redirect=${redirect}` : false || fallback;
                navigate(redirectTo);
            }
        })
        .catch((err) => {
            if (err.status === 409) {
                openMessagePopup(t("accountExists"), false);
                return;
            }
        })
        .finally(() => {
            isRegisteringRef.current = 0;
            changeElementClass({element: pageLoaderRef.current});
        })
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

    const validateStep1 = () => {
        const firstNameValue = firstName.current?.value.trim();
        const lastNameValue = lastName.current?.value.trim();
        const emailValue = email.current?.value.trim();
        const passwordValue = password.current?.value;

        // Check if all fields are filled
        if (!firstNameValue || !lastNameValue || !emailValue || !passwordValue) {
            openMessagePopup(t("completeRequiredFields"), false);
            return false;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailValue)) {
            openMessagePopup(t("validEmail"), false);
            return false;
        }

        if (passwordValue.length < 8) {
            openMessagePopup(t("passwordMinChars"), false);
            return false;
        }

        return true;
    };

    const handleNextStep = () => {
        if (validateStep1()) {
            setStep(2);
        }
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
                        <h3 className="font-semibold text-[1.3rem] max-[500px]:text-[1.2rem] -mb-1.25 text-(--text1)">OptiFlowz</h3>
                        <p className="font-medium text-sm text-(--text2)">{t("appName")}</p>
                    </span>
                </Link>

                <div className="holder">
                    <StepIndicator step={step} />

                    <div className="form">
                        {/* STEP 1: Login Details */}
                        <div className={step === 1 ? "" : "hidden"}>
                            <h2 className="text-[1.8rem] font-bold tracking-[.1rem] text-(--text1)">{t("register")}</h2>
                            <p className="weakText text-[.95rem] mt-2">{t("registerIntro")}</p>
                            <div className="inputHolder">
                                <input ref={firstName} className="mt-4" type="text" placeholder={t("firstName")} />
                                <input ref={lastName} className="mt-4" type="text" placeholder={t("lastName")} />
                            </div>
                            <input ref={email} className="mt-4" type="text" placeholder={t("emailAddress")} />
                            <span className="passwordInput">
                                <input ref={password} type={showPassword ? "text" : "password"}  placeholder={t("password")} />
                                <button type="button" onClick={() => setShowPassword(!showPassword)}>
                                    {showPassword ? passwordHideSVG : passwordShowSVG}
                                </button>
                            </span>
                            <Link
                                to={`/login${
                                redirect ? `?redirect=${redirect}` : ""
                                }`}
                                className="button text-(--accentOrange) mt-4! block"
                            >
                                {t("alreadyHaveAccount")}
                            </Link>

                            <div className="flex gap-3 mt-8 max-[800px]:mt-12">
                                <button 
                                    className="button flex-1 bg-(--accentOrange) text-white rounded-xl py-3 font-semibold" 
                                    onClick={handleNextStep}
                                >
                                    {t("next")}
                                </button>
                            </div>
                        </div>

                        {/* STEP 2: Categories
                        {step === 2 && (
                            <>
                                <h2 className="text-[1.8rem] font-[600] tracking-[.1rem]">Interests</h2>
                                <p className="weakText text-[.95rem] mt-2">Select your favorite categories (at least 1)</p>

                                <div className="grid grid-cols-2 gap-3 mt-6 max-h-[300px] px-2">
                                    {CATEGORIES.map((category) => (
                                        <button
                                            key={category.id}
                                            className={`catItem button flex items-center gap-2 p-3 rounded-[15px] transition-all ${
                                                selectedCategories.includes(category.id)
                                                    ? "bg-[var(--accentBlue)] border-2 border-[var(--accentOrange)]"
                                                    : "bg-gray-700 border-2 border-gray-600 hover:border-gray-500"
                                            }`}
                                            onClick={() => handleCategoryToggle(category.id)}
                                        >
                                            <span className="catIcon">{category.icon}</span>
                                            <span className="text-[.9rem] text-left">{category.name}</span>
                                        </button>
                                    ))}
                                </div>

                                <div className="flex gap-3 mt-12 max-[800px]:mt-16">
                                    <button className="button flex-1 bg-gray-700 rounded-[30px] py-[10px] font-[200]" onClick={() => setStep(1)}>
                                        Previous
                                    </button>
                                    <button 
                                        className="button flex-1 bg-[var(--accentBlue)] rounded-[30px] py-[10px] font-[200]" 
                                        onClick={() => setStep(3)}
                                        disabled={selectedCategories.length < 1}
                                        style={{ 
                                            opacity: selectedCategories.length < 1 ? 0.5 : 1,
                                            cursor: selectedCategories.length < 1 ? "not-allowed" : "pointer"
                                        }}
                                    >
                                        Next ({selectedCategories.length}/1)
                                    </button>
                                </div>
                            </>
                        )} */}

                        {/* STEP 2: Bio */}
                        {step === 2 && (
                            <>
                                <h2 className="text-[1.8rem] font-bold tracking-[.1rem] text-(--text1)">{t("aboutYou")}</h2>
                                <p className="weakText text-[.95rem] mt-0">{t("aboutYouText")}</p>

                                <textarea
                                    ref={bio}
                                    className="mt-6 w-full bg-gray-700 rounded-[15px] p-4 text-[.95rem] min-h-37.5 resize-none focus:outline-none focus:ring-2 focus:ring-(--accentBlue)"
                                    placeholder={t("bioPlaceholder")}
                                    maxLength={300}
                                />

                                <span className="flex items-center gap-2 mt-2">
                                    <input 
                                        ref={eaesMember}
                                        className="appearance-none rounded-md! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative
                                        checked:after:content-['✓'] checked:after:absolute checked:after:text-(--accentBlue2) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2" 
                                        type="checkbox" 
                                        id="rememberMe" 
                                    />
                                    <label htmlFor="rememberMe" className="opacity-60 font-medium text-[.95rem] cursor-pointer">
                                        {t("eaesMember")}
                                    </label>
                                </span>

                                <div className="flex gap-3 mt-12 max-[800px]:mt-16 max-[420px]:mt-8">
                                    <button className="button flex-1 bg-(--background2) hover:bg-(--background3) text-(--text1) rounded-xl py-3 font-semibold" onClick={() => setStep(1)}>
                                        {t("previous")}
                                    </button>
                                    <button className="button flex-1 bg-(--accentOrange) text-white rounded-xl py-3 font-semibold" onClick={handleFinish}>
                                        {t("finish")}
                                    </button>
                                </div>
                            </>
                        )}
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
            </div>

            <MessagePopup
                open={popupState.open}
                message={popupState.message}
                actionHref={popupState.actionHref}
                actionLabel={popupState.actionLabel}
                autoCloseMs={popupState.autoCloseMs}
                onClose={closeMessagePopup}
            />

            <Loader
                ref={pageLoaderRef}
                classes="pageLoader show"
            />
        </main>
    );
}

export default SetupWizardPage;
