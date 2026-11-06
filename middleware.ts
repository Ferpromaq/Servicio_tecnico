import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies: { name: string; value: string; options?: any }[]) {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isLogin = pathname === "/login";

  if (authError || !user) {
    if (isLogin) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();

  // Acceso cerrado por defecto: sin perfil verificable no se permite entrar
  // a los módulos protegidos. La pantalla de login permanece accesible.
  if (profileError || !profile || profile.active !== true) {
    if (isLogin) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = profile.role === "tecnico" ? "/ordenes" : "/";
    return NextResponse.redirect(url);
  }

  // Las API validan sus permisos de forma independiente en el servidor.
  if (pathname.startsWith("/api/")) return response;

  const isOrdersRoute = pathname === "/ordenes" || pathname.startsWith("/ordenes/");
  const isUsersRoute = pathname === "/usuarios" || pathname.startsWith("/usuarios/");

  const isNewOrderRoute = pathname === "/ordenes/nueva" || pathname.startsWith("/ordenes/nueva/");
  const forbiddenForTechnician = profile.role === "tecnico" && (!isOrdersRoute || isNewOrderRoute);
  const forbiddenForSupervisor = profile.role === "supervisor" && isUsersRoute;

  if (forbiddenForTechnician || forbiddenForSupervisor) {
    const url = request.nextUrl.clone();
    url.pathname = "/ordenes";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
