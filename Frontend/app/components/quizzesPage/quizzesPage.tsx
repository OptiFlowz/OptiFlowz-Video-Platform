import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { createPortal } from "react-dom";
import {
  AddSVG,
  DeleteSVG,
  EditSVG,
  FilterSVG,
  PlaySVG,
  QuizSVG,
  ThreeDotMenuSVG,
} from "~/constants";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";
import Sidebar from "~/components/myVideosPage/sidebar/sidebar";
import CreateQuizPopup from "~/components/quizzesPage/createQuizPopup";
import EditQuizQuestionsPopup from "~/components/quizzesPage/editQuizQuestionsPopup";
import EditQuizRulesPopup from "~/components/quizzesPage/editQuizRulesPopup";
import EditQuizSourcesPopup from "~/components/quizzesPage/editQuizSourcesPopup";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import { useI18n } from "~/i18n";
import type {
  CreateQuizPayload,
  CreateQuizQuestionPayload,
  CreateQuizRulePayload,
  CreateQuizSourcePayload,
  QuizData,
  QuizQuestionResponse,
} from "~/components/quizzesPage/quizTypes";

type QuizCollectionResponse =
  | QuizData[]
  | {
      success?: boolean;
      quizzes?:
        | QuizData[]
        | {
            quizzes?: QuizData[];
            pagination?: {
              page: number;
              limit: number;
              total: number;
              totalPages: number;
              hasNextPage: boolean;
              hasPreviousPage: boolean;
            };
            sorting?: {
              sortBy?: string;
              sortOrder?: string;
            };
          };
      items?: QuizData[];
      data?: QuizData[];
    };

const QUIZ_MODAL_DURATION = 200;

function normalizeQuizCollection(payload: QuizCollectionResponse): QuizData[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.quizzes)) {
    return payload.quizzes;
  }

  if (Array.isArray(payload?.quizzes?.quizzes)) {
    return payload.quizzes.quizzes;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

function formatDate(value?: string) {
  if (!value) return "Not available";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function QuizzesPage() {
  const { t } = useI18n();
  const headersRef = useRef(new Headers());
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizData | null>(null);
  const [closingSelectedQuiz, setClosingSelectedQuiz] = useState<QuizData | null>(null);
  const [questionsQuiz, setQuestionsQuiz] = useState<QuizData | null>(null);
  const [rulesQuiz, setRulesQuiz] = useState<QuizData | null>(null);
  const [sourcesQuiz, setSourcesQuiz] = useState<QuizData | null>(null);
  const [selectedQuizzes, setSelectedQuizzes] = useState<QuizData[]>([]);
  const [isDeletingQuizId, setIsDeletingQuizId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [quizModalError, setQuizModalError] = useState<string | null>(null);
  const [mobileMenuQuiz, setMobileMenuQuiz] = useState<QuizData | null>(null);
  const { confirm, dialogProps } = useConfirm();

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;

    setToken(userToken);
    headersRef.current = new Headers();
    headersRef.current.set("Content-Type", "application/json");
    headersRef.current.set("Authorization", `Bearer ${userToken}`);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuQuiz ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuQuiz]);

  const {
    data: quizzesResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin-quizzes"],
    queryFn: () =>
      fetchFn<QuizCollectionResponse>({
        route: "api/quizzes/user?sortBy=created_at&sortOrder=desc&page=1&limit=100",
        options: {
          method: "GET",
          headers: headersRef.current,
        },
      }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const quizzes = useMemo(() => {
    const items = normalizeQuizCollection(quizzesResponse ?? []);

    return items.slice().sort((a, b) => {
      const left = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      const right = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      return left - right;
    });
  }, [quizzesResponse]);

  const filteredQuizzes = useMemo(() => {
    const normalizedFilter = filterValue.trim().toLowerCase();
    if (!normalizedFilter) return quizzes;

    return quizzes.filter((quiz) => {
      const haystack = [
        quiz.title,
        quiz.description,
        quiz.created_by,
        String(quiz.question_count ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedFilter);
    });
  }, [filterValue, quizzes]);

  useEffect(() => {
    setSelectedQuizzes((prev) => {
      const next = prev.filter((selected) =>
        filteredQuizzes.some((quiz) => quiz.id === selected.id)
      );

      if (
        next.length === prev.length &&
        next.every((quiz, index) => quiz.id === prev[index]?.id)
      ) {
        return prev;
      }

      return next;
    });
  }, [filteredQuizzes]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;

    if (filteredQuizzes.length === 0) {
      el.checked = false;
      el.indeterminate = false;
      return;
    }

    const selectedVisibleCount = filteredQuizzes.filter((quiz) =>
      selectedQuizzes.some((selected) => selected.id === quiz.id)
    ).length;

    el.checked = selectedVisibleCount === filteredQuizzes.length;
    el.indeterminate =
      selectedVisibleCount > 0 && selectedVisibleCount < filteredQuizzes.length;
  }, [filteredQuizzes, selectedQuizzes]);

  useEffect(() => {
    if (selectedQuiz) {
      setClosingSelectedQuiz(selectedQuiz);
      return;
    }

    const timeout = window.setTimeout(
      () => setClosingSelectedQuiz(null),
      QUIZ_MODAL_DURATION
    );

    return () => window.clearTimeout(timeout);
  }, [selectedQuiz]);

  const toggleSelectAll = () => {
    const el = selectAllRef.current;
    if (!el) return;

    if (el.checked) {
      setSelectedQuizzes(filteredQuizzes);
      return;
    }

    setSelectedQuizzes([]);
  };

  const toggleQuizSelection = (quiz: QuizData, checked: boolean) => {
    setSelectedQuizzes((prev) => {
      if (checked) {
        if (prev.some((selected) => selected.id === quiz.id)) {
          return prev;
        }

        return [...prev, quiz];
      }

      return prev.filter((selected) => selected.id !== quiz.id);
    });
  };

  const openCreateModal = () => {
    setSelectedQuiz(null);
    setQuizModalError(null);
    setIsQuizModalOpen(true);
  };

  const openEditModal = async (quiz: QuizData) => {
    setQuizModalError(null);

    try {
      const response = await fetchFn<{ success: boolean; quiz?: QuizData }>({
        route: `api/quizzes/${quiz.id}/details`,
        options: {
          method: "GET",
          headers: headersRef.current,
        },
      });

      if (!response?.quiz) {
        throw new Error("Failed to load quiz details.");
      }

      setSelectedQuiz(response.quiz);
      setIsQuizModalOpen(true);
    } catch (err) {
      setQuizModalError(
        err instanceof Error ? err.message : "Failed to load quiz details."
      );
    }
  };

  const handleCreateQuiz = async (payload: CreateQuizPayload) => {
    await fetchFn<{ success: boolean; quiz?: QuizData }>({
      route: "api/quizzes/create",
      options: {
        method: "POST",
        headers: headersRef.current,
        body: JSON.stringify(payload),
      },
    });

    setIsQuizModalOpen(false);
    await refetch();
  };

  const handleUpdateQuiz = async (payload: CreateQuizPayload) => {
    if (!selectedQuiz?.id) return;

    await fetchFn<{ success: boolean; quiz?: QuizData }>({
      route: `api/quizzes/${selectedQuiz.id}`,
      options: {
        method: "PATCH",
        headers: headersRef.current,
        body: JSON.stringify(payload),
      },
    });

    setIsQuizModalOpen(false);
    setSelectedQuiz(null);
    await refetch();
  };

  const handleDeleteQuiz = async (quiz: QuizData) => {
    setMobileMenuQuiz(null);

    const confirmed = await confirm({
      title: `Delete quiz "${quiz.title}"?`,
      message: "This will permanently remove the quiz and all of its questions.",
      yesText: "Delete",
      noText: "Cancel",
    });
    if (!confirmed) return false;

    setIsDeletingQuizId(quiz.id);

    try {
      await fetchFn<{ success: boolean; deleted?: boolean }>({
        route: `api/quizzes/${quiz.id}`,
        options: {
          method: "DELETE",
          headers: headersRef.current,
        },
      });

      if (questionsQuiz?.id === quiz.id) {
        setQuestionsQuiz(null);
      }

      if (rulesQuiz?.id === quiz.id) {
        setRulesQuiz(null);
      }

      if (sourcesQuiz?.id === quiz.id) {
        setSourcesQuiz(null);
      }

      if (selectedQuiz?.id === quiz.id) {
        setSelectedQuiz(null);
      }

      await refetch();
      return true;
    } finally {
      setIsDeletingQuizId(null);
    }
  };

  const handleOpenQuiz = (quiz: QuizData) => {
    setMobileMenuQuiz(null);
    window.location.href = `/quiz/${quiz.id}`;
  };

  const handleEditQuiz = async (quiz: QuizData) => {
    setMobileMenuQuiz(null);
    await openEditModal(quiz);
  };

  const handleOpenQuestionsFromModal = () => {
    if (!selectedQuiz) return;

    setQuestionsQuiz(selectedQuiz);
    setIsQuizModalOpen(false);
    setSelectedQuiz(null);
  };

  const handleOpenRulesFromModal = () => {
    if (!selectedQuiz) return;

    setRulesQuiz(selectedQuiz);
    setIsQuizModalOpen(false);
    setSelectedQuiz(null);
  };

  const handleOpenSourcesFromModal = () => {
    if (!selectedQuiz) return;

    setSourcesQuiz(selectedQuiz);
    setIsQuizModalOpen(false);
    setSelectedQuiz(null);
  };

  const handleDeleteSelectedQuizzes = useCallback(async () => {
    const count = selectedQuizzes.length;
    if (!count) return;

    const confirmed = await confirm({
      title: `Delete ${count} ${count === 1 ? "quiz" : "quizzes"}?`,
      message: "This will permanently remove the selected quizzes and all of their questions.",
      yesText: "Delete",
      noText: "Cancel",
    });
    if (!confirmed) return;

    setIsBulkDeleting(true);

    try {
      await Promise.all(
        selectedQuizzes.map((quiz) =>
          fetchFn<{ success: boolean; deleted?: boolean }>({
            route: `api/quizzes/${quiz.id}`,
            options: {
              method: "DELETE",
              headers: headersRef.current,
            },
          })
        )
      );

      if (questionsQuiz && selectedQuizzes.some((quiz) => quiz.id === questionsQuiz.id)) {
        setQuestionsQuiz(null);
      }

      if (rulesQuiz && selectedQuizzes.some((quiz) => quiz.id === rulesQuiz.id)) {
        setRulesQuiz(null);
      }

      if (sourcesQuiz && selectedQuizzes.some((quiz) => quiz.id === sourcesQuiz.id)) {
        setSourcesQuiz(null);
      }

      if (selectedQuiz && selectedQuizzes.some((quiz) => quiz.id === selectedQuiz.id)) {
        setSelectedQuiz(null);
      }

      setSelectedQuizzes([]);
      await refetch();
    } finally {
      setIsBulkDeleting(false);
    }
  }, [confirm, questionsQuiz, refetch, rulesQuiz, selectedQuiz, selectedQuizzes, sourcesQuiz]);

  const handleCreateQuizQuestion = async (payload: CreateQuizQuestionPayload) => {
    if (!questionsQuiz?.id) {
      throw new Error("Open a quiz before creating questions.");
    }

    const response = await fetchFn<{
      success: boolean;
      question?: QuizQuestionResponse;
    }>({
      route: `api/quizzes/${questionsQuiz.id}/question/create`,
      options: {
        method: "POST",
        headers: headersRef.current,
        body: JSON.stringify(payload),
      },
    });

    await refetch();

    if (!response?.question) {
      throw new Error("Failed to create quiz question.");
    }

    return {
      id: response.question.id,
      question_text: response.question.question_text,
      question_type: response.question.question_type,
      points: Number(response.question.points),
      position: Number(response.question.position),
    };
  };

  const handleCreateQuizRule = async (payload: CreateQuizRulePayload) => {
    if (!rulesQuiz?.id) {
      throw new Error("Open a quiz before creating rules.");
    }

    const response = await fetchFn<{
      success: boolean;
      rule?: { id?: string; rule_id?: string };
    }>({
      route: `api/quizzes/${rulesQuiz.id}/rule/create`,
      options: {
        method: "POST",
        headers: headersRef.current,
        body: JSON.stringify(payload),
      },
    });

    await refetch();

    if (!response?.rule?.id && !response?.rule?.rule_id) {
      throw new Error("Failed to create quiz rule.");
    }

    return response.rule;
  };

  const handleCreateQuizSource = async (payload: CreateQuizSourcePayload) => {
    if (!sourcesQuiz?.id) {
      throw new Error("Open a quiz before creating sources.");
    }

    const response = await fetchFn<{
      success: boolean;
      source?: { id?: string; source_id?: string };
    }>({
      route: `api/quizzes/${sourcesQuiz.id}/question-source/create`,
      options: {
        method: "POST",
        headers: headersRef.current,
        body: JSON.stringify(payload),
      },
    });

    await refetch();

    if (!response?.source?.id && !response?.source?.source_id) {
      throw new Error("Failed to create quiz source.");
    }

    return response.source;
  };

  const activeQuizModalQuiz = selectedQuiz ?? closingSelectedQuiz;
  const activeQuizModalInitialValues: CreateQuizPayload | null = activeQuizModalQuiz
    ? {
        title: activeQuizModalQuiz.title,
        description: activeQuizModalQuiz.description,
        is_active: activeQuizModalQuiz.is_active,
        time_limit_seconds: Number(activeQuizModalQuiz.time_limit_seconds),
        question_count: Number(activeQuizModalQuiz.question_count),
        max_attempts: Number(activeQuizModalQuiz.max_attempts),
        passing_score_percentage: Number(activeQuizModalQuiz.passing_score_percentage),
        answer_review_mode:
          activeQuizModalQuiz.answer_review_mode === "at_end" ? "at_end" : "immediate",
        shuffle_questions: activeQuizModalQuiz.shuffle_questions,
        shuffle_options: activeQuizModalQuiz.shuffle_options,
      }
    : null;

  return (
    <main className="myVideos quizzesPage">
      <Sidebar />
      <ConfirmDialog {...dialogProps} />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("navQuizzes")}</h1>
              <p>Create, edit, and organize quizzes independently from videos.</p>
            </div>
            <div className="libraryActions">
              <div className="filter">
                {FilterSVG}
                <input
                  type="text"
                  placeholder="Filter quizzes"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="playlistAddBtn"
                title="Create quiz"
                aria-label="Create quiz"
                onClick={openCreateModal}
              >
                {AddSVG}
              </button>
            </div>
          </div>

          <div className="mobileTitleRow">
            <h2 className="mobileTitle">{t("navQuizzes")}</h2>
            <button
              type="button"
              className="playlistAddBtn mobile"
              title="Create quiz"
              aria-label="Create quiz"
              onClick={openCreateModal}
            >
              {AddSVG}
            </button>
          </div>

          <div className="libraryTableWrap">
            <table>
              <thead>
                <tr>
                  <th className="notHoverable">
                    <span>
                      <input
                        ref={selectAllRef}
                        onChange={toggleSelectAll}
                        className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        type="checkbox"
                      />
                      <p className="py-3">Quiz</p>
                      {selectedQuizzes.length > 0 && (
                        <span id="selectedButtons">
                          <button
                            className="button bg-(--accentRed) text-white"
                            onClick={() => void handleDeleteSelectedQuizzes()}
                            disabled={isBulkDeleting}
                          >
                            {isBulkDeleting ? "Deleting..." : "Delete All"}
                          </button>
                        </span>
                      )}
                    </span>
                  </th>
                  <th>Status</th>
                  <th>Questions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="flex items-center gap-3 py-6">
                        <div className="uploadSpinner tiny" />
                        <span>Loading quizzes...</span>
                      </div>
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="errorBanner my-4">
                        <p>
                          {error instanceof Error
                            ? error.message
                            : "Failed to load quizzes."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : filteredQuizzes.length ? (
                  filteredQuizzes.map((quiz) => (
                    <tr key={quiz.id}>
                      <td>
                        <div className="quizRowInfo flex min-w-[240px] items-center gap-3 py-2">
                          <input
                            className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                            type="checkbox"
                            checked={selectedQuizzes.some((selected) => selected.id === quiz.id)}
                            onChange={(event) =>
                              toggleQuizSelection(quiz, event.target.checked)
                            }
                          />
                          <div className="rounded-xl bg-(--background2) p-2 text-(--accentBlue)">
                            {QuizSVG}
                          </div>
                          <div className="flex flex-col gap-1">
                            <strong className="text-(--text1)">{quiz.title}</strong>
                            <span className="text-sm opacity-75">
                              {quiz.description || "No description"}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="quizMobileOptionsButton"
                            aria-label="Quiz options"
                            onClick={() => setMobileMenuQuiz(quiz)}
                          >
                            {ThreeDotMenuSVG}
                          </button>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`inline-flex w-fit whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                            quiz.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {quiz.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>{quiz.question_count}</td>
                      <td>
                        <div className="flex flex-wrap gap-2 py-2">
                          <Link
                            to={`/quiz/${quiz.id}`}
                            className="saveCaptionsBtn"
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            className="saveCaptionsBtn"
                            onClick={() => void openEditModal(quiz)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="deleteCaptionsBtn"
                            onClick={() => void handleDeleteQuiz(quiz)}
                            disabled={isDeletingQuizId === quiz.id || isBulkDeleting}
                          >
                            {isDeletingQuizId === quiz.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>
                      <div className="flex flex-col items-center gap-3 py-10 text-center opacity-80">
                        <div className="rounded-full bg-(--background2) p-4 text-(--accentBlue)">
                          {QuizSVG}
                        </div>
                        <div>
                          <p className="font-semibold">No quizzes found</p>
                          <p className="text-sm">
                            Create your first quiz here or adjust the current filter.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {mobileMenuQuiz &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="fixed inset-0 z-100 flex items-end justify-center"
                onClick={() => setMobileMenuQuiz(null)}
              >
                <div className="absolute inset-0 bg-black/50" />

                <div
                  className="rowActionSheet relative w-full max-w-lg animate-slide-up rounded-t-3xl bg-(--background1) pb-safe"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex justify-center py-3">
                    <div className="h-1 w-10 rounded-full bg-(--border1)" />
                  </div>

                  <div className="flex items-center gap-3 px-4 pb-3 border-b border-(--border1)">
                    <div className="rounded-xl bg-(--background2) p-2 text-(--accentBlue)">
                      {QuizSVG}
                    </div>
                    <p className="text-sm font-medium line-clamp-2 flex-1">
                      {mobileMenuQuiz.title}
                    </p>
                  </div>

                  <div className="flex flex-col py-2">
                    <button
                      type="button"
                      onClick={() => handleOpenQuiz(mobileMenuQuiz)}
                      className="flex items-center gap-4 px-4 py-3 text-left hover:bg-(--background2) active:bg-(--background3) transition-colors cursor-pointer"
                    >
                      <span className="w-6 h-6 flex items-center justify-center playSvg">
                        {PlaySVG}
                      </span>
                      <span>Open Quiz</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleEditQuiz(mobileMenuQuiz)}
                      className="flex items-center gap-4 px-4 py-3 text-left hover:bg-(--background2) active:bg-(--background3) transition-colors cursor-pointer"
                    >
                      <span className="w-6 h-6 flex items-center justify-center">
                        {EditSVG}
                      </span>
                      <span>Edit Quiz</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteQuiz(mobileMenuQuiz)}
                      disabled={isDeletingQuizId === mobileMenuQuiz.id || isBulkDeleting}
                      className="flex items-center gap-4 px-4 py-3 text-left hover:bg-(--background2) active:bg-(--background3) transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <span className="w-6 h-6 flex items-center justify-center">
                        {DeleteSVG}
                      </span>
                      <span>
                        {isDeletingQuizId === mobileMenuQuiz.id ? "Deleting..." : "Delete Quiz"}
                      </span>
                    </button>
                  </div>

                  <div className="px-4 pb-4 pt-2">
                    <button
                      type="button"
                      onClick={() => setMobileMenuQuiz(null)}
                      className="w-full rounded-full border border-(--border1) bg-(--background2) py-3 font-medium hover:bg-(--background3) transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )}
          {quizModalError ? (
            <div className="errorBanner mt-4">
              <p>{quizModalError}</p>
            </div>
          ) : null}
        </div>
      </div>

      <CreateQuizPopup
        open={isQuizModalOpen}
        mode={activeQuizModalQuiz ? "edit" : "create"}
        videoTitle=""
        initialValues={activeQuizModalInitialValues}
        onClose={() => {
          setIsQuizModalOpen(false);
          setSelectedQuiz(null);
        }}
        onSubmit={activeQuizModalQuiz ? handleUpdateQuiz : handleCreateQuiz}
        onOpenQuestions={handleOpenQuestionsFromModal}
        onOpenRules={handleOpenRulesFromModal}
        onOpenSources={handleOpenSourcesFromModal}
      />

      <EditQuizQuestionsPopup
        open={!!questionsQuiz}
        quizId={questionsQuiz?.id ?? ""}
        quizTitle={questionsQuiz?.title ?? ""}
        requestHeaders={headersRef.current}
        onClose={() => setQuestionsQuiz(null)}
        onSubmit={handleCreateQuizQuestion}
      />

      <EditQuizRulesPopup
        open={!!rulesQuiz}
        quizId={rulesQuiz?.id ?? ""}
        quizTitle={rulesQuiz?.title ?? ""}
        requestHeaders={headersRef.current}
        onClose={() => setRulesQuiz(null)}
        onSubmit={handleCreateQuizRule}
      />

      <EditQuizSourcesPopup
        open={!!sourcesQuiz}
        quizId={sourcesQuiz?.id ?? ""}
        quizTitle={sourcesQuiz?.title ?? ""}
        requestHeaders={headersRef.current}
        onClose={() => setSourcesQuiz(null)}
        onSubmit={handleCreateQuizSource}
      />
    </main>
  );
}

export default QuizzesPage;
