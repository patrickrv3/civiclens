import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK (bypasses Firestore security rules — server only)
function getAdminDb() {
    if (getApps().length === 0) {
        initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
                clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                // Vercel stores multiline values with \n — replace to get real newlines
                privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        });
    }
    return getFirestore();
}

export async function POST(request) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    let event;
    try {
        event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    try {
        const db = getAdminDb();

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const uid = session.metadata?.uid;
            const customerId = session.customer;
            const subscriptionId = session.subscription;

            if (uid) {
                await db.doc(`users/${uid}/subscription/pro`).set({
                    status: 'active',
                    plan: 'pro',
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    activatedAt: Date.now(),
                });
                console.log(`Activated Pro for uid: ${uid}`);
            }
        }

        if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            const newStatus = subscription.status; // 'active', 'canceled', 'past_due'

            // Find user subscription doc by stripeCustomerId using collectionGroup query
            const snap = await db.collectionGroup('subscription')
                .where('stripeCustomerId', '==', customerId)
                .get();

            for (const docSnap of snap.docs) {
                await docSnap.ref.set({
                    ...docSnap.data(),
                    status: newStatus === 'active' ? 'active' : 'canceled',
                    updatedAt: Date.now(),
                }, { merge: true });
                console.log(`Updated subscription to ${newStatus} for customer: ${customerId}`);
            }
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error('Webhook handler error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
