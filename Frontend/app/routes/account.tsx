import Header from "~/components/header/header";
import type { Route } from "./+types/account";
import Footer from "~/components/footer/footer";
import AccountPage from "~/components/accountPage/accountPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Account(){
    const hasUser =
    !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    )}`;
    return null;
  }
  
    return <>
        <Header />

        <AccountPage />

        <Footer />
    </>;
}

export default Account;