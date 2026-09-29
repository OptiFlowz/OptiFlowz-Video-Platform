import { useEffect, useRef, useState } from "react";
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

    useEffect(() => {
        setCollapsed(sidebarCollapsed);
        const media = window.matchMedia('(max-width: 1100px)');
        const update = () => { setMobile(media.matches); setDrawerOpen(false); };
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    useEffect(() => { setDrawerOpen(false); }, [pathname]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!drawerOpen || !dialog) return;
        dialog.showModal();
        drawerTitleRef.current?.focus({ preventScroll: true });
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            dialog.close();
            document.body.style.overflow = previousOverflow;
        };
    }, [drawerOpen]);

    const toggle = () => {
        if (overlay) setDrawerOpen(value => !value);
        else setCollapsed(value => { sidebarCollapsed = !value; return !value; });
    };

    return <div className={`appFrame${drawerOnly || collapsed ? ' appFrameCompact' : ''}`}>
        <Header onMenuToggle={toggle} menuExpanded={overlay ? drawerOpen : !collapsed} />
        {!overlay && <aside id="app-sidebar" className="appSidebar" inert={collapsed} aria-hidden={collapsed}><Sidebar /></aside>}
        <div className="appFrameContent">{children}</div>
        {overlay && <dialog id="app-sidebar" ref={dialogRef} className="appSidebarDialog" aria-label={t('menuAria')}
            onCancel={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)}
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
