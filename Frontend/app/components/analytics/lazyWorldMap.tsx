import { lazy, Suspense, type ComponentProps } from "react";
import type WorldMap from "./worldMap";
export type { WorldMapCountry } from "./worldMap";

const Map = lazy(() => import("./worldMap"));

export function WorldMapSVG(props: ComponentProps<typeof WorldMap>) {
  return <Suspense fallback={<svg viewBox="0 0 1010 666" aria-busy="true" aria-label="Loading map" />}>
    <Map {...props} />
  </Suspense>;
}
