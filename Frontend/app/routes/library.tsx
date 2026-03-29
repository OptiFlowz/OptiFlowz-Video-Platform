import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/library";
import LibraryPage from "~/components/libraryPage/libraryPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform Library" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Library(){
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

      <LibraryPage />

      <Footer />
  </>;
}

export default Library;