-- Up Migration

ALTER TABLE public.quiz_requirements
    DROP CONSTRAINT quiz_requirements_video_id_fkey;

ALTER TABLE public.quiz_requirements
    ADD CONSTRAINT quiz_requirements_video_id_fkey
    FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

-- Down Migration

ALTER TABLE public.quiz_requirements
    DROP CONSTRAINT quiz_requirements_video_id_fkey;

ALTER TABLE public.quiz_requirements
    ADD CONSTRAINT quiz_requirements_video_id_fkey
    FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE RESTRICT;
