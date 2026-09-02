import type MuxPlayerElement from "@mux/mux-player";

let mediaThemePromise: Promise<unknown> | null = null;

const CAPTION_STYLE_ID = "optiflowz-caption-style";
const CAPTION_OVERLAY_ID = "optiflowz-caption-overlay";
const CAPTION_PREFERENCES_KEY = "optiflowz-caption-preferences";
const CAPTION_PREFERENCES_EVENT = "optiflowz-caption-preferences-change";

type CaptionPreferences = {
  size: "small" | "medium" | "large";
  color: "red" | "blue" | "white" | "green" | "purple";
  background: "transparent" | "black" | "white";
};

const DEFAULT_CAPTION_PREFERENCES: CaptionPreferences = {
  size: "medium",
  color: "white",
  background: "black",
};

const captionSizes = {
  small: { min: 12, max: 28, scale: 0.023 },
  medium: { min: 14, max: 34, scale: 0.028 },
  large: { min: 16, max: 42, scale: 0.034 },
} as const;

const captionColors = {
  red: "var(--palette-ff6b6b)",
  blue: "var(--palette-72a7ff)",
  white: "var(--palette-ffffff)",
  green: "var(--palette-69dc8e)",
  purple: "var(--palette-c995ff)",
} as const;

const captionBackgrounds = {
  transparent: "transparent",
  black: "color-mix(in srgb, var(--palette-000000) 72%, transparent)",
  white: "color-mix(in srgb, var(--palette-ffffff) 72%, transparent)",
} as const;

type CaptionPreferenceMenu = HTMLElement & {
  hidden: boolean;
  value: string;
};

const initializedCaptionMenuRoots = new WeakSet<ShadowRoot>();

function getCaptionPreferences(): CaptionPreferences {
  try {
    const stored = JSON.parse(
      localStorage.getItem(CAPTION_PREFERENCES_KEY) ?? "{}",
    ) as Partial<CaptionPreferences>;

    return {
      size: stored.size && stored.size in captionSizes ? stored.size : "medium",
      color:
        stored.color && stored.color in captionColors ? stored.color : "white",
      background:
        stored.background && stored.background in captionBackgrounds
          ? stored.background
          : "black",
    };
  } catch {
    return DEFAULT_CAPTION_PREFERENCES;
  }
}

function saveCaptionPreferences(preferences: CaptionPreferences) {
  try {
    localStorage.setItem(CAPTION_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences still apply for the current page when storage is unavailable.
  }

  window.dispatchEvent(
    new CustomEvent<CaptionPreferences>(CAPTION_PREFERENCES_EVENT, {
      detail: preferences,
    }),
  );
}

/**
 * Mux copies the custom theme template into a generic <media-theme> element,
 * so the custom theme class' connectedCallback is not run. Wire the caption
 * preference controls against the actual mounted theme instead.
 */
function setupCaptionPreferenceMenus(player: MuxPlayerElement) {
  const theme = player.shadowRoot?.querySelector<HTMLElement>("media-theme");
  const themeRoot = theme?.shadowRoot;
  if (!themeRoot || initializedCaptionMenuRoots.has(themeRoot)) return;

  const settingsMenu =
    themeRoot.querySelector<CaptionPreferenceMenu>("media-settings-menu");
  const captionSettingsMenu =
    themeRoot.querySelector<CaptionPreferenceMenu>(".caption-settings-menu");
  if (!settingsMenu || !captionSettingsMenu) return;

  const preferenceMenus = [
    [
      "size",
      themeRoot.querySelector<CaptionPreferenceMenu>(".caption-size-menu"),
    ],
    [
      "color",
      themeRoot.querySelector<CaptionPreferenceMenu>(".caption-color-menu"),
    ],
    [
      "background",
      themeRoot.querySelector<CaptionPreferenceMenu>(".caption-background-menu"),
    ],
  ] as const;

  if (preferenceMenus.some(([, menu]) => !menu)) return;
  initializedCaptionMenuRoots.add(themeRoot);

  const preferences = getCaptionPreferences();
  const getNaturalMenuSize = (menu: CaptionPreferenceMenu) => {
    const root = menu.shadowRoot;
    const container = root?.querySelector<HTMLElement>("#container");
    const backButton = root?.querySelector<HTMLElement>('[part~="back"]');
    const content = root?.querySelector<HTMLElement>("slot:not([name])");
    const contentHeight =
      (backButton?.offsetHeight ?? 0) + (content?.scrollHeight ?? 0);

    return {
      height: contentHeight || container?.offsetHeight || menu.offsetHeight,
      width: Math.max(menu.offsetWidth, container?.offsetWidth ?? 0),
    };
  };
  const settingsContainer =
    settingsMenu.shadowRoot?.querySelector<HTMLElement>("#container");
  const captionContainer =
    captionSettingsMenu.shadowRoot?.querySelector<HTMLElement>("#container");
  let settingsMenuBaseSize: { height: number; width: number } | undefined;
  const refreshSettingsMenuBaseSize = () => {
    const naturalSize = getNaturalMenuSize(settingsMenu);
    settingsMenuBaseSize = {
      height: Math.max(settingsMenuBaseSize?.height ?? 0, naturalSize.height),
      width: Math.max(
        settingsMenuBaseSize?.width ?? 0,
        settingsMenu.offsetWidth,
        naturalSize.width,
      ),
    };
  };
  const setSettingsMenuSize = (height: number, width: number) => {
    settingsContainer?.style.setProperty("height", `${height}px`);
    settingsContainer?.style.setProperty("min-height", `${height}px`);
    settingsMenu.style.setProperty("min-height", `${height}px`);
    settingsMenu.style.setProperty("min-width", `${width}px`);
  };
  const restoreSettingsMenuContainer = () => {
    /*
     * The fixed container height is only needed while a submenu is visible.
     * Keeping it on the root menu makes Chromium lay the root rows out from
     * the top of that enlarged container instead of letting the settings menu
     * align their naturally sized block to the bottom again.
     */
    settingsContainer?.style.removeProperty("height");
    settingsContainer?.style.removeProperty("min-height");
  };
  const restoreSettingsMenuSize = () => {
    /*
     * Native Playback/Audio/Quality rows are populated asynchronously. Read
     * the root slot when it is presented and retain the largest complete
     * measurement instead of caching its early theme-initialisation height.
     */
    if (!settingsMenuBaseSize) refreshSettingsMenuBaseSize();
    if (!settingsMenuBaseSize) return;
    restoreSettingsMenuContainer();
    settingsMenu.style.setProperty(
      "min-height",
      `${settingsMenuBaseSize.height}px`,
    );
    settingsMenu.style.setProperty(
      "min-width",
      `${settingsMenuBaseSize.width}px`,
    );
  };
  const resetCaptionSettingsMenuSize = () => {
    captionContainer?.style.removeProperty("height");
    captionContainer?.style.removeProperty("min-height");

    preferenceMenus.forEach(([, menu]) => {
      menu?.style.removeProperty("top");
      menu?.style.removeProperty("bottom");
    });
  };

  /*
   * The root settings menu keeps its five original rows in the layout while a
   * submenu is translated into view. Explicitly size its inner container to
   * the active submenu so short menus do not get an empty band above their
   * header and tall menus are not clipped.
   */
  settingsMenu.addEventListener("toggle", (event) => {
    if (event.target === settingsMenu) {
      if (!settingsMenu.hidden) {
        refreshSettingsMenuBaseSize();
        resetCaptionSettingsMenuSize();
        restoreSettingsMenuSize();
      }
      return;
    }

    const submenu = event.target as CaptionPreferenceMenu;
    if (submenu.hidden) {
      if (submenu === captionSettingsMenu) resetCaptionSettingsMenuSize();
      restoreSettingsMenuSize();
      return;
    }

    refreshSettingsMenuBaseSize();
    const { height, width } = getNaturalMenuSize(submenu);
    setSettingsMenuSize(height, width);
  });

  /*
   * Media Chrome handles one submenu level by itself. A second-level toggle
   * must reach the caption settings menu so that it can slide and resize, but
   * it must not continue to the root settings menu (the root would interpret
   * it as a sibling toggle and close the caption settings menu).
   *
   * Once the caption menu has resized, mirror its outside dimensions onto the
   * root. This keeps the root's background, border and 24px radius around the
   * complete panel instead of positioning a bare inner container over it.
   */
  const captionSettingsBaseSize = getNaturalMenuSize(captionSettingsMenu);

  captionSettingsMenu.addEventListener("toggle", (event) => {
    if (event.target === captionSettingsMenu) return;

    event.stopPropagation();
    if (captionSettingsMenu.hidden) return;

    const toggledMenu = event.target as CaptionPreferenceMenu;
    const toggledMenuSize = getNaturalMenuSize(toggledMenu);
    const height = toggledMenu.hidden
      ? captionSettingsBaseSize.height
      : Math.max(captionSettingsBaseSize.height, toggledMenuSize.height);
    const width = toggledMenu.hidden
      ? captionSettingsBaseSize.width
      : Math.max(captionSettingsBaseSize.width, toggledMenuSize.width);

    if (toggledMenu.hidden) {
      toggledMenu.style.removeProperty("top");
      toggledMenu.style.removeProperty("bottom");
    }
    captionContainer?.style.setProperty("height", `${height}px`);
    captionContainer?.style.setProperty("min-height", `${height}px`);
    setSettingsMenuSize(height, width);

    const alignNestedMenu = () => {
      if (toggledMenu.hidden || !captionContainer) return;

      const settingsRect = settingsMenu.getBoundingClientRect();
      const captionContainerRect = captionContainer.getBoundingClientRect();
      const settingsStyle = getComputedStyle(settingsMenu);
      const panelInset =
        Number(settingsStyle.borderTopWidth.replace("px", "")) +
        Number(settingsStyle.paddingTop.replace("px", ""));
      const top = settingsRect.top + panelInset - captionContainerRect.top;

      toggledMenu.style.setProperty("top", `${top}px`);
      toggledMenu.style.setProperty("bottom", "auto");
    };

    requestAnimationFrame(alignNestedMenu);
    window.setTimeout(alignNestedMenu, 220);
  });

  preferenceMenus.forEach(([key, menu]) => {
    if (!menu) return;
    menu.value = preferences[key];

    menu.addEventListener("change", () => {
      saveCaptionPreferences({
        ...getCaptionPreferences(),
        [key]: menu.value,
      });
    });
  });
}

const captionStyles = `
  video::cue {
    color: transparent;
    background: transparent;
    opacity: 0;
    text-shadow: none;
  }

  #${CAPTION_OVERLAY_ID} {
    position: absolute;
    z-index: 1;
    inset-inline: 5%;
    bottom: 4%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1em;
    color: var(--optiflowz-caption-color, var(--palette-ffffff));
    font-family: Arial, Helvetica, sans-serif;
    font-weight: 500;
    line-height: 1.25;
    text-align: center;
    text-shadow: 0 1px 2px color-mix(in srgb, var(--palette-000000) 45%, transparent);
    pointer-events: none;
    transition: bottom 180ms ease;
  }

  #${CAPTION_OVERLAY_ID}[data-controls-visible="true"] {
    bottom: var(--optiflowz-caption-controls-bottom, max(12%, 48px));
  }

  #${CAPTION_OVERLAY_ID} .optiflowz-caption-cue {
    display: block;
    position: relative;
    max-width: 92%;
    line-height: 1.25;
  }

  #${CAPTION_OVERLAY_ID} .optiflowz-caption-text {
    position: relative;
    z-index: 1;
  }

  #${CAPTION_OVERLAY_ID} .optiflowz-caption-background {
    position: absolute;
    z-index: 0;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  #${CAPTION_OVERLAY_ID} .optiflowz-caption-background path {
    fill: var(--optiflowz-caption-background, color-mix(in srgb, var(--palette-000000) 72%, transparent));
  }
`;

type CaptionPoint = { x: number; y: number };

function roundedPolygonPath(points: CaptionPoint[], radius: number) {
  return `${points
    .map((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      const previousLength = Math.hypot(
        previous.x - point.x,
        previous.y - point.y,
      );
      const nextLength = Math.hypot(next.x - point.x, next.y - point.y);
      const cornerRadius = Math.min(
        radius,
        previousLength / 2,
        nextLength / 2,
      );
      const before = {
        x: point.x +
          ((previous.x - point.x) / (previousLength || 1)) * cornerRadius,
        y: point.y +
          ((previous.y - point.y) / (previousLength || 1)) * cornerRadius,
      };
      const after = {
        x: point.x + ((next.x - point.x) / (nextLength || 1)) * cornerRadius,
        y: point.y + ((next.y - point.y) / (nextLength || 1)) * cornerRadius,
      };

      return `${index === 0 ? "M" : "L"} ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
    })
    .join(" ")} Z`;
}

export function loadMediaTheme() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (!mediaThemePromise) {
    // @ts-ignore local vendored JS module has no type declarations
    mediaThemePromise = import("./optiflowzTheme/dist/media-theme.js");
  }

  return mediaThemePromise;
}

/**
 * Mux Player nests the native video in a second shadow root, so document-level
 * ::cue rules cannot reach it. Install the caption treatment beside that video
 * instead. iOS native fullscreen temporarily falls back to Safari's native
 * cue renderer because custom DOM overlays are not included in that player.
 */
export function styleMuxPlayerCaptions(player: MuxPlayerElement | null) {
  if (player) setupCaptionPreferenceMenus(player);

  const media = player?.media;
  const mediaRoot = media?.shadowRoot;
  const video = media?.nativeEl;
  if (!mediaRoot || !video || mediaRoot.getElementById(CAPTION_OVERLAY_ID)) {
    return;
  }

  let captionStyle = mediaRoot.getElementById(
    CAPTION_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!captionStyle) {
    captionStyle = document.createElement("style");
    captionStyle.id = CAPTION_STYLE_ID;
    captionStyle.textContent = captionStyles;
    mediaRoot.append(captionStyle);
  }

  const overlay = document.createElement("div");
  overlay.id = CAPTION_OVERLAY_ID;
  overlay.setAttribute("aria-hidden", "true");
  mediaRoot.append(overlay);

  const trackedTextTracks = new WeakSet<TextTrack>();
  let captionPreferences = getCaptionPreferences();
  let captionBackgroundFrame = 0;

  const updateCaptionBackgrounds = () => {
    overlay.querySelectorAll<HTMLElement>(".optiflowz-caption-cue").forEach((cue) => {
      const text = cue.querySelector<HTMLElement>(".optiflowz-caption-text");
      const path = cue.querySelector<SVGPathElement>(
        ".optiflowz-caption-background path",
      );
      if (!text || !path) return;

      const cueRect = cue.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const fragments = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      range.detach();

      const lines = fragments.reduce<DOMRect[]>(
        (grouped, fragment) => {
          const line = grouped.find(
            (candidate) => Math.abs(candidate.top - fragment.top) < 2,
          );
          if (line) {
            const left = Math.min(line.left, fragment.left);
            const top = Math.min(line.top, fragment.top);
            const right = Math.max(line.right, fragment.right);
            const bottom = Math.max(line.bottom, fragment.bottom);
            line.x = left;
            line.y = top;
            line.width = right - left;
            line.height = bottom - top;
          } else {
            grouped.push(
              new DOMRect(
                fragment.left,
                fragment.top,
                fragment.width,
                fragment.height,
              ),
            );
          }
          return grouped;
        },
        [],
      ).sort((a, b) => a.top - b.top);

      if (!lines.length) {
        path.removeAttribute("d");
        return;
      }

      const fontSize = parseFloat(getComputedStyle(overlay).fontSize);
      const paddingX = fontSize * 0.42;
      const paddingY = fontSize * 0.13;
      const boxes = lines.map((line) => ({
        left: line.left - cueRect.left - paddingX,
        right: line.right - cueRect.left + paddingX,
        top: line.top - cueRect.top - paddingY,
        bottom: line.bottom - cueRect.top + paddingY,
      }));
      const points: CaptionPoint[] = [
        { x: boxes[0].left, y: boxes[0].top },
        { x: boxes[0].right, y: boxes[0].top },
      ];

      boxes.slice(0, -1).forEach((box, index) => {
        const next = boxes[index + 1];
        const joinY = (box.bottom + next.top) / 2;
        points.push(
          { x: box.right, y: joinY },
          { x: next.right, y: joinY },
        );
      });

      const lastBox = boxes[boxes.length - 1];
      points.push(
        { x: lastBox.right, y: lastBox.bottom },
        { x: lastBox.left, y: lastBox.bottom },
      );

      for (let index = boxes.length - 2; index >= 0; index -= 1) {
        const box = boxes[index];
        const next = boxes[index + 1];
        const joinY = (box.bottom + next.top) / 2;
        points.push(
          { x: next.left, y: joinY },
          { x: box.left, y: joinY },
        );
      }

      path.setAttribute("d", roundedPolygonPath(points, fontSize * 0.24));
    });
  };

  const scheduleCaptionBackgroundUpdate = () => {
    cancelAnimationFrame(captionBackgroundFrame);
    captionBackgroundFrame = requestAnimationFrame(updateCaptionBackgrounds);
  };

  const applyCaptionPreferences = (preferences: CaptionPreferences) => {
    captionPreferences = preferences;
    overlay.style.setProperty(
      "--optiflowz-caption-color",
      captionColors[preferences.color],
    );
    overlay.style.setProperty(
      "--optiflowz-caption-background",
      captionBackgrounds[preferences.background],
    );

    const size = captionSizes[preferences.size];
    const fontSize = Math.max(
      size.min,
      Math.min(size.max, video.clientWidth * size.scale),
    );
    overlay.style.fontSize = `${fontSize}px`;
    scheduleCaptionBackgroundUpdate();
  };

  const renderCaptions = () => {
    const activeCues = Array.from(video.textTracks)
      .filter((track) => track.mode === "showing")
      .flatMap((track) => Array.from(track.activeCues ?? []));

    const cueElements = activeCues.map((cue) => {
      const cueElement = document.createElement("div");
      cueElement.className = "optiflowz-caption-cue";
      const cueBackground = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      cueBackground.classList.add("optiflowz-caption-background");
      cueBackground.setAttribute("aria-hidden", "true");
      const cueBackgroundPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      cueBackground.append(cueBackgroundPath);
      const cueText = document.createElement("span");
      cueText.className = "optiflowz-caption-text";

      if (typeof VTTCue !== "undefined" && cue instanceof VTTCue) {
        cueText.append(cue.getCueAsHTML());
      } else {
        cueText.textContent =
          (cue as TextTrackCue & { text?: string }).text ?? "";
      }

      cueElement.append(cueBackground, cueText);
      return cueElement;
    });

    overlay.replaceChildren(...cueElements);
    scheduleCaptionBackgroundUpdate();
  };

  const syncTextTracks = () => {
    Array.from(video.textTracks).forEach((track) => {
      if (trackedTextTracks.has(track)) return;
      trackedTextTracks.add(track);
      track.addEventListener("cuechange", renderCaptions);
    });
    renderCaptions();
  };

  video.textTracks.addEventListener("addtrack", syncTextTracks);
  video.textTracks.addEventListener("removetrack", syncTextTracks);
  video.textTracks.addEventListener("change", syncTextTracks);

  const controller = player?.mediaController;
  const syncCaptionPosition = () => {
    const controlsVisible = overlay.dataset.controlsVisible === "true";
    if (!controlsVisible) return;

    const controlBar = controller?.querySelector<HTMLElement>(
      "media-control-bar",
    );
    const controllerRect = controller?.getBoundingClientRect();
    const controlBarRect = controlBar?.getBoundingClientRect();
    const isCompactPlayer = video.clientWidth <= 768;
    const fallbackClearance = Math.max(
      video.clientHeight * (isCompactPlayer ? 0.24 : 0.12),
      isCompactPlayer ? 56 : 40,
    );
    const measuredClearance =
      controllerRect && controlBarRect
        ? controllerRect.bottom - controlBarRect.top + 12
        : 0;
    const clearance = Math.min(
      Math.max(measuredClearance, fallbackClearance),
      video.clientHeight * 0.42,
    );

    overlay.style.setProperty(
      "--optiflowz-caption-controls-bottom",
      `${clearance}px`,
    );
  };

  const resizeObserver = new ResizeObserver(() => {
    applyCaptionPreferences(captionPreferences);
    syncCaptionPosition();
  });
  resizeObserver.observe(video);

  const syncControlVisibility = () => {
    const controlsVisible =
      controller?.hasAttribute("mediapaused") ||
      !controller?.hasAttribute("userinactive");
    overlay.dataset.controlsVisible = String(controlsVisible);
    syncCaptionPosition();
  };

  const controlVisibilityObserver = new MutationObserver(syncControlVisibility);
  if (controller) {
    controlVisibilityObserver.observe(controller, {
      attributes: true,
      attributeFilter: ["mediapaused", "userinactive"],
    });
  }

  const handleCaptionPreferences = (event: Event) => {
    const preferences = (event as CustomEvent<CaptionPreferences>).detail;
    applyCaptionPreferences(preferences ?? getCaptionPreferences());
  };
  window.addEventListener(CAPTION_PREFERENCES_EVENT, handleCaptionPreferences);

  const enterNativeFullscreen = () => {
    captionStyle.disabled = true;
    overlay.hidden = true;
  };
  const exitNativeFullscreen = () => {
    captionStyle.disabled = false;
    overlay.hidden = false;
    syncControlVisibility();
    renderCaptions();
  };
  video.addEventListener("webkitbeginfullscreen", enterNativeFullscreen);
  video.addEventListener("webkitendfullscreen", exitNativeFullscreen);

  applyCaptionPreferences(captionPreferences);
  syncControlVisibility();
  syncTextTracks();
}
