"use client";

import { useMemo, useState } from "react";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { AddSVG, EditSVG, FilterSVG } from "~/constants";
import Sidebar from "../myVideosPage/sidebar/sidebar";
import CreatePersonPopup, { type CreatePersonPayload } from "./createPersonPopup";
import { useI18n } from "~/i18n";

type PersonRecord = {
  id: string;
  first_name: string;
  last_name: string;
  image_url: string;
  biography: string;
};

const initialPeople: PersonRecord[] = [
  {
    id: "mock-person-1",
    first_name: "Elena",
    last_name: "Markovic",
    image_url: DefaultProfile,
    biography:
      "Professor of minimally invasive surgery with a strong focus on advanced laparoscopic education and international faculty programs.",
  },
  {
    id: "mock-person-2",
    first_name: "Luca",
    last_name: "Bianchi",
    image_url: DefaultProfile,
    biography:
      "Upper GI surgeon and experienced moderator of multidisciplinary congress sessions and expert panels.",
  },
  {
    id: "mock-person-3",
    first_name: "Ana",
    last_name: "Petrovic",
    image_url: DefaultProfile,
    biography:
      "Consultant colorectal surgeon known for practical teaching formats, operative breakdowns, and pathway optimization talks.",
  },
  {
    id: "mock-person-4",
    first_name: "Matthias",
    last_name: "Keller",
    image_url: DefaultProfile,
    biography:
      "Program director supporting scientific content curation and educational session planning across surgical events.",
  },
];

function SpeakersChairsPage() {
  const { t } = useI18n();
  const [people, setPeople] = useState<PersonRecord[]>(initialPeople);
  const [search, setSearch] = useState("");
  const [isCreatePopupOpen, setIsCreatePopupOpen] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);

  const filteredPeople = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return people.filter((person) => {
      if (!normalizedSearch) return true;

      return [
        person.first_name,
        person.last_name,
        person.biography,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [people, search]);

  const handleCreatePerson = async (payload: CreatePersonPayload) => {
    const newPerson: PersonRecord = {
      id: `mock-person-${Date.now()}`,
      first_name: payload.first_name,
      last_name: payload.last_name,
      image_url: payload.image_url || DefaultProfile,
      biography:
        payload.biography ||
        "Short biography placeholder. This record is currently stored locally as mock data until the API is connected.",
    };

    setPeople((current) => [newPerson, ...current]);
    setIsCreatePopupOpen(false);
  };

  const handleEditPerson = async (payload: CreatePersonPayload) => {
    if (!editingPersonId) return;

    setPeople((current) =>
      current.map((person) =>
        person.id === editingPersonId
          ? {
              ...person,
              first_name: payload.first_name,
              last_name: payload.last_name,
              image_url: payload.image_url || DefaultProfile,
              biography:
                payload.biography ||
                "Short biography placeholder. This record is currently stored locally as mock data until the API is connected.",
            }
          : person
      )
    );
    setEditingPersonId(null);
  };

  const editingPerson =
    editingPersonId == null
      ? null
      : people.find((person) => person.id === editingPersonId) ?? null;

  return (
    <main className="myVideos speakersChairsPage">
      <Sidebar />
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
              }
            : null
        }
      />

      <div className="content libraryContent">
        <div className="holder libraryShell">
          <div className="libraryHeader">
            <div className="libraryHeading">
              <h1>{t("navSpeakersChairs")}</h1>
              <p>
                Manage the shared person records used across videos. Speaker or chair assignment will be handled later on the video itself.
              </p>
            </div>
            <div className="libraryActions">
              <div className="filter">
                {FilterSVG}
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
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
            {filteredPeople.map((person) => {
              const fullName = `${person.first_name} ${person.last_name}`.trim();

              return (
                <article key={person.id} className="speakersChairsPersonCard">
                  <img src={person.image_url || DefaultProfile} alt={fullName} />
                  <div className="speakersChairsPersonBody">
                    <h3>{fullName}</h3>
                    <p className="speakersChairsBio">{person.biography}</p>
                  </div>
                  <div className="speakersChairsPersonActions">
                    <button
                      type="button"
                      onClick={() => setEditingPersonId(person.id)}
                      title="Edit person"
                      aria-label="Edit person"
                    >
                      {EditSVG}
                    </button>
                  </div>
                </article>
              );
            })}

            {filteredPeople.length === 0 ? (
              <div className="speakersChairsEmptyState">
                No people match the current search.
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

export default SpeakersChairsPage;
