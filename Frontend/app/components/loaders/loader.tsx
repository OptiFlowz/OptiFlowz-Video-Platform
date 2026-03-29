import { forwardRef } from "react";

type Props = {
    classes?: string
}

const Loader = forwardRef<HTMLDivElement, Props>((props, ref) => {
    return (
        <div ref={ref} className={`${props.classes ?? ''} loader`}>
            <svg viewBox="0 0 16 16" height="48" width="48" className="loadingSpinner">
                <circle r="4px" cy="8px" cx="8px"></circle>
            </svg>
        </div>
    )
});

export default Loader;