import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;
  if (!url || !anonKey || !serviceKey || !resendKey || !from) {
    return NextResponse.json({ error: "Faltan variables de entorno para enviar notificaciones." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items: {name:string;value:string;options?:any}[]) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { data: profile } = await sessionClient.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || !["admin", "supervisor"].includes(profile.role)) {
    return NextResponse.json({ error: "No tienes permiso para enviar esta notificación." }, { status: 403 });
  }

  let orderId = "";
  try { orderId = String((await request.json()).orderId ?? ""); }
  catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }
  if (!orderId) return NextResponse.json({ error: "Falta el identificador de la orden." }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order, error } = await admin.from("service_orders")
    .select("order_number,commissioning,assigned_technician,clients(name),machines(equipment_type,brand,model)")
    .eq("id", orderId).single();
  if (error || !order) return NextResponse.json({ error: "No se encontró la orden." }, { status: 404 });
  if (!order.commissioning) return NextResponse.json({ error: "La orden no está marcada como Puesta en Marcha." }, { status: 409 });
  if (!order.assigned_technician) return NextResponse.json({ sent: false, reason: "La orden no tiene técnico asignado." });

  const { data: technician, error: technicianError } = await admin.auth.admin.getUserById(order.assigned_technician);
  const email = technician?.user?.email;
  if (technicianError || !email) return NextResponse.json({ error: "El técnico asignado no tiene un correo disponible." }, { status: 422 });

  const clientName = Array.isArray(order.clients) ? order.clients[0]?.name : order.clients?.name;
  const machine = Array.isArray(order.machines) ? order.machines[0] : order.machines;
  const equipment = [machine?.brand, machine?.model, machine?.equipment_type].filter(Boolean).join(" ");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Nueva orden de Puesta en Marcha · Ferpromaq",
      text: "Se registró la orden #" + order.order_number + " como Puesta en Marcha. Cliente: " + (clientName ?? "No indicado") + ". Equipo: " + (equipment || "No indicado") + ". Ingresa a la plataforma de servicio técnico para revisar los antecedentes.",
    }),
  });
  if (!response.ok) return NextResponse.json({ error: "No fue posible enviar el correo de notificación." }, { status: 502 });
  return NextResponse.json({ sent: true });
}
