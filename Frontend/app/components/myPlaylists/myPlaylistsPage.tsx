import { AddSVG, FilterSVG } from "~/constants";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getToken } from "~/functions";
import type { FetchMyPlaylistsT, MyPlaylistT } from "~/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import PlaylistRow from "./playlistRow/playlistRow";
import { ConfirmDialog } from "../confirmPopup/confirmDialog";
import { useConfirm } from "../confirmPopup/useConfirm";
import CreatePlaylistPopup from "./createPlaylistPopup";

type SortColumn = "created_at" | "view_count" | "save_count";
type SortDirection = "asc" | "desc";

const SortIndicator = ({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn | null; sortDirection: SortDirection }) => {
    if (sortColumn !== column) return <span className="sortIcon">⇅</span>;
    return (
      <span className="sortIcon active">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
};

function MyPlaylistsPage() {
  const myHeaders = useRef(new Headers());
  const [token, setToken] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedPlaylists, setSelectedPlaylists] = useState<MyPlaylistT[]>([]);
  const [isCreatePopupOpen, setIsCreatePopupOpen] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { confirm, dialogProps } = useConfirm();

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;
    setToken(userToken);
    myHeaders.current.set("Content-Type", "application/json");
    myHeaders.current.set("Authorization", `Bearer ${userToken}`);
  }, []);

  const { data } = useQuery<FetchMyPlaylistsT>({
    queryKey: ["my-playlists", page, limit, sortColumn, sortDirection],
    queryFn: () => {
      return fetchFn<FetchMyPlaylistsT>({
        route: `api/playlists-moderation/my/playlists?sort=${sortColumn}&order=${sortDirection}&page=${page}&limit=${limit}`,
        options: { method: "GET", headers: myHeaders.current },
      });
    },
    enabled: !!token,
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
    setPage(1);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const currentPlaylists = data?.playlists ?? [];

  const itemsArray = currentPlaylists.map((item, index) => (
    <PlaylistRow
      key={`${item.id}${index}`}
      props={item}
      isSelected={selectedPlaylists.some((playlist) => playlist.id === item.id)}
      setSelectedPlaylists={setSelectedPlaylists}
    />
  ));

  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const startIndex = total > 0 ? (page - 1) * limit + 1 : 0;
  const endIndex = Math.min(page * limit, total);

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (page > 3) {
        pages.push("...");
      }

      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) {
        pages.push("...");
      }

      pages.push(totalPages);
    }

    return pages;
  };

  const saveVisibility = async (type: MyPlaylistT["status"]) => {
    const len = selectedPlaylists.length;
    if (len === 0) return;

    const ok = await confirm({
      title: `Change playlist visibility?`,
      message: "This action cannot be undone.",
      yesText: "Change",
      noText: "Cancel",
    });
    if (!ok) return;

    Promise.all(
      selectedPlaylists.map((playlist) =>
        fetchFn({
          route: `api/playlists-moderation/playlist-details/${playlist.id}`,
          options: {
            method: "PATCH",
            headers: myHeaders.current,
            body: JSON.stringify({
              status: type,
            }),
          },
        })
      )
    )
      .then(() => {
        queryClient.setQueryData(
          ["my-playlists", page, limit, sortColumn, sortDirection],
          (old: FetchMyPlaylistsT | undefined) => {
            if (!old) return old;

            return {
              ...old,
              playlists: old.playlists.map((playlist) => {
                if (selectedPlaylists.some((selected) => selected.id === playlist.id)) {
                  return {
                    ...playlist,
                    status: type,
                  };
                }

                return playlist;
              }),
            };
          }
        );

        setSelectedPlaylists([]);
      })
      .catch(console.error);
  };

  const deleteAll = useCallback(async () => {
    const len = selectedPlaylists.length;
    if (len === 0) return;

    const ok = await confirm({
      title: `Delete ${len} ${len === 1 ? "playlist" : "playlists"}?`,
      message: "This action cannot be undone.",
      yesText: "Delete",
      noText: "Cancel",
    });
    if (!ok) return;

    Promise.all(
      selectedPlaylists.map((playlist) =>
        fetchFn({
          route: `api/playlists-moderation/playlist/${playlist.id}`,
          options: {
            method: "DELETE",
            headers: myHeaders.current,
          },
        })
      )
    )
      .then(() => {
        queryClient.setQueryData(
          ["my-playlists", page, limit, sortColumn, sortDirection],
          (old: FetchMyPlaylistsT | undefined) => {
            if (!old) return old;

            return {
              ...old,
              playlists: old.playlists.filter(
                (playlist) =>
                  !selectedPlaylists.some((selected) => selected.id === playlist.id)
              ),
              total: old.total - selectedPlaylists.length,
            };
          }
        );

        setSelectedPlaylists([]);
      })
      .catch(console.error);
  }, [confirm, limit, page, queryClient, selectedPlaylists, sortColumn, sortDirection]);

  useEffect(() => {
    setSelectedPlaylists((prev) =>
      prev.filter((selected) =>
        currentPlaylists.some((playlist) => playlist.id === selected.id)
      )
    );
  }, [currentPlaylists]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;

    if (currentPlaylists.length === 0) {
      el.checked = false;
      el.indeterminate = false;
      return;
    }

    const selectedOnPage = currentPlaylists.filter((playlist) =>
      selectedPlaylists.some((selected) => selected.id === playlist.id)
    ).length;

    el.checked = selectedOnPage === currentPlaylists.length;
    el.indeterminate =
      selectedOnPage > 0 && selectedOnPage < currentPlaylists.length;
  }, [currentPlaylists, selectedPlaylists]);

  const toggleSelectAll = () => {
    const el = selectAllRef.current;
    if (!el) return;

    if (el.checked) {
      setSelectedPlaylists(currentPlaylists);
      return;
    }

    setSelectedPlaylists([]);
  };

  const handleCreatePlaylist = async (title: string) => {
    const response = await fetchFn<{
      success: boolean;
      playlist: {
        id: string;
        title: string;
        status: "public" | "private";
        created_at: string;
      };
    }>({
      route: "api/playlists-moderation/playlist/create",
      options: {
        method: "POST",
        headers: myHeaders.current,
        body: JSON.stringify({ title }),
      },
    });

    if (!response?.success || !response.playlist) {
      throw new Error("Failed to create playlist.");
    }

    const createdPlaylist: MyPlaylistT = {
      id: response.playlist.id,
      title: response.playlist.title,
      status: response.playlist.status,
      created_at: response.playlist.created_at,
      thumbnail_url: "",
      view_count: 0,
      save_count: 0,
      video_count: 0,
      featured: false,
    };

    queryClient.setQueryData(
      ["my-playlists", 1, limit, "created_at", "desc"],
      (old: FetchMyPlaylistsT | undefined) => {
        if (!old) return old;

        const nextPlaylists = [createdPlaylist, ...old.playlists].slice(0, old.limit);

        return {
          ...old,
          page: 1,
          sort: "created_at",
          order: "desc",
          total: old.total + 1,
          total_pages: Math.max(1, Math.ceil((old.total + 1) / old.limit)),
          playlists: nextPlaylists,
        };
      }
    );

    setSortColumn("created_at");
    setSortDirection("desc");
    setPage(1);
    setSelectedPlaylists([]);
    setIsCreatePopupOpen(false);
    queryClient.invalidateQueries({ queryKey: ["my-playlists"] });
  };

  return (
    <main className="myVideos">
      <Sidebar />
      <ConfirmDialog {...dialogProps} />
      <CreatePlaylistPopup
        open={isCreatePopupOpen}
        onClose={() => setIsCreatePopupOpen(false)}
        onCreate={handleCreatePlaylist}
      />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>My Playlists</h1>
              <p>Group sessions into curated sets and manage playlist visibility from one place.</p>
            </div>
            <div className="libraryActions">
              <div className="filter">
                {FilterSVG}
                <input type="text" placeholder="Filter playlists" />
              </div>
              <button
                type="button"
                className="playlistAddBtn"
                title="Create playlist"
                aria-label="Create playlist"
                onClick={() => setIsCreatePopupOpen(true)}
              >
                {AddSVG}
              </button>
            </div>
          </div>
          <div className="mobileTitleRow">
            <h2 className="mobileTitle">My Playlists</h2>
            <button
              type="button"
              className="playlistAddBtn mobile"
              title="Create playlist"
              aria-label="Create playlist"
              onClick={() => setIsCreatePopupOpen(true)}
            >
              {AddSVG}
            </button>
          </div>
          <div className="libraryTableWrap">
            <table>
              <thead>
                <tr>
                  <th className="notHoverable">
                    <span>
                      <input
                        ref={selectAllRef}
                        onChange={toggleSelectAll}
                        className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                      checked:after:content-['✓'] checked:after:absolute checked:after:text-(--accentBlue2) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        type="checkbox"
                      />
                      <p className="py-3">Playlist</p>
                      {selectedPlaylists.length > 0 && (
                        <span id="selectedButtons">
                          <button
                            className="button bg-(--accentRed) text-white"
                            onClick={deleteAll}
                          >
                            Delete All
                          </button>
                          {selectedPlaylists.some(
                            (playlist) => playlist.status !== "private"
                          ) && (
                            <button
                              onClick={() => saveVisibility("private")}
                              className="button bg-(--background2) text-(--text1)!"
                            >
                              Make Private
                            </button>
                          )}
                          {selectedPlaylists.some(
                            (playlist) => playlist.status !== "public"
                          ) && (
                            <button
                              onClick={() => saveVisibility("public")}
                              className="button bg-(--background2) text-(--text1)!"
                            >
                              Make Public
                            </button>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                  <th className="notHoverable">Status</th>
                  <th
                    className={`sortable ${sortColumn === "created_at" ? "active" : ""}`}
                    onClick={() => handleSort("created_at")}
                  >
                    Date <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="created_at" />
                  </th>
                  <th
                    className={`sortable ${sortColumn === "view_count" ? "active" : ""}`}
                    onClick={() => handleSort("view_count")}
                  >
                    Views <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="view_count" />
                  </th>
                  <th className="notHoverable">Videos</th>
                  <th
                    className={`sortable ${sortColumn === "save_count" ? "active" : ""}`}
                    onClick={() => handleSort("save_count")}
                  >
                    Saves <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="save_count" />
                  </th>
                </tr>
              </thead>

              <tbody>{itemsArray}</tbody>
            </table>
          </div>

          <div className="pagination">
            <span>
              <p>Rows per page:</p>
              <select
                name="rowsPerPage"
                value={limit}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={40}>40</option>
                <option value={50}>50</option>
              </select>
            </span>

            <p>
              {total > 0 ? `${startIndex}-${endIndex} of ${total}` : "0 results"}
            </p>

            <span className="pageNumbers">
              {getPageNumbers().map((pageNum, index) =>
                pageNum === "..." ? (
                  <span key={`ellipsis-${index}`} className="ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={pageNum}
                    className={`pageBtn ${page === pageNum ? "active" : ""}`}
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                )
              )}
            </span>
          </div>

        </div>
      </div>
    </main>
  );
}

export default MyPlaylistsPage;
