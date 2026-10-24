"use client";

import { useLayoutEffect } from "react";

const widgetSelector = "#optiflowz-chat, #optiflowz-chat-open, .optiflowz-chat-wrapper";

export function isQuizChatBlocked(pathname: string) {
  return /^\/quiz(?:\/|$)/i.test(pathname);
}

/** Also covers a widget that finishes loading after navigation to a quiz. */
export function useQuizChatRestriction(pathname: string) {
  const blocked = isQuizChatBlocked(pathname);

  useLayoutEffect(() => {
    if (!blocked) return;

    document.body.classList.add("quiz-chat-blocked");
    const originalInert = new Map<HTMLElement, boolean>();
    let closing = false;

    const restrictWidget = () => {
      const chat = document.getElementById("optiflowz-chat");
      if (chat?.classList.contains("chat-open")) {
        // Use the widget's toggle so its internal open state is reset as well.
        closing = true;
        document.getElementById("optiflowz-chat-open")?.click();
        closing = false;
        chat.classList.remove("chat-open");
      }
      document.querySelectorAll<HTMLElement>(widgetSelector).forEach(element => {
        if (!originalInert.has(element)) originalInert.set(element, element.inert);
        element.inert = true;
      });
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(widgetSelector)) active.blur();
    };

    const blockInteraction = (event: Event) => {
      if (!closing && event.target instanceof Element && event.target.closest(widgetSelector)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const events = ["click", "pointerdown", "keydown", "submit"];
    events.forEach(type => document.addEventListener(type, blockInteraction, true));
    restrictWidget();

    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === "childList" ||
        (record.target instanceof Element && record.target.matches(widgetSelector)))) {
        restrictWidget();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      events.forEach(type => document.removeEventListener(type, blockInteraction, true));
      originalInert.forEach((inert, element) => { element.inert = inert; });
      document.body.classList.remove("quiz-chat-blocked");
    };
  }, [blocked]);

  return blocked;
}
