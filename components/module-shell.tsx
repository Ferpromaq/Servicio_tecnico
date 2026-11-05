"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Users, Wrench, Cog, Package, CreditCard, BarChart3, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

const links = [
  { href: "/", label: "Panel general", icon: ClipboardList },
  { href: "/#ordenes", label: "Órdenes de servicio", icon: Wrench },
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
  const [profileWarning, setProfileWarning] = useState("");

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setProfileWarning("No se pudo inicializar la conexión con Supabase.");
      return;
    }

    let cancelled = false;
    async function verifySession() {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        router.replace("/login");
        return;
      }

      // Un error de lectura del perfil (por ejemplo, RLS o conexión) NO debe
      // cerrar la sesión. Solo se cierra cuando active=false está confirmado.
      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role,active")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (profileError) {
        setProfileWarning("No se pudo verificar el perfil. La sesión permanece activa; revisa los permisos de profiles en Supabase.");
        return;
      }
      if (!profile) {
        setProfileWarning("Tu usuario inició sesión, pero no tiene un perfil registrado en la tabla profiles.");
        return;
      }
      if (profile.active === false) {
        await client.auth.signOut();
        if (!cancelled) router.replace("/login");
        return;
      }
      setRole(profile.role ?? "");
      setProfileWarning("");
    }

    void verifySession();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/">FERPRO<span>MAQ</span></Link>
        <div className="navlabel">Espacio de trabajo</div>
        {links.filter(item => !item.admin || role === "admin").map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`navitem navlink ${path === href ? "active" : ""}`}>
            <Icon size={17} />{label}
          </Link>
        ))}
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
        {children}
        <div className="footer">Ferpromaq · Plataforma de servicio técnico</div>
      </main>
    </div>
  );
}
