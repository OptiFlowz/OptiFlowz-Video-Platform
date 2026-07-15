import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { fetchFn } from "~/API";
import { ArrowSVG, CloseSVG, FilterSVG, WorldMapSVG, type WorldMapCountry } from "~/constants";
import { formatDate, formatDuration, formatViews, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { VideoT } from "~/types";
import Sidebar from "~/components/myVideosPage/sidebar/sidebar";

type AnalyticsRange = "last7" | "last30" | "last90" | "last365" | "all";
type AnalyticsGroupBy = "day" | "week" | "month";
type TimeSeriesMetric = "watchTime" | "views";

type VideoOverviewResponse = {
  success: boolean;
  overview: {
    totalViews: number;
    firstTimeViews: number;
    totalWatchTime: number;
    totalLikes: number;
    totalDislikes: number;
    totalComments: number;
    avgWatchTimePerViewer: number;
  };
};

type EngagementResponse = {
  success: boolean;
  engagement: number;
};

type DeviceSplitResponse = {
  success: boolean;
  deviceSplit: {
    totalViews: number;
    desktop: number;
    phone: number;
    tablet: number;
    other: number;
  };
};

type OperatingSystemSplitResponse = {
  success: boolean;
  operatingSystemSplit: {
    totalViews: number;
    windows: number;
    macOS: number;
    android: number;
    iOS: number;
    linux: number;
    other: number;
  };
};

type GeographicCountry = {
  name: string;
  totalViews: number;
  cities: Record<string, number>;
};

type GeographicBreakdownResponse = {
  success: boolean;
  geographicBreakdown: Record<string, GeographicCountry>;
};

type ViewsOverTimeResponse = {
  success: boolean;
  viewsOverTime: Array<{
    periodStart: string;
    views: number;
  }>;
};

type WatchTimeOverTimeResponse = {
  success: boolean;
  watchTimeOverTime: Array<{
    periodStart: string;
    watchTime: number;
  }>;
};

type CompletionBucketsResponse = {
  success: boolean;
  completionBuckets: {
    "<25%": number;
    "25-50%": number;
    "50-75%": number;
    "75-95%": number;
    ">95%": number;
  };
};

type TimeSeriesPoint = {
  periodStart: string;
  watchTime?: number;
  views?: number;
};

type CompletionBucketPoint = {
  bucket: string;
  viewers: number;
};

type DonutItem = {
  label: string;
  value: number;
  color: string;
};

const WORLD_MAP_CENTER = { x: 505, y: 333 };
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 3.5;
const COUNTRY_POPUP_DURATION = 200;

function getMapPoint(map: HTMLDivElement, clientX: number, clientY: number) {
  const svg = map.querySelector("svg");
  const screenMatrix = svg?.getScreenCTM();
  if (!svg || !screenMatrix) return null;

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(screenMatrix.inverse());
}

function DonutChart({ items, total, viewsLabel }: { items: DonutItem[]; total: number; viewsLabel: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartItems = items.filter((item) => item.value > 0);
  const data = chartItems.length
    ? chartItems
    : [{ label: "No data", value: 1, color: "var(--background3)" }];
  const activeItem = activeIndex === null || !chartItems.length
    ? null
    : chartItems[activeIndex];
  const activePercentage = activeItem && total > 0
    ? Math.round((activeItem.value / total) * 100)
    : 0;

  return (
    <div className="videoAnalyticsDonutLayout">
      <div className="videoAnalyticsDonut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="92%"
              paddingAngle={chartItems.length > 1 ? 1.5 : 0}
              cornerRadius={chartItems.length > 1 ? 3 : 0}
              stroke="var(--background2)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={500}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((item, index) => (
                <Cell
                  className="videoAnalyticsDonutSegment"
                  fill={item.color}
                  key={item.label}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="videoAnalyticsDonutCenter">
          {activeItem ? (
            <>
              <small>{activeItem.label}</small>
              <strong>{activeItem.value}</strong>
              <span>{activePercentage}% · {viewsLabel}</span>
            </>
          ) : (
            <>
              <strong>{total}</strong>
              <span>{viewsLabel}</span>
            </>
          )}
        </div>
      </div>

      <div className="videoAnalyticsLegend">
        {items.map((item) => {
          const percentage = total > 0 ? Math.round((item.value / total) * 100) : 0;
          return (
            <div className="videoAnalyticsLegendItem" key={item.label}>
              <i style={{ backgroundColor: item.color }} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.value} · {percentage}%</small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatWatchTime(totalSeconds: number, alwaysShowHours = false) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0 || alwaysShowHours) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function useAnimatedPercentage(targetValue: number, resetKey: string, duration = 900) {
  const safeTarget = Math.min(100, Math.max(0, Number.isFinite(targetValue) ? targetValue : 0));
  const [animatedValue, setAnimatedValue] = useState(0);
  const currentValueRef = useRef(0);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      currentValueRef.current = 0;
      setAnimatedValue(0);
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      currentValueRef.current = safeTarget;
      setAnimatedValue(safeTarget);
      return;
    }

    const startValue = currentValueRef.current;
    const difference = safeTarget - startValue;
    const startTime = performance.now();
    let animationFrame = 0;

    const animate = (currentTime: number) => {
      const progress = Math.min(1, (currentTime - startTime) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = startValue + difference * easedProgress;
      currentValueRef.current = nextValue;
      setAnimatedValue(nextValue);

      if (progress < 1) animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [duration, resetKey, safeTarget]);

  return animatedValue;
}

function EngagementMeter({
  percentage,
  resetKey,
  label,
}: {
  percentage: number;
  resetKey: string;
  label: string;
}) {
  const animatedPercentage = useAnimatedPercentage(percentage, resetKey);
  const labelPosition = Math.min(97, Math.max(3, animatedPercentage));

  return (
    <div className="videoAnalyticsEngagementMeter">
      <div className="videoAnalyticsEngagementValueRow">
        <strong style={{ left: `${labelPosition}%` }}>
          {Math.round(animatedPercentage)}%
        </strong>
      </div>
      <div
        className="videoAnalyticsEngagementTrack"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentage)}
      >
        <i style={{ transform: `scaleX(${animatedPercentage / 100})` }} />
      </div>
    </div>
  );
}

function getDateRange(range: AnalyticsRange) {
  if (range === "all") return "";

  const days = Number(range.replace("last", ""));
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - days);
  fromDate.setUTCHours(0, 0, 0, 0);
  toDate.setUTCHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    fromDate: fromDate.toISOString(),
    toDate: toDate.toISOString(),
  });

  return `?${params.toString()}`;
}

function getGroupedDateRange(range: AnalyticsRange, groupBy: AnalyticsGroupBy) {
  const params = new URLSearchParams(getDateRange(range).replace(/^\?/, ""));
  params.set("groupBy", groupBy);
  return `?${params.toString()}`;
}

function formatPeriodLabel(periodStart: string, groupBy: AnalyticsGroupBy, locale: string, detailed = false) {
  const date = new Date(periodStart);
  if (Number.isNaN(date.getTime())) return periodStart;

  if (detailed) {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  return new Intl.DateTimeFormat(locale, groupBy === "month"
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function TimeSeriesTooltip({
  active,
  payload,
  label,
  groupBy,
  locale,
  viewsLabel,
  watchTimeLabel,
}: TooltipContentProps & {
  groupBy: AnalyticsGroupBy;
  locale: string;
  viewsLabel: string;
  watchTimeLabel: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="videoAnalyticsLineTooltip">
      <span className="videoAnalyticsLineTooltipDate">
        {formatPeriodLabel(String(label ?? ""), groupBy, locale, true)}
      </span>
      {payload.map((entry) => {
        const metric: TimeSeriesMetric = String(entry.dataKey) === "watchTime" ? "watchTime" : "views";
        const value = Number(entry.value ?? 0);
        return (
          <div className={`videoAnalyticsLineTooltipValue ${metric}`} key={metric}>
            <i aria-hidden="true" />
            <span>{metric === "watchTime" ? watchTimeLabel : viewsLabel}</span>
            <strong>{metric === "watchTime" ? formatWatchTime(value, true) : value.toLocaleString(locale)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function CompletionBucketsTooltip({
  active,
  payload,
  label,
  locale,
  viewersLabel,
}: TooltipContentProps & {
  locale: string;
  viewersLabel: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="videoAnalyticsLineTooltip">
      <span className="videoAnalyticsLineTooltipDate">{String(label ?? "")}</span>
      <div className="videoAnalyticsLineTooltipValue completionBuckets">
        <i aria-hidden="true" />
        <span>{viewersLabel}</span>
        <strong>{Number(payload[0]?.value ?? 0).toLocaleString(locale)}</strong>
      </div>
    </div>
  );
}

function CountryFlag({ code }: { code: string }) {
  const normalizedCode = /^[A-Z]{2}$/i.test(code) ? code.toLowerCase() : "";
  return (
    <span
      className={`videoAnalyticsCountryFlag${normalizedCode ? ` fi fi-${normalizedCode}` : ""}`}
      aria-hidden="true"
    />
  );
}

function VideoAnalyticsPage() {
  const { locale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("video");
  const headers = useRef(new Headers());
  const [token, setToken] = useState("");
  const [range, setRange] = useState<AnalyticsRange>("last7");
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("day");
  const [activeTimeSeries, setActiveTimeSeries] = useState<Record<TimeSeriesMetric, boolean>>({
    watchTime: true,
    views: true,
  });
  const [isCompletionBucketsActive, setIsCompletionBucketsActive] = useState(true);
  const [mapView, setMapView] = useState({ zoom: MIN_MAP_ZOOM, x: 0, y: 0 });
  const [mapDrag, setMapDrag] = useState<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    countryCode: string | null;
  } | null>(null);
  const [mapTooltip, setMapTooltip] = useState<{ name: string; views: number; x: number; y: number } | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; data: GeographicCountry } | null>(null);
  const [isCountryPopupVisible, setIsCountryPopupVisible] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapDidDragRef = useRef(false);
  const countryPopupTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;

    headers.current.set("Content-Type", "application/json");
    headers.current.set("Authorization", `Bearer ${userToken}`);
    setToken(userToken);
  }, []);

  useEffect(() => () => {
    if (countryPopupTimerRef.current) window.clearTimeout(countryPopupTimerRef.current);
  }, []);

  const { data: video, isLoading, isError } = useQuery<VideoT | null>({
    queryKey: ["video-analytics", videoId],
    queryFn: () =>
      fetchFn<VideoT>({
        route: `api/videos/${videoId}`,
        options: { method: "GET", headers: headers.current },
      }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });

  const dateRangeQuery = useMemo(() => getDateRange(range), [range]);
  const {
    data: overviewData,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
  } = useQuery<VideoOverviewResponse>({
    queryKey: ["video-analytics-overview", videoId, range],
    queryFn: () =>
      fetchFn<VideoOverviewResponse>({
        route: `api/analytics/${videoId}/overview${dateRangeQuery}`,
        options: { method: "GET", headers: headers.current },
      }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });

  const {
    data: engagementData,
    isLoading: isEngagementLoading,
    isError: isEngagementError,
  } = useQuery<EngagementResponse>({
    queryKey: ["video-analytics-engagement", videoId, range],
    queryFn: () => fetchFn<EngagementResponse>({
      route: `api/analytics/${videoId}/engagement`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });
  const engagementPercentage = Math.min(100, Math.max(0, (engagementData?.engagement ?? 0) * 100));

  const overview = overviewData?.overview;
  const overviewCards = overview
    ? [
        { label: t("videoAnalyticsTotalViews"), value: overview.totalViews, description: t("videoAnalyticsTotalViewsHelp") },
        { label: t("videoAnalyticsFirstTimeViews"), value: overview.firstTimeViews, description: t("videoAnalyticsFirstTimeViewsHelp") },
        { label: t("videoAnalyticsWatchTime"), value: formatWatchTime(overview.totalWatchTime, true), description: t("videoAnalyticsWatchTimeHelp") },
        { label: t("videoAnalyticsTotalLikes"), value: overview.totalLikes, description: t("videoAnalyticsTotalLikesHelp") },
        { label: t("videoAnalyticsTotalDislikes"), value: overview.totalDislikes, description: t("videoAnalyticsTotalDislikesHelp") },
        { label: t("videoAnalyticsAverageWatchTime"), value: formatWatchTime(overview.avgWatchTimePerViewer), description: t("videoAnalyticsAverageWatchTimeHelp") },
        { label: t("videoAnalyticsTotalComments"), value: overview.totalComments, description: t("videoAnalyticsTotalCommentsHelp") },
      ]
    : [];

  const groupedDateRangeQuery = useMemo(
    () => getGroupedDateRange(range, groupBy),
    [groupBy, range],
  );
  const {
    data: viewsOverTimeData,
    isLoading: isViewsOverTimeLoading,
    isError: isViewsOverTimeError,
  } = useQuery<ViewsOverTimeResponse>({
    queryKey: ["video-analytics-views-over-time", videoId, range, groupBy],
    queryFn: () => fetchFn<ViewsOverTimeResponse>({
      route: `api/analytics/${videoId}/views-over-time${groupedDateRangeQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });
  const {
    data: watchTimeOverTimeData,
    isLoading: isWatchTimeOverTimeLoading,
    isError: isWatchTimeOverTimeError,
  } = useQuery<WatchTimeOverTimeResponse>({
    queryKey: ["video-analytics-watch-time-over-time", videoId, range, groupBy],
    queryFn: () => fetchFn<WatchTimeOverTimeResponse>({
      route: `api/analytics/${videoId}/watch-time-over-time${groupedDateRangeQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });
  const {
    data: completionBucketsData,
    isLoading: isCompletionBucketsLoading,
    isError: isCompletionBucketsError,
  } = useQuery<CompletionBucketsResponse>({
    queryKey: ["video-analytics-completion-buckets", videoId],
    queryFn: () => fetchFn<CompletionBucketsResponse>({
      route: `api/analytics/${videoId}/completion-buckets`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });
  const completionBuckets = completionBucketsData?.completionBuckets;
  const completionBucketChartData: CompletionBucketPoint[] = completionBuckets
    ? [
        { bucket: "<25%", viewers: completionBuckets["<25%"] },
        { bucket: "25–50%", viewers: completionBuckets["25-50%"] },
        { bucket: "50–75%", viewers: completionBuckets["50-75%"] },
        { bucket: "75–95%", viewers: completionBuckets["75-95%"] },
        { bucket: ">95%", viewers: completionBuckets[">95%"] },
      ]
    : [];
  const completionBucketMax = Math.max(
    1,
    ...completionBucketChartData.map((point) => point.viewers),
  );
  const completionBucketTickStep = completionBucketMax <= 5
    ? 1
    : Math.ceil(completionBucketMax / 4);
  const completionBucketAxisMax = Math.ceil(
    completionBucketMax / completionBucketTickStep,
  ) * completionBucketTickStep;
  const completionBucketTicks = Array.from(
    { length: completionBucketAxisMax / completionBucketTickStep + 1 },
    (_, index) => index * completionBucketTickStep,
  );
  const timeSeriesData = useMemo(() => {
    const points = new Map<string, TimeSeriesPoint>();

    if (activeTimeSeries.watchTime) {
      for (const point of watchTimeOverTimeData?.watchTimeOverTime ?? []) {
        points.set(point.periodStart, {
          ...points.get(point.periodStart),
          periodStart: point.periodStart,
          watchTime: point.watchTime,
        });
      }
    }

    if (activeTimeSeries.views) {
      for (const point of viewsOverTimeData?.viewsOverTime ?? []) {
        points.set(point.periodStart, {
          ...points.get(point.periodStart),
          periodStart: point.periodStart,
          views: point.views,
        });
      }
    }

    return Array.from(points.values()).sort(
      (a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime(),
    );
  }, [activeTimeSeries, viewsOverTimeData, watchTimeOverTimeData]);
  const hasActiveTimeSeries = activeTimeSeries.watchTime || activeTimeSeries.views;
  const isTimeSeriesLoading = hasActiveTimeSeries && (
    (activeTimeSeries.watchTime && isWatchTimeOverTimeLoading)
    || (activeTimeSeries.views && isViewsOverTimeLoading)
  );
  const isTimeSeriesError = hasActiveTimeSeries && (
    (activeTimeSeries.watchTime && isWatchTimeOverTimeError)
    || (activeTimeSeries.views && isViewsOverTimeError)
  );

  const {
    data: audienceData,
    isLoading: isAudienceLoading,
    isError: isAudienceError,
  } = useQuery({
    queryKey: ["video-analytics-audience", videoId, range],
    queryFn: async () => {
      const [device, operatingSystem] = await Promise.all([
        fetchFn<DeviceSplitResponse>({
          route: `api/analytics/${videoId}/device-split${dateRangeQuery}`,
          options: { method: "GET", headers: headers.current },
        }),
        fetchFn<OperatingSystemSplitResponse>({
          route: `api/analytics/${videoId}/operating-system-split${dateRangeQuery}`,
          options: { method: "GET", headers: headers.current },
        }),
      ]);

      return { device, operatingSystem };
    },
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });

  const deviceSplit = audienceData?.device.deviceSplit;
  const operatingSystemSplit = audienceData?.operatingSystem.operatingSystemSplit;
  const chartColors = [
    "var(--analyticsChart1)",
    "var(--analyticsChart2)",
    "var(--analyticsChart3)",
    "var(--analyticsChart4)",
    "var(--analyticsChart5)",
    "var(--analyticsChart6)",
  ];
  const deviceItems: DonutItem[] = deviceSplit
    ? [
        { label: t("videoAnalyticsDesktop"), value: deviceSplit.desktop, color: chartColors[0] },
        { label: t("videoAnalyticsPhone"), value: deviceSplit.phone, color: chartColors[1] },
        { label: t("videoAnalyticsTablet"), value: deviceSplit.tablet, color: chartColors[2] },
        { label: t("videoAnalyticsOther"), value: deviceSplit.other, color: chartColors[3] },
      ]
    : [];
  const operatingSystemItems: DonutItem[] = operatingSystemSplit
    ? [
        { label: "Windows", value: operatingSystemSplit.windows, color: chartColors[0] },
        { label: "macOS", value: operatingSystemSplit.macOS, color: chartColors[1] },
        { label: "Android", value: operatingSystemSplit.android, color: chartColors[2] },
        { label: "iOS", value: operatingSystemSplit.iOS, color: chartColors[3] },
        { label: "Linux", value: operatingSystemSplit.linux, color: chartColors[4] },
        { label: t("videoAnalyticsOther"), value: operatingSystemSplit.other, color: chartColors[5] },
      ]
    : [];

  const {
    data: geographicData,
    isLoading: isGeographicLoading,
    isError: isGeographicError,
  } = useQuery<GeographicBreakdownResponse>({
    queryKey: ["video-analytics-geographic", videoId, range],
    queryFn: () => fetchFn<GeographicBreakdownResponse>({
      route: `api/analytics/${videoId}/geographic-breakdown${dateRangeQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token && !!videoId,
    refetchOnWindowFocus: false,
  });
  const geographicBreakdown = geographicData?.geographicBreakdown ?? {};
  const geographicCountries = Object.entries(geographicBreakdown)
    .filter(([, country]) => country.totalViews > 0)
    .sort(([, a], [, b]) => b.totalViews - a.totalViews);
  const maxCountryViews = Math.max(1, ...geographicCountries.map(([, country]) => country.totalViews));

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const focalPoint = getMapPoint(map, event.clientX, event.clientY) ?? WORLD_MAP_CENTER;
      const sensitivity = event.ctrlKey ? 0.008 : 0.0025;

      setMapView((current) => {
        const nextZoom = Math.min(
          MAX_MAP_ZOOM,
          Math.max(MIN_MAP_ZOOM, current.zoom * Math.exp(-event.deltaY * sensitivity)),
        );
        if (nextZoom === current.zoom) return current;

        const zoomRatio = nextZoom / current.zoom;
        return {
          zoom: nextZoom,
          x: focalPoint.x - WORLD_MAP_CENTER.x - zoomRatio * (focalPoint.x - current.x - WORLD_MAP_CENTER.x),
          y: focalPoint.y - WORLD_MAP_CENTER.y - zoomRatio * (focalPoint.y - current.y - WORLD_MAP_CENTER.y),
        };
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
  }, [isGeographicLoading, isGeographicError]);

  const updateMapTooltip = (country: WorldMapCountry, event: React.MouseEvent<SVGPathElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const data = geographicBreakdown[country.id.toUpperCase()];
    setMapTooltip({
      name: data?.name || country.name,
      views: data?.totalViews || 0,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const openCountryPopup = (code: string, data: GeographicCountry) => {
    if (countryPopupTimerRef.current) window.clearTimeout(countryPopupTimerRef.current);
    setSelectedCountry({ code, data });
    setIsCountryPopupVisible(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setIsCountryPopupVisible(true)));
  };

  const closeCountryPopup = () => {
    setIsCountryPopupVisible(false);
    if (countryPopupTimerRef.current) window.clearTimeout(countryPopupTimerRef.current);
    countryPopupTimerRef.current = window.setTimeout(
      () => setSelectedCountry(null),
      COUNTRY_POPUP_DURATION,
    );
  };

  useEffect(() => {
    if (!selectedCountry) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && closeCountryPopup();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedCountry]);

  return (
    <main className="myVideos videoAnalyticsPage">
      <Sidebar />

      <div className="content libraryContent">
        <div className="holder libraryShell videoAnalyticsShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("videoAnalyticsTitle")}</h1>
              <p>{t("videoAnalyticsDescription")}</p>
            </div>
          </div>

          {!videoId ? (
            <p className="videoAnalyticsMessage">{t("videoAnalyticsMissingVideo")}</p>
          ) : isLoading ? (
            <div className="videoAnalyticsCard videoAnalyticsCardLoading" aria-label={t("videoAnalyticsLoading")} />
          ) : isError || !video ? (
            <p className="videoAnalyticsMessage">{t("videoAnalyticsLoadFailed")}</p>
          ) : (
            <section className="videoAnalyticsCard">
              <div className="videoAnalyticsThumbnail">
                <img src={video.thumbnail_url} alt={video.title} />
                <span>{formatDuration(video.duration_seconds)}</span>
              </div>

              <div className="videoAnalyticsInfo">
                <h2>{video.title}</h2>
                <p>{video.uploader_name}</p>
                <div className="videoAnalyticsMeta">
                  <span>{formatViews(video.view_count)}</span>
                  <span>{formatDate(video.published_at || video.created_at)}</span>
                </div>
              </div>
            </section>
          )}

          <div className="videoAnalyticsFilters" aria-label={t("videoAnalyticsFilters")}>
            <label className="videoAnalyticsSelect">
              {FilterSVG}
              <select
                value={range}
                onChange={(event) => setRange(event.target.value as AnalyticsRange)}
                aria-label={t("analyticsRange")}
              >
                <option value="last7">{t("analyticsLast7Days")}</option>
                <option value="last30">{t("analyticsLast30Days")}</option>
                <option value="last90">{t("analyticsLast90Days")}</option>
                <option value="last365">{t("analyticsLast365Days")}</option>
                <option value="all">{t("analyticsAllTime")}</option>
              </select>
            </label>
            <label className="videoAnalyticsSelect">
              {FilterSVG}
              <select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as AnalyticsGroupBy)}
                aria-label={t("analyticsGroupBy")}
              >
                <option value="day">{t("analyticsDay")}</option>
                <option value="week">{t("analyticsWeek")}</option>
                <option value="month">{t("analyticsMonth")}</option>
              </select>
            </label>
          </div>

          <section className="videoAnalyticsOverview">
            <h2>{t("videoAnalyticsOverview")}</h2>

            {isOverviewLoading ? (
              <div className="videoAnalyticsOverviewGrid" aria-label={t("videoAnalyticsOverviewLoading")}>
                {Array.from({ length: 7 }, (_, index) => (
                  <div className="videoAnalyticsOverviewCard loading" key={index} />
                ))}
              </div>
            ) : isOverviewError || !overview ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsOverviewFailed")}</p>
            ) : (
              <div className="videoAnalyticsOverviewGrid">
                {overviewCards.map((card) => (
                  <article className="videoAnalyticsOverviewCard" key={card.label}>
                    <h3>{card.label}</h3>
                    <strong>{card.value}</strong>
                    <p>{card.description}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="videoAnalyticsEngagement">
            <h2>{t("videoAnalyticsEngagement")}</h2>

            {isEngagementLoading ? (
              <div className="videoAnalyticsEngagementLoading loading" aria-label={t("videoAnalyticsEngagementLoading")} />
            ) : isEngagementError || !engagementData ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsEngagementFailed")}</p>
            ) : (
              <EngagementMeter
                percentage={engagementPercentage}
                resetKey={range}
                label={t("videoAnalyticsEngagement")}
              />
            )}
          </section>

          <section className="videoAnalyticsGraphs">
            <h2>{t("videoAnalyticsAudienceGraphs")}</h2>

            <div className="videoAnalyticsGraphTabs" aria-label={t("videoAnalyticsAudienceGraphs")}>
              <button
                className="watchTime"
                type="button"
                aria-pressed={activeTimeSeries.watchTime}
                onClick={() => setActiveTimeSeries((current) => ({
                  ...current,
                  watchTime: !current.watchTime,
                }))}
              >
                <i aria-hidden="true" />
                {t("videoAnalyticsWatchTimeOverTime")}
              </button>
              <button
                className="views"
                type="button"
                aria-pressed={activeTimeSeries.views}
                onClick={() => setActiveTimeSeries((current) => ({
                  ...current,
                  views: !current.views,
                }))}
              >
                <i aria-hidden="true" />
                {t("videoAnalyticsViewsOverTime")}
              </button>
            </div>

            {isTimeSeriesLoading ? (
              <div className="videoAnalyticsLineChart loading" aria-label={t("videoAnalyticsGraphsLoading")} />
            ) : isTimeSeriesError ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsGraphsFailed")}</p>
            ) : !hasActiveTimeSeries ? (
              null
            ) : !timeSeriesData.length ? (
              <p className="videoAnalyticsGraphEmpty">{t("videoAnalyticsGraphsEmpty")}</p>
            ) : (
              <div className="videoAnalyticsLineChart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeSeriesData} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
                    <CartesianGrid
                      yAxisId={activeTimeSeries.watchTime ? "watchTime" : "views"}
                      stroke="var(--border1)"
                      strokeDasharray="4 4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="periodStart"
                      tickFormatter={(value) => formatPeriodLabel(String(value), groupBy, locale)}
                      tick={{ fill: "var(--text2)", fontSize: 13 }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border1)" }}
                      minTickGap={28}
                    />
                    {activeTimeSeries.watchTime && (
                      <YAxis
                        yAxisId="watchTime"
                        width={72}
                        tickFormatter={(value) => formatWatchTime(Number(value))}
                        tick={{ fill: "var(--text2)", fontSize: 13 }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                    )}
                    {activeTimeSeries.views && (
                      <YAxis
                        yAxisId="views"
                        orientation={activeTimeSeries.watchTime ? "right" : "left"}
                        width={48}
                        tickFormatter={(value) => Number(value).toLocaleString(locale)}
                        tick={{ fill: "var(--text2)", fontSize: 13 }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                    )}
                    <Tooltip
                      isAnimationActive={false}
                      cursor={{ stroke: "var(--border1)", strokeDasharray: "4 4" }}
                      content={(props) => (
                        <TimeSeriesTooltip
                          {...props}
                          groupBy={groupBy}
                          locale={locale}
                          viewsLabel={t("videoAnalyticsViewsOverTime")}
                          watchTimeLabel={t("videoAnalyticsWatchTimeOverTime")}
                        />
                      )}
                    />
                    {activeTimeSeries.watchTime && (
                      <Line
                        yAxisId="watchTime"
                        type="monotone"
                        dataKey="watchTime"
                        name={t("videoAnalyticsWatchTimeOverTime")}
                        stroke="var(--analyticsWatchTimeOverTime)"
                        strokeWidth={3}
                        dot={timeSeriesData.length <= 20
                          ? { r: 3, fill: "var(--analyticsWatchTimeOverTime)", stroke: "var(--background1)", strokeWidth: 2 }
                          : false}
                        activeDot={{ r: 5, fill: "var(--analyticsWatchTimeOverTime)", stroke: "var(--background1)", strokeWidth: 2 }}
                        isAnimationActive
                        animationDuration={500}
                      />
                    )}
                    {activeTimeSeries.views && (
                      <Line
                        yAxisId="views"
                        type="monotone"
                        dataKey="views"
                        name={t("videoAnalyticsViewsOverTime")}
                        stroke="var(--analyticsViewsOverTime)"
                        strokeWidth={3}
                        dot={timeSeriesData.length <= 20
                          ? { r: 3, fill: "var(--analyticsViewsOverTime)", stroke: "var(--background1)", strokeWidth: 2 }
                          : false}
                        activeDot={{ r: 5, fill: "var(--analyticsViewsOverTime)", stroke: "var(--background1)", strokeWidth: 2 }}
                        isAnimationActive
                        animationDuration={500}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div
              className="videoAnalyticsGraphTabs videoAnalyticsCompletionToggle"
              aria-label={t("videoAnalyticsCompletionBuckets")}
            >
              <button
                className="completionBuckets"
                type="button"
                aria-pressed={isCompletionBucketsActive}
                onClick={() => setIsCompletionBucketsActive((current) => !current)}
              >
                <i aria-hidden="true" />
                {t("videoAnalyticsCompletionBuckets")}
              </button>
            </div>

            {isCompletionBucketsActive && (
              isCompletionBucketsLoading ? (
                <div className="videoAnalyticsLineChart loading" aria-label={t("videoAnalyticsGraphsLoading")} />
              ) : isCompletionBucketsError || !completionBuckets ? (
                <p className="videoAnalyticsOverviewError">{t("videoAnalyticsCompletionBucketsFailed")}</p>
              ) : (
                <div className="videoAnalyticsLineChart videoAnalyticsCompletionChart">
                  <div className="videoAnalyticsCompletionAxisLabels" aria-hidden="true">
                    {completionBucketTicks.map((tick) => (
                      <span
                        key={tick}
                        style={{ bottom: `${(tick / (completionBucketAxisMax * 1.08)) * 100}%` }}
                      >
                        {tick.toLocaleString(locale)}
                      </span>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={completionBucketChartData} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid stroke="var(--border1)" strokeDasharray="4 4" vertical={false} />
                      <XAxis
                        dataKey="bucket"
                        tick={{ fill: "var(--text2)", fontSize: 13 }}
                        tickLine={false}
                        axisLine={{ stroke: "var(--border1)" }}
                      />
                      <YAxis
                        width={52}
                        domain={[0, completionBucketAxisMax * 1.08]}
                        ticks={completionBucketTicks}
                        interval={0}
                        tickFormatter={(value) => Number(value).toLocaleString(locale)}
                        tick={false}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        allowDataOverflow
                      />
                      <Tooltip
                        isAnimationActive={false}
                        cursor={{ fill: "var(--background2)" }}
                        content={(props) => (
                          <CompletionBucketsTooltip
                            {...props}
                            locale={locale}
                            viewersLabel={t("videoAnalyticsViewers")}
                          />
                        )}
                      />
                      <Bar
                        dataKey="viewers"
                        name={t("videoAnalyticsViewers")}
                        fill="var(--analyticsCompletionBuckets)"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={90}
                        isAnimationActive
                        animationDuration={500}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            )}

            {!hasActiveTimeSeries && !isCompletionBucketsActive && (
              <p className="videoAnalyticsGraphEmpty">{t("videoAnalyticsGraphsNoneSelected")}</p>
            )}
          </section>

          <section className="videoAnalyticsAudience">
            <h2>{t("videoAnalyticsAudienceBreakdown")}</h2>

            {isAudienceLoading ? (
              <div className="videoAnalyticsAudienceGrid" aria-label={t("videoAnalyticsAudienceLoading")}>
                <div className="videoAnalyticsChartCard loading" />
                <div className="videoAnalyticsChartCard loading" />
              </div>
            ) : isAudienceError || !deviceSplit || !operatingSystemSplit ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsAudienceFailed")}</p>
            ) : (
              <div className="videoAnalyticsAudienceGrid">
                <article className="videoAnalyticsChartCard">
                  <h3>{t("videoAnalyticsDeviceSplit")}</h3>
                  <DonutChart items={deviceItems} total={deviceSplit.totalViews} viewsLabel={t("videoAnalyticsViews")} />
                </article>
                <article className="videoAnalyticsChartCard">
                  <h3>{t("videoAnalyticsOperatingSystems")}</h3>
                  <DonutChart items={operatingSystemItems} total={operatingSystemSplit.totalViews} viewsLabel={t("videoAnalyticsViews")} />
                </article>
              </div>
            )}
          </section>

          <section className="videoAnalyticsGeographic">
            <h2>{t("videoAnalyticsGeographicBreakdown")}</h2>
            <p>{t("videoAnalyticsViewByMap")}</p>

            {isGeographicLoading ? (
              <div className="videoAnalyticsMap loading" />
            ) : isGeographicError ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsGeographicFailed")}</p>
            ) : (
              <>
                <div
                  ref={mapRef}
                  className={`videoAnalyticsMap${mapDrag ? " dragging" : ""}`}
                  onPointerDown={(event) => {
                    const point = getMapPoint(event.currentTarget, event.clientX, event.clientY);
                    if (!point) return;
                    mapDidDragRef.current = false;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const target = event.target instanceof Element ? event.target : null;
                    const countryCode = target?.closest("path.interactive")?.getAttribute("data-country") ?? null;
                    setMapDrag({
                      x: point.x,
                      y: point.y,
                      originX: mapView.x,
                      originY: mapView.y,
                      countryCode,
                    });
                  }}
                  onPointerMove={(event) => {
                    if (!mapDrag) return;
                    const point = getMapPoint(event.currentTarget, event.clientX, event.clientY);
                    if (!point) return;
                    if (Math.hypot(point.x - mapDrag.x, point.y - mapDrag.y) > 3) {
                      mapDidDragRef.current = true;
                    }
                    setMapView((current) => ({
                      ...current,
                      x: mapDrag.originX + point.x - mapDrag.x,
                      y: mapDrag.originY + point.y - mapDrag.y,
                    }));
                  }}
                  onPointerUp={() => {
                    const countryCode = mapDidDragRef.current ? null : mapDrag?.countryCode;
                    setMapDrag(null);
                    if (!countryCode) return;
                    const countryData = geographicBreakdown[countryCode];
                    if (!countryData || countryData.totalViews <= 0) return;
                    openCountryPopup(countryCode, countryData);
                  }}
                  onPointerCancel={() => setMapDrag(null)}
                >
                  <WorldMapSVG
                    transform={`translate(${mapView.x} ${mapView.y}) translate(${WORLD_MAP_CENTER.x} ${WORLD_MAP_CENTER.y}) scale(${mapView.zoom}) translate(${-WORLD_MAP_CENTER.x} ${-WORLD_MAP_CENTER.y})`}
                    getFill={(country) => geographicBreakdown[country.id.toUpperCase()] ? "var(--accentBlue2)" : "var(--background3)"}
                    getFillOpacity={(country) => {
                      const views = geographicBreakdown[country.id.toUpperCase()]?.totalViews || 0;
                      return views ? 0.25 + 0.75 * (views / maxCountryViews) : 1;
                    }}
                    onCountryEnter={updateMapTooltip}
                    onCountryMove={updateMapTooltip}
                    onCountryLeave={() => setMapTooltip(null)}
                    isCountryInteractive={(country) => (
                      (geographicBreakdown[country.id.toUpperCase()]?.totalViews ?? 0) > 0
                    )}
                    onCountryActivate={(country) => {
                      const code = country.id.toUpperCase();
                      const countryData = geographicBreakdown[code];
                      if (!countryData || countryData.totalViews <= 0) return;
                      openCountryPopup(code, countryData);
                    }}
                  />
                  {mapTooltip && (
                    <div className="videoAnalyticsMapTooltip" style={{ left: mapTooltip.x, top: mapTooltip.y }}>
                      <strong>{mapTooltip.name}</strong>
                      <span>{mapTooltip.views} {t("videoAnalyticsViews")}</span>
                    </div>
                  )}
                  <div className="videoAnalyticsMapControls" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setMapView((current) => ({ ...current, zoom: Math.min(MAX_MAP_ZOOM, current.zoom + 0.35) }))}
                    >+</button>
                    <button
                      type="button"
                      onClick={() => setMapView({ zoom: MIN_MAP_ZOOM, x: 0, y: 0 })}
                    >↺</button>
                    <button
                      type="button"
                      onClick={() => setMapView((current) => ({ ...current, zoom: Math.max(MIN_MAP_ZOOM, current.zoom - 0.35) }))}
                    >−</button>
                  </div>
                </div>

                <p className="videoAnalyticsGridLabel">{t("videoAnalyticsViewByGrid")}</p>
                <div className="videoAnalyticsCountryGrid">
                  {geographicCountries.map(([code, country]) => (
                    <button
                      type="button"
                      key={code}
                      aria-label={`${country.name}: ${country.totalViews} ${t("videoAnalyticsViews")}`}
                      onClick={() => openCountryPopup(code, country)}
                    >
                      <CountryFlag code={code} />
                      <strong>{country.totalViews} {t("videoAnalyticsViews")}</strong>
                      <b>{ArrowSVG}</b>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {selectedCountry && createPortal(
            <div
              className={`videoAnalyticsCityBackdrop${isCountryPopupVisible ? " visible" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={selectedCountry.data.name}
              onMouseDown={closeCountryPopup}
            >
              <section className="videoAnalyticsCityPopup" onMouseDown={(event) => event.stopPropagation()}>
                <header>
                  <CountryFlag code={selectedCountry.code} />
                  <div>
                    <h2>{selectedCountry.data.name}</h2>
                    <p>{selectedCountry.data.totalViews} {t("videoAnalyticsViews")}</p>
                  </div>
                  <button type="button" aria-label={t("close")} onClick={closeCountryPopup}>{CloseSVG}</button>
                </header>
                <div className="videoAnalyticsCityPopupBody">
                  <p>{t("videoAnalyticsCities")}</p>
                  <div className="videoAnalyticsCityGrid">
                    {Object.entries(selectedCountry.data.cities).sort(([, a], [, b]) => b - a).map(([city, views]) => (
                      <article key={city}><strong>{city}</strong><span>{views} {t("videoAnalyticsViews")}</span></article>
                    ))}
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )}
        </div>
      </div>
    </main>
  );
}

export default VideoAnalyticsPage;
