import Footer from "~/components/footer/footer";
import Header from "~/components/header/header";
import VideoQuizPage from "~/components/playPage/playerCollection/videoQuizPage";
import type { Route } from "./+types/quiz";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Quiz | OptiFlowz Video Platform" },
    { name: "description", content: "Complete an OptiFlowz quiz" },
  ];
}

function Quiz() {
  return (
    <>
      <Header />
      <VideoQuizPage />
      <Footer />
    </>
  );
}

export default Quiz;
