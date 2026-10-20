"use client";

import VideoQuizPage from "~/components/quizEngine/QuizOverview";
import { FramedPage } from "../../page-shell";

export default function Page() {
  return (
    <FramedPage guard="auth" access="participate">
      <VideoQuizPage />
    </FramedPage>
  );
}
