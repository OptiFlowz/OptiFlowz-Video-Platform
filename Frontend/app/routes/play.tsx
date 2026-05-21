import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import PlayPage from "~/components/playPage/playPage";
import type { Route } from "./+types/play";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Play(){
  return <>
      <Header />

      <PlayPage />

      <Footer />
  </>;
}

export default Play;
