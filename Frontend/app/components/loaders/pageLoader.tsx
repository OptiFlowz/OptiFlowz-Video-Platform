import { useIsFetching } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigation } from "react-router";
import { changeElementClass } from "~/functions";

function PageLoader({ active = false }: { active?: boolean }){
    const isFetching = useIsFetching({ predicate: query => !query.state.data });
    const navigation = useNavigation();
    const location = useLocation();

    const [progress, setProgress] = useState(0);
    const loaderRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
    const postLoaderRef = useRef<ReturnType<typeof setTimeout>>(null);
    const progressRef = useRef(0);

    const removeTimeout = (item: ReturnType<typeof setTimeout> | null) => {
        if(!item) return;

        clearTimeout(item);
        item = null;
    }

    const removeInterval = (item: ReturnType<typeof setInterval> | null) => {
        if(!item) return;

        clearInterval(item);
        item = null;
    };

    const changeProgress = useCallback((number: number) => {
        progressRef.current = number;
        setProgress(number);
    }, [progress]);

    const loaderFn = () => {
        removeInterval(intervalRef.current);

        const isLoading = active || isFetching || navigation.state === "loading";

        if (isLoading) {
            if(progress === 0){
                changeElementClass({element: loaderRef.current, show: true});

                //DELAY TO AVOID FLASHING EFFECT ON FAST LOADING
                setTimeout(() => {
                    changeProgress(70);    
                }, 10);
            }

            intervalRef.current = setInterval(() => {
                if(progressRef.current <= 85)
                changeProgress(progressRef.current + 5);
            }, Math.max(Math.random(), 0.2) * 1000);
        } else if(!isLoading && progressRef.current !== 0) {
            changeProgress(100);
            
            removeTimeout(timeoutRef.current);
            removeTimeout(postLoaderRef.current);

            timeoutRef.current = setTimeout(() => {
                changeElementClass({element: loaderRef.current, timeout: 200});

                postLoaderRef.current = setTimeout(() => {
                    changeProgress(0);
                }, 200);
            }, 500);
        }
    };

    useEffect(() => {
        removeTimeout(timeoutRef.current);
        removeTimeout(postLoaderRef.current);
        removeInterval(intervalRef.current);

        changeProgress(0);
        changeElementClass({element: loaderRef.current, timeout: 0});
    }, [location.pathname]);

    useEffect(() => {
        loaderFn();
    }, [active, isFetching, navigation.state, progress]);

    return (
        <div ref={loaderRef} className="fetchLoader displayNone">
            <span style={{ width: `${progress}%` }}></span>
        </div>
    );
}

export default PageLoader;
