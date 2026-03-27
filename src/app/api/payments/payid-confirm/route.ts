import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const paymentIds: string[] = body.payment_ids || (body.payment_id ? [body.payment_id] : []);
    if (paymentIds.length === 0) {
      return NextResponse.json({ error: "payment_id or payment_ids required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: payments, error } = await supabase
      .from("payments")
      .select("*, player:players(name), session:sessions(date)")
      .in("id", paymentIds);

    if (error || !payments || payments.length === 0) {
      return NextResponse.json({ error: "Payments not found" }, { status: 404 });
    }

    const references: string[] = [];

    for (const payment of payments) {
      if (payment.payment_status === "paid") continue;

      const playerData = payment.player as unknown as { name: string };
      const sessionData = payment.session as unknown as { date: string };
      const d = new Date(sessionData.date);
      const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const dayAbbrev = days[d.getDay()];
      const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const firstName = playerData.name.split(" ")[0].toUpperCase();
      const reference = `${dayAbbrev}-${mmdd}-${firstName}`;

      await supabase
        .from("payments")
        .update({
          pending_confirmation: true,
          payment_method: "payid",
          payment_reference: reference,
        })
        .eq("id", payment.id);

      references.push(reference);
    }

    return NextResponse.json({ success: true, references });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
