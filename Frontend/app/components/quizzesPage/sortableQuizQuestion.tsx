import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "~/i18n";
import type { QuizQuestion } from "./quizTypes";

type Props = {
  question: QuizQuestion;
  position: number;
  disabled?: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

function Grip() {
  return (
    <span aria-hidden="true" className="inline-flex flex-col gap-1">
      <span className="block h-[2px] w-4 rounded-full bg-current" />
      <span className="block h-[2px] w-4 rounded-full bg-current" />
      <span className="block h-[2px] w-4 rounded-full bg-current" />
    </span>
  );
}

export function QuizQuestionCard({
  question,
  position,
  disabled,
  onEdit,
  onDelete,
  handle,
}: Props & { handle?: ReactNode }) {
  const { t } = useI18n();
  const typeLabel = {
    single_choice: t("quizSingleChoice"),
    multiple_choice: t("quizMultipleChoice"),
    matching: t("quizMatching"),
  }[question.question_type] ?? question.question_type;

  return (
    <div className="rounded-3xl border border-(--border1) bg-(--background2) px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 text-sm opacity-75">
        <span>#{position}</span>
        <span>•</span>
        <span>{typeLabel}</span>
        <span>•</span>
        <span>{t("quizPointsShort", { count: question.points })}</span>
        <span>•</span>
        <span>{question.video_id ? t("quizVideoAttached") : t("quizNoVideo")}</span>
        <span>•</span>
        <span>{question.playlist_id ? t("quizPlaylistAttached") : t("quizNoPlaylist")}</span>
        <span>•</span>
        <span>{t("quizDragToReorder")}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="min-w-0 break-words font-medium">{question.question_text}</p>
        <div className="flex shrink-0 items-center gap-2">
          {handle ?? <span className="inline-flex h-9 w-9 items-center justify-center"><Grip /></span>}
          <button
            type="button"
            className="cursor-pointer rounded-full border border-(--border1) bg-(--background1) px-3 py-1.5 text-sm transition-colors hover:bg-(--background3) disabled:cursor-not-allowed"
            onClick={onEdit}
            disabled={disabled}
          >
            {t("adminEdit")}
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-full border border-(--accentRed) bg-(--background15) px-3 py-1.5 text-sm text-(--accentRed3) transition-colors disabled:cursor-not-allowed"
            onClick={onDelete}
            disabled={disabled}
          >
            {t("adminDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SortableQuizQuestion(props: Props) {
  const { t } = useI18n();
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: props.question.id, disabled: props.disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative rounded-3xl motion-reduce:transition-none ${
        isDragging ? "outline-2 outline-dashed outline-(--accentBlue) bg-(--background3)" : ""
      } ${props.disabled ? "opacity-70" : ""}`}
    >
      <div className={isDragging ? "opacity-0" : ""}>
        <QuizQuestionCard
          {...props}
          handle={
            <button
              ref={setActivatorNodeRef}
              type="button"
              {...attributes}
              {...listeners}
              disabled={props.disabled}
              aria-label={t("quizDragQuestion", { position: props.position })}
              title={t("quizDragToReorder")}
              className="inline-flex h-9 w-9 touch-none cursor-grab items-center justify-center rounded-lg text-(--text2) transition-colors hover:bg-(--background3) hover:text-(--text1) focus-visible:outline-2 focus-visible:outline-(--accentBlue) active:cursor-grabbing disabled:cursor-wait"
            >
              <Grip />
            </button>
          }
        />
      </div>
    </div>
  );
}
