import { Link, NavLink } from "react-router";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { useI18n } from "~/i18n";
import { BRAND_NAME, MARKETING_WEBSITE_URL } from "~/changeables";
import {
    LiveSVG, AnalyticsSVG, ChannelMenuSVG, ContinueWatchingSVG, CupOutlineSVG, ExternalSiteMenuSVG, HistorySVG,
    ArrowSVG, HomeMenuSVG, LanguageMenuSVG, LikeSVG, PeopleSVG, PlatformMenuSVG,
    PlaylistSVG, PostSVG, QuizSVG, RecommendedMenuSVG, TrendingMenuSVG, UserSVG,
} from "~/constants";
import LanguageSelect from "~/components/languageSelect/languageSelect";
import type { ReactNode } from "react";

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
    const { t, locale, setLocale } = useI18n();
    const { can, canAccess, user } = useAuthorization();
    const platformHome = canAccess('platformAnalytics') ? '/platform-analytics' : canAccess('platformUsers') ? '/platform-users' : canAccess('platformSettings') ? '/platform-settings?page=access' : null;
    const item = (to: string, label: string, icon: ReactNode) => <NavLink key={to} to={to} end
        className={({ isActive }) => `appSidebarItem${isActive ? ' isActive' : ''}`} onClick={onNavigate}>
        <span className="appSidebarIcon" data-line-icon={icon === AnalyticsSVG || icon === LiveSVG ? "true" : undefined} aria-hidden="true">{icon}</span><span>{label}</span>
    </NavLink>;
    const management = [
        canAccess('videos') && item('/my-videos', t('navMyVideos'), ChannelMenuSVG),
        canAccess('playlists') && item('/my-playlists', t('navMyPlaylists'), PlaylistSVG),
        canAccess('posts') && item('/my-posts', t('navMyPosts'), PostSVG),
        canAccess('myLivestreams') && item('/my-livestreams', t('liveMyStreams'), LiveSVG),
        canAccess('quizzes') && item('/quizzes', t('navQuizzes'), QuizSVG),
        canAccess('people') && item('/speakers-chairs', t('navSpeakersChairs'), PeopleSVG),
        canAccess('channelAnalytics') && item('/channel-analytics', t('navChannelAnalytics'), AnalyticsSVG),
        platformHome && item(platformHome, t('navPlatform'), PlatformMenuSVG),
    ].filter(Boolean);

    return <nav className="appSidebarNav" aria-label={t('menuAria')}>
        <div className="appSidebarGroup">
            {item('/', t('navHome'), HomeMenuSVG)}
            {item('/videos/1', t('navRecommended'), RecommendedMenuSVG)}
            {item('/videos/2', t('navTrending'), TrendingMenuSVG)}
            {can(P.liveLibrary) && item('/live', t('liveTitle'), LiveSVG)}
        </div>
        <section className="appSidebarGroup" aria-label={t('footerAccount')}>
            <h2 className="appSidebarSectionTitle">
                <Link to={user ? '/account' : '/login'} className="appSidebarHeading" onClick={onNavigate}>
                    {t('footerAccount')}<span className="appSidebarHeadingArrow" aria-hidden="true">{ArrowSVG}</span>
                </Link>
            </h2>
            {user ? <>
                {(can(P.videosLibrary) || can(P.liveLibrary)) && <>
                    {item('/account', t('watchHistory'), HistorySVG)}
                    {item('/account/liked', t('likedVideos'), LikeSVG)}
                    {item('/account/continue', t('continueWatching'), ContinueWatchingSVG)}
                </>}
                {can(P.playlistsLibrary) && item('/account/playlists', t('savedPlaylists'), PlaylistSVG)}
                {can(P.quizzesCertificates) && item('/account/certificates', t('accountCertificatesTitle'), CupOutlineSVG)}
            </> : item('/login', t('login'), UserSVG)}
        </section>
        {management.length > 0 && <section className="appSidebarGroup" aria-label={t('navSectionManage')}>
            <h2 className="appSidebarHeading appSidebarSectionTitle">{t('navSectionManage')}</h2>
            {management}
        </section>}
        <section className="appSidebarGroup" aria-label={t('more')}>
            <h2 className="appSidebarHeading appSidebarSectionTitle">{t('more')}</h2>
            <Link to={MARKETING_WEBSITE_URL} className="appSidebarItem" onClick={onNavigate}>
                <span className="appSidebarIcon" aria-hidden="true">{ExternalSiteMenuSVG}</span>{BRAND_NAME}
            </Link>
            <LanguageSelect value={locale} onChange={setLocale} ariaLabel={t('accountLanguage')}
                label={t('accountLanguage')} variant="mobile" placement="top" leadingContent={LanguageMenuSVG} />
        </section>
    </nav>;
}
