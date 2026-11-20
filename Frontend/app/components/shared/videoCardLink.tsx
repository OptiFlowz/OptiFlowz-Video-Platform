import type { ComponentProps } from "react";
import { Link } from "react-router";

export function VideoCardLink({ locked, children, ...props }: ComponentProps<typeof Link> & { locked: boolean }) {
  if (locked) return <div className={props.className}>{children}</div>;
  return <Link {...props}>{children}</Link>;
}
