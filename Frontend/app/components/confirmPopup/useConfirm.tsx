import { useCallback, useRef, useState } from "react";

type ConfirmOptions = {
  title?: string;
  message?: string;
  yesText?: string;
  noText?: string;
};

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({});
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions = {}) => {
    setOptions(opts);
    setOpen(true);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setOpen(false);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  return {
    confirm, // call this from anywhere in the component
    dialogProps: {
      open,
      title: options.title,
      message: options.message,
      yesText: options.yesText,
      noText: options.noText,
      onYes: () => close(true),
      onNo: () => close(false),
    },
  };
}