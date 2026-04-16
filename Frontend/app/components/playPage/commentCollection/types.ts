import type { VideoCommentT, VideoT } from "~/types";

export type CommentTreeNode = VideoCommentT & {
  depth: number;
  replyTargetId: string | null;
  replyTargetAuthorName: string | null;
  children: CommentTreeNode[];
};

export type CommentsSectionProps = {
  videoId: VideoT["id"];
  variant?: "inline" | "drawer";
  onClose?: () => void;
};
