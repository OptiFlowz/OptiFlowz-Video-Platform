import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

type Props = {
    additionalClass?: string,
    images: string[],
    paragraphs?: React.RefObject<HTMLDivElement | null>,
};

function Slider({props}: {props: Props}){
    const sliderHolderRef = useRef<HTMLDivElement>(null);
    const autoSlideRef = useRef<ReturnType<typeof setInterval>>(null);

    const changeSelectedParagraph = (index: number, animate?: boolean) => {
        const paragraphHolder = props.paragraphs!.current;
        paragraphHolder!.querySelector(".paragraph.selected")?.classList.remove("selected");
        const toSet = paragraphHolder!.querySelector(`.paragraph${index}`) as HTMLParagraphElement;
        const toSetLeft = toSet.offsetLeft - paragraphHolder!.offsetLeft;

        if(animate){
            toSet?.classList.add("selected");
            animateScroll(toSet.parentElement as HTMLElement, toSetLeft, 700);
        }
        else{
            toSet?.classList.add("selected", "noTransition");
            paragraphHolder!.scrollTo({
                behavior: "auto",
                left: 0
            });
            toSet?.classList.remove("noTransition");
        }
    }

    const dotHandle = useCallback((index: number) => {   
        if(sliderHolderRef.current){
            const imageToSet = sliderHolderRef.current.querySelector(`.photo-large${index}`) as HTMLImageElement;
            const imageParent = imageToSet.parentElement;

            const container = imageToSet.parentElement as HTMLElement;
            const targetLeft = imageToSet.offsetLeft - imageParent!.offsetLeft;

            if(props.paragraphs?.current){
                changeSelectedParagraph(index, true);
            } 

            animateScroll(
                container,
                targetLeft,
                700,
                () => {
                    if(index === 3){
                        container.scrollTo({
                            behavior: "auto",
                            left: 0
                        });

                        changeSelectedParagraph(0);
                    }
                }
            );   
        }
    }, [sliderHolderRef, props.paragraphs]);

    const animateScroll = (element: HTMLElement, to: number, duration: number = 900, onComplete?: () => void) => {
        const start = element.scrollLeft;
        const change = to - start;
        const startTime = performance.now();

        const easeInOutCubic = (t: number) => {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeInOutCubic(progress);

            element.scrollLeft = start + change * eased;

            if (progress < 1) 
                requestAnimationFrame(animate);
            else
                onComplete?.();
        };

        requestAnimationFrame(animate);
    };

    const autoSlide = useCallback((index: number) => {
        if(autoSlideRef.current)
            clearInterval(autoSlideRef.current);
        
        autoSlideRef.current = setInterval(() => {
            if(++index >= props.images.length + 1)
                index = 1;

            dotHandle(index);
        }, 5000)
    }, []);

    useLayoutEffect(() => {
        autoSlide(0);
    }, []);

    //OBSERVER WINDOW SIZE
    // const removeAutoSlide = useCallback(() => {
    //     if(autoSlideRef.current){
    //         dotHandle(0);
    //         clearInterval(autoSlideRef.current);
    //         autoSlideRef.current = null;
    //     }
    // }, []);

    // useEffect(() => {
    //     if(window.innerWidth <= 800)
    //         removeAutoSlide();

    //     const trackFn = () => {
    //         if(window.innerWidth <= 800)
    //             removeAutoSlide();
    //         else if(!autoSlideRef.current)
    //             autoSlide(0);
    //     }

    //     window.addEventListener("resize", trackFn);

    //     return () => window.removeEventListener("resize", trackFn);
    // }, []);

    const imagesElement = useMemo(() => {
        const normalArray =  props.images.map((imageURL, index) => (
            <img key={`sliderImage${index}`} className={`photo-large photo-large${index} ${index === 0 ? "selected" : ''}`} src={imageURL} alt="Hero Image Large" />
        ));
        normalArray.push(
            <img key={`sliderImage${3}`} className={`photo-large photo-large${3}`} src={props.images[0]} alt="Hero Image Large" />
        )

        return normalArray;
    }, [props.images]);
    

    return (
        <div ref={sliderHolderRef} className={`sliderHolder ${props.additionalClass ?? ''}`}>
            <div className="background"></div>
            <div className="image-grid">
                {imagesElement}
            </div>
        </div>
    );
}

export default Slider;
