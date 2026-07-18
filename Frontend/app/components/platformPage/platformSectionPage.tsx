import PlatformSidebar from "~/components/platformPage/sidebar/platformSidebar";
import { useI18n, type TranslationKey } from "~/i18n";

type PlatformSectionPageProps = {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  messageKey: TranslationKey;
};

export default function PlatformSectionPage({
  titleKey,
  descriptionKey,
  messageKey,
}: PlatformSectionPageProps) {
  const { t } = useI18n();

  return (
    <main className="myVideos videoAnalyticsPage platformPage">
      <PlatformSidebar />

      <div className="content libraryContent">
        <div className="holder libraryShell videoAnalyticsShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t(titleKey)}</h1>
              <p>{t(descriptionKey)}</p>
            </div>
          </div>

          <p className="videoAnalyticsMessage">{t(messageKey)}</p>
        </div>
      </div>
    </main>
  );
}
