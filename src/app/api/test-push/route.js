import { NextResponse } from 'next/server';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';

export async function POST(request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { uid } = await request.json();

        const cred = {
            projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
            clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        };

        // Get token from Firestore
        const app = initializeApp({ credential: cert(cred) }, 'raw-test-' + Date.now());
        const db = getFirestore(app);
        const devicesSnap = await db.collection('users').doc(uid).collection('devices').get();
        const token = devicesSnap.docs.find(d => d.data().enabled && d.data().token)?.data()?.token;

        if (!token) return NextResponse.json({ error: 'No token found' });

        // Get OAuth2 access token manually
        const auth = new GoogleAuth({
            credentials: {
                client_email: cred.clientEmail,
                private_key: cred.privateKey,
            },
            scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });
        const accessToken = await auth.getAccessToken();

        // Make raw FCM v1 API call
        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${cred.projectId}/messages:send`;
        
        const body = {
            message: {
                token: token,
                notification: {
                    title: 'Test from Civisly',
                    body: 'Push notifications are working!',
                },
            },
        };

        // Test 1: dry run
        const dryRes = await fetch(fcmUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...body, validate_only: true }),
        });
        const dryData = await dryRes.text();

        // Test 2: real send
        const realRes = await fetch(fcmUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const realData = await realRes.text();

        return NextResponse.json({
            tokenPrefix: token.substring(0, 30),
            projectId: cred.projectId,
            hasAccessToken: !!accessToken,
            accessTokenPrefix: accessToken?.substring(0, 20),
            dryRun: { status: dryRes.status, body: dryData.substring(0, 500) },
            realSend: { status: realRes.status, body: realData.substring(0, 500) },
        });
    } catch (err) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 500 });
    }
}
