export type VPreviewProps = {
    id?: string,
    thumbnail: string,
    progress_seconds: number,
    percentage_watched: number,
    title: string,
    author: string,
    views: string,
    date: string,
    duration: string,
    duration_seconds: number
}

export type VProps = VPreviewProps & {
    description: string,
    tags: string[],
}

type Pagination = {
    page: number,
    limit: number,
    total: number,
    total_pages: number
}

export type ItemSliderT = {
    type: number,
    limit?: number,
    progress?: string[],
    classes?: string,
    onDataStateChange?: (state: "loading" | "empty" | "has-data") => void
}

export type CategoryT = {
    id: string,
    name: string,
    color: string,
    number: number
}

export type ChapterT = {
    title: string,
    startTime: number
}

export type VideoPlaylistT = {
    id: string,
    title: string,
    thumbnail_url: string,
    view_count: number,
    video_count: number,
    created_at: string
}

export type VideoT = {
    categories: CategoryT[],
    comment_count?: number,
    created_at: string,
    description: string,
    dislike_count: number,
    duration_seconds: number,
    id: string,
    like_count: number,
    percentage_watched: number,
    progress_seconds: number,
    published_at: string,
    stream_url: string,
    mux_playback_id: string,
    chapters: ChapterT[],
    tags: string[],
    thumbnail_url: string,
    title: string,
    updated_at: string,
    uploader_name: string,
    view_count: number,
    people: PersonT[],
    playlists: VideoPlaylistT[],
    view: ViewT,
    user_reaction: number,
    visibility: "public" | "private"
}

export type AuthFetchT = {
    message: string,
    issues: unknown[],
    user: {
        full_name: string,
        email: string,
        image_url: string,
        role: string,
        eaes_member: boolean,
        description: string
    },
    token: string,
    videos: VideoT[],
    pagination: Pagination
}

export type VideosT = {
    created_at: string,
    duration_seconds: number 
    id: string,
    last_watched_at: string,
    percentage_watched: number,
    progress_seconds: number,
    thumbnail_url: string,
    title: string,
    uploader_name: string,
    view_count: number,
    people: PersonT[]
}

export type PersonT = {
    id: string,
    name: string,
    image_url: string,
    total_video_count: number,
    type: number
}

export type PersonSearchT = {
    id: string,
    name: string,
    image_url: string,
    description: string
}

export type ViewT = {
    view_id: string,
    last_seq: number,
    counted: boolean
}

export type PlaylistViewT = {
    view_id: string,
    counted: boolean
}

export type SimilarVideoT = {
    created_at: string,
    duration_seconds: number 
    id: string,
    similarity_score: number,
    percentage_watched: number,
    progress_seconds: number,
    thumbnail_url: string,
    title: string,
    uploader_name: string,
    view_count: number,
    people: PersonT[]
}

export type SimilarT = {
    videos: SimilarVideoT[],
    pagination: Pagination
}

export type SearchT = {
    videos: SimilarVideoT[],
    pagination: Pagination
}

export type fetchCategoryT = {
    categories: CategoryT[],
    pagination: Pagination
}

export type fetchVideos = {
    videos: VideosT[],
    pagination: Pagination
}

export type fetchVideo = {
    videos: VideoT[],
    pagination: Pagination,
    total: number,
    total_pages: number
}

export type MyPlaylistT = {
    id: string,
    title: string,
    description?: string,
    thumbnail_url: string,
    view_count: number,
    save_count: number,
    video_count: number,
    created_at: string,
    status: "public" | "private",
    featured?: boolean
}

export type FetchMyPlaylistsT = {
    success: boolean,
    page: number,
    limit: number,
    total: number,
    total_pages: number,
    sort: "created_at" | "view_count" | "save_count",
    order: "asc" | "desc",
    playlists: MyPlaylistT[]
}

export type fetchFeaturedPlaylist = {
    playlists: VideoPlaylistT[],
    pagination: Pagination
}

export type fetchPerson = {
    person: PersonSearchT
}

export type PlaylistT = {
    created_at: string,
    description: string,
    save_count: number,
    is_saved: boolean,
    id: string,
    tags: null | string[],
    thumbnail_url: string,
    title: string,
    video_count: number,
    videos: SimilarVideoT[],
    view_count: number,
    view: PlaylistViewT,
    status?: "public" | "private",
    featured?: boolean
}

export type PlaylistSearchRes = {
  playlists: Array<{
    id: string,
    title: string,
    thumbnail_url: string,
    view_count: number,
    video_count: number,
    created_at: string,
    description: string,
    relevance?: number,
  }>,
  pagination: { total: number; page: number; limit: number; totalPages: number }
};

export type PeopleSearchRes = {
  people: Array<{
    id: string,
    name: string,
    image_url: string | null,
    description: string | null,
    total_video_count: number | string,
  }>,
  pagination: { total: number; page: number; limit: number; totalPages: number }
};

export type VideoCommentT = {
    id: string,
    video_id: string,
    user_id: string,
    parent_id: string | null,
    content: string,
    like_count: number,
    dislike_count: number,
    reply_count: number,
    created_at: string,
    updated_at: string,
    author_full_name: string,
    author_image_url: string | null,
    my_reaction: number | null
}

export type FetchVideoCommentsT = {
    comments: VideoCommentT[],
    page: number,
    limit: number,
    total: number,
    total_pages: number
}

export type FetchCommentRepliesT = {
    success: boolean,
    parent_id: string,
    video_id: string,
    page: number,
    limit: number,
    total: number,
    total_pages: number,
    replies: VideoCommentT[]
}

export type PostCommentResponseT = {
    success: boolean,
    comment: VideoCommentT
}

export type CommentReactionResponseT = {
    status: number,
    like_count: number,
    dislike_count: number
}
