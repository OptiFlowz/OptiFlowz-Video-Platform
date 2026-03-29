import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/privacyPolicy";
import PrivacyPolicyPage from "~/components/privacyPolicyPage/privacyPolicyPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function PrivacyPolicy(){
  return <>
      <Header />

      <PrivacyPolicyPage />

      <Footer />
  </>;
}

export default PrivacyPolicy;