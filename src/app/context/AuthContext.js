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
    deleteUser,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

const AuthContext = createContext(null);

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [redirectError, setRedirectError] = useState(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);
        });

        // Handle result when user returns from Google redirect
        getRedirectResult(auth)
            .then((result) => {
                if (result?.user) {
                    console.log('Redirect sign-in succeeded:', result.user.email);
                }
            })
            .catch((err) => {
                console.error('getRedirectResult error — code:', err.code, 'message:', err.message);
                setRedirectError(err.code || err.message);
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
        return signInWithPopup(auth, provider);
    };

    const logOut = async () => {
        return firebaseSignOut(auth);
    };

    const deleteAccount = async () => {
        if (!user) throw new Error('Not signed in');

        // 1. Delete all user data from Firestore via server endpoint
        const res = await fetch('/api/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: user.uid }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to delete account data');
        }

        // 2. Delete the Firebase Auth account
        await deleteUser(user);

        // 3. Clear local storage
        localStorage.clear();
    };

    return (
        <AuthContext.Provider value={{ user, loading, redirectError, signUp, signIn, signInWithGoogle, logOut, deleteAccount }}>
            {children}
        </AuthContext.Provider>
    );
}
