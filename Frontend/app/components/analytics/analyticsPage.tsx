import { useMemo, useState } from "react";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import PageLoader from "../loaders/pageLoader";
import { env } from "~/env";
import { getToken } from "~/functions";

type AnalyticsRange = "last30" | "last90" | "last365" | "all" | "custom";
type AnalyticsGroupBy = "day" | "week" | "month";

function Analytics() {
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [range, setRange] = useState<AnalyticsRange>("last30");
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("day");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const isCustomRange = range === "custom";

  const validationMessage = useMemo(() => {
    if (!isCustomRange) return "";
    if (!from || !to) return "Choose both dates for custom range.";
    if (from > to) return "From date must be before To date.";
    return "";
  }, [from, isCustomRange, to]);

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

      if (reportWindow) {
        reportWindow.document.open();
        reportWindow.document.write(`
          <title>${filename}</title>
          <style>
            html, body {
              margin: 0;
              height: 100%;
              background: #091c42;
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
      <Sidebar />
      <PageLoader active={isGeneratingReport} />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>Analytics</h1>
              <p>Generate your video analytics PDF report.</p>
            </div>
          </div>

          <h2 className="mobileTitle">Analytics</h2>

          <section className="analyticsSimple">
            <div className="analyticsSimpleRow">
              <label className="analyticsSimpleField">
                <span>Range</span>
                <select value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}>
                  <option value="last30">Last 30 days</option>
                  <option value="last90">Last 90 days</option>
                  <option value="last365">Last 365 days</option>
                  <option value="all">All time</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              <label className="analyticsSimpleField">
                <span>Group By</span>
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as AnalyticsGroupBy)}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
            </div>

            {isCustomRange && (
              <div className="analyticsSimpleRow">
                <label className="analyticsSimpleField">
                  <span>From</span>
                  <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </label>

                <label className="analyticsSimpleField">
                  <span>To</span>
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
                {isGeneratingReport ? "Generating PDF..." : "Download PDF"}
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
