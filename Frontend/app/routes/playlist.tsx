import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/playlist";
import PlaylistPage from "~/components/playlistPage/playlistPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Playlist(){
  return <>
      <Header />

      <PlaylistPage />

      <Footer />
  </>;
}

export default Playlist;
