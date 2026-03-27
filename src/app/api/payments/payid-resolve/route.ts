import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { payment_id, action } = await request.json();
    if (!payment_id || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "payment_id and action (approve|reject) required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: payment, error } = await supabase
      .from("payments")
      .select("amount_due")
      .eq("id", payment_id)
      .single();

    if (error || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (action === "approve") {
      await supabase
        .from("payments")
        .update({
          payment_status: "paid",
          amount_paid: payment.amount_due,
          pending_confirmation: false,
        })
        .eq("id", payment_id);
    } else {
      // Reject — reset to unpaid, player can retry
      await supabase
        .from("payments")
        .update({
          pending_confirmation: false,
        })
        .eq("id", payment_id);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
