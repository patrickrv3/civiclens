import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(request) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    try {
        const { customerId } = await request.json();

        if (!customerId) {
            return NextResponse.json({ error: 'Missing customerId' }, { status: 400 });
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: 'https://civisly.com/',
        });

        return NextResponse.json({ url: session.url });
    } catch (error) {
        console.error('Stripe portal error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
