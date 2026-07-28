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

        // Get tokens
        const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();
        const tokens = devicesSnap.docs
            .filter(d => d.data().enabled && d.data().token)
            .map(d => d.data().token);

        if (tokens.length === 0) {
            return NextResponse.json({ error: 'No enabled tokens' });
        }

        const results = [];

        // Test 1: Dry run with fake token
        try {
            await messaging.send({ token: 'fake', notification: { title: 't', body: 't' } }, true);
            results.push({ test: 'dry-run-fake', result: 'success' });
        } catch (e) {
            results.push({ test: 'dry-run-fake', code: e.code, msg: e.message?.substring(0, 100) });
        }

        // Test 2: Dry run with REAL token
        try {
            await messaging.send({
                token: tokens[0],
                notification: { title: 'test', body: 'test' },
            }, true); // dry run
            results.push({ test: 'dry-run-real-token', result: 'success' });
        } catch (e) {
            results.push({ test: 'dry-run-real-token', code: e.code, msg: e.message?.substring(0, 100) });
        }

        // Test 3: Real send with messaging.send (NOT sendEachForMulticast)
        try {
            const msgId = await messaging.send({
                token: tokens[0],
                notification: {
                    title: '🔔 Test from Civisly',
                    body: 'Push notifications are working!',
                },
                apns: { payload: { aps: { sound: 'default', badge: 1 } } },
            });
            results.push({ test: 'real-send-single', result: 'success', messageId: msgId });
        } catch (e) {
            results.push({ test: 'real-send-single', code: e.code, msg: e.message?.substring(0, 100) });
        }

        return NextResponse.json({
            tokenPrefix: tokens[0]?.substring(0, 30),
            tokenLength: tokens[0]?.length,
            projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
            results,
        });
    } catch (err) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 500 });
    }
}
