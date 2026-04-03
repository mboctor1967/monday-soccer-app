import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const { session_id } = await request.json();
    if (!session_id) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Find payments with this checkout session ID
    const { data: payments, error } = await supabase
      .from("payments")
      .select("id, payment_status, amount_due, stripe_checkout_session_id")
      .eq("stripe_checkout_session_id", session_id);

    if (error || !payments || payments.length === 0) {
      return NextResponse.json({ error: "No payments found for this checkout" }, { status: 404 });
    }

    // Skip if already paid
    const unpaid = payments.filter((p) => p.payment_status !== "paid");
    if (unpaid.length === 0) {
      return NextResponse.json({ status: "already_paid" });
    }

    // Verify with Stripe that the checkout session is actually paid
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
    if (checkoutSession.payment_status !== "paid") {
      return NextResponse.json({ status: "not_paid", stripe_status: checkoutSession.payment_status });
    }

    // Mark all payments as paid
    for (const payment of unpaid) {
      await supabase
        .from("payments")
        .update({
          payment_status: "paid",
          amount_paid: payment.amount_due,
          payment_method: "stripe",
          stripe_payment_intent_id: checkoutSession.payment_intent as string,
          pending_confirmation: false,
        })
        .eq("id", payment.id);
    }

    return NextResponse.json({ status: "paid", count: unpaid.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Verification failed";
    console.error("Payment verification error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
