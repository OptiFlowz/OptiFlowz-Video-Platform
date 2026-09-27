"use client";
import MyLivestreams from '~/components/live/MyLivestreams';
import { FramedPage } from '../page-shell';
export default function Page() { return <FramedPage guard="auth" access="myLivestreams"><MyLivestreams /></FramedPage>; }
