import { memo, type ReactElement } from "react";

function CategoryItem({props}: {props: {title: string, color: string, svg: ReactElement, searchUrl: string}}){
    return (
        <a href={`/search?category=${props.searchUrl}&title=${props.title}`} style={{backgroundColor: `${props.color}0F`, borderColor: `${props.color}7F`}} className={`item`}>
            {props.svg}
            
            <span>
                {props.svg}
            </span>
            
            <h3 className="mt-3 text-[1.15rem]">{props.title}</h3>
        </a>
    );
}

export default memo(CategoryItem);