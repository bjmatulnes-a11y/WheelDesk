import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "../../../lib/supabase-server";

const waitlistSchema = z.object({
  email: z.string().email(),
  source: z.string().max(80).optional(),
});

const fromEmail = process.env.WAITLIST_FROM_EMAIL ?? "WheelDesk <waitlist@thewheeldesk.com>";
const notifyEmail = process.env.WAITLIST_NOTIFY_EMAIL;
const resendApiKey = process.env.RESEND_API_KEY;

function getBaseUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
}

async function sendResendEmail(input: { to: string; subject: string; html: string; text: string }) {
  if (!resendApiKey) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, reason: detail || `Resend failed with ${response.status}` };
  }

  return { sent: true };
}

function welcomeEmail(email: string, baseUrl: string) {
  const subject = "You're on the WheelDesk early access list";
  const text = `You're on the WheelDesk early access list.\n\nWheelDesk is being built as an options control system for OI path, dealer pressure, validation, and disciplined premium selling.\n\nWe'll send build updates and early access notes while the product is being finalized.\n\n${baseUrl}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#0f172a;background:#f8fafc;padding:24px">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;padding:24px">
        <p style="margin:0 0 12px;color:#0891b2;font-weight:800;letter-spacing:.08em;text-transform:uppercase">WheelDesk early access</p>
        <h1 style="margin:0 0 12px;font-size:26px;color:#020617">You're on the list.</h1>
        <p>Thanks for joining the WheelDesk waitlist.</p>
        <p>WheelDesk is being built as an options control system for OI path, dealer pressure, validation, news pulse, and disciplined premium selling.</p>
        <p>While the platform is being finalized, we'll send build updates, early access notes, and validation milestones.</p>
        <p style="margin-top:22px"><a href="${baseUrl}" style="display:inline-block;background:#06b6d4;color:#00111f;text-decoration:none;font-weight:800;padding:12px 16px;border-radius:12px">Visit WheelDesk</a></p>
        <p style="margin-top:22px;color:#64748b;font-size:13px">This was sent to ${email} because this address joined the WheelDesk early access list.</p>
      </div>
    </div>`;
  return { subject, text, html };
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let rawEmail = "";
  let rawSource = "landing";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    rawEmail = String(body.email ?? "").trim().toLowerCase();
    rawSource = String(body.source ?? "landing").trim();
  } else {
    const formData = await request.formData();
    rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
    rawSource = String(formData.get("source") ?? "landing").trim();
  }

  const parsed = waitlistSchema.safeParse({ email: rawEmail, source: rawSource });
  if (!parsed.success) {
    const url = new URL("/", request.url);
    url.searchParams.set("error", "invalid-email");
    return NextResponse.redirect(url, { status: 303 });
  }

  const email = parsed.data.email;
  const source = parsed.data.source ?? "landing";

  const { data: existing } = await supabaseServer
    .from("waitlist_entries")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabaseServer.from("waitlist_entries").insert({
      email,
      source,
      notes: "landing_email_capture",
    });

    if (error && error.code !== "23505") {
      console.error("waitlist insert failed", error);
      const url = new URL("/", request.url);
      url.searchParams.set("error", "waitlist-save-failed");
      return NextResponse.redirect(url, { status: 303 });
    }
  }

  const baseUrl = getBaseUrl(request);
  const emailContent = welcomeEmail(email, baseUrl);
  const welcomeResult = await sendResendEmail({ to: email, ...emailContent });

  if (notifyEmail && !existing) {
    await sendResendEmail({
      to: notifyEmail,
      subject: `New WheelDesk waitlist signup: ${email}`,
      text: `New WheelDesk waitlist signup: ${email}\nSource: ${source}`,
      html: `<p>New WheelDesk waitlist signup:</p><p><strong>${email}</strong></p><p>Source: ${source}</p>`,
    });
  }

  if (contentType.includes("application/json")) {
    return NextResponse.json({ ok: true, alreadyJoined: Boolean(existing), emailSent: welcomeResult.sent });
  }

  const url = new URL("/", request.url);
  url.searchParams.set("joined", existing ? "already" : "1");
  if (!welcomeResult.sent) url.searchParams.set("email", "queued");
  return NextResponse.redirect(url, { status: 303 });
}
