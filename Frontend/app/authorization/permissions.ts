// These keys match the backend authorization permissions, not role names.
export const P = {
  liveCreate: 'livestreams.create', liveLibrary: 'livestreams.library.read',
  liveUpdateOwn: 'livestreams.update_own', liveUpdateAny: 'livestreams.update_any',
  liveDeleteOwn: 'livestreams.delete_own', liveDeleteAny: 'livestreams.delete_any',
  liveBroadcastOwn: 'livestreams.broadcast_own', liveBroadcastAny: 'livestreams.broadcast_any',
  liveProgress: 'livestreams.progress.update', liveReact: 'livestreams.react',
  liveAnalyticsOwn: 'analytics.livestream_own.read', liveAnalyticsAny: 'analytics.livestream_any.read',
  postsReact: 'posts.react',
  postsCreate: 'posts.create', postsUpdateOwn: 'posts.update_own', postsUpdateAny: 'posts.update_any',
  postsDeleteOwn: 'posts.delete_own', postsDeleteAny: 'posts.delete_any',
  postsPollVote: 'posts.poll.vote', postsQuestionerAnswer: 'posts.questioner.answer',
  rolesManage: 'roles.manage', usersSearch: 'users.search', usersAssignRoles: 'users.assign_roles',
  videosCreate: 'videos.create', videosUpdateOwn: 'videos.update_own', videosUpdateAny: 'videos.update_any',
  videosDeleteOwn: 'videos.delete_own', videosDeleteAny: 'videos.delete_any', videosLibrary: 'videos.library.read',
  videosProgress: 'videos.progress.update', videosReact: 'videos.react',
  playlistsCreate: 'playlists.create', playlistsUpdateOwn: 'playlists.update_own', playlistsUpdateAny: 'playlists.update_any',
  playlistsDeleteOwn: 'playlists.delete_own', playlistsDeleteAny: 'playlists.delete_any', playlistsLibrary: 'playlists.library.read', playlistsSave: 'playlists.save',
  quizzesCreate: 'quizzes.create', quizzesManageOwn: 'quizzes.manage_own', quizzesManageAny: 'quizzes.manage_any', quizzesParticipate: 'quizzes.participate', quizzesCertificates: 'quizzes.certificates',
  notesReadOwn: 'notes.read_own', notesCreate: 'notes.create', notesEditOwn: 'notes.edit_own', notesDeleteOwn: 'notes.delete_own',
  commentsCreate: 'comments.create', commentsEditOwn: 'comments.edit_own', commentsDeleteOwn: 'comments.delete_own', commentsModerate: 'comments.moderate', commentsReact: 'comments.react',
  peopleManage: 'people.manage', videoAnalyticsOwn: 'analytics.video_own.read', videoAnalyticsAny: 'analytics.video_any.read',
  channelAnalyticsOwn: 'analytics.channel_own.read', channelAnalyticsAny: 'analytics.channel_any.read', platformAnalytics: 'analytics.platform.read', analyticsExport: 'reports.analytics.export',
} as const;

export const accessPermissions = {
  live: [P.liveLibrary], myLivestreams: [P.liveUpdateOwn], createLive: [P.liveCreate],
  liveStudio: [P.liveUpdateOwn, P.liveUpdateAny, P.liveBroadcastOwn, P.liveBroadcastAny],
  posts: [P.postsCreate, P.postsUpdateOwn, P.postsUpdateAny, P.postsDeleteOwn, P.postsDeleteAny],
  videos: [P.videosUpdateOwn], upload: [P.videosCreate], editVideo: [P.videosUpdateOwn, P.videosUpdateAny, P.liveUpdateOwn, P.liveUpdateAny],
  playlists: [P.playlistsUpdateOwn], editPlaylist: [P.playlistsUpdateOwn, P.playlistsUpdateAny],
  quizzes: [P.quizzesManageOwn], participate: [P.quizzesParticipate], people: [P.peopleManage],
  videoAnalytics: [P.videoAnalyticsOwn, P.videoAnalyticsAny, P.liveAnalyticsOwn, P.liveAnalyticsAny], channelAnalytics: [P.channelAnalyticsOwn],
  platformUsers: [P.usersSearch], platformSettings: [P.rolesManage], platformAnalytics: [P.platformAnalytics],
} as const;
export type AccessSection = keyof typeof accessPermissions;
