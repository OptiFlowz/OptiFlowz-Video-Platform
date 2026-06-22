"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { fetchFn } from "~/API";
import { AddSVG, DeleteSVG, EditSVG, FilterSVG } from "~/constants";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import CreatePersonPopup, { type CreatePersonPayload } from "./createPersonPopup";
import { useI18n } from "~/i18n";
import { ConfirmDialog } from "../confirmPopup/confirmDialog";
import { useConfirm } from "../confirmPopup/useConfirm";

type PersonRecord = {
  id: string;
  first_name: string;
  last_name: string;
  image_url: string;
  biography: string;
  total_video_count: number;
};

type PeopleApiPerson = {
  id: string;
  name: string;
  image_url: string | null;
  description: string | null;
  total_video_count: number | string | null;
};

type PeopleApiResponse = {
  success: boolean;
  people: PeopleApiPerson[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages?: number;
    total_pages?: number;
    hasNextPage?: boolean;
  };
};

type PersonMutationResponse = {
  success: boolean;
  person: PeopleApiPerson;
};

type PersonDeleteResponse = {
  success: boolean;
  deleted: boolean;
};

const PEOPLE_PER_PAGE = 20;

const fallbackBiography =
  "Biography is not available yet for this person.";

type PaginationItem = number | "...";

function splitFullName(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { first_name: "", last_name: "" };
  }

  const [first_name, ...rest] = trimmedName.split(/\s+/);
  return {
    first_name,
    last_name: rest.join(" "),
  };
}

function mapApiPersonToRecord(person: PeopleApiPerson): PersonRecord {
  const { first_name, last_name } = splitFullName(person.name);

  return {
    id: person.id,
    first_name,
    last_name,
    image_url: person.image_url || DefaultProfile,
    biography: person.description?.trim() || fallbackBiography,
    total_video_count: Number(person.total_video_count ?? 0) || 0,
  };
}

async function createPerson(
  token: string,
  payload: CreatePersonPayload
): Promise<PeopleApiPerson> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const response = await fetchFn<PersonMutationResponse>({
    route: "api/people/create",
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `${payload.first_name} ${payload.last_name}`.trim(),
        description: payload.biography.trim(),
      }),
    },
  });

  return response.person;
}

async function updatePerson(
  token: string,
  personId: string,
  updates: { name?: string; description?: string }
): Promise<PeopleApiPerson> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const response = await fetchFn<PersonMutationResponse>({
    route: `api/people/${personId}`,
    options: {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    },
  });

  return response.person;
}

async function uploadPersonImage(
  token: string,
  personId: string,
  imageFile: File
): Promise<PeopleApiPerson> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);

  const formData = new FormData();
  formData.append("file", imageFile);

  const response = await fetchFn<PersonMutationResponse>({
    route: `api/people/${personId}/image`,
    options: {
      method: "PATCH",
      headers,
      body: formData,
    },
  });

  return response.person;
}

async function deletePerson(token: string, personId: string) {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);

  return fetchFn<PersonDeleteResponse>({
    route: `api/people/${personId}`,
    options: {
      method: "DELETE",
      headers,
    },
  });
}

async function fetchPeoplePage(token: string, page: number) {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetchFn<PeopleApiResponse>({
    route: `api/people?page=${page}&limit=${PEOPLE_PER_PAGE}&sortBy=name&sortOrder=asc`,
    options: { method: "GET", headers },
  });

  return {
    people: (response.people ?? []).map(mapApiPersonToRecord),
    pagination: response.pagination,
  };
}

function SpeakersChairsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, dialogProps } = useConfirm();
  const [token, setToken] = useState<string | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isCreatePopupOpen, setIsCreatePopupOpen] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);

  useEffect(() => {
    const storedUser =
      localStorage.getItem("user") ?? sessionStorage.getItem("user");

    if (!storedUser) return;

    try {
      const parsedUser = JSON.parse(storedUser) as { token?: string };
      if (parsedUser.token) {
        setToken(parsedUser.token);
      }
    } catch (error) {
      console.error("Failed to parse stored user for people fetch:", error);
    }
  }, []);

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["people", token, page],
    queryFn: () => fetchPeoplePage(token as string, page),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.people) {
      setPeople(data.people);
    }
  }, [data]);

  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(
    data?.pagination?.totalPages ?? data?.pagination?.total_pages ?? 1,
    1
  );
  const currentPage = data?.pagination?.page ?? page;
  const startIndex = total === 0 ? 0 : (currentPage - 1) * PEOPLE_PER_PAGE + 1;
  const endIndex = total === 0 ? 0 : Math.min(currentPage * PEOPLE_PER_PAGE, total);

  const getPageNumbers = (): PaginationItem[] => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    if (currentPage <= 3) {
      return [1, 2, 3, "...", totalPages];
    }

    if (currentPage >= totalPages - 2) {
      return [1, "...", totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  };

  const filteredPeople = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return people.filter((person) => {
      if (!normalizedSearch) return true;

      return [
        person.first_name,
        person.last_name,
        person.biography,
        String(person.total_video_count),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [people, search]);

  const handleCreatePerson = async (payload: CreatePersonPayload) => {
    if (!token) {
      throw new Error("Missing authentication token.");
    }

    await createPerson(token, payload).then(async (createdPerson) => {
      if (payload.image_file) {
        await uploadPersonImage(token, createdPerson.id, payload.image_file);
      }
    });

    await queryClient.invalidateQueries({ queryKey: ["people"] });
    setIsCreatePopupOpen(false);
  };

  const handleEditPerson = async (payload: CreatePersonPayload) => {
    if (!editingPersonId) return;
    if (!token) {
      throw new Error("Missing authentication token.");
    }

    const personToEdit =
      people.find((person) => person.id === editingPersonId) ?? null;

    if (!personToEdit) {
      throw new Error("Person not found.");
    }

    const nextName = `${payload.first_name} ${payload.last_name}`.trim();
    const currentName =
      `${personToEdit.first_name} ${personToEdit.last_name}`.trim();
    const nextDescription = payload.biography.trim();
    const currentDescription = personToEdit.biography === fallbackBiography
      ? ""
      : personToEdit.biography.trim();

    const updates: { name?: string; description?: string } = {};

    if (nextName !== currentName) {
      updates.name = nextName;
    }

    if (nextDescription !== currentDescription) {
      updates.description = nextDescription;
    }

    if (Object.keys(updates).length > 0) {
      await updatePerson(token, editingPersonId, updates);
    }

    if (payload.image_file) {
      await uploadPersonImage(token, editingPersonId, payload.image_file);
    }

    await queryClient.invalidateQueries({ queryKey: ["people"] });
    setEditingPersonId(null);
  };

  const handleDeletePerson = async (person: PersonRecord) => {
    if (!token) {
      throw new Error("Missing authentication token.");
    }

    const fullName = `${person.first_name} ${person.last_name}`.trim();
    const ok = await confirm({
      title: t("adminDeletePersonTitle", { name: fullName }),
      message: t("adminActionCannotBeUndone"),
      yesText: t("adminDelete"),
      noText: t("adminCancel"),
    });

    if (!ok) return;

    const response = await deletePerson(token, person.id);

    if (response.success && response.deleted) {
      await queryClient.invalidateQueries({ queryKey: ["people"] });
    }
  };

  const editingPerson =
    editingPersonId == null
      ? null
      : people.find((person) => person.id === editingPersonId) ?? null;

  return (
    <main className="myVideos speakersChairsPage">
      <Sidebar />
      <ConfirmDialog {...dialogProps} />
      <CreatePersonPopup
        open={isCreatePopupOpen}
        onClose={() => setIsCreatePopupOpen(false)}
        onSubmit={handleCreatePerson}
        mode="create"
      />
      <CreatePersonPopup
        open={editingPerson != null}
        onClose={() => setEditingPersonId(null)}
        onSubmit={handleEditPerson}
        mode="edit"
        initialValues={
          editingPerson
            ? {
                first_name: editingPerson.first_name,
                last_name: editingPerson.last_name,
                image_url: editingPerson.image_url,
                biography: editingPerson.biography,
                image_file: null,
              }
            : null
        }
      />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("navSpeakersChairs")}</h1>
              <p>{t("adminSpeakersChairsDescription")}</p>
            </div>
            <div className="libraryActions">
              <div className="filter">
                {FilterSVG}
                <input
                  type="text"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t("searchPlaceholder")}
                />
              </div>
              <button
                type="button"
                className="playlistAddBtn"
                title={t("navSpeakersChairs")}
                aria-label={t("navSpeakersChairs")}
                onClick={() => setIsCreatePopupOpen(true)}
              >
                {AddSVG}
              </button>
            </div>
          </div>

          <div className="mobileTitleRow">
            <h2 className="mobileTitle">{t("navSpeakersChairs")}</h2>
            <button
              type="button"
              className="playlistAddBtn mobile"
              title={t("navSpeakersChairs")}
              aria-label={t("navSpeakersChairs")}
              onClick={() => setIsCreatePopupOpen(true)}
            >
              {AddSVG}
            </button>
          </div>

          <section className="speakersChairsPeopleGrid">
            {isLoading ? (
              <div className="speakersChairsEmptyState">
                {t("adminLoadingPeople")}
              </div>
            ) : null}

            {isError ? (
              <div className="speakersChairsEmptyState">
                {t("adminFailedLoadPeople")}
              </div>
            ) : null}

            {filteredPeople.map((person) => {
              const fullName = `${person.first_name} ${person.last_name}`.trim();

              return (
                <article key={person.id} className="speakersChairsPersonCard">
                  <img src={person.image_url || DefaultProfile} alt={fullName} />
                  <div className="speakersChairsPersonBody">
                    <h3>{fullName}</h3>
                    <p className="speakersChairsMeta">
                      {t("videosLabel", { count: person.total_video_count })}
                    </p>
                    <p className="speakersChairsBio">{person.biography}</p>
                  </div>
                  <div className="speakersChairsPersonActions">
                    <button
                      type="button"
                      onClick={() => setEditingPersonId(person.id)}
                      title={t("adminEditPerson")}
                      aria-label={t("adminEditPerson")}
                    >
                      {EditSVG}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePerson(person)}
                      title={t("adminDeletePerson")}
                      aria-label={t("adminDeletePerson")}
                    >
                      {DeleteSVG}
                    </button>
                  </div>
                </article>
              );
            })}

            {!isLoading && !isError && filteredPeople.length === 0 ? (
              <div className="speakersChairsEmptyState">
                {t("adminNoPeopleAdded")}
              </div>
            ) : null}
          </section>

          <div className="pagination">
            <span>
              <p>{t("adminRowsPerPage")}</p>
              <select name="rowsPerPage" value={PEOPLE_PER_PAGE} disabled>
                <option value={PEOPLE_PER_PAGE}>{PEOPLE_PER_PAGE}</option>
              </select>
            </span>

            <p>
              {total > 0 ? t("adminPaginationRange", { start: startIndex, end: endIndex, total }) : t("adminZeroResults")}
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
                    type="button"
                    className={`pageBtn ${currentPage === pageNum ? "active" : ""}`}
                    onClick={() => setPage(pageNum)}
                    disabled={isLoading}
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

export default SpeakersChairsPage;
