'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';

const ProfileContext = createContext(null);

const DEFAULT_PROFILE = {
    hasCompletedOnboarding: false,
    location: { zipCode: '' },
    lifeTags: [],
    interests: [],
    wantsPersonalizedImpact: false,
};

export function ProfileProvider({ children }) {
    const { user } = useAuth();
    const [profile, setProfile] = useState(DEFAULT_PROFILE);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load profile — from Firestore if signed in, localStorage otherwise
    useEffect(() => {
        let cancelled = false;

        const loadProfile = async () => {
            // Always start with localStorage
            let localProfile = DEFAULT_PROFILE;
            const saved = localStorage.getItem('civiclens_profile');
            if (saved) {
                try { localProfile = JSON.parse(saved); } catch (e) { }
            }

            if (user) {
                // User is signed in — try Firestore
                try {
                    const docRef = doc(db, 'users', user.uid);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        // Firestore has data — use it
                        const cloudProfile = docSnap.data();
                        if (!cancelled) {
                            setProfile(cloudProfile);
                            // Also update localStorage as a cache
                            localStorage.setItem('civiclens_profile', JSON.stringify(cloudProfile));
                        }
                    } else {
                        // First sign-in — push local data UP to Firestore
                        if (localProfile.hasCompletedOnboarding) {
                            await setDoc(docRef, localProfile);
                        }
                        if (!cancelled) setProfile(localProfile);
                    }
                } catch (err) {
                    console.error('Firestore load error:', err);
                    if (!cancelled) setProfile(localProfile);
                }
            } else {
                // Not signed in — use localStorage
                if (!cancelled) setProfile(localProfile);
            }

            if (!cancelled) setIsLoaded(true);
        };

        setIsLoaded(false);
        loadProfile();

        return () => { cancelled = true; };
    }, [user]);

    // Save profile — to both localStorage and Firestore (if signed in)
    const saveProfile = useCallback(async (newProfile) => {
        // Always save to localStorage
        localStorage.setItem('civiclens_profile', JSON.stringify(newProfile));

        // If signed in, also save to Firestore
        if (user) {
            try {
                const docRef = doc(db, 'users', user.uid);
                await setDoc(docRef, newProfile);
            } catch (err) {
                console.error('Firestore save error:', err);
            }
        }
    }, [user]);

    const updateProfile = useCallback((updates) => {
        setProfile((prev) => {
            const updated = { ...prev, ...updates };
            saveProfile(updated);
            return updated;
        });
    }, [saveProfile]);

    const getPrimaryLocation = () => {
        if (profile.location?.zipCode) {
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
