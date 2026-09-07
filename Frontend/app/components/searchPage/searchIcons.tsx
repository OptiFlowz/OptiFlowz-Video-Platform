import { cloneElement } from "react";
import { ArrowForwardSVG, PeopleSVG, PlaylistSVG, PlaySVG, SearchSVG } from "~/constants";
import styles from "./searchPage.module.css";

const icons = {
  search: SearchSVG,
  video: PlaySVG,
  playlist: PlaylistSVG,
  people: PeopleSVG,
  arrow: ArrowForwardSVG,
};

export function SearchIcon({ name }: { name: keyof typeof icons }) {
  return cloneElement(icons[name], { className: styles.icon, "aria-hidden": true });
}
