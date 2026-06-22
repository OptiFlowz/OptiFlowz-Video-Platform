import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "~/i18n";
import type { AnswerReviewMode, CreateQuizPayload, ScoringMode } from "./quizTypes";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  videoTitle: string;
  initialValues?: CreateQuizPayload | null;
  onClose: () => void;
  onSubmit: (payload: CreateQuizPayload) => Promise<void>;
  onOpenQuestions?: () => void;
  onOpenRules?: () => void;
  onOpenSources?: () => void;
};

const DEFAULT_DESCRIPTION = "Test your knowledge after watching the video";

const normalizeAnswerReviewMode = (value?: string | null): AnswerReviewMode =>
  value === "at_end" || value === "assignment" ? value : "immediate";

const normalizeScoringMode = (value?: string | null): ScoringMode =>
  value === "partial" ? "partial" : "strict";

function CreateQuizPopup({
  open,
  mode,
  videoTitle,
  initialValues,
  onClose,
  onSubmit,
  onOpenQuestions,
  onOpenRules,
  onOpenSources,
}: Props) {
  const { t } = useI18n();
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [quizTitle, setQuizTitle] = useState("");
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [isActive, setIsActive] = useState(true);
  const [hasCertificate, setHasCertificate] = useState(false);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState("900");
  const [questionCount, setQuestionCount] = useState("10");
  const [maxAttempts, setMaxAttempts] = useState("3");
  const [passingScorePercentage, setPassingScorePercentage] = useState("50");
  const [scoring, setScoring] = useState<ScoringMode>("strict");
  const [answerReviewMode, setAnswerReviewMode] = useState<AnswerReviewMode>("immediate");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const isEditMode = mode === "edit";

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      setQuizTitle(
        initialValues?.title ?? (videoTitle?.trim() ? `${videoTitle.trim()} Quiz` : "")
      );
      setDescription(initialValues?.description ?? DEFAULT_DESCRIPTION);
      setIsActive(initialValues?.is_active ?? true);
      setHasCertificate(initialValues?.has_certificate ?? false);
      setTimeLimitSeconds(String(initialValues?.time_limit_seconds ?? 900));
      setQuestionCount(String(initialValues?.question_count ?? 10));
      setMaxAttempts(initialValues ? String(initialValues.max_attempts ?? 0) : "3");
      setPassingScorePercentage(String(initialValues?.passing_score_percentage ?? 50));
      setScoring(normalizeScoringMode(initialValues?.scoring));
      setAnswerReviewMode(normalizeAnswerReviewMode(initialValues?.answer_review_mode));
      setShuffleQuestions(initialValues?.shuffle_questions ?? true);
      setShuffleOptions(initialValues?.shuffle_options ?? true);
      setError(null);
      setIsSubmitting(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          titleInputRef.current?.focus();
          titleInputRef.current?.select();
        });
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [initialValues, open, videoTitle]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onClose, open]);

  const parsePositiveInteger = (
    value: string,
    label: string,
    options?: { min?: number; max?: number }
  ) => {
    const parsed = Number.parseInt(value, 10);
    const min = options?.min ?? 1;
    const max = options?.max;

    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new Error(t("quizFieldRequired", { label }));
    }

    if (parsed < min) {
      throw new Error(t("quizFieldMin", { label, min }));
    }

    if (typeof max === "number" && parsed > max) {
      throw new Error(t("quizFieldMax", { label, max }));
    }

    return parsed;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      const normalizedTitle = quizTitle.trim();
      const normalizedDescription = description.trim();

      if (!normalizedTitle) {
        throw new Error(t("quizTitleRequired"));
      }

      const payload: CreateQuizPayload = {
        title: normalizedTitle,
        description: normalizedDescription,
        is_active: isActive,
        has_certificate: hasCertificate,
        time_limit_seconds: parsePositiveInteger(timeLimitSeconds, "Time limit", {
          min: 0,
        }),
        question_count: parsePositiveInteger(questionCount, "Question count"),
        max_attempts: (() => {
          const parsedMaxAttempts = parsePositiveInteger(maxAttempts, "Max attempts", {
            min: 0,
          });

          return parsedMaxAttempts === 0 ? null : parsedMaxAttempts;
        })(),
        passing_score_percentage: parsePositiveInteger(
          passingScorePercentage,
          "Passing score percentage",
          { min: 0, max: 100 }
        ),
        scoring,
        answer_review_mode: answerReviewMode,
        shuffle_questions: shuffleQuestions,
        shuffle_options: shuffleOptions,
      };

      setError(null);
      setIsSubmitting(true);
      await onSubmit(payload);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("quizCreateFailed");
      setError(message);
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={isEditMode ? t("quizEditTitle") : t("quizCreateTitle")}
      onMouseDown={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`relative flex max-h-[min(720px,calc(100vh-32px))] w-[min(560px,92vw)] flex-col overflow-hidden rounded-3xl border border-(--border1) bg-(--background1) p-6 shadow-2xl transition-all duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="quizPopupHeader">
          <div>
            <h3 className="text-xl font-semibold">
              {isEditMode ? t("quizEditTitle") : t("quizCreateTitle")}
            </h3>
            <p className="mt-2 text-sm opacity-80">
              {isEditMode
                ? t("quizEditDescription")
                : t("quizCreateDescription")}
            </p>
          </div>
        </div>

        <form className="quizPopupForm" onSubmit={handleSubmit}>
          <div className="quizPopupBody">
            <div className="formGroup">
              <label htmlFor="quizTitle">{t("title")}</label>
              <input
                ref={titleInputRef}
                id="quizTitle"
                type="text"
                value={quizTitle}
                onChange={(event) => setQuizTitle(event.target.value)}
                placeholder={t("quizTitlePlaceholder")}
                maxLength={120}
                disabled={isSubmitting}
                className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
              />
            </div>

            <div className="formGroup">
              <label htmlFor="quizDescription">{t("description")}</label>
              <textarea
                id="quizDescription"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("quizDescriptionPlaceholder")}
                rows={4}
                maxLength={500}
                disabled={isSubmitting}
                className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
              />
            </div>

            <div className="quizPopupGrid">
              <div className="formGroup">
                <label htmlFor="quizTimeLimit">{t("quizTimeLimitSeconds")}</label>
                <input
                  id="quizTimeLimit"
                  type="number"
                  min={0}
                  step={1}
                  value={timeLimitSeconds}
                  onChange={(event) => setTimeLimitSeconds(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
                <p className="quizPopupHint">{t("quizNoTimeLimitHint")}</p>
              </div>

              <div className="formGroup">
                <label htmlFor="quizQuestionCount">{t("quizQuestionCount")}</label>
                <input
                  id="quizQuestionCount"
                  type="number"
                  min={1}
                  step={1}
                  value={questionCount}
                  onChange={(event) => setQuestionCount(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
                <p className="quizPopupHint">{t("quizUnlimitedAttemptsHint")}</p>
              </div>

              <div className="formGroup">
                <label htmlFor="quizMaxAttempts">{t("quizMaxAttempts")}</label>
                <input
                  id="quizMaxAttempts"
                  type="number"
                  min={0}
                  step={1}
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
              </div>

              <div className="formGroup">
                <label htmlFor="quizPassingScore">{t("quizPassingScore")}</label>
                <input
                  id="quizPassingScore"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={passingScorePercentage}
                  onChange={(event) => setPassingScorePercentage(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                />
              </div>

              <div className="formGroup">
                <label htmlFor="quizAnswerReviewMode">{t("quizAnswerReviewMode")}</label>
                <select
                  id="quizAnswerReviewMode"
                  value={answerReviewMode}
                  onChange={(event) =>
                    setAnswerReviewMode(normalizeAnswerReviewMode(event.target.value))
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                >
                  <option value="immediate">{t("quizReviewImmediate")}</option>
                  <option value="at_end">{t("quizReviewAtEnd")}</option>
                  <option value="assignment">{t("quizReviewAssignment")}</option>
                </select>
              </div>

              <div className="formGroup">
                <label htmlFor="quizScoring">{t("quizScoring")}</label>
                <select
                  id="quizScoring"
                  value={scoring}
                  onChange={(event) => setScoring(normalizeScoringMode(event.target.value))}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                >
                  <option value="strict">{t("quizScoringStrict")}</option>
                  <option value="partial">{t("quizScoringPartial")}</option>
                </select>
              </div>
            </div>

            <div className="quizPopupToggleList">
              <label className="quizPopupToggleRow" htmlFor="quizIsActive">
                <div>
                  <strong>{t("quizIsActive")}</strong>
                  <span>{t("quizIsActiveHelp")}</span>
                </div>
                <input
                  id="quizIsActive"
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  disabled={isSubmitting}
                  className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                />
              </label>

              <label className="quizPopupToggleRow" htmlFor="quizHasCertificate">
                <div>
                  <strong>{t("quizHasCertificate")}</strong>
                  <span>{t("quizHasCertificateHelp")}</span>
                </div>
                <input
                  id="quizHasCertificate"
                  type="checkbox"
                  checked={hasCertificate}
                  onChange={(event) => setHasCertificate(event.target.checked)}
                  disabled={isSubmitting}
                  className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                />
              </label>

              <label className="quizPopupToggleRow" htmlFor="quizShuffleQuestions">
                <div>
                  <strong>{t("quizShuffleQuestions")}</strong>
                  <span>{t("quizShuffleQuestionsHelp")}</span>
                </div>
                <input
                  id="quizShuffleQuestions"
                  type="checkbox"
                  checked={shuffleQuestions}
                  onChange={(event) => setShuffleQuestions(event.target.checked)}
                  disabled={isSubmitting}
                  className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                />
              </label>

              <label className="quizPopupToggleRow" htmlFor="quizShuffleOptions">
                <div>
                  <strong>{t("quizShuffleOptions")}</strong>
                  <span>{t("quizShuffleOptionsHelp")}</span>
                </div>
                <input
                  id="quizShuffleOptions"
                  type="checkbox"
                  checked={shuffleOptions}
                  onChange={(event) => setShuffleOptions(event.target.checked)}
                  disabled={isSubmitting}
                  className="quizPopupCheckbox appearance-none rounded-[6px]! p-2.25! border-2 cursor-pointer checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                />
              </label>
            </div>

            {error ? <p className="quizPopupError">{error}</p> : null}
          </div>

          {isEditMode ? (
            <div className="quizPopupManageActions">
              <button
                type="button"
                className="saveCaptionsBtn"
                onClick={onOpenQuestions}
                disabled={isSubmitting}
              >
                {t("quizQuestionsButton")}
              </button>
              <button
                type="button"
                className="saveCaptionsBtn"
                onClick={onOpenRules}
                disabled={isSubmitting}
              >
                {t("quizRulesButton")}
              </button>
              <button
                type="button"
                className="saveCaptionsBtn"
                onClick={onOpenSources}
                disabled={isSubmitting}
              >
                {t("quizSourcesButton")}
              </button>
            </div>
          ) : null}

          <div className="quizPopupActions">
            <button
              type="button"
              className="cancelBtn cursor-pointer disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t("adminCancel")}
            </button>
            <button
              type="submit"
              className="saveCaptionsBtn cursor-pointer disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <div className="uploadSpinner tiny" />
                  {isEditMode ? t("saving") : t("creating")}
                </>
              ) : (
                isEditMode ? t("quizSaveQuiz") : t("quizCreateQuiz")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreateQuizPopup;
