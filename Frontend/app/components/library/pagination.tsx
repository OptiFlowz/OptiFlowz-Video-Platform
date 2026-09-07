import { useI18n } from "~/i18n";
import CustomSelect from "~/components/customSelect/customSelect";
import { getPaginationItems } from "./paginationItems";
import styles from "./pagination.module.css";

type Props = {
  page: number;
  limit: number;
  total?: number;
  totalPages?: number;
  loading?: boolean;
  disabled?: boolean;
  pageSizes?: number[];
  label: string;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
};

export default function Pagination({
  page, limit, total, totalPages, loading = false, disabled = false,
  pageSizes = [10, 20, 50], label, onPageChange, onLimitChange,
}: Props) {
  const { t } = useI18n();
  const pages = Math.max(1, totalPages ?? Math.ceil((total ?? 0) / limit));
  const currentPage = Math.min(Math.max(1, page), pages);
  const unavailable = disabled || loading || total === undefined;
  const start = total ? Math.min((currentPage - 1) * limit + 1, total) : 0;
  const end = Math.min(currentPage * limit, total ?? 0);

  return (
    <div className={styles.pagination} aria-busy={loading}>
      <div className={styles.pageSize}>
        <span>{t("adminRowsPerPage")}</span>
        <CustomSelect
          value={limit}
          options={pageSizes.map((value) => ({ value, label: String(value) }))}
          onChange={(value) => onLimitChange(Number(value))}
          ariaLabel={t("adminRowsPerPage")}
          triggerClassName={styles.select}
          disabled={disabled || loading}
        />
      </div>
      <p className={styles.summary} role="status" aria-live="polite">
        {loading || total === undefined ? "…" : total > 0
          ? t("adminPaginationRange", { start, end, total })
          : t("adminZeroResults")}
      </p>
      <nav className={styles.pages} aria-label={label}>
        <button
          type="button"
          className={styles.pageButton}
          aria-label={t("previous")}
          title={t("previous")}
          disabled={unavailable || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {getPaginationItems(currentPage, pages).map((item, index) => item === "…" ? (
          <span key={`gap-${index}`} className={styles.ellipsis} aria-hidden="true">…</span>
        ) : (
          <button
            key={item}
            type="button"
            className={styles.pageButton}
            aria-current={item === currentPage ? "page" : undefined}
            aria-label={t("usersPage", { page: item, total: pages })}
            disabled={unavailable}
            onClick={() => { if (item !== currentPage) onPageChange(item); }}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          className={styles.pageButton}
          aria-label={t("next")}
          title={t("next")}
          disabled={unavailable || currentPage >= pages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m10 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </nav>
    </div>
  );
}
