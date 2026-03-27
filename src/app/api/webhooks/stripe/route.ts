import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook verification failed";
    console.error("Stripe webhook signature error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    // Support both single payment_id and comma-separated payment_ids
    const paymentIdsStr = session.metadata?.payment_ids || session.metadata?.payment_id || "";
    const paymentIds = paymentIdsStr.split(",").filter(Boolean);

    if (paymentIds.length === 0) {
      console.error("Stripe webhook: no payment_ids in metadata");
      return NextResponse.json({ error: "No payment_ids" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    for (const paymentId of paymentIds) {
      // Idempotent — skip if already paid
      const { data: existing } = await supabase
        .from("payments")
        .select("payment_status, amount_due")
        .eq("id", paymentId)
        .single();

      if (!existing || existing.payment_status === "paid") continue;

      await supabase
        .from("payments")
        .update({
          payment_status: "paid",
          amount_paid: existing.amount_due,
          payment_method: "stripe",
          stripe_payment_intent_id: typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
          pending_confirmation: false,
        })
        .eq("id", paymentId);
    }
  }

  return NextResponse.json({ received: true });
}
