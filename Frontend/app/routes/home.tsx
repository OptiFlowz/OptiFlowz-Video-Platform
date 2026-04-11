import Header from "~/components/header/header";
import type { Route } from "./+types/home";
import HomePage from "~/components/homePage/homePage";
import Footer from "~/components/footer/footer";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

export default function Home() {
  return <>
    <Header />

    <HomePage />

    <Footer />
  </>
}
