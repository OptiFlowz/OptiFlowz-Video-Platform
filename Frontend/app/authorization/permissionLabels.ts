import { hasTranslation } from "~/locales/formatTranslation";

export function permissionLabel(key: string, fallback: string, t: (key: string) => string) {
  const translationKey = `permission.${key}`;
  return hasTranslation(translationKey) ? t(translationKey) : fallback;
}

const permissionGroupKeys: Record<string, string> = {
  roles: "usersRoles", users: "rolesUsers", members: "rolesUsers",
  videos: "videosTab", playlists: "playlistsTab", quizzes: "navQuizzes",
  comments: "comments", people: "permission.groupPeople", analytics: "navAnalytics", reports: "permission.groupReports",
};
export function permissionGroupLabel(name: string, t: (key: string) => string) {
  const key = permissionGroupKeys[name.toLowerCase()];
  return key ? t(key) : name;
}
