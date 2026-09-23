import { useI18n } from "~/i18n";

export default function CommentsLoading() {
  const { t } = useI18n();
  return <div role="status" aria-label={t("loadingComments")} className="w-full py-3">
    <div aria-hidden="true" className="flex items-start gap-3 motion-safe:animate-pulse">
      <span className="size-9 shrink-0 rounded-full bg-(--background3)" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 py-1">
        <span className="h-3 w-1/3 rounded-full bg-(--background3)" />
        <span className="h-3 w-5/6 rounded-full bg-(--background3)" />
        <span className="h-3 w-2/3 rounded-full bg-(--background3)" />
      </div>
    </div>
  </div>;
}
