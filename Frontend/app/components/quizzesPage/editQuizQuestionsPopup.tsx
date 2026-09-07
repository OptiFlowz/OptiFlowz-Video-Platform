import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor,
  closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import SortableQuizQuestion, { QuizQuestionCard } from "./sortableQuizQuestion";
import { AddSVG } from "~/constants";
import { fetchFn } from "~/API";
import CreateQuizQuestionPopup from "~/components/quizzesPage/createQuizQuestionPopup";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useI18n } from "~/i18n";
import type {
  CreateQuizQuestionPayload,
  QuestionDraftValues,
  QuizQuestion,
} from "./quizTypes";

export type { CreateQuizQuestionPayload } from "./quizTypes";

const QUESTIONS_PAGE_LIMIT = 10;

type QuizQuestionsResponse = {
  success: boolean;
  questions: QuizQuestion[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

type Props = {
  open: boolean;
  quizId: string;
  quizTitle: string;
  requestHeaders: Headers;
  onClose: () => void;
  onSubmit: (payload: CreateQuizQuestionPayload) => Promise<unknown>;
};

function EditQuizQuestionsPopup({
  open,
  quizId,
  quizTitle,
  requestHeaders,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isCreateQuestionOpen, setIsCreateQuestionOpen] = useState(false);
  const [shouldRenderCreateQuestionPopup, setShouldRenderCreateQuestionPopup] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null>(null);
  const [closingEditingQuestion, setClosingEditingQuestion] = useState<QuizQuestion | null>(null);
  const [orderedQuestions, setOrderedQuestions] = useState<QuizQuestion[]>([]);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const { confirm, dialogProps } = useConfirm();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const modalLabel = useMemo(
    () => t("quizQuestionsDescription", { title: quizTitle || t("quizThisQuiz") }),
    [quizTitle, t]
  );

  const {
    data: questionsResponse,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isQuestionsLoading,
    refetch: refetchQuestions,
  } = useInfiniteQuery({
    queryKey: ["quiz-questions", quizId],
    queryFn: ({ pageParam }) =>
      fetchFn<QuizQuestionsResponse>({
        route: `api/quizzes/${quizId}/questions?page=${pageParam}&limit=${QUESTIONS_PAGE_LIMIT}&sortBy=position&sortOrder=asc`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    getNextPageParam: (lastPage) => {
      const pagination = lastPage.pagination;
      if (!pagination?.hasNextPage) return undefined;

      return pagination.page + 1;
    },
    initialPageParam: 1,
    enabled: open && !!quizId,
    refetchOnWindowFocus: false,
  });

  const questions = useMemo(() => {
    const seenQuestionIds = new Set<string>();
    const uniqueQuestions: QuizQuestion[] = [];

    questionsResponse?.pages.forEach((page) => {
      page.questions?.forEach((question) => {
        if (seenQuestionIds.has(question.id)) return;

        seenQuestionIds.add(question.id);
        uniqueQuestions.push(question);
      });
    });

    return uniqueQuestions;
  }, [questionsResponse]);
  const latestPagination = questionsResponse?.pages.at(-1)?.pagination;
  const sortedQuestions = useMemo(
    () =>
      questions
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0)),
    [questions]
  );
  const loadedMaxQuestionPosition =
    orderedQuestions.length > 0
      ? Math.max(...orderedQuestions.map((question) => Number(question.position) || 0))
      : 0;
  const totalQuestionCount = Number(latestPagination?.total ?? questions.length);
  const draggedQuestion = orderedQuestions.find((question) => question.id === draggedQuestionId);
  const nextQuestionPosition =
    Math.max(loadedMaxQuestionPosition, totalQuestionCount) + 1;

  useEffect(() => {
    if (draggedQuestionId || isReordering) return;

    setOrderedQuestions((currentQuestions) => {
      const nextQuestionsSnapshot = JSON.stringify(sortedQuestions);
      const currentQuestionsSnapshot = JSON.stringify(currentQuestions);

      if (currentQuestionsSnapshot === nextQuestionsSnapshot) {
        return currentQuestions;
      }

      return sortedQuestions;
    });
  }, [sortedQuestions, draggedQuestionId, isReordering]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }

      setMounted(true);
      setVisible(false);
      setIsCreateQuestionOpen(false);
      setEditingQuestion(null);
      setDraggedQuestionId(null);
      setSuccessMessage(null);
      setReorderError(null);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [open]);

  useEffect(() => {
    if (isCreateQuestionOpen) {
      setShouldRenderCreateQuestionPopup(true);
      return;
    }

    const timeout = window.setTimeout(
      () => setShouldRenderCreateQuestionPopup(false),
      DURATION
    );

    return () => window.clearTimeout(timeout);
  }, [isCreateQuestionOpen]);

  useEffect(() => {
    if (editingQuestion) {
      setClosingEditingQuestion(editingQuestion);
      return;
    }

    const timeout = window.setTimeout(() => setClosingEditingQuestion(null), DURATION);

    return () => window.clearTimeout(timeout);
  }, [editingQuestion]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !draggedQuestionId && !isCreateQuestionOpen && !editingQuestion) {
        onClose();
      }
    };

    // Read the drag state before the sensor handles Escape and clears it.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [draggedQuestionId, editingQuestion, isCreateQuestionOpen, onClose, open]);

  useEffect(() => {
    if (!open || !hasNextPage || isFetchingNextPage || draggedQuestionId || isReordering) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: "240px" }
    );
    const el = loadMoreRef.current;

    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, open, draggedQuestionId, isReordering]);

  const handleCreateQuestion = async (payload: CreateQuizQuestionPayload) => {
    await onSubmit(payload);
    await refetchQuestions();
    setSuccessMessage(t("quizQuestionCreated"));
  };

  const handleUpdateQuestion = async (payload: CreateQuizQuestionPayload) => {
    if (!editingQuestion) return;

    await fetchFn<{ success: boolean }>({
      route: `api/quizzes/question/${editingQuestion.id}`,
      options: {
        method: "PATCH",
        headers: requestHeaders,
        body: JSON.stringify(payload),
      },
    });

    await refetchQuestions();
    setEditingQuestion(null);
    setSuccessMessage(t("quizQuestionUpdated"));
  };

  const handleDeleteQuestion = async (question: QuizQuestion) => {
    const confirmed = await confirm({
      title: t("quizDeleteQuestionTitle", { position: question.position }),
      message: t("quizDeleteQuestionMessage"),
      yesText: t("adminDelete"),
      noText: t("adminCancel"),
    });
    if (!confirmed) return;

    await fetchFn<{ success: boolean; deleted?: boolean }>({
      route: `api/quizzes/question/${question.id}`,
      options: {
        method: "DELETE",
        headers: requestHeaders,
      },
    });

    await refetchQuestions();
    setSuccessMessage(t("quizQuestionDeleted"));
  };

  const getQuestionDraftValues = (question: QuizQuestion): QuestionDraftValues => ({
    question_text: question.question_text,
    question_type: question.question_type,
    video_id: question.video_id ?? null,
    playlist_id: question.playlist_id ?? null,
    explanation: question.explanation,
    points: question.points,
    position: question.position,
    options: question.options
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((option) => ({
        option_text: option.option_text,
        is_correct: option.is_correct,
      })),
    pairs: question.pairs
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((pair) => ({
        left_text: pair.left_text,
        right_text: pair.right_text,
      })),
  });

  const buildQuestionPayload = (
    question: QuizQuestion,
    nextPositionValue: number
  ): CreateQuizQuestionPayload => ({
    question_text: question.question_text,
    question_type: question.question_type,
    video_id: question.video_id ?? null,
    playlist_id: question.playlist_id ?? null,
    explanation: question.explanation,
    points: question.points,
    position: nextPositionValue,
    is_active: question.is_active,
    options: question.options
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((option) => ({
        option_text: option.option_text,
        is_correct: option.is_correct,
      })),
    pairs: question.pairs
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((pair) => ({
        left_text: pair.left_text,
        right_text: pair.right_text,
      })),
  });

  const handleReorderQuestions = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId || isReordering) return;

    const sourceIndex = orderedQuestions.findIndex((question) => question.id === sourceId);
    const targetIndex = orderedQuestions.findIndex((question) => question.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextOrderedQuestions = orderedQuestions.slice();
    const [movedQuestion] = nextOrderedQuestions.splice(sourceIndex, 1);
    nextOrderedQuestions.splice(targetIndex, 0, movedQuestion);

    const normalizedQuestions = nextOrderedQuestions.map((question, index) => ({
      ...question,
      position: index + 1,
    }));

    const changedQuestions = normalizedQuestions.filter((question, index) => {
      const previousQuestion = orderedQuestions.find((item) => item.id === question.id);
      return previousQuestion && previousQuestion.position !== index + 1;
    });

    if (!changedQuestions.length) {
      setDraggedQuestionId(null);
      return;
    }

    setOrderedQuestions(normalizedQuestions);
    setDraggedQuestionId(null);
    setIsReordering(true);
    setSuccessMessage(null);
    setReorderError(null);

    try {
      const results = await Promise.allSettled(
        changedQuestions.map((question) =>
          fetchFn<{ success: boolean }>({
            route: `api/quizzes/question/${question.id}`,
            options: {
              method: "PATCH",
              headers: requestHeaders,
              body: JSON.stringify(buildQuestionPayload(question, question.position)),
            },
          })
        )
      );

      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;

      await refetchQuestions();
      setSuccessMessage(t("quizQuestionOrderUpdated"));
    } catch (err) {
      await refetchQuestions();
      setSuccessMessage(null);
      setReorderError(err instanceof Error ? err.message : t("errorUnexpected"));
    } finally {
      setIsReordering(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={modalLabel}
        onMouseDown={() => {
          if (!isCreateQuestionOpen && !editingQuestion) onClose();
        }}
      >
        <div
          className={`absolute inset-0 bg-(--backgroundC2) transition-opacity duration-200 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`relative flex max-h-[min(720px,calc(100vh-32px))] w-[min(760px,94vw)] flex-col overflow-hidden rounded-3xl border border-(--border1) bg-(--background1) p-6 shadow-2xl shadow-(color:--seethroughtBlack) transition-all duration-200 ease-out ${
            visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">{t("quizEditQuestions")}</h3>
              <p className="mt-2 text-sm opacity-80">
                {t("quizQuestionsDescription", { title: quizTitle || t("quizThisQuiz") })}
              </p>
            </div>
            <button
              type="button"
              className="flex cursor-pointer items-center gap-3 rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 text-sm font-medium transition-colors hover:bg-(--background3) disabled:cursor-not-allowed"
              title={t("quizAddQuestion")}
              aria-label={t("quizAddQuestion")}
              onClick={() => {
                setSuccessMessage(null);
                setIsCreateQuestionOpen(true);
              }}
              disabled={isReordering}
            >
              <span className="[&>svg_path]:stroke-(--text1)">{AddSVG}</span>
              <span>{t("quizAddQuestion")}</span>
            </button>
          </div>

          <div className="quizPopupScroll flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-4">
              <h4 className="flex items-center gap-2 text-base font-semibold">
                {t("adminTableQuestions")}
                {questionsResponse ? <span className="rounded-full bg-(--background2) px-2.5 py-0.5 text-sm tabular-nums opacity-75">{totalQuestionCount}</span> : null}
              </h4>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {isQuestionsLoading ? (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  {t("quizLoadingQuestions")}
                </div>
              ) : orderedQuestions.length ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={({ active }) => {
                    setDraggedQuestionId(String(active.id));
                    setSuccessMessage(null);
                    setReorderError(null);
                  }}
                  onDragCancel={() => setDraggedQuestionId(null)}
                  onDragEnd={({ active, over }) => {
                    setDraggedQuestionId(null);
                    if (over) void handleReorderQuestions(String(active.id), String(over.id));
                  }}
                >
                  <SortableContext items={orderedQuestions.map((question) => question.id)} strategy={verticalListSortingStrategy}>
                    {orderedQuestions.map((question, index) => (
                      <SortableQuizQuestion
                        key={question.id}
                        question={question}
                        position={index + 1}
                        disabled={isReordering}
                        onEdit={() => {
                          setSuccessMessage(null);
                          setEditingQuestion(question);
                        }}
                        onDelete={() => void handleDeleteQuestion(question)}
                      />
                    ))}
                  </SortableContext>
                  {createPortal(
                    <DragOverlay zIndex={90}>
                      {draggedQuestion ? (
                        <div aria-hidden="true" className="cursor-grabbing rounded-3xl shadow-2xl shadow-(color:--seethroughtBlack) ring-2 ring-(--accentBlue)">
                          <QuizQuestionCard
                            question={draggedQuestion}
                            position={orderedQuestions.findIndex((question) => question.id === draggedQuestion.id) + 1}
                            disabled
                            onEdit={() => {}}
                            onDelete={() => {}}
                          />
                        </div>
                      ) : null}
                    </DragOverlay>,
                    document.body
                  )}
                </DndContext>
              ) : (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  {t("quizNoQuestionsYet")}
                </div>
              )}

              <div ref={loadMoreRef} className="h-px" aria-hidden="true" />

              {isFetchingNextPage ? (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-4 text-sm opacity-75">
                  {t("quizLoadingMoreQuestions")}
                </div>
              ) : null}

            </div>

            {reorderError ? <p role="alert" className="mt-4 text-sm text-(--accentRed)">{reorderError}</p> : null}
            {successMessage ? <p role="status" className="mt-4 text-sm text-(--accentGreen2)">{successMessage}</p> : null}
          </div>

          <div className="quizPopupActions mt-4">
            <button
              type="button"
              className="cancelBtn cursor-pointer min-w-[140px]"
              onClick={onClose}
            >
              {t("adminCancel")}
            </button>
          </div>
        </div>
      </div>

      {shouldRenderCreateQuestionPopup ? (
        <CreateQuizQuestionPopup
          key="create-quiz-question"
          open={isCreateQuestionOpen}
          nextPosition={nextQuestionPosition}
          requestHeaders={requestHeaders}
          onClose={() => setIsCreateQuestionOpen(false)}
          onSubmit={handleCreateQuestion}
        />
      ) : null}
      {closingEditingQuestion ? (
        <CreateQuizQuestionPopup
          key={`edit-quiz-question-${closingEditingQuestion.id}`}
          open={!!editingQuestion}
          mode="edit"
          initialValues={getQuestionDraftValues(closingEditingQuestion)}
          nextPosition={closingEditingQuestion.position}
          requestHeaders={requestHeaders}
          onClose={() => setEditingQuestion(null)}
          onSubmit={handleUpdateQuestion}
        />
      ) : null}
      <ConfirmDialog {...dialogProps} />
    </>,
    document.body
  );
}

export default EditQuizQuestionsPopup;
