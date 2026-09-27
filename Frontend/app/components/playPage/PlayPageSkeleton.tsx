import { useI18n } from "~/i18n";

export default function PlayPageSkeleton() {
    const { t } = useI18n();
    return <main className="play px-0 py-7.5" aria-busy="true" aria-label={t("videoLoadingData")}>
        <div className="flex flex-col gap-5 overflow-x-hidden min-w-0">
            <div className="player">
                <div className="persistent-video-slot" aria-hidden="true">
                    <div className="player-skeleton">
                        <div className="player-skeleton__controls">
                            <span className="player-skeleton__chip player-skeleton__chip--wide" />
                            <span className="player-skeleton__chip" />
                            <span className="player-skeleton__chip player-skeleton__chip--short" />
                        </div>
                    </div>
                </div>
            </div>
            <div className="skeleton-content" aria-hidden="true">
                <div className="skeleton-title" />
                <div className="skeleton-text short" />
            </div>
        </div>
        <div className="relevant flex flex-col gap-7" aria-hidden="true">
            <div className="similar">
                <h2 className="subTitle">{t("similarVideos")}</h2>
                <div className="holder">
                    {Array.from({ length: 6 }, (_, index) => <div className="skeleton-playcard" key={index}>
                        <div className="skeleton-playcard-thumbnail" />
                        <div className="skeleton-playcard-content">
                            <div className="skeleton-playcard-title" />
                            <div className="skeleton-playcard-text" />
                            <div className="skeleton-playcard-text short" />
                        </div>
                    </div>)}
                </div>
            </div>
        </div>
    </main>;
}
