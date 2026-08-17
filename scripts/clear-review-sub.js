// Quick one-off script to clear subscription for the Apple review account
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = {
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'civiclens-8b866',
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const auth = getAuth(app);

async function clearSubscription() {
    const email = 'applereviews@gmail.com';

    // Find user by email
    const userRecord = await auth.getUserByEmail(email);
    console.log(`Found user: ${userRecord.uid} (${userRecord.email})`);

    // Delete subscription document
    const subRef = db.collection('users').doc(userRecord.uid).collection('subscription').doc('pro');
    const snap = await subRef.get();

    if (snap.exists) {
        console.log('Current subscription data:', JSON.stringify(snap.data(), null, 2));
        await subRef.delete();
        console.log('✅ Subscription deleted for', email);
    } else {
        console.log('No subscription document found — user is already non-Pro');
    }
}

clearSubscription().catch(console.error);
