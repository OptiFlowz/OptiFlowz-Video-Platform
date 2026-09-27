"use client";
import LivePage from '~/components/live/LiveList';
import { FramedPage } from '../page-shell';
export default function Page() { return <FramedPage guard="auth" access="live"><LivePage /></FramedPage>; }
