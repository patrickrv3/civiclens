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

        const pk = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
        const cred = {
            projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
            clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: pk?.replace(/\\n/g, '\n'),
        };

        // Step 1: Create fresh app
        const appName = 'test-push-' + Date.now();
        const app = initializeApp({ credential: cert(cred) }, appName);
        const db = getFirestore(app);
        const messaging = getMessaging(app);

        // Step 2: Dry-run test (same as working debug endpoint)
        let dryRunResult = null;
        try {
            await messaging.send({
                token: 'fake-dry-run-token',
                notification: { title: 'test', body: 'test' },
            }, true);
            dryRunResult = 'success (unexpected)';
        } catch (e) {
            dryRunResult = `${e.code}: ${e.message}`;
        }

        // Step 3: Get real tokens from Firestore
        const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();
        const tokens = devicesSnap.docs
            .filter(d => d.data().enabled && d.data().token)
            .map(d => d.data().token);

        if (tokens.length === 0) {
            return NextResponse.json({
                error: 'No enabled tokens',
                dryRunResult,
                devices: devicesSnap.docs.map(d => ({
                    id: d.id,
                    enabled: d.data().enabled,
                    hasToken: !!d.data().token,
                    tokenPrefix: d.data().token?.substring(0, 20) || 'none',
                })),
            });
        }

        // Step 4: Send real notification
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
            dryRunResult,
            tokenCount: tokens.length,
            tokenPrefixes: tokens.map(t => t.substring(0, 20)),
            details: response.responses.map((resp) => ({
                success: resp.success,
                messageId: resp.messageId || null,
                error: resp.error ? { code: resp.error.code, message: resp.error.message } : null,
            })),
        });
    } catch (err) {
        return NextResponse.json({
            error: err.message,
            code: err.code,
            stack: err.stack?.split('\n').slice(0, 3),
        }, { status: 500 });
    }
}
