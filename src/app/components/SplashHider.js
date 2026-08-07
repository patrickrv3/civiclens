'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export default function SplashHider() {
    useEffect(() => {
        async function hideSplash() {
            if (Capacitor.isNativePlatform()) {
                try {
                    const { SplashScreen } = await import('@capacitor/splash-screen');
                    // Small delay to ensure the page is visually ready
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await SplashScreen.hide({ fadeOutDuration: 300 });
                    console.log('[Splash] Hidden after page load');
                } catch (e) {
                    console.warn('[Splash] Failed to hide:', e.message);
                }
            }
        }
        hideSplash();
    }, []);

    return null; // This component renders nothing
}
