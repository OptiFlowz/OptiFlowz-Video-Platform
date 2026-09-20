import { useLayoutEffect } from "react";
import worldMap from "@svg-maps/world";

export type WorldMapCountry = { id: string; name: string; path: string };

export default function WorldMapSVG({
  transform,
  onReady,
  getFill,
  getFillOpacity,
  onCountryEnter,
  onCountryMove,
  onCountryLeave,
  isCountryInteractive,
  onCountryActivate,
}: {
  transform?: string;
  onReady?: () => void;
  getFill: (country: WorldMapCountry) => string;
  getFillOpacity: (country: WorldMapCountry) => number;
  onCountryEnter: (country: WorldMapCountry, event: React.MouseEvent<SVGPathElement>) => void;
  onCountryMove: (country: WorldMapCountry, event: React.MouseEvent<SVGPathElement>) => void;
  onCountryLeave: () => void;
  isCountryInteractive?: (country: WorldMapCountry) => boolean;
  onCountryActivate?: (country: WorldMapCountry) => void;
}) {
  useLayoutEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <svg viewBox={worldMap.viewBox} role="img" aria-label={worldMap.label}>
      <g transform={transform}>
        {(worldMap.locations as WorldMapCountry[]).map((country) => {
          const isInteractive = isCountryInteractive?.(country) ?? false;
          return (
            <path
              key={country.id}
              className={isInteractive ? "interactive" : undefined}
              data-country={country.id.toUpperCase()}
              d={country.path}
              fill={getFill(country)}
              fillOpacity={getFillOpacity(country)}
              role={isInteractive ? "button" : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              aria-label={isInteractive ? country.name : undefined}
              onKeyDown={isInteractive ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onCountryActivate?.(country);
              } : undefined}
              onMouseEnter={(event) => onCountryEnter(country, event)}
              onMouseMove={(event) => onCountryMove(country, event)}
              onMouseLeave={onCountryLeave}
            />
          );
        })}
      </g>
    </svg>
  );
}

