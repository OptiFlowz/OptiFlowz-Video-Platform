import type MuxPlayerElement from "@mux/mux-player";

export const TRANSCRIPT_EVENT = "player:transcript";
export const TRANSCRIPT_REQUEST_EVENT = "player:transcript-request";

export type TranscriptCue = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
};

export type TranscriptEventDetail = {
  cues: TranscriptCue[];
  hasTrack: boolean;
  language: string;
};

function parseVttTimestamp(value: string) {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? Number.NaN;
}

function cleanVttText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseVttTranscript(vtt: string): TranscriptCue[] {
  return vtt
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .flatMap((block, blockIndex) => {
      const lines = block.split("\n").map((line) => line.trim());
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return [];

      const timing = lines[timingIndex].match(
        /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)/,
      );
      if (!timing) return [];

      const startTime = parseVttTimestamp(timing[1]);
      const endTime = parseVttTimestamp(timing[2]);
      const text = cleanVttText(lines.slice(timingIndex + 1).join(" "));
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !text) return [];

      return [{ id: `vtt-${startTime}-${endTime}-${blockIndex}`, startTime, endTime, text }];
    });
}

function getCueText(cue: TextTrackCue) {
  if (typeof VTTCue !== "undefined" && cue instanceof VTTCue) {
    const holder = document.createElement("div");
    holder.append(cue.getCueAsHTML());
    return holder.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  return cleanVttText((cue as TextTrackCue & { text?: string }).text ?? "");
}

export function readPlayerTranscript(player: MuxPlayerElement | null): TranscriptEventDetail {
  const video = player?.media?.nativeEl;
  if (!video) return { cues: [], hasTrack: false, language: "" };

  const tracks = Array.from(video.textTracks).filter(
    (track) => track.kind === "captions" || track.kind === "subtitles",
  );
  const selectedTrack =
    tracks.find((track) => track.mode === "showing") ??
    tracks.find((track) => track.mode === "hidden") ??
    tracks.find((track) => (track.cues?.length ?? 0) > 0) ??
    tracks[0];

  const cues = Array.from(selectedTrack?.cues ?? [])
    .map((cue, index) => ({
      id: `${cue.startTime}-${cue.endTime}-${index}`,
      startTime: cue.startTime,
      endTime: cue.endTime,
      text: getCueText(cue),
    }))
    .filter((cue) => cue.text.length > 0);

  return {
    cues,
    hasTrack: tracks.length > 0,
    language: selectedTrack?.language ?? "",
  };
}

export function publishPlayerTranscript(player: MuxPlayerElement | null) {
  window.dispatchEvent(
    new CustomEvent<TranscriptEventDetail>(TRANSCRIPT_EVENT, {
      detail: readPlayerTranscript(player),
    }),
  );
}
