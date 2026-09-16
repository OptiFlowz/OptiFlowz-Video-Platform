import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { fetchFn } from "~/API";
import { getToken, subscribeToSession } from "~/auth/session";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";

export type VideoNote = { id: string; video_id: string; title: string; text: string; timestamp: number; color: string | null };
export type NoteInput = Pick<VideoNote, "title" | "text" | "timestamp" | "color">;
export const noteColors = [
  { key: "blue", variable: "--accentBlue3" },
  { key: "green", variable: "--analyticsSignupsOverTime" },
  { key: "amber", variable: "--analyticsViewsOverTime" },
  { key: "purple", variable: "--analyticsActiveUsersOverTime" },
] as const;
export function noteColor(color: string | null) {
  return `var(${(noteColors.find(option => option.key === color || option.variable === color) ?? noteColors[0]).variable})`;
}
export function parseNoteTime(value: string): number | null {
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value.trim())) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.slice(1).some(part => part >= 60)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
export function noteTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(total % 60).padStart(2, "0")}`;
}
function normalizeNote(note: VideoNote): VideoNote {
  const timestamp = Number(note?.timestamp);
  if (!note?.id || !note.video_id || typeof note.title !== "string" || typeof note.text !== "string" || !Number.isFinite(timestamp) || timestamp < 0) throw new Error("Invalid note response");
  return { ...note, timestamp };
}
export function sortNotes(notes: VideoNote[]) {
  return [...notes].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}
type NoteChange = { type: "create"; input: NoteInput } | { type: "edit"; id: string; input: NoteInput } | { type: "delete"; id: string };
export function useVideoNotes(videoId: string) {
  const token = useSyncExternalStore(subscribeToSession, getToken, () => null);
  const auth = useAuthorization();
  const client = useQueryClient();
  const key = ["video-notes", token, videoId];
  const canRead = !!token && auth.can(P.notesReadOwn);
  const query = useQuery({
    queryKey: key, enabled: !!videoId && canRead, staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const result = await fetchFn<{ success: boolean; notes: VideoNote[] }>({ route: `api/notes/video/${encodeURIComponent(videoId)}`, options: { headers: { Authorization: `Bearer ${token}` }, signal } });
      if (!result?.success || !Array.isArray(result.notes)) throw new Error("Invalid notes response");
      return sortNotes(result.notes.map(normalizeNote).filter(note => note.video_id === videoId));
    },
    retry: (count, error) => count < 1 && !("status" in error && [401, 403, 404].includes(Number(error.status))),
  });
  const mutation = useMutation({
    onMutate: async () => { await client.cancelQueries({ queryKey: key }); },
    mutationFn: async (change: NoteChange) => {
      const permission = change.type === "create" ? P.notesCreate : change.type === "edit" ? P.notesEditOwn : P.notesDeleteOwn;
      if (!token || getToken() !== token || !auth.can(permission)) throw new Error("Not authorized");
      const result = await fetchFn<{ success: boolean; note?: VideoNote; deleted?: boolean }>({
        route: change.type === "create" ? "api/notes" : `api/notes/${encodeURIComponent(change.id)}`,
        options: {
          method: change.type === "create" ? "POST" : change.type === "edit" ? "PATCH" : "DELETE",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          ...(change.type !== "delete" ? { body: JSON.stringify(change.type === "create" ? { ...change.input, video_id: videoId } : change.input) } : {}),
        },
      });
      if (!result?.success || (change.type === "delete" ? !result.deleted : !result.note)) throw new Error("Invalid note response");
      const note = result.note ? normalizeNote(result.note) : undefined;
      if (note && note.video_id !== videoId) throw new Error("Invalid note video");
      return note;
    },
    onSuccess: (note, change) => {
      if (getToken() !== token) return;
      client.setQueryData<VideoNote[]>(key, previous => sortNotes([
        ...(previous ?? []).filter(item => item.id !== (change.type === "create" ? note?.id : change.id)),
        ...(note ? [note] : []),
      ]));
      void client.invalidateQueries({ queryKey: key });
    },
  });
  return { ...query, notes: canRead ? query.data ?? [] : [], mutation, signedIn: !!token, authLoading: auth.loading, authError: auth.error, canRead,
    canCreate: canRead && auth.can(P.notesCreate), canEdit: canRead && auth.can(P.notesEditOwn), canDelete: canRead && auth.can(P.notesDeleteOwn) };
}
export const OPEN_NOTES_EVENT = "player:open-notes";
export type OpenNotesDetail = { videoId: string; noteId?: string; action?: "edit" | "delete" };
export function openVideoNotes(detail: OpenNotesDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTES_EVENT, { detail }));
}
