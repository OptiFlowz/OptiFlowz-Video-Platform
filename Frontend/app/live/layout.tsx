import { createPageMetadata } from '~/metadata';
export const metadata = createPageMetadata({ title: 'Live', path: '/live', noIndex: true });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
