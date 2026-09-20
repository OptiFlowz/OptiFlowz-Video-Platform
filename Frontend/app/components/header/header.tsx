import { useHydrated } from "~/hooks/useHydrated";
import { PostSVG } from "~/constants";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { usePathname } from "next/navigation";
import {
    AnalyticsSVG, ChannelMenuSVG, CloseSVG, EditModeSVG, ExternalSiteMenuSVG,
    HomeMenuSVG, LanguageMenuSVG, LogOutSVG, MenuSVG, PeopleSVG,
    PlatformMenuSVG, PlaylistSVG, QuizSVG, RecommendedMenuSVG, SearchSVG,
    SearchSVGWhite, TrendingMenuSVG, UserSVG,
} from "~/constants";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { getToken, getStoredUser } from "~/functions";
import { redirectToLogin } from "~/auth/session";
import type { AuthFetchT } from "~/types";
import { useI18n } from "~/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { LOGO, BRAND_NAME, MARKETING_WEBSITE_URL } from "~/changeables";
import LanguageSelect from "~/components/languageSelect/languageSelect";

// Next remounts this page-level header during navigation. Retain only the route,
// then measure its link again so the underline can continue across that remount.
let previousNavigationPath: string | null = null;

function Header(){
    const { locale, setLocale, t } = useI18n();
    const pathname = usePathname();
    const navigationRef = useRef<HTMLElement>(null);
    const navigationMeasuredRef = useRef(false);
    const navigationStartingPathRef = useRef<string | null | undefined>(undefined);
    const [navigationIndicator, setNavigationIndicator] = useState<{ left: number; width: number; visible: boolean } | null>(null);

    useLayoutEffect(() => {
        const navigation = navigationRef.current;
        if (!navigation) return;
        if (navigationStartingPathRef.current === undefined) {
            navigationStartingPathRef.current = previousNavigationPath;
        }
        let firstFrame = 0;
        let secondFrame = 0;
        let entering = false;

        const measureLink = (link: HTMLAnchorElement) => {
            const navigationBounds = navigation.getBoundingClientRect();
            const linkBounds = link.getBoundingClientRect();
            const style = getComputedStyle(link);
            const paddingLeft = parseFloat(style.paddingLeft) || 0;
            const paddingRight = parseFloat(style.paddingRight) || 0;
            return {
                left: linkBounds.left - navigationBounds.left + paddingLeft,
                width: linkBounds.width - paddingLeft - paddingRight,
                visible: true,
            };
        };

        const updateIndicator = () => {
            if (entering) return;
            const activeLink = navigation.querySelector<HTMLAnchorElement>("a.active");
            if (!activeLink || !activeLink.getClientRects().length) {
                setNavigationIndicator(previous => previous?.visible ? { ...previous, visible: false } : previous);
                return;
            }

            const { left, width } = measureLink(activeLink);
            setNavigationIndicator(previous =>
                previous?.visible && previous.left === left && previous.width === width
                    ? previous
                    : { left, width, visible: true },
            );
        };

        const previousLink = Array.from(navigation.querySelectorAll<HTMLAnchorElement>("a"))
            .find(link => link.getAttribute("href") === navigationStartingPathRef.current);
        if (!navigationMeasuredRef.current && navigationStartingPathRef.current !== pathname &&
            previousLink?.getClientRects().length && navigation.querySelector("a.active") &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setNavigationIndicator(measureLink(previousLink));
            entering = true;
            // Paint the starting position before transitioning to the new link.
            firstFrame = requestAnimationFrame(() => {
                secondFrame = requestAnimationFrame(() => {
                    entering = false;
                    navigationMeasuredRef.current = true;
                    updateIndicator();
                });
            });
        } else {
            navigationMeasuredRef.current = true;
            updateIndicator();
        }
        previousNavigationPath = pathname;
        const observer = new ResizeObserver(updateIndicator);
        observer.observe(navigation);
        navigation.querySelectorAll("a").forEach(link => observer.observe(link));
        window.addEventListener("resize", updateIndicator);
        return () => {
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
            observer.disconnect();
            window.removeEventListener("resize", updateIndicator);
        };
    }, [pathname, locale]);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchFocusArmed, setSearchFocusArmed] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [accountMenuPosition, setAccountMenuPosition] = useState({ top: 0, right: 0 });
    const navigate = useNavigate();
    const {searchValue} = useParams();
    const { videoId } = useParams();
    const idToEdit = videoId || "";

    const { can, canAccess, user: authUser } = useAuthorization();
    const channelHome = canAccess('videos') ? '/my-videos' : canAccess('playlists') ? '/my-playlists' : canAccess('quizzes') ? '/quizzes' : canAccess('people') ? '/speakers-chairs' : canAccess('channelAnalytics') ? '/channel-analytics' : canAccess('upload') ? '/upload' : null;
    const platformHome = canAccess('platformAnalytics') ? '/platform-analytics' : canAccess('platformUsers') ? '/platform-users' : canAccess('platformSettings') ? '/platform-settings?page=access' : null;
    const hasManagementAccess = !!channelHome || !!platformHome;

    const searchRef1 = useRef<HTMLInputElement>(null);
    const searchRef2 = useRef<HTMLInputElement>(null);
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
        if (searchOpen) {
            setSearchFocusArmed(false);
            const timeout = window.setTimeout(() => {
                setSearchFocusArmed(true);
            }, 180);

            return () => window.clearTimeout(timeout);
        }

        setSearchFocusArmed(false);
        searchRef2.current?.blur();
    }, [searchOpen]);

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

    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if(e.key !== "Enter") return;

        const searchVal = searchRef1?.current?.value || searchRef2?.current?.value;

        if(searchVal && searchVal !== searchValue){
            navigate(`/search/${encodeURIComponent(searchVal.trim())}`);
            setSearchOpen(false);
        }
    }

    const handleSearchButton = () => {
        const searchVal = searchRef1?.current?.value || searchRef2?.current?.value;

        if(searchVal && searchVal !== searchValue){
            navigate(`/search/${encodeURIComponent(searchVal.trim())}`);
            setSearchOpen(false);
        }
    }

    const closeMobileMenu = () => {
        setMobileMenuOpen(false);
    }

    const hasAuthenticatedUser = !!headerUserData?.user && !!token;

    const handleLogout = () => {
        redirectToLogin();
    }

    return <>
        <header data-app-header className={`fixed w-full px-4 max-[800px]:pr-1.5 z-10 duration-300 ${searchOpen ? "search-open-mobile" : ""}`}>
            <div className="max-w-(--contentWidth) py-3 flex justify-between items-center mx-auto relative">
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

                {/* Desktop Navigation */}
                <nav ref={navigationRef} className="primaryNavigation flex max-[800px]:hidden">
                    <Link className="primaryNavigationBrand" to={MARKETING_WEBSITE_URL}>{BRAND_NAME}</Link>
                    <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>{t("navHome")}</NavLink>
                    <NavLink to="/videos/1" end className={({ isActive }) => (isActive ? "active" : "")}>{t("navRecommended")}</NavLink>
                    <NavLink to="/videos/2" end className={({ isActive }) => (isActive ? "active" : "")}>{t("navTrending")}</NavLink>
                    {navigationIndicator && <span
                        className="primaryNavigationIndicator"
                        aria-hidden="true"
                        style={{
                            transform: `translateX(${navigationIndicator.left}px)`,
                            width: navigationIndicator.width,
                            opacity: navigationIndicator.visible ? 1 : 0,
                        }}
                    />}
                </nav>

                <div className={`flex ${hasManagementAccess ? "gap-3" : "gap-1"} max-[650px]:gap-2 max-[500px]:gap-0.5 items-center`}>
                    {/* Admin Edit Mode Switch */}
                    {can(P.videosUpdateAny) && idToEdit != "" && (
                        <Link to={`/edit?video=${idToEdit}`} className="darkSVG max-[800px]:hidden flex items-center p-2.5 hover:bg-(--background2) rounded-full transition-all duration-200 cursor-pointer">
                            <span className="w-6 h-6 flex items-center justify-center">{EditModeSVG}</span>
                        </Link>
                    )}
                    {/* Search Icon */}
                    <button 
                        className={`darkSVG flex p-2.5 hover:bg-(--background2) rounded-full transition-all duration-200 cursor-pointer ${searchOpen ? "searchOpen" : ""}`}
                        onClick={() => {
                            const nextOpen = !searchOpen;
                            setSearchOpen(nextOpen);
                            if (mobileMenuOpen) setMobileMenuOpen(false);
                            if (nextOpen) {
                                searchRef2.current?.focus();
                            }
                        }}
                        aria-label={t("searchAria")}
                    >
                        <span className="w-6 h-6 flex items-center justify-center transition-all duration-200">{!searchOpen ? SearchSVGWhite : CloseSVG}</span>
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

                    {/* Mobile Menu Button */}
                    <button 
                        className="darkSVG hidden max-[800px]:flex p-2.5 hover:bg-(--background2) rounded-full transition-all duration-200 cursor-pointer"
                        onClick={() => {
                            setMobileMenuOpen(!mobileMenuOpen);
                            if (searchOpen) setSearchOpen(false);
                        }}
                        aria-label={t("menuAria")}
                    >
                        <span className="w-6 h-6 flex items-center justify-center transition-all duration-200">
                            {!mobileMenuOpen ? (
                                MenuSVG
                            ) : (
                                CloseSVG
                            )}
                        </span>
                    </button>
                </div>

                {/* Search Bar Mobile */}
                <div className={`searchPanel ${searchOpen ? 'open' : ''} ${searchFocusArmed ? 'focus-armed' : ''}`}>
                    <div className="searchPanelInner p-2">
                        <span className="search w-full cursor-text flex items-center gap-2">
                            <span className="w-6 h-6 flex items-center justify-center shrink-0">{SearchSVG}</span>
                            <input 
                                ref={searchRef2}
                                type="text" 
                                placeholder={t("searchPlaceholder")} 
                                className="flex-1 w-full cursor-text"
                                onKeyDown={e => handleSearch(e)} 
                                spellCheck="false"
                            />
                            <button onClick={handleSearchButton}>{SearchSVG}</button>
                        </span>
                    </div>
                </div>
            </div>
        </header>

        {/* Mobile Sidebar Menu */}
        <aside
            className={`mobileSideMenu max-[800px]:flex hidden ${mobileMenuOpen ? "open" : ""}`}
            aria-hidden={!mobileMenuOpen}
        >
            <div className="mobileSideMenuHeader">
                <Link to="/" className="mobileSideMenuBrand" onClick={closeMobileMenu}>
                    <img src={LOGO} alt={`${BRAND_NAME} Logo`} />
                    <span>
                        <h3>{BRAND_NAME}</h3>
                        <p>{t("appName")}</p>
                    </span>
                </Link>

                <button
                    type="button"
                    className="mobileSideMenuClose"
                    onClick={closeMobileMenu}
                    aria-label={t("close")}
                >
                    {CloseSVG}
                </button>
            </div>

            <nav className="flex flex-col gap-2 font-regular">
                    <NavLink 
                        to="/" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{HomeMenuSVG}</span>
                        <span>{t("navHome")}</span>
                    </NavLink>
                    {canAccess('videos') ?
                    <NavLink 
                        to="/my-videos" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{ChannelMenuSVG}</span>
                        <span>{t("navMyVideos")}</span>
                    </NavLink>
                    : ""}
                    {canAccess('playlists') ?
                    <NavLink 
                        to="/my-playlists" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{PlaylistSVG}</span>
                        <span>{t("navMyPlaylists")}</span>
                    </NavLink>
                    : ""}
                    {canAccess('posts') && <NavLink to="/my-posts" end
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={closeMobileMenu}>
                        <span className="mobileSideMenuIcon" aria-hidden="true">{PostSVG}</span>
                        <span>{t("navMyPosts")}</span>
                    </NavLink>}
                    {canAccess('quizzes') ?
                    <NavLink 
                        to="/quizzes" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{QuizSVG}</span>
                        <span>{t("navQuizzes")}</span>
                    </NavLink>
                    : ""}
                    {canAccess('people') ?
                    <NavLink 
                        to="/speakers-chairs" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{PeopleSVG}</span>
                        <span>{t("navSpeakersChairs")}</span>
                    </NavLink>
                    : ""}
                    {canAccess('channelAnalytics') ?
                    <NavLink
                        to="/channel-analytics"
                        end
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{AnalyticsSVG}</span>
                        <span>{t("navChannelAnalytics")}</span>
                    </NavLink>
                    : ""}
                    {platformHome ?
                    <NavLink
                        to={platformHome}
                        end
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{PlatformMenuSVG}</span>
                        <span>{t("navPlatform")}</span>
                    </NavLink>
                    : ""}
                    <NavLink 
                        to="/videos/1" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{RecommendedMenuSVG}</span>
                        <span>{t("navRecommended")}</span>
                    </NavLink>
                    <NavLink 
                        to="/videos/2" 
                        end 
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{TrendingMenuSVG}</span>
                        <span>{t("navTrending")}</span>
                    </NavLink>
                    <Link 
                        to={MARKETING_WEBSITE_URL}
                        className="mobileSideMenuItem p-3 rounded-lg transition-colors hover:bg-(--background2)"
                        onClick={closeMobileMenu}
                    >
                        <span className="mobileSideMenuIcon" aria-hidden="true">{ExternalSiteMenuSVG}</span>
                        <span>{BRAND_NAME}</span>
                    </Link>
                    <LanguageSelect
                        value={locale}
                        onChange={setLocale}
                        ariaLabel={t("accountLanguage")}
                        label={t("accountLanguage")}
                        variant="mobile"
                        leadingContent={LanguageMenuSVG}
                    />
                    <NavLink
                        to="/account"
                        end
                        className={({ isActive }) => `mobileSideMenuItem p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <img className="accountImg rounded-full w-8 h-8 aspect-square object-cover shrink-0 border-2!" src={headerUserData?.user?.image_url || DefaultProfile} alt={t("profilePhotoAlt")} />
                        <span>{t("footerAccount")}</span>
                    </NavLink>
            </nav>
        </aside>

        <div 
            className={`mobileMenuBg max-[800px]:block hidden ${mobileMenuOpen ? "open" : ""}`}
            onClick={closeMobileMenu}
        ></div>
    </>;  
}

export default memo(Header);
