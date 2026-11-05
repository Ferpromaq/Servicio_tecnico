import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resend = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!url || !anon || !service || !resend || !from || !appUrl) {
    return NextResponse.json({ error: "Faltan variables de entorno para enviar la autorización." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items: {name:string;value:string;options?:any}[]) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const { data: profile } = await auth.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || !["admin", "supervisor"].includes(profile.role)) {
    return NextResponse.json({ error: "No tienes permiso para solicitar autorización al cliente." }, { status: 403 });
  }

  let body: { partId?: string } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }
  if (!body.partId) return NextResponse.json({ error: "Falta el repuesto." }, { status: 400 });

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: part, error: partError } = await db.from("parts_requests")
    .select("id,description,status,order_id,service_orders(order_number,clients(name,email))")
    .eq("id", body.partId).single();
  if (partError || !part) return NextResponse.json({ error: "No se encontró el repuesto." }, { status: 404 });
  if (part.status !== "pendiente") return NextResponse.json({ error: "Solo se pueden enviar repuestos pendientes de autorización." }, { status: 409 });

  const order = Array.isArray(part.service_orders) ? part.service_orders[0] : part.service_orders;
  const client = order && (Array.isArray(order.clients) ? order.clients[0] : order.clients);
  const email = client?.email;
  if (!email) return NextResponse.json({ error: "El cliente no tiene correo registrado." }, { status: 422 });

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: insertError } = await db.from("part_client_authorizations").insert({
    order_id: part.order_id, part_id: part.id, token_hash: tokenHash, expires_at: expiresAt, created_by: user.id,
  });
  if (insertError) return NextResponse.json({ error: "No se pudo generar el enlace seguro." }, { status: 500 });

  const link = new URL("/autorizar-repuesto", appUrl);
  link.searchParams.set("token", rawToken);
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#202124"><h2 style="color:#ff6210">Ferpromaq · Autorización de repuesto</h2><p>Hola ${escapeHtml(client?.name ?? "cliente")},</p><p>Para continuar con la orden <strong>#${escapeHtml(String(order?.order_number ?? ""))}</strong>, necesitamos que indiques si autorizas el siguiente repuesto:</p><p style="padding:16px;background:#f5f5f5;border-radius:8px"><strong>${escapeHtml(part.description)}</strong></p><p><a href="${link.toString()}" style="display:inline-block;background:#ff6210;color:white;padding:12px 18px;border-radius:6px;text-decoration:none">Revisar y responder</a></p><p>Este enlace vence en 7 días y solo puede utilizarse una vez.</p><p>Si no solicitaste esta gestión, puedes ignorar este correo.</p></div>`;
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + resend, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject: "Autorización de repuesto · Orden #" + order?.order_number, html }),
  });
  if (!sent.ok) {
    await db.from("part_client_authorizations").delete().eq("token_hash", tokenHash);
    return NextResponse.json({ error: "Resend no pudo enviar el correo." }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
