import { useCallback, useEffect, useRef, useState } from "react";

type ConfirmOptions = {
  intent?: "danger" | "primary";
  title?: string;
  message?: string;
  yesText?: string;
  noText?: string;
};

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({});
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const promiseRef = useRef<Promise<boolean> | null>(null);
  const resultRef = useRef<boolean | null>(null);

  const confirm = useCallback((opts: ConfirmOptions = {}) => {
    if (promiseRef.current) return promiseRef.current;
    setOptions(opts);
    setOpen(true);

    promiseRef.current = new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
    return promiseRef.current;
  }, []);

  const close = useCallback((result: boolean) => {
    if (!resolverRef.current || resultRef.current !== null) return;
    resultRef.current = result;
    setOpen(false);
  }, []);

  const afterClose = useCallback(() => {
    if (resultRef.current === null) return;
    const result = resultRef.current, resolve = resolverRef.current;
    resolverRef.current = null;
    promiseRef.current = null;
    resultRef.current = null;
    resolve?.(result);
  }, []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
    promiseRef.current = null;
    resultRef.current = null;
  }, []);

  return {
    confirm, // call this from anywhere in the component
    dialogProps: {
      open,
      intent: options.intent,
      title: options.title,
      message: options.message,
      yesText: options.yesText,
      noText: options.noText,
      onYes: () => close(true),
      onNo: () => close(false),
      onAfterClose: afterClose,
    },
  };
}
