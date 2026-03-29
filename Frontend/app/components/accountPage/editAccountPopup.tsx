import type { AuthFetchT } from "~/types";
import { CloseSVG, UploadSVG } from "~/constants";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchFn } from "~/API";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { changeElementClass, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import Loader from "../loaders/loader";
import MessagePopup from "../messagePopup/messagePopup";

function EditAccountPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pictureRemoved, setPictureRemoved] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  
  const [popupState, setPopupState] = useState<{
    open: boolean;
    message: string;
    autoCloseMs: number
  }>({
    open: false,
    message: "",
    autoCloseMs: 3000
  });

  const openMessagePopup = (text: string) => {
    setPopupState({
      ...popupState,
      open: true,
      message: text,
    });
  };

  const closeMessagePopup = () => {
    setPopupState((prev) => ({ ...prev, open: false }));
  };

  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const eaesInputRef = useRef<HTMLInputElement>(null);
  const profilePictureInputRef = useRef<HTMLInputElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const myHeaders = useRef(new Headers());

  const handlePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      openMessagePopup(t("selectImageAlert"));
      e.target.value = "";
      setPreviewUrl(null);
      setPictureRemoved(false);
      return;
    }

    const maxBytes = 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      openMessagePopup(t("imageTooLargeAlert"));
      e.target.value = "";
      setPreviewUrl(null);
      setPictureRemoved(false);
      return;
    }

    setPictureRemoved(false);

    const url = URL.createObjectURL(file);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  };

  const handleRemovePicture = () => {
    if (profilePictureInputRef.current) {
      profilePictureInputRef.current.value = "";
    }

    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });

    setPictureRemoved(true);
  };

  useLayoutEffect(() => {
    const t = getToken();
    if(!t) return;
    setToken(t);
    if (t) myHeaders.current.set("Authorization", `Bearer ${t}`);
  }, []);

  const { data: userData } = useQuery({
    queryKey: ["accountInfo"],
    queryFn: () =>
      fetchFn<AuthFetchT>({
        route: `api/auth/me`,
        options: {
          method: "GET",
          headers: myHeaders.current,
        },
      }),
    enabled: !!token,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!open) return;

    // reset local state za sliku svaki put kad otvoriš
    setPictureRemoved(false);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });

    if (profilePictureInputRef.current) {
      profilePictureInputRef.current.value = "";
    }

    // kad imamo userData, popuni inpute
    const u = userData?.user;
    if (!u) return;

    if (fullNameInputRef.current) fullNameInputRef.current.value = u.full_name ?? "";
    if (descriptionInputRef.current) descriptionInputRef.current.value = u.description ?? "";
    if (eaesInputRef.current) eaesInputRef.current.checked = !!u.eaes_member;
  }, [open, userData]);

  const handleUserUpdate = async () => {
    if (!fullNameInputRef.current || !descriptionInputRef.current || !eaesInputRef.current) return;
    if (!token) return;

    const fullName = fullNameInputRef.current.value.trim();
    const description = descriptionInputRef.current.value.trim();
    const eaesMember = eaesInputRef.current.checked;

    try {
      let latestUser = userData?.user;

      const file = profilePictureInputRef.current?.files?.[0];

      if (pictureRemoved || file) {
        const imgHeaders = new Headers();
        imgHeaders.set("Authorization", `Bearer ${token}`);

        const formdata = new FormData();

        if (pictureRemoved) {
          formdata.append("file", "");
        } else if (file) {
          if (!file.type.startsWith("image/")) {
            openMessagePopup(t("selectImageAlert"));
            return;
          }
          const maxBytes = 4 * 1024 * 1024;
          if (file.size > maxBytes) {
            openMessagePopup(t("imageTooLargeAlert"));
            return;
          }

          formdata.append("file", file);
        }

        changeElementClass({element: loaderRef.current, show: true});

        const uploadRes = await fetchFn<AuthFetchT>({
          route: "api/auth/user/profile-picture",
          options: {
            method: "POST",
            headers: imgHeaders,
            body: formdata,
          },
        });

        if (uploadRes?.user) {
          latestUser = uploadRes.user;
        }
      }

      const myHeaders2 = new Headers();
      myHeaders2.set("Authorization", `Bearer ${token}`);
      myHeaders2.set("Content-Type", "application/json");

      const raw = JSON.stringify({
        full_name: fullName,
        description,
        eaes_member: eaesMember,
      });

      const updateRes = await fetchFn<AuthFetchT>({
        route: "api/auth/user-update",
        options: {
          method: "PATCH",
          headers: myHeaders2,
          body: raw,
        },
      });

      if (updateRes?.user) {
        latestUser = updateRes.user;
      }

      if (latestUser) {
        const stored = JSON.parse(localStorage.getItem("user") || "{}");
        stored.user = latestUser;
        localStorage.setItem("user", JSON.stringify(stored));

        window.dispatchEvent(new CustomEvent("update-header"));

        queryClient.setQueryData<AuthFetchT>(["accountInfo"], (old) => {
          if (!old) return old;
          return { ...old, user: latestUser };
        });
      }

      onClose();
    } catch (err) {
      console.error(err);
      openMessagePopup("Something went wrong. Please try again.");
    } finally {
      changeElementClass({element: loaderRef.current});
    }
  };

  useEffect(() => {
    if (eaesInputRef.current) {
      eaesInputRef.current.checked = !!userData?.user?.eaes_member;
    }
  }, [userData?.user?.eaes_member]);

  const hasCurrentPicture = !!previewUrl || !!userData?.user?.image_url;

  return <>
    <div className={`popup editAccountPopup ${open ? "active" : ""}`}>
      <div className="popup-content">
        <h2>
          {t("accountSettings")} <button onClick={onClose}>{CloseSVG}</button>
        </h2>

        <section>
          <span className="userPictureInput">
            <label htmlFor="profilePictureInput">
              <img
                src={
                  pictureRemoved
                    ? DefaultProfile
                    : previewUrl || userData?.user?.image_url || DefaultProfile
                }
                alt="Profile pic"
                onError={e => {
                    e.currentTarget.src = DefaultProfile;
                }}
              />
              <span>{UploadSVG}</span>
            </label>

            {!pictureRemoved && hasCurrentPicture && (
                <button type="button" className="remove" onClick={handleRemovePicture}>
                    {CloseSVG}
                </button>
            )}

            <input
              ref={profilePictureInputRef}
              id="profilePictureInput"
              type="file"
              name="profileEdit"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePictureChange}
            />
          </span>

          <span className="textInputField">
            <label htmlFor="fullNameInput">{t("fullName")}</label>
            <input
              ref={fullNameInputRef}
              type="text"
              name="profileEdit"
              id="fullNameInput"
              placeholder={t("fullName")}
              defaultValue={userData?.user?.full_name}
            />
          </span>

          <span className="textInputField">
            <label htmlFor="descriptionInput">{t("biography")}</label>
            <textarea
              ref={descriptionInputRef}
              name="profileEdit"
              id="descriptionInput"
              placeholder={t("biography")}
              defaultValue={userData?.user?.description}
            />
          </span>

          <span className="checkInputField flex items-center gap-2">
            <input
              ref={eaesInputRef}
              className="appearance-none rounded-lg! p-3.5! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
              checked:after:content-['✓'] checked:after:absolute checked:after:text-(--accentBlue2) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
              type="checkbox"
              id="rememberMe"
              defaultChecked={!!userData?.user?.eaes_member}
            />
            <label htmlFor="rememberMe" className="cursor-pointer">
              {t("eaesMember")}
            </label>
          </span>

          <span className="editButtons">
            <button onClick={onClose}>{t("cancel")}</button>
            <button onClick={handleUserUpdate}>{t("saveChanges")}</button>
          </span>
        </section>
      </div>

      <button className="closePopup" onClick={onClose}></button>

      <Loader ref={loaderRef} classes="pageLoader displayNone" />
    </div>

    <MessagePopup
      open={popupState.open}
      message={popupState.message}
      onClose={closeMessagePopup}
      autoCloseMs={popupState.autoCloseMs}
    />
  </>;
}

export default EditAccountPopup;
