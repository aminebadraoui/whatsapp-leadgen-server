const express = require('express');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');
const { generateToken, sendMagicLink } = require('../utils/auth');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const prisma = new PrismaClient();

router.post('/create-checkout-session', async (req, res) => {
    const { priceId } = req.body;
    console.log('Creating checkout session for price:', priceId);

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/pricing`,
        });

        console.log('Created session:', session.id);
        res.json({ id: session.id });
    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/webhook', async (req, res) => {
    const event = req.body;
    const sig = req.headers['stripe-signature'];

    try {
        const verifiedEvent = stripe.webhooks.constructEvent(
            req.rawBody,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );

        switch (verifiedEvent.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(verifiedEvent.data.object);
                break;
            case 'checkout.session.expired':
                await handleCheckoutSessionExpired(verifiedEvent.data.object);
                break;
            case 'checkout.session.async_payment_succeeded':
                await handleCheckoutSessionAsyncPaymentSucceeded(verifiedEvent.data.object);
                break;
            case 'checkout.session.async_payment_failed':
                await handleCheckoutSessionAsyncPaymentFailed(verifiedEvent.data.object);
                break;
            default:
                console.log(`Unhandled event type ${verifiedEvent.type}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

async function handleCheckoutSessionCompleted(session) {
    try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0].price.id;
        const product = await stripe.products.retrieve(lineItems.data[0].price.product);

        const email = session.customer_details.email;
        let user = await prisma.user.findUnique({ where: { email } });

        if (user) {
            // User exists, update their purchases
            user = await prisma.user.update({
                where: { email },
                data: {
                    purchases: {
                        push: product.id
                    }
                }
            });
        } else {
            // User doesn't exist, create a new user
            user = await prisma.user.create({
                data: {
                    email: email,
                    purchases: [product.id]
                }
            });
        }

        const token = generateToken(user.id);
        await sendMagicLink(user.email, token);

        console.log(`User updated/created: ${user.email}`);
    } catch (error) {
        console.error('Error handling checkout.session.completed:', error);
    }
}

async function handleCheckoutSessionExpired(session) {
    try {
        console.log(`Checkout session expired for session ID: ${session.id}`);
        // You can add additional logic here, such as cleaning up any pending orders or notifying the user
    } catch (error) {
        console.error('Error handling checkout.session.expired:', error);
    }
}

async function handleCheckoutSessionAsyncPaymentSucceeded(session) {
    try {
        console.log(`Async payment succeeded for session ID: ${session.id}`);
        // This event is similar to checkout.session.completed for async payments
        // You may want to handle it similarly or add specific logic for async payments
        await handleCheckoutSessionCompleted(session);
    } catch (error) {
        console.error('Error handling checkout.session.async_payment_succeeded:', error);
    }
}

async function handleCheckoutSessionAsyncPaymentFailed(session) {
    try {
        console.log(`Async payment failed for session ID: ${session.id}`);
        // You can add logic here to handle failed async payments, such as notifying the user or updating your database
    } catch (error) {
        console.error('Error handling checkout.session.async_payment_failed:', error);
    }
}

module.exports = router;