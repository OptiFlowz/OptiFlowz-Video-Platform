import { memo, useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { SearchSVG, SearchSVGWhite, CloseSVG, MenuSVG, EditModeSVG } from "~/constants";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import OptiFlowzLogo from "../../../assets/OptiFlowzLogo.webp";
import { getToken } from "~/functions";
import type { AuthFetchT } from "~/types";
import { useI18n } from "~/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFn } from "~/API";

function Header(){
    const { t } = useI18n();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchFocusArmed, setSearchFocusArmed] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const navigate = useNavigate();
    const {searchValue} = useParams();
    const { videoId } = useParams();
    const idToEdit = videoId || "";

    const [isAdmin, setIsAdmin] = useState(false);

    const searchRef1 = useRef<HTMLInputElement>(null);
    const searchRef2 = useRef<HTMLInputElement>(null);
    const accountMenuRef = useRef<HTMLDivElement>(null);

    const token = getToken();
    const myHeaders = useRef(new Headers());

    useEffect(() => {
        if (token) myHeaders.current.set("Authorization", `Bearer ${token}`);
    }, [token]);

    const { data: headerUserData } = useQuery({
        queryKey: ["accountInfo"],
        queryFn: () => fetchFn<AuthFetchT>({
            route: `api/auth/me`,
            options: { method: "GET", headers: myHeaders.current }
        }),
        enabled: !!token,
        staleTime: 5 * 60 * 1000,
    });

    //LISTEN FOR PROFILE UPDATE
    const queryClient = useQueryClient();
    
    useEffect(() => {
        if(headerUserData && headerUserData.user)
            setIsAdmin(headerUserData.user.role === "admin");

        const handleUpdate = () => {
            const newUser = localStorage.getItem("user");

            if(newUser && headerUserData){
                queryClient.setQueriesData<AuthFetchT>(
                      { queryKey: ["accountInfo"] },
                      (old) => {
                        if (!old) return old;
                
                        return {
                          ...old,
                          user: {
                            ...old.user,
                            image_url: (JSON.parse(newUser) as AuthFetchT).user.image_url
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

        const handleClickOutside = (event: MouseEvent) => {
            if (!accountMenuRef.current?.contains(event.target as Node)) {
                setAccountMenuOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setAccountMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [accountMenuOpen]);

    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if(e.key !== "Enter") return;

        const searchVal = searchRef1?.current?.value || searchRef2?.current?.value;

        if(searchVal && searchVal !== searchValue){
            navigate(`/search/${searchVal}`);
            setSearchOpen(false);
        }
    }

    const handleSearchButton = () => {
        const searchVal = searchRef1?.current?.value || searchRef2?.current?.value;

        if(searchVal && searchVal !== searchValue){
            navigate(`/search/${searchVal}`);
            setSearchOpen(false);
        }
    }

    const closeMobileMenu = () => {
        setMobileMenuOpen(false);
    }

    const hasAuthenticatedUser = !!headerUserData?.user && !!token;

    const handleLogout = () => {
        localStorage.removeItem("user");
        sessionStorage.removeItem("user");
        setAccountMenuOpen(false);
        setMobileMenuOpen(false);
        queryClient.removeQueries({ queryKey: ["accountInfo"] });
        navigate("/login");
    }

    return <>
        <header className={`fixed w-full px-4 max-[800px]:pr-1.5 z-10 duration-300 ${searchOpen ? "search-open-mobile" : ""}`}>
            <div className="max-w-(--contentWidth) py-3 flex justify-between items-center mx-auto relative">
                {/* Logo - Klikabilan */}
                <Link to="/" className="logo flex gap-3 items-center cursor-pointer hover:opacity-80 transition-opacity">
                    <img
                        src={OptiFlowzLogo}
                        alt="OptiFlowz Logo"
                        className="w-9 h-9 object-contain shrink-0"
                    />
                    <span className="p-0">
                        <h3 className="font-medium text-xl -mb-1.25">OptiFlowz</h3>
                        <p className="font-light text-sm">{t("appName")}</p>
                    </span>
                </Link>

                {/* Desktop Navigation */}
                <nav className="flex gap-2 font-regular max-[800px]:hidden">
                    <Link to="https://optiflowz.com/">OptiFlowz</Link>
                    <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>{t("navHome")}</NavLink>
                    <NavLink to="/videos/1" end className={({ isActive }) => (isActive ? "active" : "")}>{t("navRecommended")}</NavLink>
                    <NavLink to="/videos/2" end className={({ isActive }) => (isActive ? "active" : "")}>{t("navTrending")}</NavLink>
                </nav>

                <div className={`flex ${isAdmin ? "gap-3" : "gap-1"} max-[650px]:gap-2 max-[500px]:gap-0.5 items-center`}>
                    {/* Admin Edit Mode Switch */}
                    {isAdmin && idToEdit != "" && (
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
                            alt="Profile Photo"
                            onError={e => {
                                e.currentTarget.src = DefaultProfile;
                            }}
                        />
                    </Link>

                    {hasAuthenticatedUser ? (
                        <div ref={accountMenuRef} className="adminAvatarMenuWrap darkSVG max-[500px]:hidden">
                            <button
                                type="button"
                                className={`adminAvatarTrigger flex items-center ${isAdmin ? "bg-(--accentOrange) p-1" : "p-1 pl-3 max-[1075px]:pl-1"} rounded-full transition-all duration-200 cursor-pointer`}
                                onClick={() => setAccountMenuOpen((prev) => !prev)}
                                aria-haspopup="menu"
                                aria-expanded={accountMenuOpen}
                                aria-label="Open account menu"
                            >
                                {!isAdmin ? (
                                    <p className="mr-2.5 font-medium max-[1075px]:hidden">
                                        <span>👋&nbsp;{t("helloUser", {firstName: headerUserData.user.full_name.split(" ")[0]})}</span>
                                    </p>
                                ) : null}
                                <img 
                                    className="accountImg rounded-full w-9 h-9 aspect-square object-cover"
                                    src={headerUserData?.user?.image_url || DefaultProfile}
                                    alt="Profile Photo"
                                    onError={e => {
                                        e.currentTarget.src = DefaultProfile;
                                    }}
                                />
                            </button>

                            {accountMenuOpen ? (
                                <div className="adminAvatarDropdown animate-slideIn" role="menu">
                                    <Link
                                        to="/account"
                                        role="menuitem"
                                        onClick={() => setAccountMenuOpen(false)}
                                    >
                                        {t("footerAccount")}
                                    </Link>
                                    {isAdmin ? (
                                        <Link
                                            to="/my-videos"
                                            role="menuitem"
                                            onClick={() => setAccountMenuOpen(false)}
                                        >
                                            {t("channelLabel")}
                                        </Link>
                                    ) : null}
                                    {isAdmin ? (
                                        <Link
                                            to="/analytics"
                                            role="menuitem"
                                            onClick={() => setAccountMenuOpen(false)}
                                        >
                                            {t("navAnalytics")}
                                        </Link>
                                    ) : null}
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={handleLogout}
                                    >
                                        {t("accountLogout")}
                                    </button>
                                </div>
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
                                alt="Profile Photo"
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
        <div 
            className={`fixed top-0 right-0 h-full w-64 bg-(--background1) shadow-2xl z-20 transition-transform duration-300 ease-in-out ${
                mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
            } max-[800px]:block hidden`}
        >
            <div className="p-4">
                <nav className="flex flex-col gap-2 font-regular">
                    <NavLink 
                        to="/" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navHome")}
                    </NavLink>
                    {isAdmin ? 
                    <NavLink 
                        to="/my-videos" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navMyVideos")}
                    </NavLink>
                    : ""}
                    {isAdmin ? 
                    <NavLink 
                        to="/my-playlists" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navMyPlaylists")}
                    </NavLink>
                    : ""}
                    {isAdmin ? 
                    <NavLink 
                        to="/speakers-chairs" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navSpeakersChairs")}
                    </NavLink>
                    : ""}
                    {isAdmin ? 
                    <NavLink 
                        to="/analytics" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navAnalytics")}
                    </NavLink>
                    : ""}
                    <NavLink 
                        to="/videos/1" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navRecommended")}
                    </NavLink>
                    <NavLink 
                        to="/videos/2" 
                        end 
                        className={({ isActive }) => `p-3 rounded-lg transition-colors ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        {t("navTrending")}
                    </NavLink>
                    <Link 
                        to="https://optiflowz.com/"
                        className={`p-3 rounded-lg transition-colors hover:bg-(--background2)`}
                    >
                        OptiFlowz
                    </Link>
                    <NavLink
                        to="/account"
                        end
                        className={({ isActive }) => `p-3 rounded-lg transition-colors flex items-center gap-3 ${isActive ? "bg-(--background2) font-semibold" : "hover:bg-(--background2)"}`}
                        onClick={() => {
                            closeMobileMenu();
                        }}
                    >
                        <img className="accountImg rounded-full w-8 h-8 aspect-square object-cover shrink-0 border-2!" src={headerUserData?.user?.image_url || DefaultProfile} alt="Profile Photo" />
                        <span>{t("footerAccount")}</span>
                    </NavLink>
                </nav>
            </div>
        </div>

        <div 
            className={`mobileMenuBg max-[800px]:block hidden ${mobileMenuOpen ? "open" : ""}`}
            onClick={closeMobileMenu}
        ></div>
    </>;  
}

export default memo(Header);
