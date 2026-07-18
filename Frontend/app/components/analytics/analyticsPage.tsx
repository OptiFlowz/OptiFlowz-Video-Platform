import { useMemo, useState } from "react";
import PlatformSidebar from "~/components/platformPage/sidebar/platformSidebar";
import PageLoader from "../loaders/pageLoader";
import { env } from "~/env";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";

type AnalyticsRange = "last30" | "last90" | "last365" | "all" | "custom";
type AnalyticsGroupBy = "day" | "week" | "month";

function Analytics() {
  const { t } = useI18n();
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [range, setRange] = useState<AnalyticsRange>("last30");
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("day");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const isCustomRange = range === "custom";

  const validationMessage = useMemo(() => {
    if (!isCustomRange) return "";
    if (!from || !to) return t("analyticsChooseBothDates");
    if (from > to) return t("analyticsFromBeforeTo");
    return "";
  }, [from, isCustomRange, t, to]);

  const reportUrl = useMemo(() => {
    const url = new URL(`${env.apiBaseUrl}/api/reports/video-analytics.pdf`);
    if (range !== "all") {
      url.searchParams.set("range", range);
    }
    url.searchParams.set("groupBy", groupBy);

    if (isCustomRange) {
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
    }

    return url.toString();
  }, [from, groupBy, isCustomRange, range, to]);

  const getFilenameFromDisposition = (disposition: string | null) => {
    if (!disposition) return "video-analytics.pdf";

    const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1].trim().replace(/["']/g, ""));
    }

    const filenameMatch = disposition.match(/filename\s*=\s*("?)([^";]+)\1/i);
    if (filenameMatch?.[2]) {
      return filenameMatch[2].trim();
    }

    return "video-analytics.pdf";
  };

  const openAnalyticsReport = async () => {
    if (validationMessage) return;

    setIsGeneratingReport(true);
    const reportWindow = window.open("", "_blank");

    try {
      const token = getToken();
      const headers = new Headers();

      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (reportWindow) {
        reportWindow.document.write("<title>Generating analytics PDF...</title><p style=\"font-family: sans-serif; padding: 16px;\">Generating analytics PDF...</p>");
        reportWindow.document.close();
      }

      const response = await fetch(reportUrl, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch analytics report.");
      }

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
            html, body {
              margin: 0;
              height: 100%;
              background: ${reportBackground};
            }
            iframe {
              border: 0;
              width: 100%;
              height: 100%;
            }
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

  return (
    <main className="myVideos analyticsPage">
      <PlatformSidebar />
      <PageLoader active={isGeneratingReport} />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("platformAnalytics")}</h1>
              <p>{t("analyticsDescription")}</p>
            </div>
          </div>

          <section className="analyticsSimple">
            <div className="analyticsSimpleRow">
              <label className="analyticsSimpleField">
                <span>{t("analyticsRange")}</span>
                <select value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}>
                  <option value="last30">{t("analyticsLast30Days")}</option>
                  <option value="last90">{t("analyticsLast90Days")}</option>
                  <option value="last365">{t("analyticsLast365Days")}</option>
                  <option value="all">{t("analyticsAllTime")}</option>
                  <option value="custom">{t("analyticsCustom")}</option>
                </select>
              </label>

              <label className="analyticsSimpleField">
                <span>{t("analyticsGroupBy")}</span>
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as AnalyticsGroupBy)}>
                  <option value="day">{t("analyticsDay")}</option>
                  <option value="week">{t("analyticsWeek")}</option>
                  <option value="month">{t("analyticsMonth")}</option>
                </select>
              </label>
            </div>

            {isCustomRange && (
              <div className="analyticsSimpleRow">
                <label className="analyticsSimpleField">
                  <span>{t("analyticsFrom")}</span>
                  <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </label>

                <label className="analyticsSimpleField">
                  <span>{t("analyticsTo")}</span>
                  <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
              </div>
            )}

            <div className="analyticsSimpleActions">
              <button
                type="button"
                onClick={openAnalyticsReport}
                disabled={isGeneratingReport || !!validationMessage}
                className="button analyticsSimpleButton"
              >
                {isGeneratingReport ? t("analyticsGeneratingPdf") : t("analyticsDownloadPdf")}
              </button>

              {validationMessage ? (
                <p className="analyticsSimpleError">{validationMessage}</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default Analytics;
