import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/play";
import { isUserAdmin } from "~/functions";
import EditPlaylistPage from "~/components/editPlaylistPage/editPlaylistPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    {
      name: "description",
      content: "OptiFlowz video platform template for professional video libraries",
    },
  ];
}

function Play() {
  const hasUser =
    !!localStorage.getItem("user") || !!sessionStorage.getItem("user");

  if (!hasUser) {
    window.location.href = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    )}`;

    if (!isUserAdmin()) {
      window.location.href = `/`;
    }
    return null;
  }

  return (
    <>
      <Header />

      <EditPlaylistPage />

      <Footer />
    </>
  );
}

export default Play;
