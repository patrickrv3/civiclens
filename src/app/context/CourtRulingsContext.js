'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useProfile } from './ProfileContext';

const CourtRulingsContext = createContext({
    rulings: [],
    isLoading: true,
    error: '',
    refetch: () => {},
});

export function CourtRulingsProvider({ children }) {
    const { profile } = useProfile();
    const [rulings, setRulings] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchRulings = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await fetch('/api/court-rulings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lifeTags: profile.lifeTags || [],
                    interests: profile.interests || [],
                }),
            });
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setRulings(data.items || []);
        } catch (err) {
            console.error('Court rulings prefetch error:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [profile.lifeTags, profile.interests]);

    // Fetch on app startup (runs once profile is available)
    useEffect(() => {
        fetchRulings();
    }, [fetchRulings]);

    return (
        <CourtRulingsContext.Provider value={{ rulings, isLoading, error, refetch: fetchRulings }}>
            {children}
        </CourtRulingsContext.Provider>
    );
}

export function useCourtRulings() {
    return useContext(CourtRulingsContext);
}
