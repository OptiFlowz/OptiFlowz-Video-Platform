import { FilterSVG } from "~/constants";
import VideoRow from "./videoRow/videoRow";
import Sidebar from "./sidebar/sidebar";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getToken } from "~/functions";
import type { fetchVideo, VideoT } from "~/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { ConfirmDialog } from "../confirmPopup/confirmDialog";
import { useConfirm } from "../confirmPopup/useConfirm";

type SortColumn = "visibility" | "date" | "views" | "likes";
type SortDirection = "asc" | "desc";

const SortIndicator = ({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn | null; sortDirection: SortDirection }) => {
    if (sortColumn !== column) return <span className="sortIcon">⇅</span>;
    return (
      <span className="sortIcon active">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
};

function MyVideos() {
  const myHeaders = useRef(new Headers());
  const [token, setToken] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedVideos, setSelectedVideos] = useState<VideoT[]>([]);
  const { confirm, dialogProps } = useConfirm();
  
  const selectAllRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken) return;
    setToken(userToken);
    myHeaders.current.set("Content-Type", "application/json");
    myHeaders.current.set("Authorization", `Bearer ${userToken}`);
  }, []);

  const { data } = useQuery<fetchVideo>({
    queryKey: ["my-videos", page, limit, sortColumn, sortDirection],
    queryFn: () => {
      return fetchFn<fetchVideo>({
        route: `api/video-moderation/my/videos?page=${page}&limit=${limit}&sort_by=${sortColumn}&sort_dir=${sortDirection}`,
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
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const sortedVideos = useMemo(() => {
    if (!data || !("videos" in data)) return [];
    if (!sortColumn) return data.videos;

    return [...data.videos].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortColumn) {
        case "visibility":
          aVal = a.visibility ?? "";
          bVal = b.visibility ?? "";
          break;
        case "date":
          aVal = new Date(a.created_at ?? 0).getTime();
          bVal = new Date(b.created_at ?? 0).getTime();
          break;
        case "views":
          aVal = a.view_count ?? 0;
          bVal = b.view_count ?? 0;
          break;
        case "likes":
          aVal = a.like_count ?? 0;
          bVal = b.like_count ?? 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortColumn, sortDirection]);

  const saveVisibility = async (type: VideoT["visibility"]) => {
    const ok = await confirm({
      title: `Change video visibility?`,
      message: "This action cannot be undone.",
      yesText: "Change",
      noText: "Cancel",
    });
    if(!ok) return;

    Promise.all(selectedVideos.map(video => 
      fetchFn({
        route: `api/video-moderation/video-details/${video.id}`,
        options: {
          method: "PATCH",
          headers: myHeaders.current,
          body: JSON.stringify({
            visibility: type,
          })
        },
      })
    ))
    .then(async () => {
      queryClient.setQueryData(
        ["my-videos", page, limit, sortColumn, sortDirection],
        (old: fetchVideo | undefined) => {
          if (!old) return old;

          return {
            ...old,
            videos: old.videos.map(video => {
              if(selectedVideos.some(v => v.id === video.id)){
                return {
                  ...video,
                  visibility: type
                }
              }

              return video;
            })
          };
        }
      );

      (document.querySelectorAll("table input") as NodeListOf<HTMLInputElement>).forEach((input: HTMLInputElement) => {
        if(input.checked)
          input.checked = false;
      });
      setSelectedVideos([]);
    })
    .catch(console.error);
  };

  const itemsArray = sortedVideos.map((item, index) => (
    <VideoRow key={`${item.id}${index}`} props={{...item, setSelectedVideos: setSelectedVideos}} />
  ));

  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const startIndex = total > 0 ? (page - 1) * limit + 1 : 0;
  const endIndex = Math.min(page * limit, total);

  // Generisanje brojeva stranica
  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    const maxVisible = 5; // Koliko brojeva prikazati

    if (totalPages <= maxVisible + 2) {
      // Ako ima malo stranica, prikaži sve
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Uvek prikaži prvu stranicu
      pages.push(1);

      if (page > 3) {
        pages.push("...");
      }

      // Stranice oko trenutne
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) {
        pages.push("...");
      }

      // Uvek prikaži poslednju stranicu
      pages.push(totalPages);
    }

    return pages;
  };

  const deleteAll = useCallback(async () => {
    const len = selectedVideos.length;
    if(len === 0) return;

    const ok = await confirm({
      title: `Delete ${len} ${len === 1 ? "video" : "videos"}?`,
      message: "This action cannot be undone.",
      yesText: "Delete",
      noText: "Cancel",
    });
    if(!ok) return;

    Promise.all(selectedVideos.map(video => 
      fetchFn({
        route: `api/video-moderation/video/${video.id}`,
        options: {
          method: "DELETE",
          headers: myHeaders.current
        },
      })
    )).then(async () => {
      queryClient.setQueryData(
        ["my-videos", page, limit, sortColumn, sortDirection],
        (old: fetchVideo | undefined) => {
          if (!old) return old;

          return {
            ...old,
            videos: old.videos.filter(
              v => !selectedVideos.some(s => s.id === v.id)
            ),
            total: old.total - selectedVideos.length
          };
        }
      );

      setSelectedVideos([]);
    }).catch(console.error);
  }, [selectedVideos]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;

    const toggleInputs = () => {
      if (data?.videos && el.checked) {
        (document.querySelectorAll("td input") as NodeListOf<HTMLInputElement>).forEach(input => {
          input.checked = true;
        });
        setSelectedVideos(data.videos);
      } else {
        (document.querySelectorAll("td input") as NodeListOf<HTMLInputElement>).forEach(input => {
          input.checked = false;
        });
        setSelectedVideos([]);
      }
    };

    el.addEventListener("change", toggleInputs);
    return () => el.removeEventListener("change", toggleInputs);
  }, [data]);

  return (
    <main className="myVideos">
      <Sidebar />
      <ConfirmDialog {...dialogProps} />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>My Videos</h1>
              <p>Review uploads, update visibility, and keep your channel organized.</p>
            </div>
            <div className="filter">
              {FilterSVG}
              <input type="text" placeholder="Filter videos" />
            </div>
          </div>
          <h2 className="mobileTitle">My Videos</h2>
          <div className="libraryTableWrap">
          <table>
            <thead>
              <tr>
                <th className="notHoverable">
                  <span>
                    <input
                      ref={selectAllRef}
                      className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                      checked:after:content-['✓'] checked:after:absolute checked:after:text-(--accentBlue2) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                      type="checkbox"
                    />
                    <p className="py-3">Video</p>
                    {selectedVideos.length > 0 && 
                      <span id="selectedButtons">
                        <button
                          className="button bg-(--accentRed) text-white"
                          onClick={deleteAll}
                        >Delete All</button>
                        {selectedVideos.some(video => video.visibility !== "private") && 
                          <button 
                            onClick={() => saveVisibility("private")}
                            className="button bg-(--background2) text-(--text1)!"
                          >Make Private</button>
                        }
                        {selectedVideos.some(video => video.visibility !== "public") && 
                          <button
                            onClick={() => saveVisibility("public")}
                            className="button bg-(--background2) text-(--text1)!"
                          >Make Public</button>
                        } 
                      </span>
                    }
                  </span>
                </th>
                <th
                  className={`sortable ${sortColumn === "visibility" ? "active" : ""}`}
                  onClick={() => handleSort("visibility")}
                >
                  Visibility <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="visibility" />
                </th>
                <th
                  className={`sortable ${sortColumn === "date" ? "active" : ""}`}
                  onClick={() => handleSort("date")}
                >
                  Date <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="date" />
                </th>
                <th
                  className={`sortable ${sortColumn === "views" ? "active" : ""}`}
                  onClick={() => handleSort("views")}
                >
                  Views <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="views" />
                </th>
                <th className="notHoverable">Comments</th>
                <th
                  className={`sortable ${sortColumn === "likes" ? "active" : ""}`}
                  onClick={() => handleSort("likes")}
                >
                  Likes <SortIndicator sortColumn={sortColumn} sortDirection={sortDirection} column="likes" />
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

export default MyVideos;
