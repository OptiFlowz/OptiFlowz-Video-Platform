import { useEffect, useRef, useState, type ReactNode } from 'react';
import './profileTabs.css';

export default function ProfileTabs({ children, className, label }: {
    children: ReactNode;
    className?: string;
    label: string;
}) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [overflow, setOverflow] = useState({ left: false, right: false });

    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const updateOverflow = () => {
            const bounds = scroller.getBoundingClientRect();
            const buttons = Array.from(scroller.children, child => child.getBoundingClientRect());
            const left = buttons.some(button => button.left < bounds.left - 1);
            const right = buttons.some(button => button.right > bounds.right + 1);
            setOverflow(previous => previous.left === left && previous.right === right
                ? previous : { left, right });
        };
        const observer = new ResizeObserver(updateOverflow);
        observer.observe(scroller);
        Array.from(scroller.children).forEach(button => observer.observe(button));
        scroller.addEventListener('scroll', updateOverflow, { passive: true });
        updateOverflow();
        return () => {
            observer.disconnect();
            scroller.removeEventListener('scroll', updateOverflow);
        };
    }, [children]);

    return <div className="profileTabsViewport" data-overflow-left={overflow.left} data-overflow-right={overflow.right}>
        <div ref={scrollerRef} className={`profileTabs ${className ?? ''}`} role="tablist" aria-label={label}>
            {children}
        </div>
    </div>;
}
