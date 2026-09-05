import Header from "~/components/header/header";
import type { Route } from "./+types/home";
import Footer from "~/components/footer/footer";
import UemsReadingList from "~/components/uemsPage/uemsPage";
import ClientGuard from "~/client-guard";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

export default function Page() {
  return <ClientGuard mode="uems"><Header /><UemsReadingList /><Footer /></ClientGuard>;
}
