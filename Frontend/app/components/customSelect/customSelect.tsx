import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type CustomSelectOption = {
  value: string | number;
  label: string;
  disabled?: boolean;
};

type CustomSelectProps = {
  value: string | number;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  rootClassName?: string;
  triggerClassName?: string;
  leadingContent?: ReactNode;
  valueContent?: ReactNode;
};

const MAX_MENU_HEIGHT = 280;

function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  name,
  disabled = false,
  rootClassName = "",
  triggerClassName = "",
  leadingContent,
  valueContent,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);
  const [menuHeight, setMenuHeight] = useState(MAX_MENU_HEIGHT);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const stringValue = String(value);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => String(option.value) === stringValue),
  );
  const firstEnabledIndex = Math.max(0, options.findIndex((option) => !option.disabled));
  const selectedOption = options[selectedIndex];

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
    if (disabled || options.length === 0) return;
    prepareMenu();
    setActiveIndex(options[index]?.disabled ? firstEnabledIndex : index);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus());
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

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const findEnabledIndex = (startIndex: number, direction: 1 | -1) => {
    let nextIndex = startIndex;
    for (let step = 0; step < options.length; step += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length;
      if (!options[nextIndex]?.disabled) return nextIndex;
    }
    return activeIndex;
  };

  const focusOption = (index: number) => {
    setActiveIndex(index);
    optionRefs.current[index]?.focus();
  };

  const selectOption = (option: CustomSelectOption) => {
    if (option.disabled) return;
    onChange(String(option.value));
    closeMenu(true);
  };

  return (
    <div ref={rootRef} className={`customSelect ${rootClassName} ${open ? "isOpen" : ""}`}>
      {name ? <input type="hidden" name={name} value={stringValue} /> : null}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={`customSelectTrigger ${triggerClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        {leadingContent ? <span className="customSelectLeading">{leadingContent}</span> : null}
        {valueContent ?? <span className="customSelectValue">{selectedOption?.label ?? stringValue}</span>}
        <span className="customSelectChevron" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="m3.75 6 4.25 4 4.25-4" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className={`customSelectMenu ${openUpward ? "opensUpward" : ""}`}>
          <div
            id={listboxId}
            className="customSelectMenuScroll"
            role="listbox"
            aria-label={ariaLabel}
            style={{ maxHeight: `${menuHeight}px` }}
          >
            {options.map((option, index) => {
              const selected = String(option.value) === stringValue;
              return (
                <button
                  key={`${option.value}-${index}`}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  className={`customSelectOption ${selected ? "isSelected" : ""}`}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusOption(findEnabledIndex(index, 1));
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusOption(findEnabledIndex(index, -1));
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      focusOption(firstEnabledIndex);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      const lastEnabled = [...options].reverse().findIndex((item) => !item.disabled);
                      focusOption(lastEnabled < 0 ? firstEnabledIndex : options.length - 1 - lastEnabled);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectOption(option);
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

export default CustomSelect;
