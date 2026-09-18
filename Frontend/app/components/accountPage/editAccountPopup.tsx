import type { AuthFetchT } from "~/types";
import { updateStoredProfile } from "~/auth/session";
import { CloseSVG, UploadSVG } from "~/constants";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchFn } from "~/API";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { changeElementClass, getToken } from "~/functions";
import { useI18n } from "~/i18n";
import Loader from "../loaders/loader";
import MessagePopup from "../messagePopup/messagePopup";
import PopupPortal from "~/components/popupPortal/popupPortal";
import ProfileImageCropper from "./profileImageCropper";

function EditAccountPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pictureRemoved, setPictureRemoved] = useState(false);
  const [selectedPicture, setSelectedPicture] = useState<File | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
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
  const profilePictureInputRef = useRef<HTMLInputElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const myHeaders = useRef(new Headers());
  const initialized = useRef(false);

  useEffect(() => {
    if (!selectedPicture) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(selectedPicture);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedPicture]);

  useEffect(() => {
    if (!open) { setCropFile(null); setSelectedPicture(null); }
  }, [open]);

  const handlePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      openMessagePopup(t("selectImageAlert"));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      openMessagePopup(t("imageTooLargeAlert"));
      return;
    }
    setCropFile(file);
  };

  const handleRemovePicture = () => {
    if (profilePictureInputRef.current) profilePictureInputRef.current.value = "";
    setSelectedPicture(null);
    setCropFile(null);
    setPictureRemoved(true);
  };

  useLayoutEffect(() => {
    const t = getToken();
    if(!t) return;
    setToken(t);
    if (t) myHeaders.current.set("Authorization", `Bearer ${t}`);
  }, []);

  const { data: userData } = useQuery({
    queryKey: ["accountInfo", token],
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
    if (!open) { initialized.current = false; return; }
    if (initialized.current || !userData?.user) return;
    initialized.current = true;

    // Initialize once per opening; background refetches must not discard a crop or form edits.
    setPictureRemoved(false);
    setSelectedPicture(null);
    setCropFile(null);

    if (profilePictureInputRef.current) {
      profilePictureInputRef.current.value = "";
    }

    // kad imamo userData, popuni inpute
    const u = userData?.user;
    if (!u) return;

    if (fullNameInputRef.current) fullNameInputRef.current.value = u.full_name ?? "";
    if (descriptionInputRef.current) descriptionInputRef.current.value = u.description ?? "";
  }, [open, userData]);

  const handleUserUpdate = async () => {
    if (!fullNameInputRef.current || !descriptionInputRef.current) return;
    if (!token || cropFile) return;

    const fullName = fullNameInputRef.current.value.trim();
    const description = descriptionInputRef.current.value.trim();

    try {
      let latestUser = userData?.user;

      const file = selectedPicture;

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
        if (token) updateStoredProfile(latestUser, token);

        window.dispatchEvent(new CustomEvent("update-header"));

        queryClient.setQueryData<AuthFetchT>(["accountInfo", token], (old) => {
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

  const hasCurrentPicture = !!previewUrl || !!userData?.user?.image_url;

  return <>
    <PopupPortal>
      <div className={`popup editAccountPopup ${open ? "active" : ""}`}>
      <div className="popup-content">
        <h2>
          {t(cropFile ? "profileCropTitle" : "accountSettings")} <button onClick={cropFile ? () => setCropFile(null) : onClose}>{CloseSVG}</button>
        </h2>

        {open && cropFile && <ProfileImageCropper file={cropFile} onCancel={() => setCropFile(null)}
          onApply={(file) => { setSelectedPicture(file); setPictureRemoved(false); setCropFile(null); }} />}

        <section style={cropFile ? { display: "none" } : undefined}>
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



        </section>

        <div className="editButtons" style={cropFile ? { display: "none" } : undefined}>
          <button onClick={onClose}>{t("cancel")}</button>
          <button onClick={handleUserUpdate}>{t("saveChanges")}</button>
        </div>
      </div>

      <button className="closePopup" onClick={onClose}></button>

      <Loader ref={loaderRef} classes="pageLoader displayNone" />
      </div>
    </PopupPortal>

    <MessagePopup
      open={popupState.open}
      message={popupState.message}
      onClose={closeMessagePopup}
      autoCloseMs={popupState.autoCloseMs}
    />
  </>;
}

export default EditAccountPopup;
