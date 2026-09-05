import LibrarySortButton from "~/components/library/librarySortButton";
import { useLocalizedPageTitle } from "~/hooks/useLocalizedPageTitle";
import { useRoleLabel } from "~/authorization/roleLabels";
import { useAuthorization } from "~/authorization/authorization";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CustomSelect from "~/components/customSelect/customSelect";
import PlatformSidebar from "~/components/platformPage/sidebar/platformSidebar";
import { SearchSVG, PermissionEyeSVG, FilterSVG } from "~/constants";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import { getErrorStatus, retryUserRequest, searchPlatformUsers, type PlatformUser, type UserSearch, type UserSortBy } from "./platformUsersApi";
import PlatformUserPopup, { UserRoleBadges, formatUserDate } from "./platformUserPopup";
import PlatformUserAvatar from "./platformUserAvatar";

export default function PlatformUsersPage() {
  useLocalizedPageTitle("platformUsers");
  const { t, locale } = useI18n();
  const roleLabel = useRoleLabel();
  const { roles, rolesLoading, rolesError, refreshRoles } = useAuthorization();
  const [token] = useState(() => getToken());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<UserSearch>({ q: "", role: "", page: 1, limit: 20, sortBy: "full_name", sortOrder: "asc" });
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
  const closePopup = useCallback(() => setSelectedUser(null), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch((current) => current.q === searchInput.trim() ? current : { ...current, q: searchInput.trim(), page: 1 });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const query = useQuery({
    queryKey: ["platform-users", token, search],
    queryFn: ({ signal }) => searchPlatformUsers(search, token!, signal),
    enabled: !!token,
    retry: retryUserRequest,
    refetchOnWindowFocus: false,
  });
  const pagination = query.data?.pagination;
  const users = query.data?.users ?? [];
  const awaitingSearch = search.q !== searchInput.trim();
  const loading = !!token && (query.isPending || awaitingSearch);

  // A deletion or a concurrent search can make the current page disappear.
  useEffect(() => {
    if (pagination && search.page > Math.max(1, pagination.totalPages)) {
      setSearch((current) => ({ ...current, page: Math.max(1, pagination.totalPages) }));
    }
  }, [pagination, search.page]);

  const changeSearch = (values: Partial<UserSearch>) => setSearch((current) => ({ ...current, ...values, page: 1 }));
  const toggleSort = (sortBy: UserSortBy) => setSearch((current) => ({
    ...current,
    sortBy,
    sortOrder: current.sortBy === sortBy && current.sortOrder === "asc" ? "desc" : "asc",
    page: 1,
  }));
  const sortHeader = (column: UserSortBy, label: string) => (
    <span role="columnheader" aria-sort={search.sortBy === column ? (search.sortOrder === "asc" ? "ascending" : "descending") : "none"}>
      <LibrarySortButton label={label} direction={search.sortBy === column ? search.sortOrder : null} onClick={() => toggleSort(column)} />
    </span>
  );
  const errorMessage = !token ? t("usersSignInRequired") : getErrorStatus(query.error) === 403 ? t("usersForbidden") : t("usersLoadFailed");

  return (
    <main className="myVideos videoAnalyticsPage platformPage platformUsersPage">
      <PlatformSidebar />
      <div className="content libraryContent">
        <div className="holder libraryShell videoAnalyticsShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("platformUsers")}</h1>
              <p>{t("platformUsersDescription")}</p>
            </div>
          </div>

          <div className="platformUsersToolbar">
            <div className="filter">
              {SearchSVG}
              <input type="search" aria-label={t("usersSearch")} placeholder={t("usersSearchPlaceholder")} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
            </div>
            <div className="platformUsersFilterControls videoAnalyticsSelect">
              <CustomSelect leadingContent={FilterSVG} value={search.role} options={[{ value: '', label: t('usersAllRoles') }, ...roles.map(role => ({ value: String(role.id), label: roleLabel(role) }))]} onChange={(role) => changeSearch({ role })} ariaLabel={t('usersRoleFilter')} disabled={rolesLoading || !!rolesError} />
            </div>
          </div>

          {rolesError && <div className="rolesTableState errorBanner" role="alert"><p>{t('usersRolesLoadFailed')}</p><button type="button" onClick={() => void refreshRoles()}>{t('usersRetry')}</button></div>}

          <section className="platformUsersTable" aria-label={t("platformUsers")} aria-busy={loading || query.isFetching}>
            <div role="table" aria-label={t("platformUsers")}>
              <div className="platformUsersRow platformUsersTableHeader" role="row">
                {sortHeader("full_name", t("usersName"))}
                {sortHeader("email", t("usersEmail"))}
                <span role="columnheader">{t("usersRoles")}</span>
                {sortHeader("created_at", t("usersJoined"))}
                <span role="columnheader">{t("usersActions")}</span>
              </div>
              {!token || query.isError || loading || !users.length ? (
                <div role="row">
                  <div role="cell" aria-colspan={5}>
                    {!token || query.isError ? (
                      <div className="platformUsersState" role="alert">
                        <p>{errorMessage}</p>
                        {token && getErrorStatus(query.error) !== 403 && <button type="button" className="addRoleButton" onClick={() => void query.refetch()}>{t("usersRetry")}</button>}
                      </div>
                    ) : loading ? (
                      <div className="platformUsersState" role="status"><div className="uploadSpinner tiny" /><p>{t("usersLoading")}</p></div>
                    ) : (
                      <div className="platformUsersState" role="status">
                        <p>{t(search.q || search.role ? "usersNoResults" : "usersEmpty")}</p>
                        {(search.q || search.role) && <button type="button" className="addRoleButton" onClick={() => { setSearchInput(""); changeSearch({ q: "", role: "" }); }}>{t("usersClearSearch")}</button>}
                      </div>
                    )}
                  </div>
                </div>
              ) : users.map((user) => (
                <div className="platformUsersRow" role="row" key={user.id}>
                  <div className="platformUsersIdentity" role="cell">
                    <PlatformUserAvatar imageUrl={user.image_url} />
                    <button type="button" className="platformUserName" onClick={() => setSelectedUser(user)}>{user.full_name?.trim() || t("usersUnnamed")}</button>
                  </div>
                  <div className="platformUserEmail" role="cell">{user.email}</div>
                  <div role="cell"><UserRoleBadges roles={user.roles} /></div>
                  <div className="platformUserJoined" role="cell"><span className="platformUserMobileLabel">{t("usersJoined")}: </span>{formatUserDate(user.created_at, locale)}</div>
                  <div className="roleActionsCell platformUserActions" role="cell">
                    <button type="button" className="edit" onClick={() => setSelectedUser(user)} aria-label={`${t("usersViewDetails")}: ${user.full_name || user.email}`} title={t("usersViewDetails")}>{PermissionEyeSVG}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="pagination">
            <span><p>{t("adminRowsPerPage")}</p><CustomSelect value={search.limit} options={[10, 20, 50, 100].map((value) => ({ value, label: String(value) }))} onChange={(value) => changeSearch({ limit: Number(value) })} ariaLabel={t("adminRowsPerPage")} triggerClassName="paginationSelect" /></span>
            {!loading && !query.isError && pagination && <p role="status">{pagination.total > 0 ? t("adminPaginationRange", { start: (pagination.page - 1) * pagination.limit + 1, end: Math.min(pagination.page * pagination.limit, pagination.total), total: pagination.total }) : t("adminZeroResults")}</p>}
            <nav className="platformUsersPagination" aria-label={t("usersPagination")}>
              <button type="button" className="pageBtn" disabled={loading || query.isFetching || query.isError || !pagination?.hasPreviousPage} onClick={() => setSearch((current) => ({ ...current, page: current.page - 1 }))}>{t("previous")}</button>
              {pagination && !loading && !query.isError && <span>{t("usersPage", { page: pagination.page, total: Math.max(1, pagination.totalPages) })}</span>}
              <button type="button" className="pageBtn" disabled={loading || query.isFetching || query.isError || !pagination?.hasNextPage} onClick={() => setSearch((current) => ({ ...current, page: current.page + 1 }))}>{t("next")}</button>
            </nav>
          </div>
        </div>
      </div>
      <PlatformUserPopup user={selectedUser} onClose={closePopup} />
    </main>
  );
}
