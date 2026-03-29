import { memo } from "react";
import { formatDate, formatViews } from "~/functions";
import { useI18n } from "~/i18n";

type Props = {
    title: string,
    author: string,
    views: number,
    date: string
}

function ContentInfo({props}: {props: Props}){
    const { t } = useI18n();
    return (
        <div className="info">
            <h2 title={props?.title}>{props?.title}</h2>
            <p className="author">{props?.author || t("unknownSpeakers")}</p>

            <span className="flex gap-1.5">
                <p className="views">{formatViews(props?.views)}</p>
                <p className="date">{formatDate(props?.date)}</p>
            </span>
        </div>
    );
}

export default memo(ContentInfo);
