"use client";
import LiveStudio from '~/components/live/LiveStudio';
import { FramedPage } from '../../../page-shell';
export default function Page() { return <FramedPage guard="auth" access="liveStudio"><LiveStudio /></FramedPage>; }
