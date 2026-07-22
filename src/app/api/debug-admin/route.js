import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export async function GET(request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Initialize fresh
        const appName = 'debug-test-' + Date.now();
        const app = initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
                clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        }, appName);

        const messaging = getMessaging(app);

        // Try a dry-run send to validate credentials
        const result = await messaging.send({
            token: 'fake-token-for-validation',
            notification: { title: 'test', body: 'test' },
        }, true); // true = dry run

        return NextResponse.json({ success: true, result });
    } catch (err) {
        return NextResponse.json({
            error: err.message,
            code: err.code,
            errorInfo: err.errorInfo || null,
        });
    }
}
