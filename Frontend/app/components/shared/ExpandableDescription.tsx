import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDescription } from "~/functions";
import { useI18n } from "~/i18n";
import "./expandableDescription.css";

export default function ExpandableDescription({ text, fallback = "" }: {
    text?: string | null;
    fallback?: string;
}) {
    const { t } = useI18n();
    const id = useId();
    const [open, setOpen] = useState(false);
    const [sizes, setSizes] = useState({ full: 0, collapsed: 0, limit: 320 });
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const content = useMemo(() => formatDescription(text) || fallback, [text, fallback]);

    useLayoutEffect(() => {
        setOpen(false);
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }, [text]);

    useLayoutEffect(() => {
        const element = contentRef.current;
        if (!element) return;
        let disposed = false;
        const measure = () => {
            if (disposed) return;
            const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
            const full = element.scrollHeight;
            const collapsed = Math.min(full, Math.ceil(lineHeight * 2));
            const limit = Math.max(collapsed, Math.min(320, window.innerHeight * .4));
            setSizes(previous => previous.full === full && previous.collapsed === collapsed && previous.limit === limit
                ? previous : { full, collapsed, limit });
        };
        measure();
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        observer?.observe(element);
        window.addEventListener("resize", measure);
        void document.fonts?.ready.then(measure);
        document.fonts?.addEventListener("loadingdone", measure);
        return () => {
            disposed = true;
            observer?.disconnect();
            window.removeEventListener("resize", measure);
            document.fonts?.removeEventListener("loadingdone", measure);
        };
    }, [content]);

    const expandable = sizes.full > sizes.collapsed + 1;
    return <div className="expandableDescription" data-open={open} data-overflow={expandable}>
        <div id={id} ref={viewportRef} className="expandableDescriptionViewport"
            style={sizes.full ? { height: open ? Math.min(sizes.full, sizes.limit) : sizes.collapsed } : undefined}
            tabIndex={open && sizes.full > sizes.limit ? 0 : undefined}>
            <div ref={contentRef} className="expandableDescriptionContent">{content}</div>
        </div>
        {expandable && <button type="button" className="expandableDescriptionToggle" aria-expanded={open} aria-controls={id}
            onClick={() => {
                if (open && viewportRef.current) viewportRef.current.scrollTop = 0;
                setOpen(value => !value);
            }}>{t(open ? "readLess" : "readMore")}</button>}
    </div>;
}
