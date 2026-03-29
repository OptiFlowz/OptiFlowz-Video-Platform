import { useQuery } from "@tanstack/react-query";
import { memo, useMemo } from "react";
import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { DescriptionSVG, MailSVG, UserSVG } from "~/constants";
import { formatDescription, getToken } from "~/functions";
import { useI18n } from "~/i18n";

const SkeletonAccountInfo = () => (
    <span className="w-full flex items-center gap-4 z-2">
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
    </span>
);

function AccountInfo(){
    const { t } = useI18n();
    const token = getToken();
    const headers = useMemo(() => {
        const nextHeaders = new Headers();
        if (token) {
            nextHeaders.set("Authorization", `Bearer ${token}`);
        }
        return nextHeaders;
    }, [token]);

    const {data: userData, isLoading} = useQuery({
        queryKey: [`accountInfo`],
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

    if (isLoading) {
        return <SkeletonAccountInfo />;
    }

    return (
        <span className="w-full flex items-center gap-4 max-[350px]:gap-3 z-2">
            <img
                className="profilePhoto"
                src={userData?.user && (userData.user?.image_url || DefaultProfile)}
                alt="Profile"
                decoding="async"
                onError={e => {
                    e.currentTarget.src = DefaultProfile;
                }}
            />

            <span className="userInfo">
                <p>{UserSVG}<span>{userData?.user && userData.user?.full_name}</span></p>
                <p className="second">{MailSVG}<span>{userData?.user && userData.user?.email}</span></p>
                <p className="second">{DescriptionSVG}<span className="w-full desc">{(userData?.user && formatDescription(userData.user?.description)) || t("noBiography")}</span></p>
            </span>
        </span>
    );
}

export default memo(AccountInfo);
