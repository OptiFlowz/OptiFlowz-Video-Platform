import { useAuthorization } from "~/authorization/authorization";
import { Link, NavLink } from "react-router";
import DefaultProfile from "../../../../assets/DefaultProfile.webp";
import { AnalyticsSVG, PeopleSVG, PostSVG, PlaylistSVG, PlaySVG, QuizSVG } from "~/constants";
import backgroundImage from "../../../../assets/LoginBackground.webp";
import { memo, useRef } from "react";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";
import { useI18n } from "~/i18n";

function Sidebar() {
    const { t } = useI18n();
    const { canAccess, user } = useAuthorization();
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

    const channelPath = user?.id ? `/channel/${user.id}` : undefined;
    const photo = <img src={user?.image_url || DefaultProfile} alt={channelName} />;
    const identity = <>
        <span className="videoAsideEyebrow">{t("channelLabel")}</span>
        <h3>{channelName}</h3>
        <p>{user?.email}</p>
    </>;

    return (
        <aside ref={asideRef} className="videoAside">
            <div ref={stickyRef} className="videoAsideSticky" style={stickyStyle}>
                <div className="background">
                    <img className="w-full h-full" src={backgroundImage} alt="Background" />
                </div>
                <section>
                    {channelPath ? <>
                        <Link to={channelPath} className="videoAsidePhotoLink" aria-label={`${t("channelLabel")}: ${channelName}`}>{photo}</Link>
                        <Link to={channelPath} className="videoAsideIdentity videoAsideChannelLink">{identity}</Link>
                    </> : <>{photo}<div className="videoAsideIdentity">{identity}</div></>}
                </section>
                <nav>
                    {canAccess('videos') && <NavLink to="/my-videos" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PlaySVG}&nbsp;{t("navMyVideos")}
                    </NavLink>}
                    {canAccess('playlists') && <NavLink to="/my-playlists" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PlaylistSVG}&nbsp;{t("navMyPlaylists")}
                    </NavLink>}
                    {canAccess('posts') && <NavLink to="/my-posts" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PostSVG}&nbsp;{t("navMyPosts")}
                    </NavLink>}
                    {canAccess('people') && <NavLink to="/speakers-chairs" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PeopleSVG}&nbsp;{t("navSpeakersChairs")}
                    </NavLink>}
                    {canAccess('quizzes') && <NavLink to="/quizzes" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {QuizSVG}&nbsp;{t("navQuizzes")}
                    </NavLink>}
                    {canAccess('channelAnalytics') && <NavLink to="/channel-analytics" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {AnalyticsSVG}&nbsp;{t("navChannelAnalytics")}
                    </NavLink>}
                </nav>
            </div>
        </aside>
    )
}

export default memo(Sidebar);
