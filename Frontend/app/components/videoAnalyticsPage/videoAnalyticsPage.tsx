import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { fetchFn } from "~/API";
import { FilterSVG } from "~/constants";
import { formatDate, formatDuration, formatViews, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import type { VideoT } from "~/types";
import Sidebar from "~/components/myVideosPage/sidebar/sidebar";

type AnalyticsRange = "last7" | "last30" | "last90" | "last365" | "all";

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

type DonutItem = {
  label: string;
  value: number;
  color: string;
};

function DonutChart({ items, total }: { items: DonutItem[]; total: number }) {
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
              <span>{activePercentage}% · views</span>
            </>
          ) : (
            <>
              <strong>{total}</strong>
              <span>views</span>
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

function VideoAnalyticsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("video");
  const headers = useRef(new Headers());
  const [token, setToken] = useState("");
  const [range, setRange] = useState<AnalyticsRange>("last7");
  const [groupBy, setGroupBy] = useState("day");

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;

    headers.current.set("Content-Type", "application/json");
    headers.current.set("Authorization", `Bearer ${userToken}`);
    setToken(userToken);
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
                onChange={(event) => setGroupBy(event.target.value)}
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
                  <DonutChart items={deviceItems} total={deviceSplit.totalViews} />
                </article>
                <article className="videoAnalyticsChartCard">
                  <h3>{t("videoAnalyticsOperatingSystems")}</h3>
                  <DonutChart items={operatingSystemItems} total={operatingSystemSplit.totalViews} />
                </article>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export default VideoAnalyticsPage;
