import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/termsOfUse";
import TermsOfUsePage from "~/components/termsOfUsePage/termsOfUsePage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function TermsOfUse(){
  return <>
    <Header />

    <TermsOfUsePage />

    <Footer />
  </>;
}

export default TermsOfUse;