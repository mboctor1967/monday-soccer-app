import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const [playersRes, sessionsRes, rsvpsRes, paymentsRes] = await Promise.all([
      supabase.from("players").select("*").order("name"),
      supabase.from("sessions").select("*").order("date", { ascending: false }),
      supabase.from("rsvps").select("*"),
      supabase.from("payments").select("*"),
    ]);

    const players = playersRes.data || [];
    const sessions = sessionsRes.data || [];
    const rsvps = rsvpsRes.data || [];
    const payments = paymentsRes.data || [];

    const wb = XLSX.utils.book_new();

    // --- Sheet 1: Session Details (one row per player per session) ---
    const detailRows: Record<string, unknown>[] = [];
    for (const session of sessions) {
      const sessionDate = new Date(session.date).toLocaleDateString("en-AU", {
        weekday: "short", day: "numeric", month: "short", year: "numeric",
      });
      for (const player of players) {
        const rsvp = rsvps.find((r) => r.session_id === session.id && r.player_id === player.id);
        const payment = payments.find((p) => p.session_id === session.id && p.player_id === player.id);
        if (rsvp || payment) {
          detailRows.push({
            "Session Date": sessionDate,
            "Session Status": session.status.replace(/_/g, " "),
            "Player": player.name,
            "Type": player.player_type,
            "Active": player.is_active ? "Yes" : "No",
            "RSVP Status": rsvp?.status || "-",
            "Waitlisted": rsvp?.is_waitlist ? "Yes" : "No",
            "Amount Due": payment?.amount_due ?? 0,
            "Amount Paid": payment?.amount_paid ?? 0,
            "Payment Status": payment?.payment_status || "-",
          });
        }
      }
    }
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    formatSheet(detailSheet, [18, 16, 20, 10, 8, 14, 10, 12, 12, 14]);
    XLSX.utils.book_append_sheet(wb, detailSheet, "Session Details");

    // --- Sheet 2: Player Summary ---
    const completedSessionIds = new Set(
      sessions.filter((s) => s.status === "completed" || s.status === "teams_published").map((s) => s.id)
    );
    const totalCompleted = completedSessionIds.size;

    const summaryRows: Record<string, unknown>[] = players.map((player) => {
      const playerRsvps = rsvps.filter(
        (r) => r.player_id === player.id && r.status === "confirmed" && !r.is_waitlist && completedSessionIds.has(r.session_id)
      );
      const playerPayments = payments.filter((p) => p.player_id === player.id);
      const totalDue = playerPayments.reduce((s, p) => s + (p.amount_due || 0), 0);
      const totalPaid = playerPayments.reduce((s, p) => s + (p.amount_paid || 0), 0);
      const paidCount = playerPayments.filter((p) => p.payment_status === "paid").length;

      return {
        "Player": player.name,
        "Type": player.player_type,
        "Active": player.is_active ? "Yes" : "No",
        "Sessions Played": playerRsvps.length,
        "Total Sessions": totalCompleted,
        "Attendance %": totalCompleted > 0 ? Math.round((playerRsvps.length / totalCompleted) * 100) : 0,
        "Sessions Paid": paidCount,
        "Sessions Owed": playerPayments.length,
        "Payment %": playerPayments.length > 0 ? Math.round((paidCount / playerPayments.length) * 100) : 0,
        "Total Due": totalDue,
        "Total Paid": totalPaid,
        "Outstanding": totalDue - totalPaid,
      };
    });
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    formatSheet(summarySheet, [20, 10, 8, 15, 14, 13, 13, 13, 12, 10, 10, 12]);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Player Summary");

    // --- Sheet 3: Sessions Overview ---
    const sessionRows: Record<string, unknown>[] = sessions.map((session) => {
      const sessionRsvps = rsvps.filter((r) => r.session_id === session.id && r.status === "confirmed");
      const confirmed = sessionRsvps.filter((r) => !r.is_waitlist).length;
      const waitlisted = sessionRsvps.filter((r) => r.is_waitlist).length;
      const sessionPayments = payments.filter((p) => p.session_id === session.id);
      const collected = sessionPayments.reduce((s, p) => s + (p.amount_paid || 0), 0);
      const due = sessionPayments.reduce((s, p) => s + (p.amount_due || 0), 0);

      return {
        "Date": new Date(session.date).toLocaleDateString("en-AU", {
          weekday: "short", day: "numeric", month: "short", year: "numeric",
        }),
        "Venue": session.venue || "-",
        "Format": session.format === "3t" ? "3 Teams" : "2 Teams",
        "Status": session.status.replace(/_/g, " "),
        "Confirmed": confirmed,
        "Max Players": session.format === "3t" ? 15 : 10,
        "Waitlisted": waitlisted,
        "Amount Due": due,
        "Collected": collected,
        "Outstanding": due - collected,
      };
    });
    const sessionsSheet = XLSX.utils.json_to_sheet(sessionRows);
    formatSheet(sessionsSheet, [22, 24, 10, 16, 10, 12, 10, 12, 10, 12]);
    XLSX.utils.book_append_sheet(wb, sessionsSheet, "Sessions");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="monday-soccer-export.xlsx"`,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function formatSheet(sheet: XLSX.WorkSheet, colWidths: number[]) {
  sheet["!cols"] = colWidths.map((w) => ({ wch: w }));
  // Bold header row
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (sheet[addr]) {
      sheet[addr].s = { font: { bold: true } };
    }
  }
}
