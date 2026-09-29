import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "~/functions";
import { accountLibraryQuery, accountCertificatesQuery } from "./accountQueries";
import { useLocalizedPageTitle } from "~/hooks/useLocalizedPageTitle";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { ContinueWatchingSVG, CupOutlineSVG, EditSVG, HistorySVG, LikeSVG, LogOutSVG, PlaylistSVG, SettingsSVG } from "~/constants";
import AccountInfo from "./accountInfo";
import AccountLibrary from "./accountLibrary";
import "./accountTabs.css";
import ProfileTabs from "../library/ProfileTabs";
import { useEffect, useId, useRef, useState } from "react";
import { redirectToLogin } from "~/auth/session";
import EditAccountPopup from "./editAccountPopup";
import SettingsPopup from "./settingsPopup";
import AccountCertificates from "./accountCertificates";
import { useI18n } from "~/i18n";
import backgroundImage from "../../../assets/LoginBackground.webp";

const accountTabs = [
    { id: 'history', icon: HistorySVG, label: 'watchHistory', type: 4, permission: P.videosLibrary },
    { id: 'liked', icon: LikeSVG, label: 'likedVideos', type: 3, permission: P.videosLibrary },
    { id: 'continue', icon: ContinueWatchingSVG, label: 'continueWatching', type: 0, permission: P.videosLibrary },
    { id: 'playlists', icon: PlaylistSVG, label: 'savedPlaylists', type: 6, permission: P.playlistsLibrary },
    { id: 'certificates', icon: CupOutlineSVG, label: 'accountCertificatesTitle', type: null, permission: P.quizzesCertificates },
] as const;

function AccountPage(){
  useLocalizedPageTitle("footerAccount");
    const { t } = useI18n();
    const { can } = useAuthorization();
    const [isEditPopupOpen, setIsEditPopupOpen] = useState(false);
    const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false);
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const selectedTab = pathname.replace(/\/$/, '').split('/')[2] || 'history';
    const selectTab = (id: string) => {
        if (id === selectedTab) return;
        navigate(id === 'history' ? '/account' : `/account/${id}`, { preventScrollReset: true, shallow: true });
    };
    const queryClient = useQueryClient();
    const token = getToken();
    const canViewVideos = can(P.videosLibrary);
    const canViewPlaylists = can(P.playlistsLibrary);
    const canViewCertificates = can(P.quizzesCertificates);
    useEffect(() => {
        if (!token) return;
        if (canViewVideos) {
            for (const type of [4, 3, 0] as const) void queryClient.prefetchInfiniteQuery(accountLibraryQuery(type, token));
        }
        if (canViewPlaylists) void queryClient.prefetchInfiniteQuery(accountLibraryQuery(6, token));
        if (canViewCertificates) void queryClient.prefetchQuery(accountCertificatesQuery(token));
    }, [queryClient, token, canViewVideos, canViewPlaylists, canViewCertificates]);
    const tabsId = useId();
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const tabs = accountTabs.filter(tab => can(tab.permission));
    const activeTab = tabs.find(tab => tab.id === selectedTab) ?? tabs[0];
    const logoutHandle = () => {
        redirectToLogin();
    }

    return (
        <>
            <main className="account accountPage">
                <section className="accountHero">
                    <div className="accountHeroBackground" aria-hidden="true">
                        <img src={backgroundImage} alt="" />
                    </div>

                    <div className="accountHeroContent">
                        <AccountInfo />

                        <div className="accountActions">
                        <span>
                            <button className="edit button" onClick={() => setIsEditPopupOpen(true)}>
                                {EditSVG}
                                <p>{t("accountEdit")}</p>
                            </button>
                            <button className="settings button" onClick={() => setIsSettingsPopupOpen(true)}>
                                {SettingsSVG}
                                <p>{t("settings")}</p>
                            </button>
                        </span>
                        <button className="logOut button" onClick={logoutHandle}>
                            {LogOutSVG}
                            <p>{t("accountLogout")}</p>
                        </button>
                        </div>
                    </div>
                </section>

                {activeTab && <>
                    <div className="accountTabNavigation">
                        <ProfileTabs className="accountTabs" label={t('footerAccount')}>
                            {tabs.map((tab, index) => <button
                                key={tab.id}
                                ref={element => { tabRefs.current[index] = element; }}
                                type="button"
                                role="tab"
                                id={`${tabsId}-${tab.id}-tab`}
                                aria-controls={`${tabsId}-${tab.id}-panel`}
                                aria-selected={activeTab.id === tab.id}
                                tabIndex={activeTab.id === tab.id ? 0 : -1}
                                onClick={() => selectTab(tab.id)}
                                onKeyDown={event => {
                                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                                    event.preventDefault();
                                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                                        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                                    selectTab(tabs[next].id);
                                    tabRefs.current[next]?.focus();
                                    tabRefs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                                }}
                            ><span className="profileTabIcon" aria-hidden="true">{tab.icon}</span><span>{t(tab.label)}</span></button>)}
                        </ProfileTabs>
                    </div>
                    {tabs.map(tab => <div
                        key={tab.id}
                        className="accountTabPanel"
                        role="tabpanel"
                        id={`${tabsId}-${tab.id}-panel`}
                        aria-labelledby={`${tabsId}-${tab.id}-tab`}
                        hidden={activeTab.id !== tab.id}
                        tabIndex={0}
                    >
                        {activeTab.id === tab.id && (tab.type === null
                            ? <AccountCertificates />
                            : <AccountLibrary type={tab.type} />)}
                    </div>)}
                </>}
            </main>

            <EditAccountPopup open={isEditPopupOpen} onClose={() => setIsEditPopupOpen(false)} />
            <SettingsPopup open={isSettingsPopupOpen} onClose={() => setIsSettingsPopupOpen(false)} />
        </>
    );
}

export default AccountPage;
