import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
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
import PlatformSidebar from "~/components/platformPage/sidebar/platformSidebar";
import { AnalyticsSVG, FilterSVG, PlaylistSVG } from "~/constants";
import { env } from "~/env";
import {
  formatDate,
  formatDescription,
  formatDuration,
  formatViews,
  getToken,
} from "~/functions";
import { useI18n } from "~/i18n";
import DefaultThumbnail from "../../../assets/DefaultThumbnail.webp";
import CustomSelect from "~/components/customSelect/customSelect";
import GeographicBreakdownSection, {
  type GeographicBreakdown,
} from "./geographicBreakdown";
import PageLoader from "../loaders/pageLoader";

type AnalyticsRange = "last7" | "last30" | "last90" | "last365" | "all" | "custom";
type AnalyticsGroupBy = "day" | "week" | "month";
type PlatformTimeSeriesMetric = "watchTime" | "views" | "signups" | "activeUsers";

type PlatformOverviewResponse = {
  success: boolean;
  platformOverview: {
    totalUsers: number;
    newUsers: number;
    videoCount: number;
    playlistCount: number;
    videoViews: number;
    watchTime: number;
    avgWatchTimePerViewer: number;
    videoLikes: number;
    videoDislikes: number;
    videoComments: number;
    playlistSaves: number;
  };
};

type PlatformEngagementResponse = {
  success: boolean;
  averageEngagementPerVideo: number;
};

type TopViewedVideo = {
  id: string;
  title: string;
  thumbnail_url: string;
  duration_seconds: number;
  view_count: number;
  period_views: number;
  created_at: string;
  uploader_name: string;
  description: string;
};

type TopViewedVideosResponse = {
  success: boolean;
  topViewedVideos: TopViewedVideo[];
};

type TopViewedPlaylist = {
  id: string;
  title: string;
  thumbnail_url: string;
  view_count: number;
  video_count: number;
  period_views: number;
  created_at: string;
  status: "public" | "private";
  description: string;
};

type TopViewedPlaylistsResponse = {
  success: boolean;
  topViewedPlaylists: TopViewedPlaylist[];
};

type PlatformDeviceSplitResponse = {
  success: boolean;
  platformDeviceSplit: {
    totalViews: number;
    desktop: number;
    phone: number;
    tablet: number;
    other: number;
  };
};

type PlatformOperatingSystemSplitResponse = {
  success: boolean;
  platformOperatingSystemSplit: {
    totalViews: number;
    windows: number;
    macOS: number;
    android: number;
    iOS: number;
    linux: number;
    other: number;
  };
};

type PlatformGeographicBreakdownResponse = {
  success: boolean;
  platformGeographicBreakdown: GeographicBreakdown;
};

type PlatformViewsOverTimeResponse = {
  success: boolean;
  platformViewsOverTime: Array<{
    periodStart: string;
    views: number;
  }>;
};

type PlatformWatchTimeOverTimeResponse = {
  success: boolean;
  platformWatchTimeOverTime: Array<{
    periodStart: string;
    watchTime: number;
  }>;
};

type PlatformSignupsOverTimeResponse = {
  success: boolean;
  platformSignupsOverTime: Array<{
    periodStart: string;
    signups: number;
  }>;
};

type PlatformActiveUsersOverTimeResponse = {
  success: boolean;
  platformActiveUsersOverTime: Array<{
    periodStart: string;
    activeUsers: number;
  }>;
};

type PlatformTimeSeriesPoint = {
  periodStart: string;
  watchTime?: number;
  views?: number;
  signups?: number;
  activeUsers?: number;
};

type DonutItem = {
  label: string;
  value: number;
  color: string;
};

function getAnalyticsQuery(
  range: AnalyticsRange,
  groupBy: AnalyticsGroupBy,
  customFromDate: string,
  customToDate: string,
) {
  const params = new URLSearchParams({ groupBy });

  if (range === "custom") {
    params.set("fromDate", new Date(`${customFromDate}T00:00:00.000Z`).toISOString());
    params.set("toDate", new Date(`${customToDate}T23:59:59.999Z`).toISOString());
  } else if (range !== "all") {
    const days = Number(range.replace("last", ""));
    const toDate = new Date();
    const fromDate = new Date(toDate);
    fromDate.setUTCDate(fromDate.getUTCDate() - days);
    fromDate.setUTCHours(0, 0, 0, 0);
    toDate.setUTCHours(23, 59, 59, 999);
    params.set("fromDate", fromDate.toISOString());
    params.set("toDate", toDate.toISOString());
  }

  return `?${params.toString()}`;
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

function formatPeriodLabel(
  periodStart: string,
  groupBy: AnalyticsGroupBy,
  locale: string,
  detailed = false,
) {
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

function PlatformTimeSeriesTooltip({
  active,
  payload,
  label,
  groupBy,
  locale,
  watchTimeLabel,
  viewsLabel,
  signupsLabel,
  activeUsersLabel,
}: TooltipContentProps & {
  groupBy: AnalyticsGroupBy;
  locale: string;
  watchTimeLabel: string;
  viewsLabel: string;
  signupsLabel: string;
  activeUsersLabel: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="videoAnalyticsLineTooltip">
      <span className="videoAnalyticsLineTooltipDate">
        {formatPeriodLabel(String(label ?? ""), groupBy, locale, true)}
      </span>
      {payload.map((entry) => {
        const dataKey = String(entry.dataKey);
        const metric: PlatformTimeSeriesMetric = dataKey === "watchTime"
          ? "watchTime"
          : dataKey === "signups"
            ? "signups"
            : dataKey === "activeUsers"
              ? "activeUsers"
              : "views";
        const value = Number(entry.value ?? 0);
        const metricLabel = metric === "watchTime"
          ? watchTimeLabel
          : metric === "signups"
            ? signupsLabel
            : metric === "activeUsers"
              ? activeUsersLabel
              : viewsLabel;

        return (
          <div className={`videoAnalyticsLineTooltipValue ${metric}`} key={metric}>
            <i aria-hidden="true" />
            <span>{metricLabel}</span>
            <strong>
              {metric === "watchTime"
                ? formatWatchTime(value, true)
                : value.toLocaleString(locale)}
            </strong>
          </div>
        );
      })}
    </div>
  );
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

function EngagementMeter({ percentage, resetKey, label }: {
  percentage: number;
  resetKey: string;
  label: string;
}) {
  const animatedPercentage = useAnimatedPercentage(percentage, resetKey);
  const labelPosition = Math.min(97, Math.max(3, animatedPercentage));

  return (
    <div className="videoAnalyticsEngagementMeter">
      <div className="videoAnalyticsEngagementValueRow">
        <strong style={{ left: `${labelPosition}%` }}>{Math.round(animatedPercentage)}%</strong>
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

function DonutChart({ items, total, viewsLabel }: {
  items: DonutItem[];
  total: number;
  viewsLabel: string;
}) {
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
              {data.map((item) => (
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

function DownloadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 17H6.5A4.5 4.5 0 0 1 6 8.03 6 6 0 0 1 17.64 9.5H18a3.5 3.5 0 0 1 0 7h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11v9m0 0-3-3m3 3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Analytics() {
  const { locale, t } = useI18n();
  const headers = useRef(new Headers());
  const [token, setToken] = useState("");
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [range, setRange] = useState<AnalyticsRange>("last30");
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("day");
  const [customFromDate, setCustomFromDate] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 30);
    return date.toISOString().slice(0, 10);
  });
  const [customToDate, setCustomToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTimeSeries, setActiveTimeSeries] = useState<Record<PlatformTimeSeriesMetric, boolean>>({
    watchTime: true,
    views: true,
    signups: true,
    activeUsers: true,
  });

  useEffect(() => {
    const userToken = getToken();
    if (!userToken) return;

    headers.current.set("Content-Type", "application/json");
    headers.current.set("Authorization", `Bearer ${userToken}`);
    setToken(userToken);
  }, []);

  const analyticsQuery = useMemo(
    () => getAnalyticsQuery(range, groupBy, customFromDate, customToDate),
    [customFromDate, customToDate, groupBy, range],
  );

  const {
    data: overviewData,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
  } = useQuery<PlatformOverviewResponse>({
    queryKey: ["platform-analytics-overview", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformOverviewResponse>({
      route: `api/analytics/platform/overview${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: engagementData,
    isLoading: isEngagementLoading,
    isError: isEngagementError,
  } = useQuery<PlatformEngagementResponse>({
    queryKey: ["platform-analytics-average-engagement", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformEngagementResponse>({
      route: `api/analytics/platform/average-engagement-per-video${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: viewsOverTimeData,
    isLoading: isViewsOverTimeLoading,
    isError: isViewsOverTimeError,
  } = useQuery<PlatformViewsOverTimeResponse>({
    queryKey: ["platform-analytics-views-over-time", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformViewsOverTimeResponse>({
      route: `api/analytics/platform/views-over-time${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: watchTimeOverTimeData,
    isLoading: isWatchTimeOverTimeLoading,
    isError: isWatchTimeOverTimeError,
  } = useQuery<PlatformWatchTimeOverTimeResponse>({
    queryKey: ["platform-analytics-watch-time-over-time", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformWatchTimeOverTimeResponse>({
      route: `api/analytics/platform/watch-time-over-time${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: signupsOverTimeData,
    isLoading: isSignupsOverTimeLoading,
    isError: isSignupsOverTimeError,
  } = useQuery<PlatformSignupsOverTimeResponse>({
    queryKey: ["platform-analytics-signups-over-time", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformSignupsOverTimeResponse>({
      route: `api/analytics/platform/signups-over-time${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: activeUsersOverTimeData,
    isLoading: isActiveUsersOverTimeLoading,
    isError: isActiveUsersOverTimeError,
  } = useQuery<PlatformActiveUsersOverTimeResponse>({
    queryKey: ["platform-analytics-active-users-over-time", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformActiveUsersOverTimeResponse>({
      route: `api/analytics/platform/active-users-over-time${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: topViewedVideosData,
    isLoading: isTopViewedVideosLoading,
    isError: isTopViewedVideosError,
  } = useQuery<TopViewedVideosResponse>({
    queryKey: ["platform-analytics-top-viewed-videos", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<TopViewedVideosResponse>({
      route: `api/analytics/platform/top-viewed-videos${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: topViewedPlaylistsData,
    isLoading: isTopViewedPlaylistsLoading,
    isError: isTopViewedPlaylistsError,
  } = useQuery<TopViewedPlaylistsResponse>({
    queryKey: ["platform-analytics-top-viewed-playlists", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<TopViewedPlaylistsResponse>({
      route: `api/analytics/platform/top-viewed-playlists${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: audienceData,
    isLoading: isAudienceLoading,
    isError: isAudienceError,
  } = useQuery({
    queryKey: ["platform-analytics-audience", range, groupBy, analyticsQuery],
    queryFn: async () => {
      const [device, operatingSystem] = await Promise.all([
        fetchFn<PlatformDeviceSplitResponse>({
          route: `api/analytics/platform/device-split${analyticsQuery}`,
          options: { method: "GET", headers: headers.current },
        }),
        fetchFn<PlatformOperatingSystemSplitResponse>({
          route: `api/analytics/platform/operating-system-split${analyticsQuery}`,
          options: { method: "GET", headers: headers.current },
        }),
      ]);

      return { device, operatingSystem };
    },
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const {
    data: geographicData,
    isLoading: isGeographicLoading,
    isError: isGeographicError,
  } = useQuery<PlatformGeographicBreakdownResponse>({
    queryKey: ["platform-analytics-geographic", range, groupBy, analyticsQuery],
    queryFn: () => fetchFn<PlatformGeographicBreakdownResponse>({
      route: `api/analytics/platform/geographic-breakdown${analyticsQuery}`,
      options: { method: "GET", headers: headers.current },
    }),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const overview = overviewData?.platformOverview;
  const engagementPercentage = Math.min(
    100,
    Math.max(0, (engagementData?.averageEngagementPerVideo ?? 0) * 100),
  );
  const overviewCards = overview
    ? [
        {
          label: t("platformAnalyticsTotalUsers"),
          value: overview.totalUsers.toLocaleString(locale),
          description: t("platformAnalyticsTotalUsersHelp"),
        },
        {
          label: t("platformAnalyticsNewUsers"),
          value: overview.newUsers.toLocaleString(locale),
          description: t("platformAnalyticsNewUsersHelp"),
        },
        {
          label: t("platformAnalyticsContent"),
          value: `${overview.videoCount.toLocaleString(locale)} / ${overview.playlistCount.toLocaleString(locale)}`,
          description: t("platformAnalyticsContentHelp"),
        },
        {
          label: t("platformAnalyticsVideoViews"),
          value: overview.videoViews.toLocaleString(locale),
          description: t("platformAnalyticsVideoViewsHelp"),
        },
        {
          label: t("videoAnalyticsWatchTime"),
          value: formatWatchTime(overview.watchTime, true),
          description: t("platformAnalyticsWatchTimeHelp"),
        },
        {
          label: t("videoAnalyticsAverageWatchTime"),
          value: formatWatchTime(overview.avgWatchTimePerViewer),
          description: t("videoAnalyticsAverageWatchTimeHelp"),
        },
        {
          label: t("platformAnalyticsVideoReactions"),
          value: (overview.videoLikes + overview.videoDislikes).toLocaleString(locale),
          description: t("platformAnalyticsVideoReactionsHelp", {
            likes: overview.videoLikes.toLocaleString(locale),
            dislikes: overview.videoDislikes.toLocaleString(locale),
          }),
        },
        {
          label: t("platformAnalyticsPlaylistSaves"),
          value: overview.playlistSaves.toLocaleString(locale),
          description: t("platformAnalyticsPlaylistSavesHelp"),
        },
      ]
    : [];

  const timeSeriesData = useMemo(() => {
    const points = new Map<string, PlatformTimeSeriesPoint>();

    if (activeTimeSeries.watchTime) {
      for (const point of watchTimeOverTimeData?.platformWatchTimeOverTime ?? []) {
        points.set(point.periodStart, {
          ...points.get(point.periodStart),
          periodStart: point.periodStart,
          watchTime: point.watchTime,
        });
      }
    }

    if (activeTimeSeries.views) {
      for (const point of viewsOverTimeData?.platformViewsOverTime ?? []) {
        points.set(point.periodStart, {
          ...points.get(point.periodStart),
          periodStart: point.periodStart,
          views: point.views,
        });
      }
    }

    if (activeTimeSeries.signups) {
      for (const point of signupsOverTimeData?.platformSignupsOverTime ?? []) {
        points.set(point.periodStart, {
          ...points.get(point.periodStart),
          periodStart: point.periodStart,
          signups: point.signups,
        });
      }
    }

    if (activeTimeSeries.activeUsers) {
      for (const point of activeUsersOverTimeData?.platformActiveUsersOverTime ?? []) {
        points.set(point.periodStart, {
          ...points.get(point.periodStart),
          periodStart: point.periodStart,
          activeUsers: point.activeUsers,
        });
      }
    }

    return Array.from(points.values()).sort(
      (a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime(),
    );
  }, [activeTimeSeries, activeUsersOverTimeData, signupsOverTimeData, viewsOverTimeData, watchTimeOverTimeData]);
  const hasActiveTimeSeries = activeTimeSeries.watchTime
    || activeTimeSeries.views
    || activeTimeSeries.signups
    || activeTimeSeries.activeUsers;
  const hasActiveCountSeries = activeTimeSeries.views
    || activeTimeSeries.signups
    || activeTimeSeries.activeUsers;
  const isTimeSeriesLoading = hasActiveTimeSeries && (
    (activeTimeSeries.watchTime && isWatchTimeOverTimeLoading)
    || (activeTimeSeries.views && isViewsOverTimeLoading)
    || (activeTimeSeries.signups && isSignupsOverTimeLoading)
    || (activeTimeSeries.activeUsers && isActiveUsersOverTimeLoading)
  );
  const isTimeSeriesError = hasActiveTimeSeries && (
    (activeTimeSeries.watchTime && isWatchTimeOverTimeError)
    || (activeTimeSeries.views && isViewsOverTimeError)
    || (activeTimeSeries.signups && isSignupsOverTimeError)
    || (activeTimeSeries.activeUsers && isActiveUsersOverTimeError)
  );

  const deviceSplit = audienceData?.device.platformDeviceSplit;
  const operatingSystemSplit = audienceData?.operatingSystem.platformOperatingSystemSplit;
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

  const reportUrl = useMemo(() => {
    const url = new URL(`${env.apiBaseUrl}/api/reports/video-analytics.pdf`);
    if (range === "custom") {
      url.searchParams.set("fromDate", new Date(`${customFromDate}T00:00:00.000Z`).toISOString());
      url.searchParams.set("toDate", new Date(`${customToDate}T23:59:59.999Z`).toISOString());
    } else if (range !== "all") {
      url.searchParams.set("range", range);
    }
    url.searchParams.set("groupBy", groupBy);
    return url.toString();
  }, [customFromDate, customToDate, groupBy, range]);

  const getFilenameFromDisposition = (disposition: string | null) => {
    if (!disposition) return "platform-analytics.pdf";

    const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].trim().replace(/["']/g, ""));

    const filenameMatch = disposition.match(/filename\s*=\s*("?)([^";]+)\1/i);
    return filenameMatch?.[2]?.trim() || "platform-analytics.pdf";
  };

  const openAnalyticsReport = async () => {
    setIsGeneratingReport(true);
    const reportWindow = window.open("", "_blank");

    try {
      if (reportWindow) {
        reportWindow.document.write("<title>Generating analytics PDF...</title><p style=\"font-family: sans-serif; padding: 16px;\">Generating analytics PDF...</p>");
        reportWindow.document.close();
      }

      const response = await fetch(reportUrl, { method: "GET", headers: headers.current });
      if (!response.ok) throw new Error("Failed to fetch analytics report.");

      const pdfBlob = await response.blob();
      const filename = getFilenameFromDisposition(response.headers.get("content-disposition"));
      const pdfUrl = URL.createObjectURL(new Blob([pdfBlob], { type: "application/pdf" }));
      const reportBackground = getComputedStyle(document.documentElement)
        .getPropertyValue("--background1")
        .trim();

      if (reportWindow) {
        reportWindow.document.open();
        reportWindow.document.write(`
          <title>${filename}</title>
          <style>
            html, body { margin: 0; height: 100%; background: ${reportBackground}; }
            iframe { border: 0; width: 100%; height: 100%; }
          </style>
          <iframe src="${pdfUrl}" title="${filename}"></iframe>
        `);
        reportWindow.document.close();
      } else {
        window.open(pdfUrl, "_blank");
      }
    } catch (error) {
      console.error("Error opening analytics report:", error);
      if (reportWindow) {
        reportWindow.document.body.innerHTML =
          "<p style=\"font-family: sans-serif; padding: 16px;\">Failed to generate analytics PDF.</p>";
      }
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const topViewedVideos = topViewedVideosData?.topViewedVideos ?? [];
  const topViewedPlaylists = topViewedPlaylistsData?.topViewedPlaylists ?? [];

  return (
    <main className="myVideos analyticsPage videoAnalyticsPage">
      <PlatformSidebar />
      <PageLoader active={isGeneratingReport} />

      <div className="content libraryContent">
        <div className="holder libraryShell videoAnalyticsShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("platformAnalytics")}</h1>
              <p>{t("platformAnalyticsDescription")}</p>
            </div>
            <button
              type="button"
              className="platformAnalyticsPdfButton"
              onClick={openAnalyticsReport}
              disabled={isGeneratingReport}
            >
              <DownloadIcon />
              {isGeneratingReport ? t("analyticsGeneratingPdf") : t("analyticsDownloadPdf")}
            </button>
          </div>

          <div className="videoAnalyticsFilters" aria-label={t("videoAnalyticsFilters")}>
            <div className="videoAnalyticsSelect">
              <CustomSelect
                leadingContent={FilterSVG}
                value={range}
                onChange={(value) => setRange(value as AnalyticsRange)}
                ariaLabel={t("analyticsRange")}
                options={[
                  { value: "last7", label: t("analyticsLast7Days") },
                  { value: "last30", label: t("analyticsLast30Days") },
                  { value: "last90", label: t("analyticsLast90Days") },
                  { value: "last365", label: t("analyticsLast365Days") },
                  { value: "all", label: t("analyticsAllTime") },
                  { value: "custom", label: t("analyticsCustom") },
                ]}
              />
            </div>
            {range === "custom" && (
              <>
                <label className="videoAnalyticsDateField">
                  <span>{t("analyticsFrom")}</span>
                  <input
                    type="date"
                    value={customFromDate}
                    max={customToDate}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return;
                      setCustomFromDate(value);
                      if (value > customToDate) setCustomToDate(value);
                    }}
                  />
                </label>
                <label className="videoAnalyticsDateField">
                  <span>{t("analyticsTo")}</span>
                  <input
                    type="date"
                    value={customToDate}
                    min={customFromDate}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return;
                      setCustomToDate(value);
                      if (value < customFromDate) setCustomFromDate(value);
                    }}
                  />
                </label>
              </>
            )}
            <div className="videoAnalyticsSelect">
              <CustomSelect
                leadingContent={FilterSVG}
                value={groupBy}
                onChange={(value) => setGroupBy(value as AnalyticsGroupBy)}
                ariaLabel={t("analyticsGroupBy")}
                options={[
                  { value: "day", label: t("analyticsDay") },
                  { value: "week", label: t("analyticsWeek") },
                  { value: "month", label: t("analyticsMonth") },
                ]}
              />
            </div>
          </div>

          <section className="videoAnalyticsOverview">
            <h2>{t("videoAnalyticsOverview")}</h2>
            <p className="videoAnalyticsSectionDescription">{t("platformAnalyticsOverviewDescription")}</p>

            {isOverviewLoading ? (
              <div className="videoAnalyticsOverviewGrid" aria-label={t("videoAnalyticsOverviewLoading")}>
                {Array.from({ length: 8 }, (_, index) => (
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
            <h2>{t("platformAnalyticsAverageEngagement")}</h2>
            <p className="videoAnalyticsSectionDescription">{t("platformAnalyticsAverageEngagementDescription")}</p>

            {isEngagementLoading ? (
              <div className="videoAnalyticsEngagementLoading loading" aria-label={t("videoAnalyticsEngagementLoading")} />
            ) : isEngagementError || !engagementData ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsEngagementFailed")}</p>
            ) : (
              <EngagementMeter
                percentage={engagementPercentage}
                resetKey={`${range}-${groupBy}`}
                label={t("platformAnalyticsAverageEngagement")}
              />
            )}
          </section>

          <section className="videoAnalyticsGraphs">
            <h2>{t("platformAnalyticsActivityOverTime")}</h2>
            <p className="videoAnalyticsSectionDescription">{t("platformAnalyticsActivityOverTimeDescription")}</p>

            <div className="videoAnalyticsGraphTabs" aria-label={t("platformAnalyticsActivityOverTime")}>
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
              <button
                className="signups"
                type="button"
                aria-pressed={activeTimeSeries.signups}
                onClick={() => setActiveTimeSeries((current) => ({
                  ...current,
                  signups: !current.signups,
                }))}
              >
                <i aria-hidden="true" />
                {t("platformAnalyticsSignupsOverTime")}
              </button>
              <button
                className="activeUsers"
                type="button"
                aria-pressed={activeTimeSeries.activeUsers}
                onClick={() => setActiveTimeSeries((current) => ({
                  ...current,
                  activeUsers: !current.activeUsers,
                }))}
              >
                <i aria-hidden="true" />
                {t("platformAnalyticsActiveUsersOverTime")}
              </button>
            </div>

            {isTimeSeriesLoading ? (
              <div className="videoAnalyticsLineChart loading" aria-label={t("videoAnalyticsGraphsLoading")} />
            ) : isTimeSeriesError ? (
              <p className="videoAnalyticsOverviewError">{t("videoAnalyticsGraphsFailed")}</p>
            ) : !hasActiveTimeSeries ? (
              <p className="videoAnalyticsGraphEmpty">{t("videoAnalyticsGraphsNoneSelected")}</p>
            ) : !timeSeriesData.length ? (
              <p className="videoAnalyticsGraphEmpty">{t("videoAnalyticsGraphsEmpty")}</p>
            ) : (
              <div className="videoAnalyticsLineChart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeSeriesData} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
                    <CartesianGrid
                      yAxisId={activeTimeSeries.watchTime ? "watchTime" : "counts"}
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
                    {hasActiveCountSeries && (
                      <YAxis
                        yAxisId="counts"
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
                        <PlatformTimeSeriesTooltip
                          {...props}
                          groupBy={groupBy}
                          locale={locale}
                          watchTimeLabel={t("videoAnalyticsWatchTimeOverTime")}
                          viewsLabel={t("videoAnalyticsViewsOverTime")}
                          signupsLabel={t("platformAnalyticsSignupsOverTime")}
                          activeUsersLabel={t("platformAnalyticsActiveUsersOverTime")}
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
                        yAxisId="counts"
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
                    {activeTimeSeries.signups && (
                      <Line
                        yAxisId="counts"
                        type="monotone"
                        dataKey="signups"
                        name={t("platformAnalyticsSignupsOverTime")}
                        stroke="var(--analyticsSignupsOverTime)"
                        strokeWidth={3}
                        dot={timeSeriesData.length <= 20
                          ? { r: 3, fill: "var(--analyticsSignupsOverTime)", stroke: "var(--background1)", strokeWidth: 2 }
                          : false}
                        activeDot={{ r: 5, fill: "var(--analyticsSignupsOverTime)", stroke: "var(--background1)", strokeWidth: 2 }}
                        isAnimationActive
                        animationDuration={500}
                      />
                    )}
                    {activeTimeSeries.activeUsers && (
                      <Line
                        yAxisId="counts"
                        type="monotone"
                        dataKey="activeUsers"
                        name={t("platformAnalyticsActiveUsersOverTime")}
                        stroke="var(--analyticsActiveUsersOverTime)"
                        strokeWidth={3}
                        dot={timeSeriesData.length <= 20
                          ? { r: 3, fill: "var(--analyticsActiveUsersOverTime)", stroke: "var(--background1)", strokeWidth: 2 }
                          : false}
                        activeDot={{ r: 5, fill: "var(--analyticsActiveUsersOverTime)", stroke: "var(--background1)", strokeWidth: 2 }}
                        isAnimationActive
                        animationDuration={500}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="channelAnalyticsBestVideos">
            <h2>{t("platformAnalyticsTopViewedVideos")}</h2>
            <p className="videoAnalyticsSectionDescription">{t("platformAnalyticsTopViewedVideosDescription")}</p>

            {isTopViewedVideosLoading ? (
              <div className="channelAnalyticsBestVideoList" aria-label={t("platformAnalyticsTopViewedVideosLoading")}>
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="channelAnalyticsBestVideo loading" key={index} />
                ))}
              </div>
            ) : isTopViewedVideosError ? (
              <p className="videoAnalyticsOverviewError">{t("platformAnalyticsTopViewedVideosFailed")}</p>
            ) : !topViewedVideos.length ? (
              <p className="videoAnalyticsGraphEmpty">{t("platformAnalyticsTopViewedVideosEmpty")}</p>
            ) : (
              <div className="channelAnalyticsBestVideoList">
                {topViewedVideos.map((video, index) => (
                  <article className="channelAnalyticsBestVideo" key={video.id}>
                    <span className="channelAnalyticsBestVideoRank" aria-label={`${index + 1}`}>{index + 1}</span>
                    <div className="channelAnalyticsBestVideoThumbnail">
                      <img
                        src={video.thumbnail_url || DefaultThumbnail}
                        alt={video.title}
                        loading="lazy"
                        decoding="async"
                        onError={(event) => { event.currentTarget.src = DefaultThumbnail; }}
                      />
                      <span>{formatDuration(video.duration_seconds)}</span>
                    </div>
                    <div className="channelAnalyticsBestVideoInfo">
                      <h3>{video.title}</h3>
                      <p className="channelAnalyticsBestVideoDescription">
                        {formatDescription(video.description || t("adminNoDescription"))}
                      </p>
                      <div className="channelAnalyticsBestVideoMeta">
                        <span>{t("platformAnalyticsPeriodViews", { count: video.period_views.toLocaleString(locale) })}</span>
                        <span>{formatViews(video.view_count)}</span>
                        <span>{formatDate(video.created_at)}</span>
                      </div>
                    </div>
                    <Link
                      className="channelAnalyticsBestVideoAction"
                      to={`/video-analytics?video=${video.id}`}
                      aria-label={`${t("channelAnalyticsViewAnalytics")}: ${video.title}`}
                    >
                      {AnalyticsSVG}
                      {t("channelAnalyticsViewAnalytics")}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="channelAnalyticsBestVideos">
            <h2>{t("platformAnalyticsTopViewedPlaylists")}</h2>
            <p className="videoAnalyticsSectionDescription">{t("platformAnalyticsTopViewedPlaylistsDescription")}</p>

            {isTopViewedPlaylistsLoading ? (
              <div className="channelAnalyticsBestVideoList" aria-label={t("platformAnalyticsTopViewedPlaylistsLoading")}>
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="channelAnalyticsBestVideo loading" key={index} />
                ))}
              </div>
            ) : isTopViewedPlaylistsError ? (
              <p className="videoAnalyticsOverviewError">{t("platformAnalyticsTopViewedPlaylistsFailed")}</p>
            ) : !topViewedPlaylists.length ? (
              <p className="videoAnalyticsGraphEmpty">{t("platformAnalyticsTopViewedPlaylistsEmpty")}</p>
            ) : (
              <div className="channelAnalyticsBestVideoList">
                {topViewedPlaylists.map((playlist, index) => (
                  <article className="channelAnalyticsBestVideo platformAnalyticsPlaylistCard" key={playlist.id}>
                    <span className="channelAnalyticsBestVideoRank" aria-label={`${index + 1}`}>{index + 1}</span>
                    <div className="channelAnalyticsBestVideoThumbnail">
                      <img
                        src={playlist.thumbnail_url || DefaultThumbnail}
                        alt={playlist.title}
                        loading="lazy"
                        decoding="async"
                        onError={(event) => { event.currentTarget.src = DefaultThumbnail; }}
                      />
                    </div>
                    <div className="channelAnalyticsBestVideoInfo">
                      <h3>{playlist.title}</h3>
                      <p className="channelAnalyticsBestVideoDescription">
                        {formatDescription(playlist.description || t("adminNoDescription"))}
                      </p>
                      <div className="channelAnalyticsBestVideoMeta">
                        <span>{t("platformAnalyticsVideoCount", { count: playlist.video_count.toLocaleString(locale) })}</span>
                        <span>{t("platformAnalyticsPeriodViews", { count: playlist.period_views.toLocaleString(locale) })}</span>
                        <span>{formatViews(playlist.view_count)}</span>
                        <span>{formatDate(playlist.created_at)}</span>
                      </div>
                    </div>
                    <Link
                      className="channelAnalyticsBestVideoAction"
                      to={`/playlist/${playlist.id}`}
                      aria-label={`${t("adminOpenPlaylist")}: ${playlist.title}`}
                    >
                      {PlaylistSVG}
                      {t("adminOpenPlaylist")}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="videoAnalyticsAudience">
            <h2>{t("videoAnalyticsAudienceBreakdown")}</h2>
            <p className="videoAnalyticsSectionDescription">{t("platformAnalyticsAudienceDescription")}</p>

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
                  <DonutChart
                    items={deviceItems}
                    total={deviceSplit.totalViews}
                    viewsLabel={t("videoAnalyticsViews")}
                  />
                </article>
                <article className="videoAnalyticsChartCard">
                  <h3>{t("videoAnalyticsOperatingSystems")}</h3>
                  <DonutChart
                    items={operatingSystemItems}
                    total={operatingSystemSplit.totalViews}
                    viewsLabel={t("videoAnalyticsViews")}
                  />
                </article>
              </div>
            )}
          </section>

          <GeographicBreakdownSection
            breakdown={geographicData?.platformGeographicBreakdown ?? {}}
            isLoading={isGeographicLoading}
            isError={isGeographicError}
            description={t("platformAnalyticsGeographicDescription")}
          />
        </div>
      </div>
    </main>
  );
}

export default Analytics;
