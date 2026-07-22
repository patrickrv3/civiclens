import { NextResponse } from 'next/server';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// Use a dedicated named app to avoid conflicts with stale singletons
let fcmApp = null;
function getAdmin() {
    if (!fcmApp) {
        fcmApp = initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
                clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        }, 'fcm-push-' + Date.now());
    }
    return { db: getFirestore(fcmApp), messaging: getMessaging(fcmApp) };
}

export async function POST(request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { uid } = await request.json();
        if (!uid) {
            return NextResponse.json({ error: 'uid required' }, { status: 400 });
        }

        const { db, messaging } = getAdmin();

        const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();

        if (devicesSnap.empty) {
            return NextResponse.json({ error: 'No devices found' });
        }

        const tokens = devicesSnap.docs
            .filter(d => d.data().enabled && d.data().token)
            .map(d => d.data().token);

        if (tokens.length === 0) {
            return NextResponse.json({ error: 'No enabled tokens' });
        }

        const message = {
            notification: {
                title: '🔔 Test from Civisly',
                body: 'Push notifications are working! You\'ll receive alerts for bill updates and executive orders.',
            },
            data: { type: 'test' },
            tokens,
            apns: {
                payload: { aps: { sound: 'default', badge: 1 } },
            },
        };

        const response = await messaging.sendEachForMulticast(message);

        const details = response.responses.map((resp, i) => ({
            success: resp.success,
            messageId: resp.messageId || null,
            error: resp.error ? { code: resp.error.code, message: resp.error.message } : null,
        }));

        return NextResponse.json({
            success: response.successCount > 0,
            successCount: response.successCount,
            failureCount: response.failureCount,
            details,
        });
    } catch (err) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 500 });
    }
}
