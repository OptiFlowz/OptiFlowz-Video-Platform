"use client";
import MyPostsPage from "~/components/posts/MyPostsPage";
import { FramedPage } from "../page-shell";
export default function Page() { return <FramedPage guard="auth" access="posts"><MyPostsPage /></FramedPage>; }
