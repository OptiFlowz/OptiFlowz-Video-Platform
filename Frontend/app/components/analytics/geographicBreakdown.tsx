import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowSVG,
  CloseSVG,
  WorldMapSVG,
  type WorldMapCountry,
} from "~/constants";
import { useI18n } from "~/i18n";

export type GeographicCountry = {
  name: string;
  totalViews: number;
  cities: Record<string, number>;
};

export type GeographicBreakdown = Record<string, GeographicCountry>;

type MapView = { zoom: number; x: number; y: number };

type MapDrag = {
  x: number;
  y: number;
  originX: number;
  originY: number;
  countryCode: string | null;
};

type CountryPopupHandle = {
  open: (code: string, data: GeographicCountry) => void;
};

const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 3.5;
const COUNTRY_POPUP_DURATION = 200;

function getMapPoint(map: HTMLDivElement, clientX: number, clientY: number) {
  const rect = map.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function CountryFlag({ code }: { code: string }) {
  const normalizedCode = /^[A-Z]{2}$/i.test(code) ? code.toLowerCase() : "";
  return (
    <span
      className={`videoAnalyticsCountryFlag${normalizedCode ? ` fi fi-${normalizedCode}` : ""}`}
      aria-hidden="true"
    >
      {normalizedCode ? null : "?"}
    </span>
  );
}

function getGeographicLabel(value: string, unknownLabel: string) {
  return /^(other|unknown)$/i.test(value.trim()) ? unknownLabel : value;
}

const CountryPopup = forwardRef<CountryPopupHandle, {
  viewsLabel: string;
  citiesLabel: string;
  closeLabel: string;
  unknownLabel: string;
}>(function CountryPopup({ viewsLabel, citiesLabel, closeLabel, unknownLabel }, ref) {
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; data: GeographicCountry } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const close = useCallback(() => {
    setIsVisible(false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(
      () => setSelectedCountry(null),
      COUNTRY_POPUP_DURATION,
    );
  }, []);

  const open = useCallback((code: string, data: GeographicCountry) => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setSelectedCountry({ code, data });
    setIsVisible(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setIsVisible(true)));
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  useEffect(() => {
    if (!selectedCountry) return;
    const handleKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, selectedCountry]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  if (!selectedCountry) return null;

  const countryName = /^[A-Z]{2}$/i.test(selectedCountry.code)
    ? getGeographicLabel(selectedCountry.data.name, unknownLabel)
    : unknownLabel;

  return createPortal(
    <div
      className={`videoAnalyticsCityBackdrop${isVisible ? " visible" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={countryName}
      onMouseDown={close}
    >
      <section className="videoAnalyticsCityPopup" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <CountryFlag code={selectedCountry.code} />
          <div>
            <h2>{countryName}</h2>
            <p>{selectedCountry.data.totalViews} {viewsLabel}</p>
          </div>
          <button type="button" aria-label={closeLabel} onClick={close}>{CloseSVG}</button>
        </header>
        <div className="videoAnalyticsCityPopupBody">
          <p>{citiesLabel}</p>
          <div className="videoAnalyticsCityGrid">
            {Object.entries(selectedCountry.data.cities)
              .sort(([, a], [, b]) => b - a)
              .map(([city, views]) => (
                <article key={city}>
                  <strong>{getGeographicLabel(city, unknownLabel)}</strong>
                  <span>{views} {viewsLabel}</span>
                </article>
              ))}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
});

function GeographicBreakdownSection({
  breakdown,
  isLoading,
  isError,
  description,
}: {
  breakdown: GeographicBreakdown;
  isLoading: boolean;
  isError: boolean;
  description: string;
}) {
  const { t } = useI18n();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapViewRef = useRef<MapView>({ zoom: MIN_MAP_ZOOM, x: 0, y: 0 });
  const mapDragRef = useRef<MapDrag | null>(null);
  const mapTooltipRef = useRef<HTMLDivElement | null>(null);
  const mapTooltipNameRef = useRef<HTMLElement | null>(null);
  const mapTooltipViewsRef = useRef<HTMLSpanElement | null>(null);
  const mapDidDragRef = useRef(false);
  const mapPanFrameRef = useRef<number | null>(null);
  const pendingMapViewRef = useRef<MapView | null>(null);
  const countryPopupRef = useRef<CountryPopupHandle | null>(null);
  const [showAllCountries, setShowAllCountries] = useState(false);

  const geographicCountries = Object.entries(breakdown)
    .filter(([, country]) => country.totalViews > 0)
    .sort(([, a], [, b]) => b.totalViews - a.totalViews);
  const visibleGeographicCountries = showAllCountries
    ? geographicCountries
    : geographicCountries.slice(0, 16);
  const hasMoreGeographicCountries = geographicCountries.length > 16;
  const maxCountryViews = Math.max(
    1,
    ...geographicCountries
      .filter(([code]) => code.toUpperCase() !== "OTHER")
      .map(([, country]) => country.totalViews),
  );

  const applyMapView = useCallback((view: MapView) => {
    const svg = mapRef.current?.querySelector("svg");
    const mapLayer = svg?.querySelector("g");
    if (!svg || !mapLayer) return;

    const viewBox = svg.viewBox.baseVal;
    const screenScale = Math.min(
      svg.clientWidth / viewBox.width,
      svg.clientHeight / viewBox.height,
    );
    const x = screenScale > 0 ? view.x / screenScale : 0;
    const y = screenScale > 0 ? view.y / screenScale : 0;
    const centerX = viewBox.x + viewBox.width / 2;
    const centerY = viewBox.y + viewBox.height / 2;

    svg.style.removeProperty("transform");
    mapLayer.setAttribute(
      "transform",
      `translate(${x} ${y}) translate(${centerX} ${centerY}) scale(${view.zoom}) translate(${-centerX} ${-centerY})`,
    );
  }, []);

  const scheduleMapView = useCallback((view: MapView) => {
    mapViewRef.current = view;
    pendingMapViewRef.current = view;
    if (mapPanFrameRef.current != null) return;

    mapPanFrameRef.current = window.requestAnimationFrame(() => {
      const nextView = pendingMapViewRef.current;
      pendingMapViewRef.current = null;
      mapPanFrameRef.current = null;
      if (nextView) applyMapView(nextView);
    });
  }, [applyMapView]);

  useLayoutEffect(() => {
    if (isLoading || isError) return;
    applyMapView(mapViewRef.current);
  }, [applyMapView, isError, isLoading]);

  useEffect(() => () => {
    if (mapPanFrameRef.current != null) window.cancelAnimationFrame(mapPanFrameRef.current);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const focalPoint = getMapPoint(map, event.clientX, event.clientY);
      const center = { x: map.clientWidth / 2, y: map.clientHeight / 2 };
      const sensitivity = event.ctrlKey ? 0.008 : 0.0025;
      const current = mapViewRef.current;
      const nextZoom = Math.min(
        MAX_MAP_ZOOM,
        Math.max(MIN_MAP_ZOOM, current.zoom * Math.exp(-event.deltaY * sensitivity)),
      );
      if (nextZoom === current.zoom) return;

      const zoomRatio = nextZoom / current.zoom;
      scheduleMapView({
        zoom: nextZoom,
        x: focalPoint.x - center.x - zoomRatio * (focalPoint.x - current.x - center.x),
        y: focalPoint.y - center.y - zoomRatio * (focalPoint.y - current.y - center.y),
      });
    };

    const preventBrowserGesture = (event: Event) => event.preventDefault();

    map.addEventListener("wheel", handleWheel, { passive: false });
    map.addEventListener("gesturestart", preventBrowserGesture, { passive: false });
    map.addEventListener("gesturechange", preventBrowserGesture, { passive: false });
    map.addEventListener("gestureend", preventBrowserGesture, { passive: false });

    return () => {
      map.removeEventListener("wheel", handleWheel);
      map.removeEventListener("gesturestart", preventBrowserGesture);
      map.removeEventListener("gesturechange", preventBrowserGesture);
      map.removeEventListener("gestureend", preventBrowserGesture);
    };
  }, [isError, isLoading, scheduleMapView]);

  const updateMapTooltip = (country: WorldMapCountry, event: React.MouseEvent<SVGPathElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    const tooltip = mapTooltipRef.current;
    if (!rect || !tooltip) return;
    const data = breakdown[country.id.toUpperCase()];
    if (mapTooltipNameRef.current) mapTooltipNameRef.current.textContent = data?.name || country.name;
    if (mapTooltipViewsRef.current) {
      mapTooltipViewsRef.current.textContent = `${data?.totalViews || 0} ${t("videoAnalyticsViews")}`;
    }
    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
    tooltip.dataset.visible = "true";
  };

  const moveMapTooltip = (_country: WorldMapCountry, event: React.MouseEvent<SVGPathElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    const tooltip = mapTooltipRef.current;
    if (!rect || !tooltip) return;

    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
  };

  const hideMapTooltip = () => mapTooltipRef.current?.removeAttribute("data-visible");
  const openCountryPopup = (code: string, data: GeographicCountry) => countryPopupRef.current?.open(code, data);

  return (
    <>
      <section className="videoAnalyticsGeographic">
        <h2>{t("videoAnalyticsGeographicBreakdown")}</h2>
        <p className="videoAnalyticsSectionDescription">{description}</p>

        {isLoading ? (
          <div className="videoAnalyticsMap loading" />
        ) : isError ? (
          <p className="videoAnalyticsOverviewError">{t("videoAnalyticsGeographicFailed")}</p>
        ) : (
          <>
            <div
              ref={mapRef}
              className="videoAnalyticsMap"
              onPointerDown={(event) => {
                const point = getMapPoint(event.currentTarget, event.clientX, event.clientY);
                mapDidDragRef.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.classList.add("dragging");
                const target = event.target instanceof Element ? event.target : null;
                const countryCode = target?.closest("path.interactive")?.getAttribute("data-country") ?? null;
                mapDragRef.current = {
                  x: point.x,
                  y: point.y,
                  originX: mapViewRef.current.x,
                  originY: mapViewRef.current.y,
                  countryCode,
                };
              }}
              onPointerMove={(event) => {
                const mapDrag = mapDragRef.current;
                if (!mapDrag) return;
                const point = getMapPoint(event.currentTarget, event.clientX, event.clientY);
                if (Math.hypot(point.x - mapDrag.x, point.y - mapDrag.y) > 3) {
                  mapDidDragRef.current = true;
                  hideMapTooltip();
                }

                scheduleMapView({
                  zoom: mapViewRef.current.zoom,
                  x: mapDrag.originX + point.x - mapDrag.x,
                  y: mapDrag.originY + point.y - mapDrag.y,
                });
              }}
              onPointerUp={(event) => {
                const countryCode = mapDidDragRef.current ? null : mapDragRef.current?.countryCode;
                mapDragRef.current = null;
                event.currentTarget.classList.remove("dragging");
                if (!countryCode) return;
                const countryData = breakdown[countryCode];
                if (!countryData || countryData.totalViews <= 0) return;
                openCountryPopup(countryCode, countryData);
              }}
              onPointerCancel={(event) => {
                mapDragRef.current = null;
                event.currentTarget.classList.remove("dragging");
              }}
            >
              <WorldMapSVG
                getFill={(country) => (
                  (breakdown[country.id.toUpperCase()]?.totalViews ?? 0) > 0
                    ? "var(--accentBlue2)"
                    : "var(--background3)"
                )}
                getFillOpacity={(country) => {
                  const views = breakdown[country.id.toUpperCase()]?.totalViews || 0;
                  return views ? 0.25 + 0.75 * (views / maxCountryViews) : 1;
                }}
                onCountryEnter={updateMapTooltip}
                onCountryMove={moveMapTooltip}
                onCountryLeave={hideMapTooltip}
                isCountryInteractive={(country) => (
                  (breakdown[country.id.toUpperCase()]?.totalViews ?? 0) > 0
                )}
                onCountryActivate={(country) => {
                  const code = country.id.toUpperCase();
                  const countryData = breakdown[code];
                  if (!countryData || countryData.totalViews <= 0) return;
                  openCountryPopup(code, countryData);
                }}
              />
              <div ref={mapTooltipRef} className="videoAnalyticsMapTooltip" aria-hidden="true">
                <strong ref={mapTooltipNameRef} />
                <span ref={mapTooltipViewsRef} />
              </div>
              <div className="videoAnalyticsMapControls" onPointerDown={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => scheduleMapView({
                    ...mapViewRef.current,
                    zoom: Math.min(MAX_MAP_ZOOM, mapViewRef.current.zoom + 0.35),
                  })}
                >+</button>
                <button
                  type="button"
                  onClick={() => scheduleMapView({ zoom: MIN_MAP_ZOOM, x: 0, y: 0 })}
                >↺</button>
                <button
                  type="button"
                  onClick={() => scheduleMapView({
                    ...mapViewRef.current,
                    zoom: Math.max(MIN_MAP_ZOOM, mapViewRef.current.zoom - 0.35),
                  })}
                >−</button>
              </div>
            </div>

            <div className="videoAnalyticsCountryGrid">
              {visibleGeographicCountries.map(([code, country]) => (
                <button
                  type="button"
                  key={code}
                  aria-label={`${/^[A-Z]{2}$/i.test(code) ? getGeographicLabel(country.name, t("videoAnalyticsUnknown")) : t("videoAnalyticsUnknown")}: ${country.totalViews} ${t("videoAnalyticsViews")}`}
                  onClick={() => openCountryPopup(code, country)}
                >
                  <CountryFlag code={code} />
                  <strong>{country.totalViews} {t("videoAnalyticsViews")}</strong>
                  <b>{ArrowSVG}</b>
                </button>
              ))}
            </div>
            {hasMoreGeographicCountries ? (
              <button
                type="button"
                className="videoAnalyticsCountriesToggle"
                aria-expanded={showAllCountries}
                onClick={() => setShowAllCountries((current) => !current)}
              >
                {t(showAllCountries ? "readLess" : "readMore")}
              </button>
            ) : null}
          </>
        )}
      </section>

      <CountryPopup
        ref={countryPopupRef}
        viewsLabel={t("videoAnalyticsViews")}
        citiesLabel={t("videoAnalyticsCities")}
        closeLabel={t("close")}
        unknownLabel={t("videoAnalyticsUnknown")}
      />
    </>
  );
}

export default GeographicBreakdownSection;
