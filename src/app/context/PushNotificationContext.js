'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';

// Register the plugin via Capacitor's native bridge — works with remote URL loading
let PushPlugin = null;
function getPushPlugin() {
    if (!PushPlugin && typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
        try {
            PushPlugin = registerPlugin('PushNotifications');
        } catch (e) {
            console.log('[Push] Plugin not available:', e.message);
            return null;
        }
    }
    return PushPlugin;
}

const PushNotificationContext = createContext({});

export function usePushNotifications() {
    return useContext(PushNotificationContext);
}

// Simple hash for device token (used as Firestore doc ID)
function hashToken(token) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
        const chr = token.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

export function PushNotificationProvider({ children }) {
    const { user } = useAuth();
    const [fcmToken, setFcmToken] = useState(null);
    const [permissionStatus, setPermissionStatus] = useState('unknown'); // 'granted' | 'denied' | 'prompt' | 'unknown'
    const [isNative, setIsNative] = useState(false);
    const listenerRegistered = useRef(false);

    // Check if we're on a native platform
    useEffect(() => {
        setIsNative(Capacitor.isNativePlatform());
    }, []);

    // Initialize push notification listeners (once)
    useEffect(() => {
        if (!isNative || listenerRegistered.current) return;

        function initPush() {
            const Push = getPushPlugin();
            if (!Push) return; // Plugin not available (old app build)

            listenerRegistered.current = true;

            // Listen for token registration
            Push.addListener('registration', (token) => {
                console.log('[Push] FCM token received:', token.value.substring(0, 20) + '...');
                setFcmToken(token.value);
                localStorage.setItem('fcmToken', token.value);
            });

            // Listen for registration errors
            Push.addListener('registrationError', (error) => {
                console.error('[Push] Registration error:', error);
            });

            // Listen for notifications received while app is in foreground
            Push.addListener('pushNotificationReceived', (notification) => {
                console.log('[Push] Notification received in foreground:', notification);
            });

            // Listen for notification taps
            Push.addListener('pushNotificationActionPerformed', (action) => {
                console.log('[Push] Notification tapped:', action);
            });

            // Check current permission status
            Push.checkPermissions().then(result => {
                setPermissionStatus(result.receive);
            }).catch(() => {});
        }

        initPush();

        // Try to restore token from localStorage
        const savedToken = localStorage.getItem('fcmToken');
        if (savedToken) {
            setFcmToken(savedToken);
        }
    }, [isNative]);

    // Save token to Firestore when user is logged in and token is available
    useEffect(() => {
        if (!user?.uid || !fcmToken) return;

        const tokenHash = hashToken(fcmToken);
        const deviceRef = doc(db, 'users', user.uid, 'devices', tokenHash);

        setDoc(deviceRef, {
            token: fcmToken,
            platform: 'ios',
            createdAt: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
            enabled: true,
        }, { merge: true }).then(() => {
            console.log('[Push] Token saved to Firestore');
        }).catch(err => {
            console.error('[Push] Failed to save token:', err);
        });
    }, [user?.uid, fcmToken]);

    // Request notification permission
    const requestPermission = useCallback(async () => {
        if (!isNative) {
            console.log('[Push] Not on native platform, skipping permission request');
            return false;
        }

        try {
            const Push = getPushPlugin();
            if (!Push) {
                console.log('[Push] Plugin not available');
                return false;
            }

            // Check current status first
            const currentStatus = await Push.checkPermissions();
            console.log('[Push] Current permission status:', currentStatus.receive);

            if (currentStatus.receive === 'granted') {
                setPermissionStatus('granted');
                await Push.register();
                return true;
            }

            if (currentStatus.receive === 'denied') {
                setPermissionStatus('denied');
                return false;
            }

            // Request permission (shows the iOS system prompt)
            const result = await Push.requestPermissions();
            console.log('[Push] Permission result:', result.receive);
            setPermissionStatus(result.receive);

            if (result.receive === 'granted') {
                await Push.register();
                localStorage.setItem('pushPermissionGranted', 'true');
                return true;
            }

            return false;
        } catch (error) {
            console.error('[Push] Permission request failed:', error);
            return false;
        }
    }, [isNative]);

    // Remove token from Firestore (for unregister)
    const unregisterDevice = useCallback(async () => {
        if (!user?.uid || !fcmToken) return;

        try {
            const tokenHash = hashToken(fcmToken);
            await deleteDoc(doc(db, 'users', user.uid, 'devices', tokenHash));
            localStorage.removeItem('fcmToken');
            localStorage.removeItem('pushPermissionGranted');
            setFcmToken(null);
            console.log('[Push] Device unregistered');
        } catch (error) {
            console.error('[Push] Unregister failed:', error);
        }
    }, [user?.uid, fcmToken]);

    const value = {
        fcmToken,
        permissionStatus,
        isNative,
        isPushEnabled: permissionStatus === 'granted' && !!fcmToken,
        requestPermission,
        unregisterDevice,
    };

    return (
        <PushNotificationContext.Provider value={value}>
            {children}
        </PushNotificationContext.Provider>
    );
}
