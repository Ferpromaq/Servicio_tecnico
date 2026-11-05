import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ error: "El servicio no está configurado." }, { status: 503 });
  let body: { token?: string; decision?: string } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }
  if (!body.token || !["autorizado", "rechazado"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "Debes indicar una decisión válida." }, { status: 400 });
  }

  const hash = createHash("sha256").update(body.token).digest("hex");
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authorization, error } = await db.from("part_client_authorizations")
    .select("id,part_id,expires_at,used_at").eq("token_hash", hash).maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo validar el enlace." }, { status: 500 });
  if (!authorization) return NextResponse.json({ error: "El enlace no es válido." }, { status: 404 });
  if (authorization.used_at) return NextResponse.json({ error: "Este enlace ya fue utilizado." }, { status: 409 });
  if (new Date(authorization.expires_at).getTime() < Date.now()) return NextResponse.json({ error: "El enlace venció. Contacta a Ferpromaq para solicitar uno nuevo." }, { status: 410 });

  const { data: part, error: partError } = await db.from("parts_requests").select("id,status").eq("id", authorization.part_id).single();
  if (partError || !part || part.status !== "pendiente") return NextResponse.json({ error: "Este repuesto ya no está pendiente de autorización." }, { status: 409 });

  const { error: updateError } = await db.from("parts_requests").update({ status: body.decision }).eq("id", part.id).eq("status", "pendiente");
  if (updateError) return NextResponse.json({ error: "No se pudo guardar tu decisión." }, { status: 500 });
  const { error: consumeError } = await db.from("part_client_authorizations").update({
    used_at: new Date().toISOString(), decision: body.decision,
  }).eq("id", authorization.id).is("used_at", null);
  if (consumeError) return NextResponse.json({ error: "La decisión se guardó, pero no se pudo cerrar el enlace. Contacta a Ferpromaq." }, { status: 500 });
  return NextResponse.json({ success: true });
}
