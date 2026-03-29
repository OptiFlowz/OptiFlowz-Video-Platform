import { NavLink } from "react-router";
import { getStoredUser } from "~/functions";
import DefaultProfile from "../../../../assets/DefaultProfile.webp";
import { AnalyticsSVG, PlaylistSVG, PlaySVG, UploadSVG } from "~/constants";
import backgroundImage from "../../../../assets/LoginBackground.webp";
import { memo, useRef } from "react";
import { useConstrainedSticky } from "~/components/shared/useConstrainedSticky";

function Sidebar() {
    const user = getStoredUser()?.user;
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
                    <img src={user?.image_url || DefaultProfile} alt="" />
                    <h3>Your channel</h3>
                    <p>{user?.email}</p>
                </section>
                <nav>
                    <NavLink to="/my-videos" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PlaySVG}&nbsp;My videos
                    </NavLink>
                    <NavLink to="/upload" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {UploadSVG}&nbsp;Upload Video
                    </NavLink>
                    <NavLink to="/my-playlists" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {PlaylistSVG}&nbsp;My playlists
                    </NavLink>
                    <NavLink to="/analytics" end className={({ isActive }) => (isActive ? "active" : "")}>
                        {AnalyticsSVG}&nbsp;Analytics
                    </NavLink>
                </nav>
            </div>
        </aside>
    )
}

export default memo(Sidebar);
