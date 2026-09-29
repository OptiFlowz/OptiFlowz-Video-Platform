import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Header from "./header";
import Sidebar from "./sidebar";
import { CloseSVG } from "~/constants";
import { useI18n } from "~/i18n";
import "./navigation.css";

let sidebarCollapsed = false;

export default function NavigationFrame({ children, drawerOnly = false }: {
    children: React.ReactNode;
    drawerOnly?: boolean;
}) {
    const { t } = useI18n();
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [mobile, setMobile] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const drawerTitleRef = useRef<HTMLElement>(null);
    const overlay = mobile || drawerOnly;
    const restoreScrollRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        setCollapsed(sidebarCollapsed);
        const media = window.matchMedia('(max-width: 1100px)');
        const update = () => { setMobile(media.matches); setDrawerOpen(false); };
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    useEffect(() => { setDrawerOpen(false); }, [pathname]);

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        if (!overlay || !dialog) return;
        return () => {
            dialog.close();
            restoreScrollRef.current?.();
            restoreScrollRef.current = null;
        };
    }, [overlay]);

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        if (!overlay || !dialog) return;
        let cancelled = false;

        if (drawerOpen) {
            if (!dialog.open) {
                dialog.dataset.visible = 'false';
                dialog.showModal();
                const previousOverflow = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                restoreScrollRef.current = () => { document.body.style.overflow = previousOverflow; };
                drawerTitleRef.current?.focus({ preventScroll: true });
                // Establish the closed styles AFTER entering the top layer, before transitioning.
                void getComputedStyle(dialog).transform;
                void getComputedStyle(dialog, '::backdrop').opacity;
            }
            // Reopening an exiting drawer reverses its transition without resetting its position.
            dialog.dataset.visible = 'true';
        } else if (dialog.open) {
            dialog.dataset.visible = 'false';
            // Flush the new styles so getAnimations includes the actual exit transitions.
            void getComputedStyle(dialog).transform;
            const transitions = dialog.getAnimations();
            void Promise.all(transitions.map(animation => animation.finished.catch(() => undefined))).then(() => {
                if (cancelled || dialog.dataset.visible === 'true') return;
                dialog.close();
                restoreScrollRef.current?.();
                restoreScrollRef.current = null;
            });
        }

        return () => { cancelled = true; };
    }, [drawerOpen, overlay]);

    const toggle = () => {
        if (overlay) setDrawerOpen(value => !value);
        else setCollapsed(value => { sidebarCollapsed = !value; return !value; });
    };

    return <div className={`appFrame${drawerOnly || collapsed ? ' appFrameCompact' : ''}`}>
        <Header onMenuToggle={toggle} menuExpanded={overlay ? drawerOpen : !collapsed} />
        {!overlay && <aside id="app-sidebar" className="appSidebar" inert={collapsed} aria-hidden={collapsed}><Sidebar /></aside>}
        <div className="appFrameContent">{children}</div>
        {overlay && <dialog id="app-sidebar" ref={dialogRef} className="appSidebarDialog" aria-label={t('menuAria')}
            onCancel={event => { event.preventDefault(); setDrawerOpen(false); }}
            onClick={event => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
            <div className="appSidebarDrawer">
                <div className="appSidebarDrawerHeader">
                    <strong ref={drawerTitleRef} tabIndex={-1}>{t('menuAria')}</strong>
                    <button type="button" className="appMenuToggle" aria-label={t('close')} onClick={() => setDrawerOpen(false)}>{CloseSVG}</button>
                </div>
                <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
        </dialog>}
    </div>;
}
