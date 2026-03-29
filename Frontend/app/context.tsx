import { createContext, useState } from "react";
import { useLocation } from "react-router";

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
    const currentTab = useLocation();
  
    const [currentNav, setCurrentNav] = useState(currentTab.pathname === "/" ? 0 : currentTab.pathname === "/library" ? 1 : currentTab.pathname === "/events" ? 2 : -1);

    return (
        <CurrentNavContext.Provider value={{currentNav, setCurrentNav}}>
            {children}
        </CurrentNavContext.Provider>
    )
}