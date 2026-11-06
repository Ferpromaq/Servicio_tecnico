"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Users, Wrench, Cog, Package, CreditCard, BarChart3, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
      const { data: authData, error: authError } = await db.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        router.replace("/login");
        return;
      }

      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("role,active")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (profileError || !profile || profile.active !== true) {
        setProfileWarning("No se pudo verificar tu perfil y tus permisos. El contenido del módulo permanecerá bloqueado.");
        setRoleReady(true);
        return;
      }

      const isOrdersRoute = path === "/ordenes" || path.startsWith("/ordenes/");
      const isUsersRoute = path === "/usuarios" || path.startsWith("/usuarios/");
      const allowed = profile.role === "admin"
        || (profile.role === "supervisor" && !isUsersRoute)
        || (profile.role === "tecnico" && isOrdersRoute);

      if (!allowed) {
        router.replace("/ordenes");
        return;
      }

      setRole(profile.role ?? "");
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
