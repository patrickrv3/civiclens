import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';

export async function POST(request) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const uid = session.metadata?.uid;
            const customerId = session.customer;
            const subscriptionId = session.subscription;

            if (uid) {
                await setDoc(doc(db, 'users', uid, 'subscription', 'pro'), {
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
            const status = subscription.status; // 'active', 'canceled', 'past_due'

            // Find user by stripeCustomerId
            const usersRef = collection(db, 'users');
            // We need to search subcollections — search by stripeCustomerId stored in subscription doc
            // Use a collectionGroup query
            const subQuery = query(
                collection(db, 'users'),
                where('stripeCustomerId', '==', customerId)
            );
            // Since subscription is a subcollection, query the subscriptions collectionGroup
            const { collectionGroup } = await import('firebase/firestore');
            const cgQuery = query(collectionGroup(db, 'subscription'), where('stripeCustomerId', '==', customerId));
            const snap = await getDocs(cgQuery);

            for (const docSnap of snap.docs) {
                await setDoc(docSnap.ref, {
                    ...docSnap.data(),
                    status: status === 'active' ? 'active' : 'canceled',
                    canceledAt: status !== 'active' ? Date.now() : null,
                }, { merge: true });
                console.log(`Updated subscription status to ${status} for customer: ${customerId}`);
            }
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error('Webhook handler error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
