import { createContext, useState } from "react";
import { usePathname } from "next/navigation";

type NavContextType = {
  currentNav: number;
  setCurrentNav: React.Dispatch<React.SetStateAction<number>>;
};

const defaultValue: NavContextType = {
  currentNav: 0,
  setCurrentNav: () => {
    throw new Error("setCurrentNav called outside NavProvider");
  },
};

export const CurrentNavContext = createContext<NavContextType>(defaultValue);

export const CurrentNavProvider = ({children}: {children: React.ReactNode}) => {
    const pathname = usePathname();
  
    const [currentNav, setCurrentNav] = useState(pathname === "/" ? 0 : pathname === "/library" ? 1 : pathname === "/events" ? 2 : -1);

    return (
        <CurrentNavContext.Provider value={{currentNav, setCurrentNav}}>
            {children}
        </CurrentNavContext.Provider>
    )
}