"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Users, Wrench, Cog, Package, CreditCard, BarChart3, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

// El middleware ya valida la sesión y los permisos en el servidor. Esta caché evita
// repetir la consulta de perfil en cada navegación cliente entre módulos.
const profileRoleCache = new Map<string, { role: string; expiresAt: number }>();
const profileRoleRequests = new Map<string, Promise<string>>();

async function getCachedProfileRole(client: NonNullable<typeof supabase>, userId: string) {
  const cached = profileRoleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;
  const pending = profileRoleRequests.get(userId);
  if (pending) return pending;

  const request = client.from("profiles").select("role,active").eq("id", userId).maybeSingle()
    .then(({ data, error }) => {
      if (error || !data || data.active !== true) throw new Error("No se pudo verificar tu perfil y tus permisos.");
      profileRoleCache.set(userId, { role: data.role, expiresAt: Date.now() + 30_000 });
      return data.role as string;
    })
    .finally(() => profileRoleRequests.delete(userId));
  profileRoleRequests.set(userId, request);
  return request;
}

const links = [
  { href: "/", label: "Panel general", icon: ClipboardList },
  { href: "/ordenes", label: "Órdenes de servicio", icon: Wrench },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/equipos", label: "Equipos", icon: Cog },
  { href: "/repuestos", label: "Repuestos", icon: Package },
  { href: "/pagos", label: "Pagos", icon: CreditCard },
  { href: "/usuarios", label: "Usuarios y técnicos", icon: Users, admin: true },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
];

export function ModuleShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [role, setRole] = useState("");
  const [roleReady, setRoleReady] = useState(false);
  const [profileWarning, setProfileWarning] = useState("");

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setProfileWarning("No se pudo inicializar la conexión con Supabase.");
      setRoleReady(true);
      return;
    }

    const db = client as NonNullable<typeof client>;
    let cancelled = false;
    async function verifySession() {
      // getSession lee la sesión persistida localmente; getUser añade una
      // validación remota que el middleware ya realizó al solicitar la ruta.
      const { data: authData, error: authError } = await db.auth.getSession();
      if (cancelled) return;
      const user = authData.session?.user;
      if (authError || !user) {
        router.replace("/login");
        return;
      }

      let profileRole: string;
      try {
        profileRole = await getCachedProfileRole(db, user.id);
      } catch {
        if (cancelled) return;
        setProfileWarning("No se pudo verificar tu perfil y tus permisos. El contenido del módulo permanecerá bloqueado.");
        setRoleReady(true);
        return;
      }

      if (cancelled) return;
      const isOrdersRoute = path === "/ordenes" || path.startsWith("/ordenes/");
      const isUsersRoute = path === "/usuarios" || path.startsWith("/usuarios/");
      const allowed = profileRole === "admin"
        || (profileRole === "supervisor" && !isUsersRoute)
        || (profileRole === "tecnico" && isOrdersRoute);

      if (!allowed) {
        router.replace("/ordenes");
        return;
      }

      setRole(profileRole);
      setRoleReady(true);
      setProfileWarning("");
    }

    void verifySession();
    return () => { cancelled = true; };
  }, [path, router]);

  const visibleLinks = links.filter(item => roleReady && (
    role === "admin"
      || (role === "supervisor" && !item.admin)
      || (role === "tecnico" && item.href === "/ordenes")
  ));

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/">FERPRO<span>MAQ</span></Link>
        <div className="sidebar-navigation">
          <div className="navlabel">Espacio de trabajo</div>
          {visibleLinks.map(({ href, label, icon: Icon }) => {
            const isActive = path === href || (href !== "/" && path.startsWith(href + "/"));
            return (
              <Link key={href} href={href} className={`navitem navlink ${isActive ? "active" : ""}`}>
                <Icon size={17} />{label}
              </Link>
            );
          })}
        </div>
        <div className="sidebar-user">
          <div className="navlabel">Sesión activa</div>
          <button className="navitem navbutton" onClick={() => {
            const client = supabase;
            if (client) void client.auth.signOut().then(() => router.replace("/login"));
          }}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">FERPROMAQ / OPERACIONES</div>
            <h1 className="heading">{title}</h1>
            <p className="muted">{description}</p>
          </div>
        </header>
        {profileWarning && <div className="notice error" role="status">{profileWarning}</div>}
        {!roleReady ? (
          <section className="card"><div className="empty"><span className="loader"/>Verificando permisos…</div></section>
        ) : profileWarning ? null : (
          children
        )}
        <div className="footer">Ferpromaq · Plataforma de servicio técnico</div>
      </main>
    </div>
  );
}
