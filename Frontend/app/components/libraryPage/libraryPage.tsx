import { useLayoutEffect, useRef, useState, type JSX } from "react";
import { BariatricsSVG, ColorectalSVG, CupSVG, GiSVG, HepatoSVG, HerniaSVG, OrgansSVG, RoboticsSVG, SearchSVG, DefaultCatSVG } from "~/constants";
import CategoryItem from "./categoryItem";
import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { useNavigate } from "react-router";
import type { fetchCategoryT } from "~/types";
import { useI18n } from "~/i18n";

const catSVGs = [CupSVG, BariatricsSVG, ColorectalSVG, HepatoSVG, HerniaSVG, RoboticsSVG, OrgansSVG, GiSVG];

function LibraryPage(){
    const { t } = useI18n();

    const myHeaders = useRef(new Headers());
    const [token, setToken] = useState(undefined);
    const navigate = useNavigate();
    const searchRef = useRef<HTMLInputElement>(null);

    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if(e.key !== "Enter") return;
        const searchVal = searchRef?.current?.value;
        if(searchVal){
            navigate(`/search/${searchVal}`);
        } 
    }

    const handleSearchButton = () => {
        const searchVal = searchRef?.current?.value;
        if(searchVal){
            navigate(`/search/${searchVal}`);
        } 
    }

    useLayoutEffect(() => {
        setToken(JSON.parse(localStorage.user).token);

        if(token)
            myHeaders.current.append("Authorization", `Bearer ${JSON.parse(localStorage.user).token}`);
    }, [token])

    const {data} = useQuery({
        queryKey: [`categories`],
        queryFn: () => fetchFn<fetchCategoryT>({route: 'api/videos/categories', options: {method: "GET", headers: myHeaders.current}}),
        enabled: !!token
    });

    let categoriesArray = new Array<JSX.Element>();

    if(data && ("categories" in data) && data.categories.length > 0){
        data.categories.forEach((item, index) => {
            categoriesArray.push(<CategoryItem key={`category${index}`} props={{title: item.name, color: item.color, svg: catSVGs[item.number - 1] || DefaultCatSVG, searchUrl: item.id}} />);
        });
    }

    return (
        <main className="library">
            <div className="heading">
                <h2 className="text-4xl font-bold">{t("videoLibrary")}</h2>
                
                <span className="flex items-center gap-1 mt-3">
                    <input ref={searchRef} type="text" placeholder={t("searchPlaceholder")} onKeyDown={e => handleSearch(e)} spellCheck="false" />
                    
                    <button className="button flex items-center gap-2.5" onClick={handleSearchButton}>
                        {SearchSVG}
                        <p>{t("search")}</p>
                    </button>
                </span>

                <p className="weakText max-w-[430px] mt-3 text-[.925rem]">{t("librarySearchText")}</p>
            </div>

            <div className="categories mb-15">
                <h2 className="subTitle">{t("videoCategories")}</h2>

                <div>
                    {categoriesArray}
                </div>
            </div>
        </main>
    );
}

export default LibraryPage;
