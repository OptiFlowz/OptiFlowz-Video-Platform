import { NavLink } from "react-router";
import { getStoredUser } from "~/functions";
import DefaultProfile from "../../../../assets/DefaultProfile.webp";
import { AnalyticsSVG, PeopleSVG, PlaylistSVG, PlaySVG } from "~/constants";
import backgroundImage from "../../../../assets/LoginBackground.webp";
import { memo, useRef } from "react";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";
import { useI18n } from "~/i18n";

function Sidebar() {
    const { t } = useI18n();
    const user = getStoredUser()?.user;
    const channelName = user?.full_name?.trim() || t("yourChannel");
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
        <aside ref={asideRef} className="videoAside">
            <div ref={stickyRef} className="videoAsideSticky" style={stickyStyle}>
                <div className="background">
                    <img className="w-full h-full" src={backgroundImage} alt="Background" />
                </div>
                <section>
                    <img src={user?.image_url || DefaultProfile} alt={channelName} />
                    <div className="videoAsideIdentity">
                        <span className="videoAsideEyebrow">{t("channelLabel")}</span>
                        <h3>{channelName}</h3>
                        <p>{user?.email}</p>
                    </div>
                </section>
                <nav>
                    <NavLink to="/my-videos" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PlaySVG}&nbsp;{t("navMyVideos")}
                    </NavLink>
                    <NavLink to="/my-playlists" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PlaylistSVG}&nbsp;{t("navMyPlaylists")}
                    </NavLink>
                    <NavLink to="/speakers-chairs" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PeopleSVG}&nbsp;{t("navSpeakersChairs")}
                    </NavLink>
                    <NavLink to="/analytics" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {AnalyticsSVG}&nbsp;{t("navAnalytics")}
                    </NavLink>
                </nav>
            </div>
        </aside>
    )
}

export default memo(Sidebar);
