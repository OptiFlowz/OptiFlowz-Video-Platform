import { useHydrated } from "~/hooks/useHydrated";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router";
import {
    ChannelMenuSVG, CloseSVG, EditModeSVG, LanguageMenuSVG, LogOutSVG, MenuSVG,
    PlatformMenuSVG, SearchSVGWhite, UserSVG,
} from "~/constants";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { getToken, getStoredUser } from "~/functions";
import { redirectToLogin } from "~/auth/session";
import type { AuthFetchT, VideoT } from "~/types";
import { useI18n } from "~/i18n";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { LOGO, BRAND_NAME } from "~/changeables";
import LanguageSelect from "~/components/languageSelect/languageSelect";

type HeaderProps = { onMenuToggle?: () => void; menuExpanded?: boolean };

function Header({ onMenuToggle, menuExpanded = false }: HeaderProps){
    const { locale, setLocale, t } = useI18n();
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [accountMenuPosition, setAccountMenuPosition] = useState({ top: 0, right: 0 });
    const navigate = useNavigate();
    const {searchValue} = useParams();
    const { videoId } = useParams();
    const idToEdit = videoId || "";
    // Observe the watch page's cached video without issuing a second request.
    const { data: currentVideo } = useQuery<VideoT>({
        queryKey: ['video', videoId],
        queryFn: skipToken,
        enabled: false,
    });


    const { can, canOwn, canAccess, user: authUser } = useAuthorization();
    const channelHome = canAccess('videos') ? '/my-videos' : canAccess('myLivestreams') ? '/my-livestreams' : canAccess('playlists') ? '/my-playlists' : canAccess('quizzes') ? '/quizzes' : canAccess('people') ? '/speakers-chairs' : canAccess('channelAnalytics') ? '/channel-analytics' : canAccess('upload') ? '/upload' : null;
    const platformHome = canAccess('platformAnalytics') ? '/platform-analytics' : canAccess('platformUsers') ? '/platform-users' : canAccess('platformSettings') ? '/platform-settings?page=access' : null;
    const hasManagementAccess = !!channelHome || !!platformHome;

    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchFormRef = useRef<HTMLFormElement>(null);
    const searchToggleRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (menuExpanded) setMobileSearchOpen(false);
    }, [menuExpanded]);
    useEffect(() => {
        if (!mobileSearchOpen) return;
        searchInputRef.current?.focus();
        const closeOutside = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!searchFormRef.current?.contains(target) && !searchToggleRef.current?.contains(target)) setMobileSearchOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setMobileSearchOpen(false);
            searchToggleRef.current?.focus();
        };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [mobileSearchOpen]);
    const [searchTerm, setSearchTerm] = useState(searchValue ?? "");
    useEffect(() => setSearchTerm(searchValue ?? ""), [searchValue]);
    const accountMenuRef = useRef<HTMLDivElement>(null);
    const accountDropdownRef = useRef<HTMLDivElement>(null);
    const accountCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelAccountClose = () => {
        if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
        accountCloseTimer.current = null;
    };
    const openAccountMenu = () => {
        cancelAccountClose();
        const bounds = accountMenuRef.current?.getBoundingClientRect();
        if (bounds) setAccountMenuPosition({ top: bounds.bottom + 10, right: Math.max(16, window.innerWidth - bounds.right) });
        setAccountMenuOpen(true);
    };
    const scheduleAccountClose = () => {
        cancelAccountClose();
        accountCloseTimer.current = setTimeout(() => setAccountMenuOpen(false), 250);
    };
    useEffect(() => () => {
        if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
    }, []);


    const hydrated = useHydrated();
    const token = hydrated ? getToken() : null;
    const headerUserData = authUser ? { user: authUser } : undefined;

    //LISTEN FOR PROFILE UPDATE
    const queryClient = useQueryClient();
    
    useEffect(() => {

        const handleUpdate = () => {
            const newUser = getStoredUser();

            if(newUser && headerUserData){
                queryClient.setQueriesData<AuthFetchT>(
                      { queryKey: ["accountInfo", token] },
                      (old) => {
                        if (!old) return old;
                
                        return {
                          ...old,
                          user: {
                            ...old.user,
                            image_url: newUser.user.image_url
                          }
                        };
                      }
                    );
            }
        }
        
        window.addEventListener("update-header", handleUpdate);

        return () => window.removeEventListener("update-header", handleUpdate);
    }, [headerUserData]);
    //

    useEffect(() => {
        if (!accountMenuOpen) return;

        const handleClickOutside = (event: Event) => {
            const target = event.target as Node;
            if (
                !accountMenuRef.current?.contains(target) &&
                !accountDropdownRef.current?.contains(target)
            ) {
                setAccountMenuOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
                cancelAccountClose();
                setAccountMenuOpen(false);
                accountMenuRef.current?.querySelector("button")?.focus();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("focusin", handleClickOutside);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("focusin", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [accountMenuOpen]);

    useEffect(() => {
        if (!accountMenuOpen) return;

        const updateAccountMenuPosition = () => {
            const triggerBounds = accountMenuRef.current?.getBoundingClientRect();
            if (!triggerBounds) return;

            setAccountMenuPosition({
                top: triggerBounds.bottom + 10,
                right: Math.max(16, window.innerWidth - triggerBounds.right),
            });
        };

        updateAccountMenuPosition();
        window.addEventListener("resize", updateAccountMenuPosition);
        window.addEventListener("scroll", updateAccountMenuPosition, true);

        return () => {
            window.removeEventListener("resize", updateAccountMenuPosition);
            window.removeEventListener("scroll", updateAccountMenuPosition, true);
        };
    }, [accountMenuOpen]);

    const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const term = searchTerm.trim();
        if (term) setMobileSearchOpen(false);
        if (term && term !== searchValue) navigate(`/search/${encodeURIComponent(term)}`);
    };

    const hasAuthenticatedUser = !!headerUserData?.user && !!token;

    const handleLogout = () => {
        redirectToLogin();
    }

    return <>
        <header data-app-header className="appHeader">
            <div className="appHeaderInner">
                <div className="appHeaderBrand">
                    <button type="button" className="appMenuToggle" onClick={onMenuToggle}
                        aria-label={t("menuAria")} aria-expanded={menuExpanded} aria-controls="app-sidebar">
                        {MenuSVG}
                    </button>
                {/* Logo - Klikabilan */}
                <Link to="/" className="logo flex gap-3 items-center cursor-pointer hover:opacity-80 transition-opacity">
                    <img
                        src={LOGO}
                        alt={BRAND_NAME + " Logo"}
                        className="w-9 h-9 object-contain shrink-0"
                    />
                    <span className="p-0">
                        <h3 className="font-medium text-xl -mb-1.25">{BRAND_NAME}</h3>
                        <p className="font-light text-sm">{t("appName")}</p>
                    </span>
                </Link>

                </div>
                <form id="header-search" ref={searchFormRef} className={`appHeaderSearch${mobileSearchOpen ? " isMobileOpen" : ""}`} role="search" onSubmit={handleSearch}>
                    <input ref={searchInputRef} type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)}
                        placeholder={t("searchPlaceholder")} aria-label={t("searchAria")} spellCheck={false} />
                    <button type="submit" aria-label={t("searchAria")}>{SearchSVGWhite}</button>
                </form>

                <div className={`appHeaderActions flex ${hasManagementAccess ? "gap-3" : "gap-1"} max-[650px]:gap-2 max-[500px]:gap-0.5 items-center`}>
                    {/* Admin Edit Mode Switch */}
                    {idToEdit !== '' && (currentVideo?.kind === 'live' ? canOwn(P.liveUpdateOwn, P.liveUpdateAny, currentVideo.uploader_id) : can(P.videosUpdateAny)) && (
                        <Link to={currentVideo?.kind === 'live' ? `/live/${idToEdit}/studio` : `/edit?video=${idToEdit}`} className="darkSVG max-[800px]:hidden flex items-center p-2.5 hover:bg-(--background2) rounded-full transition-all duration-200 cursor-pointer">
                            <span className="w-6 h-6 flex items-center justify-center">{EditModeSVG}</span>
                        </Link>
                    )}
                    <button ref={searchToggleRef} type="button" className="appMenuToggle appMobileSearchToggle"
                        aria-label={t(mobileSearchOpen ? "close" : "searchAria")} aria-expanded={mobileSearchOpen}
                        aria-controls="header-search" onClick={() => setMobileSearchOpen(open => !open)}>
                        {mobileSearchOpen ? CloseSVG : SearchSVGWhite}
                    </button>
                    {/* Account Icon */}
                    <Link 
                        className={`darkSVG hidden max-[500px]:flex items-center p-1 rounded-full transition-all duration-200 cursor-pointer`} 
                        to={hasAuthenticatedUser ? "/account" : "/login"}
                    >
                        <img 
                            className="accountImg rounded-full w-9 h-9 aspect-square object-cover"
                            src={headerUserData?.user?.image_url || DefaultProfile}
                            alt={t("profilePhotoAlt")}
                            onError={e => {
                                e.currentTarget.src = DefaultProfile;
                            }}
                        />
                    </Link>

                    {hasAuthenticatedUser ? (
                        <div ref={accountMenuRef} className="adminAvatarMenuWrap darkSVG max-[500px]:hidden">
                            <button
                                type="button"
                                className={`adminAvatarTrigger flex items-center ${hasManagementAccess ? "bg-(--accentOrange) p-1" : "p-1 pl-3 max-[1075px]:pl-1"} rounded-full transition-all duration-200 cursor-pointer`}
                                onPointerEnter={event => { if (event.pointerType === "mouse") openAccountMenu(); }}
                                onPointerLeave={event => { if (event.pointerType === "mouse") scheduleAccountClose(); }}
                                onClick={event => {
                                    cancelAccountClose();
                                    if (event.detail === 0 && accountMenuOpen) setAccountMenuOpen(false);
                                    else openAccountMenu();
                                }}
                                aria-haspopup="menu"
                                aria-expanded={accountMenuOpen}
                                aria-controls={accountMenuOpen ? "header-account-menu" : undefined}
                                aria-label={t("accountMenuAria")}
                            >
                                {!hasManagementAccess ? (
                                    <p className="mr-2.5 font-medium max-[1075px]:hidden">
                                        <span>👋&nbsp;{t("helloUser", {firstName: headerUserData.user.full_name.split(" ")[0]})}</span>
                                    </p>
                                ) : null}
                                <img 
                                    className="accountImg rounded-full w-9 h-9 aspect-square object-cover"
                                    src={headerUserData?.user?.image_url || DefaultProfile}
                                    alt={t("profilePhotoAlt")}
                                    onError={e => {
                                        e.currentTarget.src = DefaultProfile;
                                    }}
                                />
                            </button>

                            {accountMenuOpen && typeof document !== "undefined" ? createPortal(
                                <div
                                    ref={accountDropdownRef}
                                    id="header-account-menu"
                                    className="adminAvatarDropdown darkSVG animate-slideIn"
                                    onPointerEnter={cancelAccountClose}
                                    onPointerLeave={event => { if (event.pointerType === "mouse") scheduleAccountClose(); }}
                                    role="menu"
                                    aria-label={t("accountMenuAria")}
                                    style={accountMenuPosition}
                                >
                                    <div className="adminAvatarIdentitySection" role="group">
                                        <Link to="/account" className="adminAvatarIdentity" role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                                            <img className="adminAvatarIdentityImage"
                                                src={headerUserData.user.image_url || DefaultProfile}
                                                alt=""
                                                onError={event => { event.currentTarget.src = DefaultProfile; }}
                                            />
                                            <div className="adminAvatarIdentityText">
                                                <strong title={headerUserData.user.full_name}>{headerUserData.user.full_name}</strong>
                                                <span title={headerUserData.user.email}>{headerUserData.user.email}</span>
                                            </div>
                                        </Link>
                                    </div>
                                    <Link
                                        to="/account"
                                        className="adminAvatarDropdownItem"
                                        role="menuitem"
                                        onClick={() => setAccountMenuOpen(false)}
                                    >
                                        <span className="adminAvatarDropdownIcon" aria-hidden="true">{UserSVG}</span>
                                        <span>{t("footerAccount")}</span>
                                    </Link>
                                    <div
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <LanguageSelect
                                            value={locale}
                                            onChange={setLocale}
                                            ariaLabel={t("accountLanguage")}
                                            label={t("accountLanguage")}
                                            variant="menu"
                                            leadingContent={LanguageMenuSVG}
                                        />
                                    </div>
                                    {channelHome ? (
                                        <Link
                                            to={channelHome}
                                            className="adminAvatarDropdownItem"
                                            role="menuitem"
                                            onClick={() => setAccountMenuOpen(false)}
                                        >
                                            <span className="adminAvatarDropdownIcon" aria-hidden="true">{ChannelMenuSVG}</span>
                                            <span>{t("channelLabel")}</span>
                                        </Link>
                                    ) : null}
                                    {platformHome ? (
                                        <Link
                                            to={platformHome}
                                            className="adminAvatarDropdownItem"
                                            role="menuitem"
                                            onClick={() => setAccountMenuOpen(false)}
                                        >
                                            <span className="adminAvatarDropdownIcon" aria-hidden="true">{PlatformMenuSVG}</span>
                                            <span>{t("navPlatform")}</span>
                                        </Link>
                                    ) : null}
                                    <div className="adminAvatarSignOut" role="group">
                                        <button
                                            type="button"
                                            className="adminAvatarDropdownItem"
                                            role="menuitem"
                                            onClick={handleLogout}
                                        >
                                            <span className="adminAvatarDropdownIcon" aria-hidden="true">{LogOutSVG}</span>
                                            <span>{t("accountLogout")}</span>
                                        </button>
                                    </div>
                                </div>,
                                document.body
                            ) : null}
                        </div>
                    ) : (
                        <Link 
                            className="darkSVG flex items-center p-1 pl-3 max-[1075px]:pl-1 max-[500px]:hidden hover:bg-(--background2) rounded-full transition-all duration-200 cursor-pointer"
                            to="/login"
                        >
                            <p className="mr-2.5 font-medium max-[1075px]:hidden">{t("login")}</p>
                            <img 
                                className="accountImg rounded-full w-9 h-9 aspect-square object-cover"
                                src={DefaultProfile}
                                alt={t("profilePhotoAlt")}
                            />
                        </Link>
                    )}

                </div>
            </div>
        </header>
    </>;
}

export default memo(Header);
