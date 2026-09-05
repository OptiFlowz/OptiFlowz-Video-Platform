import { useAuthorization } from "~/authorization/authorization";
import { memo, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { AnalyticsSVG, PeopleSVG, SettingsSVG } from "~/constants";
import { BRAND_NAME, LOGO } from "~/changeables";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";
import { useI18n } from "~/i18n";
import backgroundImage from "../../../../assets/LoginBackground.webp";

function PlatformSidebar() {
  const { t } = useI18n();
    const { canAccess } = useAuthorization();
  const { pathname } = useLocation();
  const asideRef = useRef<HTMLElement | null>(null);
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const stickyStyle = useConstrainedSticky({
    containerRef: asideRef,
    stickyRef,
    lockHeightToContainer: true,
    disabledBelow: 800,
    topOffset: 89,
    bottomGap: 16,
  });

  return (
    <aside ref={asideRef} className="videoAside platformAside">
      <div ref={stickyRef} className="videoAsideSticky" style={stickyStyle}>
        <div className="background">
          <img className="w-full h-full" src={backgroundImage} alt="" />
        </div>
        <section>
          <img src={LOGO} alt={BRAND_NAME} />
          <div className="videoAsideIdentity">
            <span className="videoAsideEyebrow">{t("platformLabel")}</span>
            <h3>{BRAND_NAME}</h3>
            <p>{t("appName")}</p>
          </div>
        </section>
        <nav>
          {canAccess('platformSettings') && <NavLink to="/platform-settings?page=access" end className={({ isActive }) => (isActive ? "active" : "")}>
            {SettingsSVG}&nbsp;{t("platformSettings")}
          </NavLink>}
          {canAccess('platformUsers') && <NavLink to="/platform-users" end className={({ isActive }) => (isActive ? "active" : "")}>
            {PeopleSVG}&nbsp;{t("platformUsers")}
          </NavLink>}
          {canAccess('platformAnalytics') && <NavLink
            to="/platform-analytics"
            end
            className={({ isActive }) => (isActive || pathname === "/analytics" ? "active" : "")}
          >
            {AnalyticsSVG}&nbsp;{t("platformAnalytics")}
          </NavLink>}
        </nav>
      </div>
    </aside>
  );
}

export default memo(PlatformSidebar);
