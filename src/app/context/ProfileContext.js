'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
    const [profile, setProfile] = useState({
        hasCompletedOnboarding: false,
        location: { zipCode: '' },
        lifeTags: [],
        interests: [],
        wantsPersonalizedImpact: false, // User choice to see "Why it matters to you"
    });

    const [isLoaded, setIsLoaded] = useState(false);

    // Load from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('civiclens_profile');
        if (saved) {
            try {
                setProfile(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to parse profile from localStorage', e);
            }
        }
        setIsLoaded(true);
    }, []);

    // Save to localStorage whenever profile changes
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('civiclens_profile', JSON.stringify(profile));
        }
    }, [profile, isLoaded]);

    const updateProfile = (updates) => {
        setProfile((prev) => ({ ...prev, ...updates }));
    };

    const getPrimaryLocation = () => {
        if (profile.location.zipCode) {
            return `Zip: ${profile.location.zipCode}`;
        }
        return null;
    };

    return (
        <ProfileContext.Provider value={{ profile, updateProfile, isLoaded, getPrimaryLocation }}>
            {children}
        </ProfileContext.Provider>
    );
}

export function useProfile() {
    const context = useContext(ProfileContext);
    if (!context) {
        throw new Error('useProfile must be used within a ProfileProvider');
    }
    return context;
}
