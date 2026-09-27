import { createPageMetadata } from '~/metadata';
export const metadata = createPageMetadata({ title: 'My livestreams', path: '/my-livestreams', noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
