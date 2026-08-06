import { useEffect, useId, useRef, useState } from "react";
import { ArrowSVG } from "~/constants";
import { LANGUAGE_OPTIONS, type Locale } from "~/i18n";

type LanguageSelectProps = {
  value: Locale;
  onChange: (locale: Locale) => void;
  ariaLabel: string;
  label?: string;
  variant?: "menu" | "mobile" | "settings";
};

const MAX_MENU_HEIGHT = 280;

function LanguageSelect({
  value,
  onChange,
  ariaLabel,
  label,
  variant = "settings",
}: LanguageSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);
  const [menuHeight, setMenuHeight] = useState(MAX_MENU_HEIGHT);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    LANGUAGE_OPTIONS.findIndex((option) => option.value === value),
  );
  const selectedLabel = LANGUAGE_OPTIONS[selectedIndex]?.label ?? value;

  const prepareMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const shouldOpenUpward = spaceBelow < MAX_MENU_HEIGHT && spaceAbove > spaceBelow;
    const availableSpace = shouldOpenUpward ? spaceAbove : spaceBelow;

    setOpenUpward(shouldOpenUpward);
    setMenuHeight(Math.max(120, Math.min(MAX_MENU_HEIGHT, availableSpace)));
  };

  const openMenu = (index = selectedIndex) => {
    prepareMenu();
    setActiveIndex(index);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    const handleViewportChange = () => prepareMenu();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    window.requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus());

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  const moveActiveOption = (nextIndex: number) => {
    const wrappedIndex =
      (nextIndex + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length;
    setActiveIndex(wrappedIndex);
    optionRefs.current[wrappedIndex]?.focus();
  };

  const selectOption = (locale: Locale) => {
    onChange(locale);
    closeMenu(true);
  };

  return (
    <div
      ref={rootRef}
      className={`customLanguageSelect customLanguageSelect--${variant} ${open ? "isOpen" : ""}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="customLanguageTrigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(selectedIndex);
          }
          if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        {label ? (
          <span className="customLanguageText">
            <strong>{label}</strong>
            <small>{selectedLabel}</small>
          </span>
        ) : (
          <span className="customLanguageValue">{selectedLabel}</span>
        )}
        <span className="customLanguageChevron" aria-hidden="true">
          {ArrowSVG}
        </span>
      </button>

      {open ? (
        <div
          className={`customLanguageMenu ${openUpward ? "opensUpward" : ""}`}
        >
          <div
            id={listboxId}
            className="customLanguageMenuScroll"
            role="listbox"
            aria-label={ariaLabel}
            style={{ maxHeight: `${menuHeight}px` }}
          >
            {LANGUAGE_OPTIONS.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`customLanguageOption ${selected ? "isSelected" : ""}`}
                  onClick={() => selectOption(option.value)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveActiveOption(index + 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveActiveOption(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveActiveOption(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveActiveOption(LANGUAGE_OPTIONS.length - 1);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectOption(option.value);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      closeMenu(true);
                    } else if (event.key === "Tab") {
                      closeMenu();
                    }
                  }}
                >
                  <span>{option.label}</span>
                  {selected ? (
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m4.5 10.5 3.4 3.4 7.6-7.8" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LanguageSelect;

