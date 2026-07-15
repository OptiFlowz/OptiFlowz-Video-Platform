import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AddSVG } from "~/constants";
import { fetchFn } from "~/API";
import CreateQuizRulePopup from "~/components/quizzesPage/createQuizRulePopup";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import { useI18n } from "~/i18n";
import type {
  CreateQuizRulePayload,
  QuizRule,
  QuizRuleApiResponse,
  QuizRuleType,
  RuleDraftValues,
} from "./quizTypes";

type Props = {
  open: boolean;
  quizId: string;
  quizTitle: string;
  requestHeaders: Headers;
  onClose: () => void;
  onSubmit: (payload: CreateQuizRulePayload) => Promise<unknown>;
};

type QuizRulesResponse = {
  success?: boolean;
  rules?: QuizRuleApiResponse[];
};

function normalizeRule(rule: QuizRuleApiResponse): QuizRule {
  return {
    id: rule.id ?? rule.rule_id ?? "",
    quiz_id: rule.quiz_id,
    rule_type: rule.rule_type,
    video_id: rule.video_id ?? null,
    playlist_id: rule.playlist_id ?? null,
    required_quiz_id: rule.required_quiz_id ?? null,
    required_percentage: rule.required_percentage ?? null,
    required_seconds: rule.required_seconds ?? null,
    is_active: Boolean(rule.is_active),
    video_title: rule.video_title ?? null,
    video_thumbnail: rule.video_thumbnail ?? null,
    playlist_title: rule.playlist_title ?? null,
    playlist_thumbnail: rule.playlist_thumbnail ?? null,
  };
}

function getRuleDraftValues(rule: QuizRule): RuleDraftValues {
  return {
    rule_type: rule.rule_type,
    video_id: rule.video_id ?? null,
    is_active: rule.is_active,
    required_percentage:
      rule.required_percentage == null ? "" : String(rule.required_percentage),
    required_seconds: rule.required_seconds == null ? "" : String(rule.required_seconds),
  };
}

function EditQuizRulesPopup({
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
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QuizRule | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const { confirm, dialogProps } = useConfirm();

  const getRuleTypeLabel = (ruleType: QuizRuleType) => {
    if (ruleType === "video_watch_percentage") return t("quizVideoWatchPercentage");
    if (ruleType === "video_watch_seconds") return t("quizVideoWatchSeconds");
    return ruleType.replaceAll("_", " ");
  };

  const getRuleSummary = (rule: QuizRule) => {
    const video = rule.video_title || rule.video_id || t("quizSelectedVideo");
    if (rule.rule_type === "video_watch_percentage") {
      return t("quizWatchPercentageSummary", {
        percentage: rule.required_percentage ?? "0",
        video,
      });
    }
    if (rule.rule_type === "video_watch_seconds") {
      return t("quizWatchSecondsSummary", {
        seconds: rule.required_seconds ?? "0",
        video,
      });
    }
    return t("quizRuleSummaryUnavailable");
  };

  const modalLabel = useMemo(
    () => t("quizRulesDescription", { title: quizTitle || t("quizThisQuiz") }),
    [quizTitle, t]
  );

  const {
    data: rulesResponse,
    isLoading: isRulesLoading,
    refetch: refetchRules,
  } = useQuery({
    queryKey: ["quiz-rules", quizId],
    queryFn: () =>
      fetchFn<QuizRulesResponse>({
        route: `api/quizzes/${quizId}/rules`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: open && !!quizId,
    refetchOnWindowFocus: false,
  });

  const rules = useMemo(
    () => (rulesResponse?.rules ?? []).map(normalizeRule).filter((rule) => rule.id),
    [rulesResponse?.rules]
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
      setIsCreateRuleOpen(false);
      setEditingRule(null);
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
      if (event.key === "Escape" && !isCreateRuleOpen && !editingRule) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingRule, isCreateRuleOpen, onClose, open]);

  const handleCreateRule = async (payload: CreateQuizRulePayload) => {
    await onSubmit(payload);
    await refetchRules();
    setSuccessMessage(t("quizRuleCreated"));
  };

  const handleUpdateRule = async (payload: CreateQuizRulePayload) => {
    if (!editingRule?.id) return;

    await fetchFn<{ success: boolean }>({
      route: `api/quizzes/rule/${editingRule.id}`,
      options: {
        method: "PATCH",
        headers: requestHeaders,
        body: JSON.stringify(payload),
      },
    });

    await refetchRules();
    setEditingRule(null);
    setSuccessMessage(t("quizRuleUpdated"));
  };

  const handleDeleteRule = async (rule: QuizRule) => {
    const confirmed = await confirm({
      title: t("quizDeleteRuleTitle", { type: getRuleTypeLabel(rule.rule_type) }),
      message: t("quizDeleteRuleMessage"),
      yesText: t("adminDelete"),
      noText: t("adminCancel"),
    });
    if (!confirmed) return;

    await fetchFn<{ success: boolean; message?: string }>({
      route: `api/quizzes/rule/${rule.id}`,
      options: {
        method: "DELETE",
        headers: requestHeaders,
      },
    });

    await refetchRules();
    setSuccessMessage(t("quizRuleDeleted"));
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
          if (!isCreateRuleOpen && !editingRule) onClose();
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
            <h3 className="text-xl font-semibold">{t("quizRulesTitle")}</h3>
            <p className="mt-2 text-sm opacity-80">
              {t("quizRulesDescription", { title: quizTitle || t("quizThisQuiz") })}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-4">
              <h4 className="text-base font-semibold">{t("quizRulesButton")}</h4>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {isRulesLoading ? (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  {t("quizLoadingRules")}
                </div>
              ) : rules.length ? (
                rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-3xl border border-(--border1) bg-(--background2) px-5 py-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm opacity-75">
                      <span>{getRuleTypeLabel(rule.rule_type)}</span>
                      <span>•</span>
                      <span
                        className={
                          rule.is_active ? "font-medium text-(--accentGreen2)" : "font-medium text-(--accentRed)"
                        }
                      >
                        {rule.is_active ? t("adminActive") : t("adminInactive")}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        {rule.video_thumbnail ? (
                          <img
                            src={rule.video_thumbnail}
                            alt={rule.video_title || t("quizRuleVideo")}
                            className="h-14 w-24 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-24 items-center justify-center rounded-xl bg-(--background1) text-xs opacity-70">
                            {t("quizNoThumbnail")}
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="font-medium">{getRuleSummary(rule)}</p>
                          <p className="mt-1 text-sm opacity-75">
                            {rule.video_title || rule.video_id || t("quizNoVideoSelected")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="cursor-pointer rounded-full border border-(--border1) bg-(--background1) px-3 py-1.5 text-sm transition-colors hover:bg-(--background3)"
                          onClick={() => {
                            setSuccessMessage(null);
                            setEditingRule(rule);
                          }}
                        >
                          {t("adminEdit")}
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-full border border-(--accentRed) bg-(--background15) px-3 py-1.5 text-sm text-red-400 transition-colors"
                          onClick={() => void handleDeleteRule(rule)}
                        >
                          {t("adminDelete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  {t("quizNoRulesYet")}
                </div>
              )}

              <button
                type="button"
                className="flex cursor-pointer items-center gap-3 self-start rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 text-sm font-medium transition-colors hover:bg-(--background3)"
                title={t("quizAddRule")}
                aria-label={t("quizAddRule")}
                onClick={() => {
                  setSuccessMessage(null);
                  setIsCreateRuleOpen(true);
                }}
              >
                <span className="[&>svg_path]:stroke-(--text1)">{AddSVG}</span>
                <span>{t("quizAddRule")}</span>
              </button>
            </div>

            {successMessage ? <p className="mt-4 text-sm text-(--accentGreen2)">{successMessage}</p> : null}
          </div>

          <div className="quizPopupActions mt-4">
            <button type="button" className="cancelBtn cursor-pointer min-w-[140px]" onClick={onClose}>
              {t("close")}
            </button>
          </div>
        </div>
      </div>

      <CreateQuizRulePopup
        open={isCreateRuleOpen}
        requestHeaders={requestHeaders}
        onClose={() => setIsCreateRuleOpen(false)}
        onSubmit={handleCreateRule}
      />
      <CreateQuizRulePopup
        open={!!editingRule}
        mode="edit"
        initialValues={editingRule ? getRuleDraftValues(editingRule) : null}
        requestHeaders={requestHeaders}
        onClose={() => setEditingRule(null)}
        onSubmit={handleUpdateRule}
      />
      <ConfirmDialog {...dialogProps} />
    </>,
    document.body
  );
}

export default EditQuizRulesPopup;
