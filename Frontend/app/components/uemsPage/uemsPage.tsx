import { useI18n } from "~/i18n";
import HeroLarge from "../../../assets/Slider1.webp";
import HeroMedium from "../../../assets/Slider2.webp";
import HeroSmall from "../../../assets/Slider3.webp";
import Slider from "../homePage/slider/slider";
import { useLayoutEffect, useRef } from "react";

type ReadingLink = {
    label: string;
    href: string;
};

function getReadingLinkType(label: string): string {
    const normalized = label.toLowerCase();

    if (normalized.includes("textbook") || normalized.includes("handbook")) {
        return "uemsTypeTextbook";
    }

    if (normalized.includes("manual")) {
        return "uemsTypeManual";
    }

    if (normalized.includes("guideline") || normalized.includes("recommendation")) {
        return "uemsTypeGuideline";
    }

    if (normalized.includes("consensus")) {
        return "uemsTypeConsensus";
    }

    if (normalized.includes("review") || normalized.includes("meta-analysis")) {
        return "uemsTypeReview";
    }

    if (normalized.includes("chapter") || normalized.includes("principles of")) {
        return "uemsTypeBookchapter";
    }

    if (normalized.includes("statpearls")) {
        return "uemsTypeReference";
    }

    return "uemsTypeArticle";
}

type ReadingList = {
    id: string;
    navLabel: string;
    title: string;
    pdfHref: string;
    links: ReadingLink[];
};

const readingLists: ReadingList[] = [
    {
        id: "uemsMis",
        navLabel: "uemsMisTitle",
        title: "uemsMisTitle",
        pdfHref: "https://optiflowzstorage.com/Reading%20List%20UEMS%20MIS.docx.pdf",
        links: [
            { label: "EAES recommendations for recovery plan in minimally invasive surgery amid COVID-19", href: "https://pubmed.ncbi.nlm.nih.gov/33170335/" },
            { label: "EAES bariatric surgery guideline update 2020", href: "https://pubmed.ncbi.nlm.nih.gov/32328827/" },
            { label: "EAES and SAGES acute diverticulitis management consensus", href: "https://doi.org/10.1007/s00464-019-06882-z" },
            { label: "Diagnosis and management of acute appendicitis", href: "https://pubmed.ncbi.nlm.nih.gov/27660247/" },
            { label: "UEG and EAES rapid guideline on surgical management of GERD", href: "https://pubmed.ncbi.nlm.nih.gov/36196591/" },
            { label: "UEG and EAES rapid guideline on TaTME for rectal cancer", href: "https://pubmed.ncbi.nlm.nih.gov/35212821/" },
            { label: "Surgical Principles of Minimally Invasive Procedures manual", href: "https://link.springer.com/book/10.1007/978-3-319-43196-3" },
            { label: "Colonoscopy complications: recognition, assessment and management", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10711827/" },
            { label: "ASCRS guideline for preventing surgical site infection", href: "https://pubmed.ncbi.nlm.nih.gov/39082620/" },
            { label: "European Guidelines on Minimally Invasive Pancreatic Surgery (EGUMIPS)", href: "https://pubmed.ncbi.nlm.nih.gov/37450702/" },
            { label: "ASMBS and IFSO indications for metabolic and bariatric surgery", href: "https://pubmed.ncbi.nlm.nih.gov/36336720/" },
            { label: "EAES clinical practice guideline on bariatric surgery update 2020", href: "https://doi.org/10.1007/s00464-020-07555-y" },
            { label: "ACG guideline on achalasia", href: "https://pubmed.ncbi.nlm.nih.gov/32773454/" }
        ]
    },
    {
        id: "uemsRas",
        navLabel: "uemsRasTitle",
        title: "uemsRasTitle",
        pdfHref: "https://optiflowzstorage.com/Reading%20List%20UEMS%20Robotics.docx.pdf",
        links: [
            { label: "Da Vinci Xi system user manual", href: "https://www.lmc-clients.com/intuitive/2023/Resources/StaffingGuide/1007573-09-USrD-Xi-ORstaff-InServiceGuide-OS4v9.pdf" },
            { label: "ALSGBI manual for robotic skills courses", href: "https://www.alsgbi.org/wp-content/uploads/2024/01/RS-Manual-v5.pdf" },
            { label: "Ergonomic evaluation and guidelines for use of the da Vinci robot system", href: "https://doi.org/10.1089/END.2009.0197" },
            { label: "Ergonomic analysis of robot-assisted and traditional laparoscopic procedures", href: "https://doi.org/10.1007/S00464-014-3604-9" },
            { label: "Metric-based simulation training to proficiency in medical education", href: "https://pubmed.ncbi.nlm.nih.gov/23620606/" },
            { label: "Origins of robotic surgery: from skepticism to standard of care", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6261744/" },
            { label: "Essential components and validation of robotic surgical training curricula", href: "https://pubmed.ncbi.nlm.nih.gov/39903561/" },
            { label: "Robotic surgery: literature review and current trends", href: "https://doi.org/10.7759/cureus.42370" },
            { label: "Principles of robot-assisted colorectal surgery", href: "https://link.springer.com/article/10.1007/s10353-024-00838-x" }
        ]
    }
];

function UemsReadingList() {
    const { t, locale } = useI18n();
    const paragraphRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!paragraphRef.current) return;

        const maxWidth = Math.min(
            Math.max(
                ...Array.from(paragraphRef.current.querySelectorAll("p"), (p) => p.offsetWidth)
            ),
            700
        );

        paragraphRef.current.style.width = `${maxWidth}px`;
        paragraphRef.current.querySelectorAll("p").forEach((p) => {
            p.style.width = `${maxWidth}px`;
        });
    }, [locale]);

    return <>
        <main className="homePage py-10">
            <div className="hero">
                <span className="titles">
                    <h2 className="relative w-fit font-bold text-(--text1) text-5xl max-[1300px]:text-[2.2rem] max-[1160px]:text-[2rem] max-[800px]:text-[2rem] max-[500px]:text-2xl">UEMS<br />{t("uemsReadingListTitle")}</h2>

                    <div ref={paragraphRef} className="paragraphHolder">
                        <p className="paragraph paragraph0 selected mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)">
                            {t("uemsReadingIntro")}
                        </p>

                        <p className="paragraph paragraph1 mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)">
                            {t("uemsReadingInstructions")}
                        </p>

                        <p className="paragraph paragraph2 mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)">
                            {t("uemsReadingSimple")}
                        </p>
                        
                        <p className="paragraph paragraph3 selected mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)">
                            {t("uemsReadingIntro")}
                        </p>
                    </div>
                </span>

                <Slider props={{
                    images: [HeroLarge, HeroMedium, HeroSmall],
                    paragraphs: paragraphRef
                }} />
            </div>

            <div className="uemsPage">

                {/* <section className="p-2">
                    <h2 className="font-semibold text-2xl mb-2 leading-7 flex items-center gap-2 flex-wrap"><span className="p-1 border! border-(--border1)! rounded-full">{DescriptionSVG}</span>UEMS Reading Lists are currently unavailable.</h2>
                    <p>Due to a last-minute change, we are still waiting for the updated links. They should be available soon (We hope ✌️).</p>
                </section> */}

                <section className="topNav">
                    {readingLists.map((list) => (
                        <a key={list.id} href={`#${list.id}`}>{t(list.navLabel)}</a>
                    ))}
                </section>

                <div className="uemsListsGrid">
                    {readingLists.map((list) => (
                        <section key={list.id} id={list.id} className="uemsListSection">
                            <div className="uemsListHeader">
                                <h3>{t(list.title)}</h3>
                                {/* <a className="pdfLink" href={list.pdfHref} target="_blank" rel="noreferrer">
                                    Open PDF with full links
                                </a> */}
                            </div>

                            <div className="uemsLinks">
                                {list.links.map((link, index) => (
                                    <a key={`${list.id}-${link.href}`} href={link.href} target="_blank" rel="noreferrer">
                                        <span>{index + 1}.</span>
                                        <div>
                                            <p>{link.label}</p>
                                            <small>{t(getReadingLinkType(link.label))}</small>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </main>
    </>;
}

export default UemsReadingList;
