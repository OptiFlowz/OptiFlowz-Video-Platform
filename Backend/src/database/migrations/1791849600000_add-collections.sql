-- Up Migration

CREATE TABLE public.collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(255) NOT NULL,
    description text,
    thumbnail_url text,
    created_by uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX collections_created_by_idx
ON public.collections (created_by);

CREATE TABLE public.collection_playlists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
    playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT collection_playlists_collection_playlist_key UNIQUE (collection_id, playlist_id)
);

CREATE INDEX collection_playlists_collection_position_idx
ON public.collection_playlists (collection_id, position);

CREATE INDEX collection_playlists_playlist_id_idx
ON public.collection_playlists (playlist_id);

-- Down Migration

DROP TABLE public.collection_playlists;
DROP TABLE public.collections;
