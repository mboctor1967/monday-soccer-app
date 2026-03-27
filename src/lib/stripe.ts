import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const STRIPE_FEE_MULTIPLIER = 1.035; // 3.5% surcharge
