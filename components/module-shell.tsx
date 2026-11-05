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
export function ModuleShell({title,description,children}:{title:string;description:string;children:React.ReactNode}) {
 const path=usePathname(); const router=useRouter(); const [role,setRole]=useState("");
 useEffect(()=>{if(!supabase)return;void supabase.auth.getUser().then(async({data})=>{if(!data.user){router.replace("/login");return;}const {data:p}=await supabase.from("profiles").select("role,active").eq("id",data.user.id).maybeSingle();if(!p?.active){await supabase.auth.signOut();router.replace("/login");return;}setRole(p.role);});},[router]);
 return <div className="shell"><aside className="sidebar"><Link className="brand" href="/">FERPRO<span>MAQ</span></Link><div className="navlabel">Espacio de trabajo</div>{links.filter(x=>!x.admin||role==="admin").map(({href,label,icon:Icon})=><Link key={href} href={href} className={`navitem navlink ${path===href?"active":""}`}><Icon size={17}/>{label}</Link>)}<div className="sidebar-user"><div className="navlabel">Sesión activa</div><button className="navitem navbutton" onClick={()=>void supabase?.auth.signOut().then(()=>router.replace("/login"))}><LogOut size={16}/> Cerrar sesión</button></div></aside><main className="main"><header className="topbar"><div><div className="eyebrow">FERPROMAQ / OPERACIONES</div><h1 className="heading">{title}</h1><p className="muted">{description}</p></div></header>{children}<div className="footer">Ferpromaq · Plataforma de servicio técnico</div></main></div>;
}