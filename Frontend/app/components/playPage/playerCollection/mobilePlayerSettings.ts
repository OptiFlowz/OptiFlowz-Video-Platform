import { CLOSE_ICON_PATH } from "~/constants";
import { setupSettingsSheetDrag } from "./settingsSheetDrag";
import type MuxPlayerElement from "@mux/mux-player";

export const MOBILE_PLAYER_QUERY = "(max-width: 800px), (hover: none) and (pointer: coarse)";

const styles = `
@media ${MOBILE_PLAYER_QUERY} {
  media-time-range { --media-preview-box-display: none; }
  media-time-range [slot="preview"] { display: none !important; }
  .media-volume-range-wrapper, media-volume-range { display: none !important; }
  media-mute-button ~ media-time-display { margin-left: calc(-0.7 * var(--base)) !important; }
}
.player-settings-sheet {
  position: fixed; inset: auto 0 0; margin: 0 auto; padding: 12px 16px max(20px, env(safe-area-inset-bottom));
  width: min(100%, 560px); max-width: 100%; max-height: 85dvh; box-sizing: border-box;
  border: 1px solid var(--border1); border-bottom: 0; border-radius: 24px 24px 0 0;
  background: var(--background1); color: var(--text1); overflow: auto; overscroll-behavior: contain;
  font-family: var(--font-sans, inherit); touch-action: pan-y;
  transform: translateY(var(--sheet-drag-y, 0px)); transition: transform 220ms cubic-bezier(.2,.8,.2,1);
  --_primary-color: var(--text1); --media-primary-color: var(--text1); --media-text-color: var(--text1);
  --media-icon-color: var(--text1); --media-menu-background: var(--background1);
  --media-menu-max-height: 65dvh; --media-menu-item-hover-background: var(--background2);
  --media-control-hover-background: var(--background2);
}
.player-settings-sheet[open] { opacity: 1 !important; visibility: visible !important; }
.player-settings-sheet[data-preparing] { transform: translateY(100%); transition: none; }
.player-settings-sheet[data-preparing]::backdrop { opacity: 0; transition: none; }
.player-settings-sheet[data-opening] { animation: settings-sheet-in 280ms cubic-bezier(.2,.8,.2,1) both; transition: none; }
.player-settings-sheet[data-opening]::backdrop { animation: settings-backdrop-in 280ms ease-out both; }
.player-settings-sheet:is([data-preparing], [data-opening]) media-settings-menu {
  --media-menu-transition-in: none; --media-menu-transition-out: none;
}
.player-settings-sheet[data-preparing] media-settings-menu::part(container) { transition: none; }
.player-settings-sheet::backdrop { background: var(--seethroughtBlack); transition: opacity 220ms ease; }
.player-settings-sheet[data-closing] { animation: none; transform: translateY(100%); }
.player-settings-sheet[data-closing]::backdrop { opacity: 0; }
.player-settings-sheet[data-dragging] { animation: none; transition: none; user-select: none; }
.player-settings-sheet .sheet-header { touch-action: none; cursor: grab; }
.player-settings-sheet[data-dragging] .sheet-header { cursor: grabbing; }
.player-settings-sheet .sheet-handle { width: 40px; height: 4px; margin: 0 auto 12px; border-radius: 999px; background: var(--text2); opacity: .35; }
.player-settings-sheet .sheet-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.player-settings-sheet h2 { margin: 0; font-size: 19px; font-weight: 650; }
.player-settings-sheet .sheet-close { font: inherit; color: var(--text1); background: var(--background2); border: 0; border-radius: 999px; display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 12px; cursor: pointer; }
.player-settings-sheet .sheet-close svg { width: 20px; height: 20px; }
.player-settings-sheet .sheet-close:hover { background: var(--background3); }
.player-settings-sheet .sheet-close:focus-visible { outline: 2px solid var(--media-accent-color); outline-offset: 2px; }
.player-settings-sheet media-settings-menu {
  position: relative !important; inset: auto !important; width: 100%; min-width: 0 !important;
  margin: 0; padding: 0; border: 0; border-radius: 12px; background: var(--background1);
  --media-menu-transform-in: none; --media-menu-transform-out: none;
}
.player-settings-sheet media-settings-menu::part(container) { width: 100% !important; }
.player-settings-sheet media-settings-menu-item,
.player-settings-sheet media-chrome-menu-item,
.player-settings-sheet [role="menu"]::part(menu-item) {
  min-height: 52px; height: auto; font-size: 16px; line-height: 1.4; margin-inline: 0;
  padding: 12px; border-radius: 12px !important; color: var(--text1);
  --media-icon-color: var(--text1); --media-menu-item-checked-background: var(--background2);
}
.player-settings-sheet [slot="submenu"] { width: 100%; --media-menu-min-width: 100%; }
.player-settings-sheet [slot="submenu"]::part(back button) { min-height: 52px; height: auto; padding: 12px; font-size: 16px; color: var(--text1); }
.player-settings-sheet media-settings-menu-item:hover,
.player-settings-sheet media-chrome-menu-item:hover,
.player-settings-sheet [role="menu"]::part(menu-item):hover,
.player-settings-sheet [slot="submenu"]::part(back button):hover { background: var(--background2); color: var(--text1); }
.player-settings-sheet media-chrome-menu-item[aria-checked="true"],
.player-settings-sheet [role="menu"]::part(menu-item checked) { color: var(--media-accent-color); background: var(--background2); }
@keyframes settings-sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes settings-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .player-settings-sheet[open] { animation: none; transition: none; } .player-settings-sheet::backdrop { animation: none; transition: none; } }
`;

/** Keep the real Media Chrome controls associated with their player, in a top-layer dialog. */
export function setupMobilePlayerSettings(player: MuxPlayerElement | null, labels: { settings: string; close: string }) {
  const root = player?.shadowRoot?.querySelector("media-theme")?.shadowRoot;
  const menu = root?.querySelector<HTMLElement>("media-settings-menu");
  const button = root?.querySelector<HTMLElement>("media-settings-menu-button");
  const controller = root?.querySelector("media-controller");
  if (!root || !menu || !button || !controller) return () => {};

  const style = document.createElement("style");
  style.textContent = styles;
  root.append(style);
  const dialog = document.createElement("dialog");
  dialog.className = "player-settings-sheet";
  dialog.setAttribute("aria-label", labels.settings);
  const handle = document.createElement("div");
  handle.className = "sheet-handle";
  handle.setAttribute("aria-hidden", "true");
  const heading = document.createElement("div");
  heading.className = "sheet-heading";
  const title = document.createElement("h2");
  title.textContent = labels.settings;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "sheet-close";
  closeButton.setAttribute("aria-label", labels.close);
  const closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  closeIcon.setAttribute("viewBox", "0 0 24 24");
  closeIcon.setAttribute("aria-hidden", "true");
  closeIcon.setAttribute("fill", "none");
  closeIcon.setAttribute("stroke", "currentColor");
  const closePath = document.createElementNS(closeIcon.namespaceURI, "path");
  closePath.setAttribute("d", CLOSE_ICON_PATH);
  closePath.setAttribute("stroke-width", "2");
  closePath.setAttribute("stroke-linecap", "round");
  closePath.setAttribute("stroke-linejoin", "round");
  closeIcon.append(closePath);
  closeButton.append(closeIcon);
  heading.append(title, closeButton);
  const header = document.createElement("div");
  header.className = "sheet-header";
  header.append(handle, heading);
  dialog.append(header);
  controller.append(dialog);
  const marker = document.createComment("desktop settings position");
  menu.before(marker);
  const anchor = menu.getAttribute("anchor");
  const media = window.matchMedia(MOBILE_PLAYER_QUERY);
  let openingFrame = 0;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseScroll: (() => void) | undefined;

  // Native dialogs also move/restore focus; clear it within this player's shadow tree.
  const clearPlayerFocus = () => {
    let active = root.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };

  const restore = () => {
    clearTimeout(closeTimer);
    cancelAnimationFrame(openingFrame);
    dialog.removeAttribute("data-preparing");
    dialog.removeAttribute("data-opening");
    dialog.removeAttribute("data-closing");
    dialog.removeAttribute("data-dragging");
    dialog.style.removeProperty("--sheet-drag-y");
    menu.hidden = true;
    menu.querySelectorAll<HTMLElement>('[slot="submenu"]').forEach(submenu => { submenu.hidden = true; });
    marker.after(menu);
    if (anchor !== null) menu.setAttribute("anchor", anchor);
    button.setAttribute("aria-expanded", "false");
    releaseScroll?.();
    releaseScroll = undefined;
  };
  const finishClose = () => { if (dialog.open) { dialog.close(); onClose(); } };
  const close = () => {
    if (!dialog.open || dialog.hasAttribute("data-closing")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finishClose(); return; }
    cancelAnimationFrame(openingFrame);
    dialog.removeAttribute("data-preparing");
    dialog.removeAttribute("data-dragging");
    dialog.removeAttribute("data-opening");
    dialog.setAttribute("data-closing", "");
    closeTimer = setTimeout(finishClose, 240);
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === dialog && event.propertyName === "transform" && dialog.hasAttribute("data-closing")) finishClose();
  };
  const cleanupDrag = setupSettingsSheetDrag(dialog, close);
  const open = (event: Event) => {
    if (!media.matches) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (dialog.open) return;
    menu.removeAttribute("anchor");
    dialog.append(menu);
    dialog.setAttribute("data-preparing", "");
    clearPlayerFocus();
    dialog.showModal();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    releaseScroll = () => { document.documentElement.style.overflow = overflow; };
    clearPlayerFocus();
    // Let the relocated menu settle at its mobile size before sliding the whole sheet in.
    openingFrame = requestAnimationFrame(() => {
      openingFrame = requestAnimationFrame(() => {
        if (!dialog.open || dialog.hasAttribute("data-closing")) return;
        dialog.setAttribute("data-opening", "");
        dialog.removeAttribute("data-preparing");
      });
    });
  };
  const onClose = () => {
    // A queued close event from the previous opening must not close a new sheet.
    if (dialog.open || !releaseScroll) return;
    restore();
    clearPlayerFocus();
  };
  const onToggle = (event: Event) => { if (event.target === menu && menu.hidden) close(); };
  const onResize = () => { if (!media.matches) finishClose(); };
  const onBackdrop = (event: MouseEvent) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  };
  // Capture at the theme root, before the custom settings button's native handler.
  const onClick = (event: Event) => { if (event.composedPath().includes(button)) open(event); };
  const onInvoke = (event: Event) => {
    if (event.target === menu && (event as Event & { relatedTarget?: Element }).relatedTarget === button) open(event);
  };
  const onKey = (event: KeyboardEvent) => {
    if (dialog.open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  };
  root.addEventListener("click", onClick, true);
  root.addEventListener("invoke", onInvoke, true);
  dialog.addEventListener("animationend", event => { if (event.target === dialog && event.animationName === "settings-sheet-in") dialog.removeAttribute("data-opening"); });
  dialog.addEventListener("transitionend", onTransitionEnd);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", onKey, true);
  dialog.addEventListener("click", onBackdrop);
  dialog.addEventListener("close", onClose);
  closeButton.addEventListener("click", close);
  menu.addEventListener("toggle", onToggle);
  media.addEventListener("change", onResize);
  return () => {
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("invoke", onInvoke, true);
    menu.removeEventListener("toggle", onToggle);
    media.removeEventListener("change", onResize);
    dialog.removeEventListener("close", onClose);
    cleanupDrag();
    clearTimeout(closeTimer);
    finishClose();
    restore();
    dialog.remove();
    marker.remove();
    style.remove();
  };
}
