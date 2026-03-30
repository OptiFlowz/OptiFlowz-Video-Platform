import { ArrowForwardSVG, passwordHideSVG, passwordShowSVG } from "~/constants";
import {
  useContext,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import { changeElementClass, getStoredUser } from "~/functions";
import { CurrentNavContext } from "~/context";
import Loader from "../loaders/loader";
import MessagePopup from "../messagePopup/messagePopup";
import OptiFlowzLogo from "../../../assets/OptiFlowzLogo.webp";
import backgroundImage from "../../../assets/LoginBackground.webp";
import { useI18n } from "~/i18n";
import GoogleLoginButton from "./googleLoginButton";

function LoginPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
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

  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const rememberMeRef = useRef<HTMLInputElement>(null);
  const pageLoaderRef = useRef<HTMLDivElement>(null);
  const isLoggingRef = useRef<number>(0);

  const { setCurrentNav } = useContext(CurrentNavContext);
  const navigate = useNavigate();

  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  useLayoutEffect(() => {
    const saved = localStorage.getItem("rememberMe");
    if (saved !== null) {
      const v = saved === "true";
      setRememberMe(v);
      if (rememberMeRef.current) rememberMeRef.current.checked = v;
    }

    if(getStoredUser())
      navigate("/");
    else
      changeElementClass({element: pageLoaderRef.current});
  }, []);

  async function handleGoogleSuccess(credential: string) {
    const res = await fetchFn<AuthFetchT>({
        route: `api/auth/oauth/google`,
        options: {
            method: "POST",
            headers: myHeaders,
            body: JSON.stringify({credential: credential})
        }
    })

    setLoggedToken(res);
  }

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

  const setLoggedToken = (res: AuthFetchT) => {
    if (res.token) {
        const isRemember =
          rememberMeRef.current?.checked ?? rememberMe;

        localStorage.removeItem("user");
        sessionStorage.removeItem("user");

        localStorage.setItem("rememberMe", String(isRemember));

        if (isRemember) {
          localStorage.setItem("user", JSON.stringify(res));
        } else {
          sessionStorage.setItem("user", JSON.stringify(res));
        }

        localStorage.autoplay = "true";
        setCurrentNav(0);
        navigate(redirect || "/");
      }
  }

  const handleSubmit = () => {
    if (isLoading) return;
    if (!email.current?.value || !password.current?.value) {
      openMessagePopup(t("pleaseEnterEmailPassword"), false);
      return;
    }

    if(password.current?.value?.length < 8){
      openMessagePopup(t("passwordIncorrect"), false);
      return;
    }

    setIsLoading(true);
    changeElementClass({ element: pageLoaderRef.current, show: true });

    const raw = JSON.stringify({
      email: email.current.value,
      password: password.current.value,
    });

    const requestOptions: RequestInit = {
      method: "POST",
      headers: myHeaders,
      body: raw,
    };

    //DISABLE MULTIPLE BUTTON CLICKS
    isLoggingRef.current = isLoggingRef.current + 1;

    if(isLoggingRef.current !== 1) return;

    fetchFn<AuthFetchT>({
      route: "api/auth/login",
      options: requestOptions,
    })
    .then((res) => {
      if (
        "message" in res &&
        (res.message === "Invalid credentials" ||
          res.message === "Invalid data")
      ) {
        setIsLoading(false);
        changeElementClass({ element: pageLoaderRef.current });
        return;
      }

      setLoggedToken(res);
    })
    .catch((err) => {
      setIsLoading(false);
      changeElementClass({ element: pageLoaderRef.current });
      if (err.status === 401) {
        err.message = err.message == "Invalid credentials" ? t("passwordIncorrect") : err.message;
        openMessagePopup(err.message, false);
      }
    })
    .finally(() => {
      isLoggingRef.current = 0;
    })
  };

  const handleEnterKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const shouldGoToPassword = e.currentTarget === email.current && !password.current?.value;

    if(e.key === "Tab" && shouldGoToPassword){
      e.preventDefault();
      password.current?.focus();
      return;
    }

    if (e.key !== "Enter") return;

    e.preventDefault();

    if (shouldGoToPassword){
      password.current?.focus();
      return;
    }

      handleSubmit();      
  };

  return (
    <main className="login max-w-full!">
      <div>
        <div className="background">
          <img className="w-full h-full" src={backgroundImage} alt="Background" />
        </div>
        
        <Link to="/" className="logoDiv flex gap-5 items-center cursor-pointer hover:opacity-80 transition-opacity">
            <img
              src={OptiFlowzLogo}
              alt="OptiFlowz Logo"
              className="w-10 h-10 object-contain shrink-0"
            />
            <span className="p-0">
                        <h3 className="font-medium text-[1.3rem] max-[500px]:text-[1.2rem] -mb-1.25">OptiFlowz</h3>
                <p className="font-medium text-sm">{t("appName")}</p>
            </span>
        </Link>

        <div className="holder">
          <div className="form">
            <h1 className="mb-2 text-[1.8rem] text-(--accentBlue) font-bold tracking-[.1rem]">
              {t("login")}
            </h1>

            <div>
              <span>{t("emailAddress")}</span>
              <input
                ref={email}
                className="mt-2 text-white"
                type="email"
                placeholder="example@gmail.com"
                onKeyDown={handleEnterKey}
              />
            </div>

            <div>
              <span>
                <p>{t("password")}</p>

                <Link
                  to="/forgot-password"
                  className="button text-[.95rem] text-(--accentOrange) leading-4 text-right max-[420px]:text-[.9rem]"
                >
                  {t("forgotPassword")}
                </Link>
              </span>
              <span className="passwordInput mt-2!">
                <input
                  ref={password}
                  className="text-white"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("password")}
                  onKeyDown={handleEnterKey}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword
                    ? passwordHideSVG
                    : passwordShowSVG}
                </button>
              </span>
            </div>

            <span className="mt-2 max-[420px]:w-full max-[420px]:gap-3">
              <span className="flex items-center gap-2">
                <input
                  ref={rememberMeRef}
                  className="appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative
                  checked:after:content-['✓'] checked:after:absolute checked:after:text-(--accentBlue2)
                  checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2
                  checked:after:-translate-x-1/2 checked:after:-translate-y-1/2 max-[420px]:p-2! max-[420px]:rounded-md!"
                  type="checkbox"
                  id="rememberMe"
                  defaultChecked={rememberMe}
                  onChange={(e) =>
                    setRememberMe(e.target.checked)
                  }
                />
                <label
                  htmlFor="rememberMe"
                  className="opacity-60 font-medium text-[.95rem] cursor-pointer leading-4 max-[420px]:text-[.8rem]"
                >
                  {t("rememberMe")}
                </label>
              </span>
            </span>

            <button
              type="button"
              disabled={isLoading}
              onClick={handleSubmit}
              className={`button w-full bg-(--accentOrange) text-white rounded-[12px] py-3 font-semibold mt-12 max-[500px]:mt-6 ${
                isLoading
                  ? "opacity-60 cursor-not-allowed"
                  : ""
              }`}
            >
              {isLoading
                ? t("loggingIn")
                : <span className="loginButton">
                  <p>{t("logIn")}</p>
                  {ArrowForwardSVG}
                </span>
              }
            </button>

            <GoogleLoginButton props={{isLoading: isLoading, rememberMe: rememberMe, onSuccess: handleGoogleSuccess}} />

            <span className="flex items-center justify-center flex-wrap mt-1 gap-1 text-[.925rem]">
              <p className="font-medium text-(--accentBlue) max-[420px]:text-[0.8rem]!">
                {t("dontHaveAccount")}
              </p>
              <Link
                to={`/register${
                  redirect ? `?redirect=${redirect}` : ""
                }`}
                className="button text-(--accentOrange) font-medium"
              >
                {t("registerHere")}
              </Link>
            </span>
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

export default LoginPage;
