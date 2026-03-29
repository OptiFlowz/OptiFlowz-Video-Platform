import { GoogleSVG } from "~/constants";
import { useI18n } from "~/i18n";

import { useEffect, useRef } from "react";

type Props = {
    props: {
        isLoading: boolean,
        rememberMe: boolean,
        onSuccess: (credentials: string) => void
    }
};

declare global {
  interface Window {
    google?: any
  }
}

function GoogleLoginButton({props}: Props) {
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const googleInitialized = useRef(false);

    useEffect(() => {
        let cancelled = false;

        const setup = () => {
            if (cancelled || !window.google || !containerRef.current) return;

            if (!googleInitialized.current) {
                try{
                    const clientId = import.meta.env.VITE_CLIENT_ID;

                    if (!clientId) {
                        console.error("Missing Google client ID");
                        return;
                    }

                    window.google.accounts.id.initialize({
                        client_id: clientId,
                        callback: (response: { credential: string }) => {
                            props.onSuccess(response.credential);
                        },
                    });
                }catch{
                    console.log("Error in setting up Google")
                }

                googleInitialized.current = true;
            }
        };

        if (window.google) {
        setup();
        } else {
        const interval = window.setInterval(() => {
            if (window.google) {
            clearInterval(interval);
            setup();
            }
        }, 100);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
        }

        return () => {
        cancelled = true;
        };
    }, [props.onSuccess]);

    const handleSubmit = () => {
        localStorage.setItem("rememberMe", JSON.stringify(props.rememberMe));
        const clientId = import.meta.env.VITE_CLIENT_ID;
        const redirectUri = `${window.location.origin}/google-callback`;

        window.location.href =
            `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${clientId}` +
            `&redirect_uri=${redirectUri}` +
            `&response_type=code` +
            `&scope=openid email profile` +
            `&state=${encodeURIComponent("/login")}`;
    };

    return (
        <button
            type="button"
            disabled={props.isLoading}
            onClick={handleSubmit}
            className={`button bg-(--background2) border-1! text-(--text1) border-(--border1)! w-full rounded-[12px] py-3 font-semibold mt-1 hover:bg-(--background3) ${
                props.isLoading ? "opacity-60 cursor-not-allowed" : ""
            }`}
            >
            {props.isLoading ? (
                t("loggingIn")
            ) : (
                <span className="loginButton font-medium flex items-center justify-center gap-2">
                {GoogleSVG}
                <p>{t("continueWithGoogle")}</p>
                </span>
            )}
        </button>
        // <div ref={containerRef}>

        // </div>
    );
}

export default GoogleLoginButton;
