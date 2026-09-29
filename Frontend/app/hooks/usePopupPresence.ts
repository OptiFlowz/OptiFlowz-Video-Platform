import { useEffect, useState } from 'react';

// Keep the panel mounted until its exit transition finishes (200ms by default).
export function usePopupPresence(open: boolean, exitDuration = 200) {
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        let firstFrame = 0;
        let secondFrame = 0;
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        if (open) {
            setMounted(true);
            firstFrame = requestAnimationFrame(() => {
                secondFrame = requestAnimationFrame(() => setVisible(true));
            });
        } else {
            setVisible(false);
            const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : exitDuration;
            closeTimer = setTimeout(() => setMounted(false), duration);
        }
        return () => {
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
            clearTimeout(closeTimer);
        };
    }, [open, exitDuration]);

    return { mounted, visible };
}
