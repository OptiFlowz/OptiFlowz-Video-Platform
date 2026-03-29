import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { fetchFn } from "~/API";
import Loader from "~/components/loaders/loader";
import { changeElementClass } from "~/functions";
import type { AuthFetchT } from "~/types";

export default function GoogleCallbackPage() {
    const navigate = useNavigate();
    const [error] = useState("");
    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");
    const loaderRef = useRef<HTMLDivElement>(null);

    const setLoggedToken = (res: AuthFetchT) => {
    if (res.token) {
        localStorage.removeItem("user");
        sessionStorage.removeItem("user");

        sessionStorage.setItem("user", JSON.stringify(res));

        const rememberMe = localStorage.getItem("rememberMe");
        if(rememberMe && JSON.parse(rememberMe) === true){
          localStorage.setItem("user", JSON.stringify(res));
        }

        localStorage.autoplay = "true";
        navigate("/");
      }
    }

    async function handleGoogleSuccess(code: string) {
      if(sessionStorage.getItem("user"))
        return navigate("/");

      const res = await fetchFn<AuthFetchT>({
          route: `api/auth/oauth/google`,
          options: {
              method: "POST",
              headers: myHeaders,
              body: JSON.stringify({code})
          }
      })
  
      changeElementClass({element: loaderRef.current});
      setLoggedToken(res);
    }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if(code)
      handleGoogleSuccess(code);
  }, [navigate]);

  return (
    <main className="login fixed! inset-0 w-[100vw]! h-[100vh]! p-0!">
      {error ? <p className="text-white">{error}</p> : <Loader ref={loaderRef} classes="pageLoader show" />}
    </main>
  );
}
