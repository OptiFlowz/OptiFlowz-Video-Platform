import { memo } from "react"
import Item from "./item";
import type { SearchT } from "~/types";

function VerticalSlider({props}: {props: SearchT}){
    const searchArray = props?.videos?.map((item, index) => (
        <Item key={`similar${index}`} props={{id: item.id, title: item.title, thumbnail: item.thumbnail_url, author: item?.people?.map(person => person.name).join(", "), views: item.view_count.toString(), date: item.created_at, duration: item.duration_seconds.toString(), duration_seconds: item.duration_seconds, progress_seconds: item.progress_seconds, percentage_watched: item.percentage_watched}} />
    ))

    return (
        <div className="verticalSlider">
            {searchArray}
        </div>
    )
}

export default memo(VerticalSlider);