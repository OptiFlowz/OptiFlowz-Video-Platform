"use client";
import QuizAttemptReviewPage from "~/components/quizEngine/QuizAttemptReviewPage";
import { FramedPage } from "../../../../page-shell";
export default function Page() {
  return <FramedPage guard="auth" access="quizResults"><QuizAttemptReviewPage /></FramedPage>;
}
