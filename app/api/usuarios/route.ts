import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const allowedRoles = ["admin", "supervisor", "tecnico"] as const;
type AppRole = (typeof allowedRoles)[number];

export async function POST(request: Request) {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: authData, error: authError } = await sessionClient.auth.getUser();

    if (authError || !authData.user) {
      return NextResponse.json({ error: "Debes iniciar sesión para realizar esta acción." }, { status: 401 });
    }

    const { data: currentProfile, error: profileError } = await sessionClient
      .from("profiles")
      .select("role,active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !currentProfile || currentProfile.active !== true) {
      return NextResponse.json({ error: "No fue posible verificar tus permisos." }, { status: 403 });
    }
    if (currentProfile.role !== "admin") {
      return NextResponse.json({ error: "Solo un administrador puede crear usuarios." }, { status: 403 });
    }

    const body = await request.json();
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role as AppRole;

    if (fullName.length < 2 || fullName.length > 120) {
      return NextResponse.json({ error: "Ingresa un nombre de entre 2 y 120 caracteres." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Ingresa un correo electrónico válido." }, { status: 400 });
    }
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: "La contraseña debe tener entre 8 y 128 caracteres." }, { status: 400 });
    }
    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: "Selecciona un rol válido." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 500 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? "No fue posible crear la cuenta." },
        { status: 400 },
      );
    }

    const { error: insertError } = await adminClient.from("profiles").insert({
      id: created.user.id,
      full_name: fullName,
      role,
      active: true,
    });

    if (insertError) {
      const { error: rollbackError } = await adminClient.auth.admin.deleteUser(created.user.id);
      if (rollbackError) {
        console.error("No se pudo revertir la cuenta creada sin perfil:", rollbackError.message);
      }
      return NextResponse.json(
        { error: "La cuenta se creó, pero no se pudo guardar su perfil. Se intentó revertir la cuenta; revisa los registros del servidor." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, userId: created.user.id });
  } catch (error) {
    console.error("Error creando usuario:", error);
    return NextResponse.json({ error: "Ocurrió un error al crear el usuario." }, { status: 500 });
  }
}
