import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

// 'Slide' will use the standard horizontal transition
// 'Stack' will use an iOS-style stack transition (where the new screen slides over)
export type PageAnimation = 'Slide' | 'Stack';

type UIContextType = {
    pageAnimation: PageAnimation;
    setPageAnimation: (type: PageAnimation) => Promise<void>;
    isLoading: boolean;
};

const UIContext = createContext<UIContextType>({
    pageAnimation: 'Slide',
    setPageAnimation: async () => { },
    isLoading: true,
});

export function useUI() {
    return useContext(UIContext);
}

export function UIProvider({ children }: { children: React.ReactNode }) {
    const [pageAnimation, setPageAnimationState] = useState<PageAnimation>('Slide');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const saved = await AsyncStorage.getItem('@ui_page_animation');
                if (saved) {
                    setPageAnimationState(saved as PageAnimation);
                }
            } catch (e) {
                console.error('Failed to load UI settings', e);
            } finally {
                setIsLoading(false);
            }
        };
        loadSettings();
    }, []);

    const setPageAnimation = async (type: PageAnimation) => {
        setPageAnimationState(type);
        await AsyncStorage.setItem('@ui_page_animation', type);
    };

    return (
        <UIContext.Provider value={{ pageAnimation, setPageAnimation, isLoading }}>
            {children}
        </UIContext.Provider>
    );
}
