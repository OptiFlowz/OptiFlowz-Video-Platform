import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useId, useMemo, useState } from "react";
import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { formatDescription, getToken } from "~/functions";
import { useI18n } from "~/i18n";

const SkeletonAccountInfo = () => (
    <div className="accountIdentity">
        <div className="skeleton-profile-photo profilePhoto"></div>

        <span className="userInfo flex flex-col gap-3">
            <p className="skeleton-user-info-row">
                <span className="skeleton-icon"></span>
                <span className="skeleton-info-text"></span>
            </p>
            <p className="skeleton-user-info-row">
                <span className="skeleton-icon"></span>
                <span className="skeleton-info-text"></span>
            </p>
            <p className="skeleton-user-info-row">
                <span className="skeleton-icon"></span>
                <span className="skeleton-info-text long"></span>
            </p>
        </span>
    </div>
);

function AccountInfo(){
    const { t } = useI18n();
    const token = getToken();
    const descriptionId = useId();
    const [descriptionOpen, setDescriptionOpen] = useState(false);
    const [descriptionElement, setDescriptionElement] = useState<HTMLDivElement | null>(null);
    const [hasDescriptionOverflow, setHasDescriptionOverflow] = useState(false);
    const headers = useMemo(() => {
        const nextHeaders = new Headers();
        if (token) {
            nextHeaders.set("Authorization", `Bearer ${token}`);
        }
        return nextHeaders;
    }, [token]);

    const {data: userData, isLoading} = useQuery({
        queryKey: ["accountInfo", token],
        queryFn: () => fetchFn<AuthFetchT>({
            route: `api/auth/me`,
            options: {
                method: "GET",
                headers
            }
        }),
        enabled: !!token,
        staleTime: 5 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        setDescriptionOpen(false);
    }, [userData?.user?.description, token]);

    useEffect(() => {
        if (!descriptionElement) return;
        const measureOverflow = () => {
            setHasDescriptionOverflow(descriptionElement.scrollHeight > descriptionElement.clientHeight + 1);
        };
        measureOverflow();
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureOverflow) : null;
        observer?.observe(descriptionElement);
        window.addEventListener("resize", measureOverflow);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measureOverflow);
        };
    }, [descriptionElement, userData?.user?.description, descriptionOpen]);

    if (isLoading) {
        return <SkeletonAccountInfo />;
    }

    return (
        <div className="accountIdentity">
            <img
                className="profilePhoto"
                src={userData?.user && (userData.user?.image_url || DefaultProfile)}
                alt="Profile"
                decoding="async"
                onError={e => {
                    e.currentTarget.src = DefaultProfile;
                }}
            />

            <div className="userInfo">
                <h1 className="accountName">{userData?.user?.full_name}</h1>
                <div className="accountEmail">{userData?.user?.email}</div>
                <div className="accountAbout">
                    <div id={descriptionId} ref={setDescriptionElement} className={`accountDescription${descriptionOpen ? " isExpanded" : ""}`}>
                        {formatDescription(userData?.user?.description) || t("noBiography")}
                    </div>
                    {(hasDescriptionOverflow || descriptionOpen) && (
                        <button type="button" className="accountReadMore" aria-expanded={descriptionOpen} aria-controls={descriptionId} onClick={() => setDescriptionOpen(open => !open)}>
                            {t(descriptionOpen ? "readLess" : "readMore")}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default memo(AccountInfo);
