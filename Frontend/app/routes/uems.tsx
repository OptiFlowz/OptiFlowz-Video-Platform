import Header from "~/components/header/header";
import type { Route } from "./+types/home";
import Footer from "~/components/footer/footer";
import UemsReadingList from "~/components/uemsPage/uemsPage";
import { isUserUEMS } from "~/functions";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

export default function Home() {
  const hasUser =
    !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  const isUems = isUserUEMS();

  if (!hasUser || !isUems) {
    window.location.href = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    )}`;
    return null;
  }

  return <>
    <Header />

    <UemsReadingList />

    <Footer />
  </>
}