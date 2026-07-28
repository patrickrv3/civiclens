import { NextResponse } from 'next/server';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

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

        const app = initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
                clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        }, 'test-push-' + Date.now());

        const db = getFirestore(app);
        const messaging = getMessaging(app);

        const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();
        const tokens = devicesSnap.docs
            .filter(d => d.data().enabled && d.data().token)
            .map(d => d.data().token);

        if (tokens.length === 0) {
            return NextResponse.json({ error: 'No enabled tokens' });
        }

        const response = await messaging.sendEachForMulticast({
            notification: {
                title: '🔔 Test from Civisly',
                body: 'Push notifications are working!',
            },
            data: { type: 'test' },
            tokens,
            apns: { payload: { aps: { sound: 'default', badge: 1 } } },
        });

        return NextResponse.json({
            success: response.successCount > 0,
            sent: response.successCount,
            failed: response.failureCount,
            details: response.responses.map((resp) => ({
                success: resp.success,
                messageId: resp.messageId || null,
                error: resp.error ? { code: resp.error.code, message: resp.error.message } : null,
            })),
        });
    } catch (err) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 500 });
    }
}
