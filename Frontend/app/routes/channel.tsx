import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import type { Route } from "./+types/channel";
import ChannelPage from "~/components/channelPage/channelPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Channel() {
  return <>
      <Header />

      <ChannelPage />

      <Footer />
  </>;
}

export default Channel;
