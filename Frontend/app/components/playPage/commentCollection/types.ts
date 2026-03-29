import type { VideoCommentT, VideoT } from "~/types";

export type CommentTreeNode = VideoCommentT & {
  children: CommentTreeNode[];
};

export type CommentsSectionProps = {
  videoId: VideoT["id"];
  variant?: "inline" | "drawer";
  onClose?: () => void;
};
