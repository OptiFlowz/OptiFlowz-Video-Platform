"use client";

import Script from "next/script";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router";
import { BRAND_NAME } from "~/changeables";
import { useI18n } from "~/i18n";

const STORAGE_KEY = "optiflowzPrivacyPreferences";
const PREFERENCES_VERSION = 1;

export type PrivacyPreferences = {
  necessary: true;
  personalization: boolean;
};

type StoredPrivacyPreferences = PrivacyPreferences & {
  version: number;
  updatedAt: string;
};

type PrivacyPreferencesContextValue = {
  preferences: PrivacyPreferences;
  hasDecision: boolean;
  openPreferences: () => void;
};

const defaultPreferences: PrivacyPreferences = {
  necessary: true,
  personalization: false,
};

const PrivacyPreferencesContext = createContext<PrivacyPreferencesContextValue>({
  preferences: defaultPreferences,
  hasDecision: false,
  openPreferences: () => undefined,
});

function readStoredPreferences(): StoredPrivacyPreferences | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredPrivacyPreferences>;
    if (parsed.version !== PREFERENCES_VERSION) return null;
    if (typeof parsed.personalization !== "boolean") {
      return null;
    }

    return {
      necessary: true,
      personalization: parsed.personalization,
      version: PREFERENCES_VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export function PrivacyPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<PrivacyPreferences>(defaultPreferences);
  const [hasDecision, setHasDecision] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [draft, setDraft] = useState<PrivacyPreferences>(defaultPreferences);

  useEffect(() => {
    const stored = readStoredPreferences();
    if (stored) {
      const next: PrivacyPreferences = {
        necessary: true,
        personalization: stored.personalization,
      };
      setPreferences(next);
      setDraft(next);
      setHasDecision(true);
    }
    setIsHydrated(true);
  }, []);

  const persist = useCallback((next: PrivacyPreferences) => {
    const stored: StoredPrivacyPreferences = {
      ...next,
      necessary: true,
      version: PREFERENCES_VERSION,
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    setPreferences(next);
    setDraft(next);
    setHasDecision(true);
    setIsPreferencesOpen(false);
  }, []);

  const openPreferences = useCallback(() => {
    setDraft(preferences);
    setIsPreferencesOpen(true);
  }, [preferences]);

  useEffect(() => {
    if (!isPreferencesOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPreferencesOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPreferencesOpen]);

  const contextValue = useMemo(
    () => ({ preferences, hasDecision, openPreferences }),
    [preferences, hasDecision, openPreferences],
  );

  return (
    <PrivacyPreferencesContext.Provider value={contextValue}>
      {children}

      <Script
        id="optiflowz-ai-widget-script"
        src="https://ai-chatbot-platform.fly.dev/widget/index.js"
        strategy="afterInteractive"
        data-agent-name={`${BRAND_NAME} AI`}
        data-chat-header-title-font-size="1.3rem"
        data-agent-description={t("privacyAiDescription")}
        data-chat-header-description-font-size="0.72rem"
        data-agent-icon="/favicon.ico"
        data-privacy-url="/privacyPolicy"
        data-questions={`["I'd like to report a problem","Tell me more about ${BRAND_NAME} Video Platform"]`}
        data-chat-desktop-width="410px"
        data-chat-desktop-height="550px"
      />

      {isHydrated && !hasDecision && (
        <section className="privacyBanner" aria-label={t("privacyBannerTitle")}>
          <div>
            <h2>{t("privacyBannerTitle")}</h2>
            <p>
              {t("privacyBannerText")} <Link to="/privacyPolicy">{t("privacyLearnMore")}</Link>
            </p>
          </div>
          <div className="privacyBannerActions">
            <button type="button" onClick={() => persist(defaultPreferences)}>
              {t("privacyRejectOptional")}
            </button>
            <button type="button" onClick={openPreferences}>
              {t("privacyCustomize")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => persist({ necessary: true, personalization: true })}
            >
              {t("privacyAcceptAll")}
            </button>
          </div>
        </section>
      )}

      {isPreferencesOpen && (
        <div
          className="privacyPreferencesBackdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsPreferencesOpen(false);
            }
          }}
        >
          <section
            className="privacyPreferencesDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-preferences-title"
          >
            <h2 id="privacy-preferences-title">{t("privacyPreferencesTitle")}</h2>
            <p>{t("privacyPreferencesIntro")}</p>

            <div className="privacyPreferenceRow">
              <div>
                <strong>{t("privacyNecessaryTitle")}</strong>
                <p>{t("privacyNecessaryText")}</p>
              </div>
              <span aria-label={t("privacyAlwaysActive")}>{t("privacyAlwaysActive")}</span>
            </div>

            <label className="privacyPreferenceRow">
              <div>
                <strong>{t("privacyPersonalizationTitle")}</strong>
                <p>{t("privacyPersonalizationText")}</p>
              </div>
              <input
                type="checkbox"
                checked={draft.personalization}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    personalization: event.target.checked,
                  }))
                }
              />
            </label>

            <p className="privacyPreferencesFootnote">
              {t("privacyPreferencesFootnote")} <Link to="/privacyPolicy">{t("footerPrivacy")}</Link>
            </p>

            <div className="privacyPreferencesActions">
              {hasDecision && (
                <button type="button" onClick={() => setIsPreferencesOpen(false)}>
                  {t("cancel")}
                </button>
              )}
              <button type="button" onClick={() => persist(defaultPreferences)}>
                {t("privacyRejectOptional")}
              </button>
              <button type="button" className="primary" onClick={() => persist(draft)}>
                {t("privacySavePreferences")}
              </button>
            </div>
          </section>
        </div>
      )}
    </PrivacyPreferencesContext.Provider>
  );
}

export function usePrivacyPreferences() {
  return useContext(PrivacyPreferencesContext);
}
