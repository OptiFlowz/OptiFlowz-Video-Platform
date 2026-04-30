import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AddSVG } from "~/constants";
import { fetchFn } from "~/API";
import CreateQuizRulePopup from "~/components/quizzesPage/createQuizRulePopup";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
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

const ruleTypeLabels: Record<string, string> = {
  video_watch_percentage: "Video Watch Percentage",
  video_watch_seconds: "Video Watch Seconds",
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

function getRuleTypeLabel(ruleType: QuizRuleType) {
  return ruleTypeLabels[ruleType] ?? ruleType.replaceAll("_", " ");
}

function getRuleSummary(rule: QuizRule) {
  if (rule.rule_type === "video_watch_percentage") {
    const percentage = rule.required_percentage ?? "0";
    return `Watch ${percentage}% of the selected video`;
  }

  if (rule.rule_type === "video_watch_seconds") {
    const seconds = rule.required_seconds ?? "0";
    return `Watch ${seconds} seconds of the selected video`;
  }

  return "Rule details available for supported types only.";
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
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QuizRule | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const { confirm, dialogProps } = useConfirm();

  const modalLabel = useMemo(
    () => `Edit rules for ${quizTitle || "this quiz"}`,
    [quizTitle]
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
    setSuccessMessage("Rule created successfully.");
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
    setSuccessMessage("Rule updated successfully.");
  };

  const handleDeleteRule = async (rule: QuizRule) => {
    const confirmed = await confirm({
      title: `Delete rule "${getRuleTypeLabel(rule.rule_type)}"?`,
      message: "This will permanently remove the access rule from the quiz.",
      yesText: "Delete",
      noText: "Cancel",
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
    setSuccessMessage("Rule deleted successfully.");
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
          className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${
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
            <h3 className="text-xl font-semibold">Quiz Rules</h3>
            <p className="mt-2 text-sm opacity-80">
              Add and manage access rules for <strong>{quizTitle || "this quiz"}</strong>.
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-4">
              <h4 className="text-base font-semibold">Rules</h4>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {isRulesLoading ? (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  Loading rules...
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
                          rule.is_active ? "font-medium text-green-600" : "font-medium text-red-500"
                        }
                      >
                        {rule.is_active ? "Active" : "Inactive"}
                      </span>
                      {rule.video_id ? (
                        <>
                          <span>•</span>
                          <span>{rule.video_title || "Video selected"}</span>
                        </>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        {rule.video_thumbnail ? (
                          <img
                            src={rule.video_thumbnail}
                            alt={rule.video_title || "Rule video"}
                            className="h-14 w-24 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-24 items-center justify-center rounded-xl bg-(--background1) text-xs opacity-70">
                            No thumb
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="font-medium">{getRuleSummary(rule)}</p>
                          <p className="mt-1 text-sm opacity-75">
                            {rule.video_title || rule.video_id || "No video selected"}
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
                          Edit
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-full border border-[rgba(220,38,38,0.35)] bg-[rgba(220,38,38,0.12)] px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-[rgba(220,38,38,0.18)]"
                          onClick={() => void handleDeleteRule(rule)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-(--border1) bg-(--background2) px-5 py-6 text-sm opacity-75">
                  No rules yet.
                </div>
              )}

              <button
                type="button"
                className="flex cursor-pointer items-center gap-3 self-start rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 text-sm font-medium transition-colors hover:bg-(--background3)"
                title="Add rule"
                aria-label="Add rule"
                onClick={() => {
                  setSuccessMessage(null);
                  setIsCreateRuleOpen(true);
                }}
              >
                <span className="[&>svg_path]:stroke-(--text1)">{AddSVG}</span>
                <span>Add Rule</span>
              </button>
            </div>

            {successMessage ? <p className="mt-4 text-sm text-green-600">{successMessage}</p> : null}
          </div>

          <div className="quizPopupActions mt-4">
            <button type="button" className="cancelBtn cursor-pointer" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="saveCaptionsBtn cursor-pointer" onClick={onClose}>
              Save Rules
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
