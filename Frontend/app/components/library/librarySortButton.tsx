type LibrarySortButtonProps = {
  label: string;
  direction: "asc" | "desc" | null;
  onClick: () => void;
};

export default function LibrarySortButton({ label, direction, onClick }: LibrarySortButtonProps) {
  return (
    <button type="button" className="platformUsersSortButton" onClick={onClick}>
      {label}
      <svg className="platformUsersSortArrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {direction !== "desc" && (
          <path d="M7 20V4M3 8l4-4 4 4" transform={direction ? "translate(5 0)" : undefined} />
        )}
        {direction !== "asc" && (
          <path d="M17 4v16m-4-4 4 4 4-4" transform={direction ? "translate(-5 0)" : undefined} />
        )}
      </svg>
    </button>
  );
}
