import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import React, { createContext, useContext, useEffect, useState } from 'react';

type UserContextType = {
    phoneNumber: string | null;
    userId: string | null;
    name: string | null;
    profileImage: string | null;
    login: (phone: string, hashId: string, name: string) => Promise<void>;
    updateProfile: (name: string, image?: string) => Promise<void>;
    logout: () => Promise<void>;
    isLoading: boolean;
};

const AuthContext = createContext<UserContextType>({
    phoneNumber: null,
    userId: null,
    name: null,
    profileImage: null,
    login: async () => { },
    updateProfile: async () => { },
    logout: async () => { },
    isLoading: true,
});

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [name, setName] = useState<string | null>(null);
    const [profileImage, setProfileImage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const segments = useSegments();
    const router = useRouter();

    useEffect(() => {
        // Load auth state from async storage
        const loadData = async () => {
            try {
                const phone = await AsyncStorage.getItem('@user_phone');
                const uid = await AsyncStorage.getItem('@user_id');
                const username = await AsyncStorage.getItem('@user_name');
                const image = await AsyncStorage.getItem('@user_image');

                if (phone && uid && username) {
                    setPhoneNumber(phone);
                    setUserId(uid);
                    setName(username);
                    setProfileImage(image);
                }
            } catch (e) {
                console.error("Failed to load user state", e);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, []);

    useEffect(() => {
        if (isLoading) return;

        const inAuthGroup = segments[0] === '(auth)';
        const isLoggedIn = !!userId;

        // Give the navigation tree a tick to reconcile before attempting redirects
        setTimeout(() => {
            if (!isLoggedIn && !inAuthGroup) {
                // Not logged in, and not currently in the auth flow -> forcefully route to onboarding
                router.replace('/(auth)/onboarding');
            } else if (isLoggedIn && inAuthGroup) {
                // Logged in, but trapped in auth flow -> forcefully push to tabs
                router.replace('/(tabs)/nexus');
            }
        }, 100);

    }, [userId, segments, isLoading]);

    const updateProfile = async (username: string, image?: string) => {
        await AsyncStorage.setItem('@user_name', username);
        setName(username);
        if (image !== undefined) {
            if (image) await AsyncStorage.setItem('@user_image', image);
            else await AsyncStorage.removeItem('@user_image');
            setProfileImage(image);
        }
    };

    const login = async (phone: string, hashId: string, username: string) => {
        await AsyncStorage.setItem('@user_phone', phone);
        await AsyncStorage.setItem('@user_id', hashId);
        await AsyncStorage.setItem('@user_name', username);
        setPhoneNumber(phone);
        setUserId(hashId);
        setName(username);
    };

    const logout = async () => {
        await AsyncStorage.removeItem('@user_phone');
        await AsyncStorage.removeItem('@user_id');
        await AsyncStorage.removeItem('@user_name');
        setPhoneNumber(null);
        setUserId(null);
        setName(null);
    };

    return (
        <AuthContext.Provider value={{
            phoneNumber,
            userId,
            name,
            profileImage,
            login,
            updateProfile,
            logout,
            isLoading
        }}>
            {children}
        </AuthContext.Provider>
    );
}
