"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {ModuleShell} from "@/components/layout/module-shell";
import {supabase} from "@/lib/supabase";
type Summary={orders:number;open:number;ready:number;delivered:number;clients:number;machines:number;parts:number;payments:number;total:number;brandCharges:number;brandTotal:number;brandPaid:number;brandBalance:number};
const initial:Summary={orders:0,open:0,ready:0,delivered:0,clients:0,machines:0,parts:0,payments:0,total:0,brandCharges:0,brandTotal:0,brandPaid:0,brandBalance:0};
const money=(n:number)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);
export default function ReportsPage(){const [data,setData]=useState(initial);const [error,setError]=useState("");const [loading,setLoading]=useState(true);
useEffect(()=>{async function load(){if(!supabase)return;const [o,c,m,pay,parts,charges,brandPayments]=await Promise.all([supabase.from("service_orders").select("id,status"),supabase.from("clients").select("id",{count:"exact",head:true}),supabase.from("machines").select("id",{count:"exact",head:true}),supabase.from("payments").select("amount"),supabase.from("parts_requests").select("id"),supabase.from("brand_charges").select("id,amount"),supabase.from("brand_charge_payments").select("amount")]);const err=o.error||c.error||m.error||pay.error||parts.error||charges.error||brandPayments.error;if(err)setError(err.message);else{const os=o.data??[];const payments=pay.data??[];const ch=charges.data??[];const bp=brandPayments.data??[];const brandTotal=ch.reduce((s,x)=>s+Number(x.amount),0);const brandPaid=bp.reduce((s,x)=>s+Number(x.amount),0);setData({orders:os.length,open:os.filter(x=>!["entregadas","rechazadas"].includes(x.status)).length,ready:os.filter(x=>x.status==="listas").length,delivered:os.filter(x=>x.status==="entregadas").length,clients:c.count??0,machines:m.count??0,parts:parts.data?.length??0,payments:payments.length,total:payments.reduce((s,x)=>s+Number(x.amount),0),brandCharges:ch.length,brandTotal,brandPaid,brandBalance:Math.max(0,brandTotal-brandPaid)});}setLoading(false);}void load()},[]);
const cards:[string,number][]=[["Órdenes totales",data.orders],["Órdenes activas",data.open],["Listas para entrega",data.ready],["Entregadas",data.delivered],["Clientes",data.clients],["Equipos",data.machines],["Solicitudes de repuestos",data.parts],["Pagos de clientes",data.payments]];
return <ModuleShell title="Reportes" description="Indicadores generales de servicio técnico"><div className="stats">{cards.map(([label,value])=><div className="card stat-card" key={label}><div className="statlabel">{label}</div><div className="statvalue">{loading?"—":value}</div></div>)}</div>
<div className="stats">
<section className="card module-list"><h2>Pagos de clientes</h2><div className="statvalue">{loading?"—":money(data.total)}</div><p className="muted">Dinero recibido de clientes por diagnóstico, repuestos e instalación.</p><Link className="primary" href="/pagos">Ver pagos</Link></section>
<section className="card module-list"><h2>Cobros a marcas</h2><div className="statvalue">{loading?"—":money(data.brandBalance)}</div><p className="muted">{data.brandCharges} cobros · Total generado {loading?"—":money(data.brandTotal)} · Recibido {loading?"—":money(data.brandPaid)}</p><Link className="primary" href="/cobros">Ver cobros</Link></section>
</div>
{error&&<div className="notice error">{error}</div>}
<p className="muted">Los ingresos de clientes y los cobros a marcas se contabilizan por separado. Los montos no representan utilidad.</p>
</ModuleShell>}
