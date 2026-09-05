import { useLocalizedPageTitle } from "~/hooks/useLocalizedPageTitle";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { useSearchParams } from "react-router";
import PlatformSidebar from "~/components/platformPage/sidebar/platformSidebar";
import AdvancedSettings from "~/components/platformPage/settingsPages/advancedSettings";
import AccessAndRoles from "~/components/platformPage/settingsPages/accessAndRoles";
import BrandingAndAppearance from "~/components/platformPage/settingsPages/brandingAndAppearance";
import HomepageConfiguration from "~/components/platformPage/settingsPages/homepageConfiguration";
import type { PlatformSettingsPageKey } from "~/components/platformPage/settingsPages/platformSettingsHeader";

const isSettingsPage = (value: string | null): value is PlatformSettingsPageKey =>
  value === "branding" || value === "homepage" || value === "access" || value === "advanced";

export default function PlatformSettingsPage() {
  useLocalizedPageTitle("platformSettings");
  const { isOwner } = useAuthorization();
  const [searchParams] = useSearchParams();
  const pageParam = searchParams.get("page");
  const activePage: PlatformSettingsPageKey = isOwner && isSettingsPage(pageParam) ? pageParam : isOwner ? "branding" : "access";

  return (
    <main className="myVideos videoAnalyticsPage platformPage platformSettingsPage">
      <PlatformSidebar />

      <div className="content libraryContent">
        <div className="holder libraryShell videoAnalyticsShell platformSettingsShell">
          {activePage === "branding" && <BrandingAndAppearance />}
          {activePage === "homepage" && <HomepageConfiguration />}
          {activePage === "access" && <AccessAndRoles />}
          {activePage === "advanced" && <AdvancedSettings />}
        </div>
      </div>
    </main>
  );
}
