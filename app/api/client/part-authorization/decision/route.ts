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
  if (!body.token || body.token.length > 256 || !["autorizado", "rechazado"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "Debes indicar una decisión válida." }, { status: 400 });
  }

  const hash = createHash("sha256").update(body.token).digest("hex");
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.rpc("consume_part_client_authorization", {
    p_token_hash: hash,
    p_decision: body.decision,
  });
  if (error) {
    const message = error.message ?? "";
    if (/inválido|vencido|utilizado|pendiente/i.test(message)) {
      return NextResponse.json({ error: "El enlace venció, ya fue utilizado o el repuesto dejó de estar pendiente. Contacta a Ferpromaq si necesitas ayuda." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo registrar tu decisión. Contacta a Ferpromaq." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
