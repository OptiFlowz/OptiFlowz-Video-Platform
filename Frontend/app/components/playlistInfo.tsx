import { memo } from "react";
import { formatDate, formatViews } from "~/functions";
import { translateContentTitle } from "~/i18n";

type Props = {
    title: string,
    views: number,
    date: string
}

function PlaylistInfo({props}: {props: Props}){
    const title = translateContentTitle(props.title);

    return (
        <div className="info">
            <h2 title={title}>{title}</h2>

            <span className="flex gap-1.5">
                <p className="views">{formatViews(props.views)}</p>
                <p className="date">{formatDate(props.date)}</p>
            </span>
        </div>
    );
}

export default memo(PlaylistInfo);
