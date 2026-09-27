import { useQuery } from "@tanstack/react-query";
import { memo, useMemo } from "react";
import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import ExpandableDescription from "../shared/ExpandableDescription";

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
                    <ExpandableDescription key={token} text={userData?.user?.description} fallback={t("noBiography")} />
                </div>
            </div>
        </div>
    );
}

export default memo(AccountInfo);
