'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import {
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

const AuthContext = createContext(null);

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);
        });

        // Handle redirect result after Google sign-in redirect
        getRedirectResult(auth).catch((err) => {
            console.warn('Redirect result error:', err);
        });

        return () => unsubscribe();
    }, []);

    const signUp = async (email, password) => {
        return createUserWithEmailAndPassword(auth, email, password);
    };

    const signIn = async (email, password) => {
        return signInWithEmailAndPassword(auth, email, password);
    };

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
        // Use redirect (more reliable on custom domains + mobile) instead of popup
        return signInWithRedirect(auth, provider);
    };

    const logOut = async () => {
        return firebaseSignOut(auth);
    };

    return (
        <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithGoogle, logOut }}>
            {children}
        </AuthContext.Provider>
    );
}
