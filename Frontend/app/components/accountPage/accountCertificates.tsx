import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchFn } from "~/API";
import { env } from "~/env";
import { formatDate, getToken } from "~/functions";
import { useI18n } from "~/i18n";

type Certificate = {
  quiz_id: string;
  quiz_title: string;
  attempt_id: string;
  date_of_completion?: string | null;
};

type CertificatesResponse = {
  success: boolean;
  certificates?: Certificate[];
};

type CertificateStatus = "loading" | "empty" | "has-data";

type Props = {
  onDataStateChange?: (state: CertificateStatus) => void;
};

const DownloadIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 20H19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const formatCertificateDate = (value?: string | null) => {
  if (!value) return "";

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "";

  return formatDate(value);
};

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

function AccountCertificates({ onDataStateChange }: Props) {
  const { t } = useI18n();
  const token = getToken();
  const [downloadingAttemptId, setDownloadingAttemptId] = useState<string | null>(null);
  const headers = useMemo(() => {
    const nextHeaders = new Headers();
    if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
    return nextHeaders;
  }, [token]);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["quizCertificates", token],
    queryFn: () =>
      fetchFn<CertificatesResponse>({
        route: "api/quizzes/certificates",
        options: {
          method: "GET",
          headers,
        },
      }),
    enabled: !!token,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const certificates = data?.certificates ?? [];

  useEffect(() => {
    if (isLoading || (isFetching && certificates.length === 0)) {
      onDataStateChange?.("loading");
      return;
    }

    onDataStateChange?.(certificates.length > 0 ? "has-data" : "empty");
  }, [certificates.length, isFetching, isLoading, onDataStateChange]);

  const handleDownloadCertificate = async (certificate: Certificate) => {
    if (!token || downloadingAttemptId) return;

    setDownloadingAttemptId(certificate.attempt_id);

    try {
      const response = await fetch(`${env.apiBaseUrl}/api/quizzes/certificate/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/pdf",
        },
        body: JSON.stringify({
          quiz_id: certificate.quiz_id,
          attempt_id: certificate.attempt_id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate certificate PDF. (${response.status})`);
      }

      const pdfBlob = await response.blob();
      const objectUrl = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      const fileName = sanitizeFileName(certificate.quiz_title || t("quizDefaultTitle")) || "certificate";

      link.href = objectUrl;
      link.download = `${fileName}-certificate.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloadingAttemptId(null);
    }
  };

  if (isLoading || (isFetching && certificates.length === 0)) {
    return (
      <section className="accountCertificates contentSection mt-8 max-[450px]:mt-3" aria-label={t("accountCertificatesTitle")}>
        <span className="collection-header">
          <span className="flex items-center gap-5">
            <h2 className="subTitle p-0!">{t("accountCertificatesTitle")}</h2>
          </span>
        </span>
        <div className="accountCertificatesGrid">
          <div className="certificateCard skeletonCertificateCard" />
          <div className="certificateCard skeletonCertificateCard" />
        </div>
      </section>
    );
  }

  if (isError || certificates.length === 0) {
    return null;
  }

  return (
    <section className="accountCertificates contentSection mt-8 max-[450px]:mt-3" aria-label={t("accountCertificatesTitle")}>
      <span className="collection-header">
        <span className="flex items-center gap-5">
          <h2 className="subTitle p-0!">{t("accountCertificatesTitle")}</h2>
        </span>
      </span>
      <div className="accountCertificatesGrid">
        {certificates.map((certificate) => {
          const completionDate = formatCertificateDate(certificate.date_of_completion);
          const title = certificate.quiz_title || t("quizDefaultTitle");

          return (
            <article
              className="certificateCard"
              key={certificate.attempt_id}
              role="button"
              tabIndex={0}
              onClick={() => handleDownloadCertificate(certificate)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleDownloadCertificate(certificate);
                }
              }}
              aria-label={t("certificateDownload")}
            >
              <div className="certificatePreview">
                <div className="certificatePreviewText">
                  <strong>CERTIFICATE</strong>
                  <span>OF COMPLETION</span>
                  <p>{title}</p>
                </div>
                <button
                  type="button"
                  className="certificateDownloadButton"
                  aria-label={t("certificateDownload")}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDownloadCertificate(certificate);
                  }}
                  disabled={downloadingAttemptId === certificate.attempt_id}
                >
                  {downloadingAttemptId === certificate.attempt_id ? (
                    <span className="certificateDownloadSpinner" aria-hidden="true" />
                  ) : (
                    DownloadIcon
                  )}
                  <span>{downloadingAttemptId === certificate.attempt_id ? "Downloading" : t("certificateDownload")}</span>
                </button>
              </div>
              <h3>{t("certificateFor", { title })}</h3>
              {completionDate ? <p className="certificateDate">{completionDate}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default AccountCertificates;
