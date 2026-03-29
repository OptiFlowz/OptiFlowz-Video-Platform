import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/search";
import SearchPage from "~/components/searchPage/searchPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Search(){
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

      <SearchPage />

      <Footer />
  </>;
}

export default Search;