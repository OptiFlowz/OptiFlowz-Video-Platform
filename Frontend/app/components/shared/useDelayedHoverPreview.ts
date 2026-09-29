import { useCallback, useEffect, useRef, useState } from "react";

export function useDelayedHoverPreview(delayMs = 300) {
  const [isActive, setIsActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setIsActive(false);
  }, []);

  const start = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    setIsActive(false);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setIsActive(true);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);

  return { isActive, start, cancel };
}
