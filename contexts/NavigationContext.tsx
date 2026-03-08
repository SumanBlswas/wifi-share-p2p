import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type TabAnimation = 'slide' | 'stack';

type NavigationContextType = {
    activeTab: number;
    setActiveTab: (index: number) => void;
    tabAnimation: TabAnimation;
    setTabAnimation: (anim: TabAnimation) => void;
};

const NavigationContext = createContext<NavigationContextType>({
    activeTab: 0,
    setActiveTab: () => { },
    tabAnimation: 'slide',
    setTabAnimation: () => { },
});

export const useNavigationContext = () => useContext(NavigationContext);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
    const [activeTab, setActiveTab] = useState(0);
    const [tabAnimation, setTabAnimationState] = useState<TabAnimation>('slide');

    useEffect(() => {
        AsyncStorage.getItem('@tab_animation').then((val) => {
            if (val === 'slide' || val === 'stack') {
                setTabAnimationState(val);
            }
        });
    }, []);

    const setTabAnimation = (anim: TabAnimation) => {
        setTabAnimationState(anim);
        AsyncStorage.setItem('@tab_animation', anim);
    };

    return (
        <NavigationContext.Provider value={{ activeTab, setActiveTab, tabAnimation, setTabAnimation }}>
            {children}
        </NavigationContext.Provider>
    );
}
