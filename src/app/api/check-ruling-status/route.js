import { NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

/**
 * Check if a watched court ruling has been updated.
 * Looks up the ruling's cached summary in Firestore and compares
 * the stored status with the user's watched status.
 * If the cached version has a different status, flag it as changed.
 */
export async function POST(request) {
    try {
        const { rulings } = await request.json();
        if (!rulings || rulings.length === 0) {
            return NextResponse.json({ results: [] });
        }

        const results = await Promise.allSettled(
            rulings.map(async (ruling) => {
                try {
                    // Check the cached summary in billSummaries collection
                    const ref = doc(db, 'billSummaries', ruling.id);
                    const snap = await getDoc(ref);

                    if (!snap.exists()) {
                        // No cached data — check CourtListener directly
                        const clusterId = ruling.id.replace('court-', '');
                        const clStatus = await checkCourtListener(clusterId);

                        if (clStatus && clStatus !== ruling.status) {
                            return {
                                id: ruling.id,
                                title: ruling.title,
                                oldStatus: ruling.status,
                                currentStatus: clStatus,
                                changed: true,
                            };
                        }

                        return {
                            id: ruling.id,
                            title: ruling.title,
                            oldStatus: ruling.status,
                            currentStatus: ruling.status,
                            changed: false,
                        };
                    }

                    const cached = snap.data();
                    const cachedStatus = cached.status || '';

                    // Compare statuses
                    if (cachedStatus && cachedStatus !== ruling.status) {
                        return {
                            id: ruling.id,
                            title: ruling.title || cached.shortTitle || '',
                            oldStatus: ruling.status,
                            currentStatus: cachedStatus,
                            changed: true,
                        };
                    }

                    return {
                        id: ruling.id,
                        title: ruling.title,
                        oldStatus: ruling.status,
                        currentStatus: ruling.status,
                        changed: false,
                    };
                } catch {
                    return {
                        id: ruling.id,
                        title: ruling.title,
                        oldStatus: ruling.status,
                        currentStatus: ruling.status,
                        changed: false,
                    };
                }
            })
        );

        return NextResponse.json({
            results: results
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value),
        });

    } catch (error) {
        console.error('check-ruling-status error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * Directly check CourtListener for a ruling's current status.
 * Uses the cluster_id to look up the opinion.
 */
async function checkCourtListener(clusterId) {
    const token = process.env.COURTLISTENER_API_TOKEN;
    if (!token || !clusterId) return null;

    try {
        const url = `https://www.courtlistener.com/api/rest/v4/search/?type=o&q=cluster_id:${clusterId}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(url, {
            headers: { Authorization: `Token ${token}` },
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) return null;
        const data = await res.json();
        const opinion = data.results?.[0];
        if (!opinion) return null;

        // Determine status from opinion data
        const snippet = (opinion.snippet || '').toLowerCase();
        if (snippet.includes('affirmed')) return 'Affirmed';
        if (snippet.includes('reversed')) return 'Reversed';
        if (snippet.includes('remanded')) return 'Remanded';
        if (snippet.includes('vacated')) return 'Vacated';
        if (snippet.includes('injunction')) return 'Injunction Granted';
        if (snippet.includes('dismissed')) return 'Dismissed';
        if (snippet.includes('denied')) return 'Denied';
        if (snippet.includes('granted')) return 'Granted';

        return null; // Can't determine
    } catch {
        return null;
    }
}
