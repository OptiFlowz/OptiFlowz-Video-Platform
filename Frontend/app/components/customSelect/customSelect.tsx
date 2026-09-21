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
  typeAhead?: boolean;
  placement?: "auto" | "top";
};

const MAX_MENU_HEIGHT = 280;
const VIEWPORT_MARGIN = 12;

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
  typeAhead = false,
  placement = "auto",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(placement === "top");
  const [menuHeight, setMenuHeight] = useState(MAX_MENU_HEIGHT);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeAheadRef = useRef({ text: "", lastTypedAt: 0 });
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

    const viewport = window.visualViewport;
    let top = viewport?.offsetTop ?? 0;
    let bottom = top + (viewport?.height ?? window.innerHeight);
    // A popup's scrollable body can end well before the viewport does.
    for (let parent = rootRef.current?.parentElement; parent; parent = parent.parentElement) {
      if (!/(auto|scroll|hidden|clip)/.test(window.getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top + parent.clientTop);
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
    }
    const spaceBelow = Math.max(0, bottom - rect.bottom - VIEWPORT_MARGIN);
    const spaceAbove = Math.max(0, rect.top - top - VIEWPORT_MARGIN);
    const shouldOpenUpward = placement === "top" || (spaceBelow < MAX_MENU_HEIGHT && spaceAbove > spaceBelow);
    const availableSpace = shouldOpenUpward ? spaceAbove : spaceBelow;

    const menu = menuRef.current;
    if (menu) {
      const viewportLeft = (viewport?.offsetLeft ?? 0) + VIEWPORT_MARGIN;
      const viewportRight = (viewport?.offsetLeft ?? 0)
        + (viewport?.width ?? document.documentElement.clientWidth) - VIEWPORT_MARGIN;
      menu.style.maxWidth = `${Math.max(0, viewportRight - viewportLeft)}px`;

      // Measure the layout width, unaffected by the opening scale animation.
      const width = menu.offsetWidth;
      let left = rect.right - width;
      if (left < viewportLeft) left = rect.left;
      left = Math.max(viewportLeft, Math.min(left, viewportRight - width));
      menu.style.left = `${left - rect.left - (rootRef.current?.clientLeft ?? 0)}px`;
      menu.style.right = "auto";
      menu.style.transformOrigin = `${Math.max(0, Math.min(width, rect.right - left))}px ${shouldOpenUpward ? "bottom" : "top"}`;
    }

    setOpenUpward(shouldOpenUpward);
    const menuStyle = menu ? window.getComputedStyle(menu) : null;
    const menuFrameHeight = menuStyle
      ? [menuStyle.paddingTop, menuStyle.paddingBottom, menuStyle.borderTopWidth, menuStyle.borderBottomWidth]
        .reduce((sum, size) => sum + (parseFloat(size) || 0), 0)
      : 0;
    setMenuHeight(Math.max(0, Math.min(MAX_MENU_HEIGHT, availableSpace - menuFrameHeight)));
  };

  const openMenu = (index = selectedIndex) => {
    if (disabled || options.length === 0) return;
    typeAheadRef.current = { text: "", lastTypedAt: 0 };
    prepareMenu();
    setActiveIndex(options[index]?.disabled ? firstEnabledIndex : index);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    typeAheadRef.current = { text: "", lastTypedAt: 0 };
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
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    const observer = new ResizeObserver(handleViewportChange);
    if (rootRef.current) observer.observe(rootRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    window.requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus());

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
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

  const focusMatchingOption = (key: string, currentIndex: number) => {
    const now = Date.now();
    const previous = typeAheadRef.current;
    const text = (now - previous.lastTypedAt < 800 ? previous.text : "") + key.toLowerCase();
    typeAheadRef.current = { text, lastTypedAt: now };

    // Repeated letters cycle through matches; a prefix such as "spa" finds Spanish.
    const repeated = [...text].every((character) => character === text[0]);
    const prefix = repeated ? text[0] : text;
    const start = repeated ? currentIndex + 1 : currentIndex;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLowerCase().startsWith(prefix)) {
        focusOption(index);
        break;
      }
    }
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

      <div
        ref={menuRef}
        className={`customSelectMenu ${openUpward ? "opensUpward" : ""}`}
        aria-hidden={!open}
      >
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
                  tabIndex={open && !option.disabled ? 0 : -1}
                  disabled={option.disabled}
                  className={`customSelectOption ${selected ? "isSelected" : ""}`}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onKeyDown={(event) => {
                    if (typeAhead && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.stopPropagation();
                      focusMatchingOption(event.key, index);
                      return;
                    }
                    if (event.key !== "Shift") typeAheadRef.current = { text: "", lastTypedAt: 0 };
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
    </div>
  );
}

export default CustomSelect;
