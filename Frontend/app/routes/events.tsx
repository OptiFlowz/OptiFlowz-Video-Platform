import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/events";
import EventsPage from "~/components/eventsPage/eventsPage";

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

        <EventsPage />

        <Footer />
    </>;
}

export default Search;