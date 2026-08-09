"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function PopupPortal({ children }: { children: ReactNode }) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  return portalRoot ? createPortal(children, portalRoot) : null;
}

export default PopupPortal;
