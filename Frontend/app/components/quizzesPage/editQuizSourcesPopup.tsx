import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AddSVG } from "~/constants";
import { fetchFn } from "~/API";
import CreateQuizSourcePopup from "~/components/quizzesPage/createQuizSourcePopup";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import { useI18n } from "~/i18n";
import type {
  CreateQuizSourcePayload,
  QuizQuestionSource,
  QuizQuestionSourceApiResponse,
  SourceDraftValues,
} from "./quizTypes";

type Props = {
  open: boolean;
  quizId: string;
  quizTitle: string;
  requestHeaders: Headers;
  onClose: () => void;
  onSubmit: (payload: CreateQuizSourcePayload) => Promise<unknown>;
};

type QuizSourcesResponse = {
  success?: boolean;
  sources?: QuizQuestionSourceApiResponse[];
};

function normalizeSource(source: QuizQuestionSourceApiResponse): QuizQuestionSource {
  return {
    id: source.id ?? source.source_id ?? "",
    quiz_id: source.quiz_id,
    source_type: source.source_type,
    playlist_id: source.playlist_id ?? null,
    playlist_title: source.playlist_title ?? null,
    playlist_thumbnail: source.playlist_thumbnail ?? null,
    video_id: source.video_id ?? null,
    video_title: source.video_title ?? null,
    video_thumbnail: source.video_thumbnail ?? null,
    percentage: source.percentage ?? null,
    question_count: source.question_count ?? null,
    fixed_question_count: source.fixed_question_count ?? null,
    include_general_questions: Boolean(source.include_general_questions),
  };
}

function getSourceTitle(source: QuizQuestionSource) {
  if (source.source_type === "playlist") {
    return source.playlist_title || source.playlist_id || "Selected playlist";
  }

  return source.video_title || source.video_id || "Selected video";
}

function getSourceThumbnail(source: QuizQuestionSource) {
  return source.source_type === "playlist"
    ? source.playlist_thumbnail
    : source.video_thumbnail;
}

function getSourceTypeLabel(source: QuizQuestionSource) {
  return source.source_type === "playlist" ? "Playlist" : "Video";
}

function getSourceDraftValues(source: QuizQuestionSource): SourceDraftValues {
  return {
    source_type: source.source_type,
    playlist_id: source.playlist_id,
    video_id: source.video_id,
    percentage: source.percentage == null ? "80" : String(source.percentage),
    include_general_questions: source.include_general_questions,
    fixed_question_count:
      source.fixed_question_count == null ? "" : String(source.fixed_question_count),
  };
}

function EditQuizSourcesPopup({
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
  const [isCreateSourceOpen, setIsCreateSourceOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<QuizQuestionSource | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const { confirm, dialogProps } = useConfirm();

  const modalLabel = useMemo(
    () => `Edit sources for ${quizTitle || "this quiz"}`,
    [quizTitle]
  );

  const {
    data: sourcesResponse,
    isLoading: isSourcesLoading,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ["quiz-question-sources", quizId],
    queryFn: () =>
      fetchFn<QuizSourcesResponse>({
        route: `api/quizzes/${quizId}/question-sources`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && !!quizId,
    refetchOnWindowFocus: false,
  });

  const sources = useMemo(
    () => (sourcesResponse?.sources ?? []).map(normalizeSource).filter((source) => source.id),
    [sourcesResponse?.sources]
  );

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
      setIsCreateSourceOpen(false);
      setEditingSource(null);
      setSuccessMessage(null);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCreateSourceOpen && !editingSource) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingSource, isCreateSourceOpen, onClose, open]);

  const handleCreateSource = async (payload: CreateQuizSourcePayload) => {
    await onSubmit(payload);
    await refetchSources();
    setSuccessMessage("Source created successfully.");
  };

  const handleUpdateSource = async (payload: CreateQuizSourcePayload) => {
    if (!editingSource?.id) return;

    await fetchFn<{ success: boolean; source?: QuizQuestionSourceApiResponse }>({
      route: `api/quizzes/question-source/${editingSource.id}`,
      options: {
        method: "PATCH",
        headers: requestHeaders,
        body: JSON.stringify(payload),
      },
    });

    await refetchSources();
    setEditingSource(null);
    setSuccessMessage("Source updated successfully.");
  };

  const handleDeleteSource = async (source: QuizQuestionSource) => {
    const confirmed = await confirm({
      title: t("quizDeleteSourceTitle", { title: getSourceTitle(source) }),
      message: t("quizDeleteSourceMessage"),
      yesText: t("adminDelete"),
      noText: t("adminCancel"),
    });
    if (!confirmed) return;

    await fetchFn<{ success: boolean; deleted?: boolean }>({
      route: `api/quizzes/question-source/${source.id}`,
      options: {
        method: "DELETE",
        headers: requestHeaders,
      },
    });

    await refetchSources();
    setSuccessMessage("Source deleted successfully.");
  };

  const renderThumbnail = (source: QuizQuestionSource) => {
    const thumbnail = getSourceThumbnail(source);
    if (!thumbnail) {
      return (
        <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-xl bg-(--background1) text-xs opacity-70">
          No thumb
        </div>
      );
    }

    return (
      <img
        src={thumbnail}
        alt={getSourceTitle(source)}
        className="h-14 w-24 shrink-0 rounded-xl object-cover"
      />
    );
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
          if (!isCreateSourceOpen && !editingSource) onClose();
        }}
      >
        <div
          className={`absolute inset-0 bg-(--backgroundC2) transition-opacity duration-200 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`relative flex max-h-[min(720px,calc(100vh-32px))] w-[min(760px,94vw)] flex-col overflow-hidden rounded-3xl border border-(--border1) bg-(--background1) p-6 shadow-2xl transition-all duration-200 ease-out ${
            visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-5">
            <h3 className="text-xl font-semibold">{t("quizQuestionSources")}</h3>
            <p className="mt-2 text-sm opacity-80">
              Add and manage source material for <strong>{quizTitle || "this quiz"}</strong>.
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-4">
              <h4 className="text-base font-semibold">Sources</h4>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {isSourcesLoading ? (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  Loading sources...
                </div>
              ) : sources.length ? (
                sources.map((source) => (
                  <div
                    key={source.id}
                    className="rounded-3xl border border-(--border1) bg-(--background2) px-5 py-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm opacity-75">
                      <span>
                        {source.source_type === "playlist"
                          ? t("adminTablePlaylist")
                          : t("adminTableVideo")}
                      </span>
                      <span>•</span>
                      <span>{source.percentage ?? 0}%</span>
                      {source.fixed_question_count ? (
                        <>
                          <span>•</span>
                          <span>{source.fixed_question_count} fixed questions</span>
                        </>
                      ) : null}
                      {source.question_count ? (
                        <>
                          <span>•</span>
                          <span>{source.question_count} questions</span>
                        </>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        {renderThumbnail(source)}

                        <div className="min-w-0">
                          <p className="font-medium">{getSourceTitle(source)}</p>
                          <p className="mt-1 text-sm opacity-75">
                            {source.include_general_questions
                              ? "Includes general questions"
                              : "Specific questions only"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="cursor-pointer rounded-full border border-(--border1) bg-(--background1) px-3 py-1.5 text-sm transition-colors hover:bg-(--background3)"
                          onClick={() => {
                            setSuccessMessage(null);
                            setEditingSource(source);
                          }}
                        >
                          {t("adminEdit")}
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-full border border-(--accentRed) bg-(--background15) px-3 py-1.5 text-sm text-(--accentRed2) transition-colors"
                          onClick={() => void handleDeleteSource(source)}
                        >
                          {t("adminDelete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  No sources yet.
                </div>
              )}

              <button
                type="button"
                className="flex cursor-pointer items-center gap-3 self-start rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 text-sm font-medium transition-colors hover:bg-(--background3)"
                title="Add source"
                aria-label="Add source"
                onClick={() => {
                  setSuccessMessage(null);
                  setIsCreateSourceOpen(true);
                }}
              >
                <span className="[&>svg_path]:stroke-(--text1)">{AddSVG}</span>
                <span>{t("quizAddSource")}</span>
              </button>
            </div>

            {successMessage ? <p className="mt-4 text-sm text-(--accentGreen2)">{successMessage}</p> : null}
          </div>

          <div className="quizPopupActions mt-4">
            <button type="button" className="cancelBtn cursor-pointer min-w-[140px]" onClick={onClose}>
              {t("adminCancel")}
            </button>
          </div>
        </div>
      </div>

      <CreateQuizSourcePopup
        open={isCreateSourceOpen}
        requestHeaders={requestHeaders}
        onClose={() => setIsCreateSourceOpen(false)}
        onSubmit={handleCreateSource}
      />
      <CreateQuizSourcePopup
        open={!!editingSource}
        mode="edit"
        initialValues={editingSource ? getSourceDraftValues(editingSource) : null}
        requestHeaders={requestHeaders}
        onClose={() => setEditingSource(null)}
        onSubmit={handleUpdateSource}
      />
      <ConfirmDialog {...dialogProps} />
    </>,
    document.body
  );
}

export default EditQuizSourcesPopup;
