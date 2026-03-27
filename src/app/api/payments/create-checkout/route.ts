import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { stripe, STRIPE_FEE_MULTIPLIER } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Support both single and multiple payment IDs
    const paymentIds: string[] = body.payment_ids || (body.payment_id ? [body.payment_id] : []);
    if (paymentIds.length === 0) {
      return NextResponse.json({ error: "payment_id or payment_ids required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: payments, error } = await supabase
      .from("payments")
      .select("*, player:players(name, email), session:sessions(date, venue)")
      .in("id", paymentIds);

    if (error || !payments || payments.length === 0) {
      return NextResponse.json({ error: "Payments not found" }, { status: 404 });
    }

    // Filter out already paid
    const unpaid = payments.filter((p) => p.payment_status !== "paid");
    if (unpaid.length === 0) {
      return NextResponse.json({ error: "All selected payments are already paid" }, { status: 400 });
    }

    const firstSession = unpaid[0].session as unknown as { date: string; venue: string };
    const sessionDate = new Date(firstSession.date).toLocaleDateString("en-AU", {
      weekday: "short", day: "numeric", month: "short",
    });

    // Build line items — one per player
    const lineItems = unpaid.map((payment) => {
      const playerName = (payment.player as unknown as { name: string })?.name || "Player";
      const amountWithFee = Math.round(payment.amount_due * STRIPE_FEE_MULTIPLIER * 100);
      return {
        price_data: {
          currency: "aud",
          unit_amount: amountWithFee,
          product_data: {
            name: `Soccer — ${playerName}`,
            description: `${sessionDate} · ${firstSession.venue} · Includes 3.5% card fee`,
          },
        },
        quantity: 1,
      };
    });

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      metadata: {
        payment_ids: unpaid.map((p) => p.id).join(","),
        session_id: unpaid[0].session_id,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/sessions/${unpaid[0].session_id}?payment=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/sessions/${unpaid[0].session_id}?payment=cancelled`,
    });

    // Store checkout session ID on all payments
    for (const payment of unpaid) {
      await supabase
        .from("payments")
        .update({ stripe_checkout_session_id: checkout.id })
        .eq("id", payment.id);
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Checkout creation failed";
    console.error("Stripe checkout error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
