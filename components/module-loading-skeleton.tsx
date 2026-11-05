import Link from "next/link";

type SkeletonModule = "dashboard" | "orders" | "clients" | "machines" | "parts" | "payments" | "users" | "reports" | "order-form" | "order-detail";

const nav = [
  ["Panel general", "/"],
  ["Órdenes de servicio", "/ordenes"],
  ["Clientes", "/clientes"],
  ["Equipos", "/equipos"],
  ["Repuestos", "/repuestos"],
  ["Pagos", "/pagos"],
  ["Usuarios y técnicos", "/usuarios"],
  ["Reportes", "/reportes"],
];

function Bar({ className = "" }: { className?: string }) {
  return <span className={`skeleton-bar ${className}`} aria-hidden="true" />;
}

function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return <div className="skeleton-table">
    <div className="skeleton-table-row skeleton-table-head">{Array.from({length:columns},(_,i)=><Bar key={i} className="skeleton-cell"/>)}</div>
    {Array.from({length:rows},(_,i)=><div className="skeleton-table-row" key={i}>{Array.from({length:columns},(_,j)=><Bar key={j} className="skeleton-cell"/>)}</div>)}
  </div>;
}

export function ModuleLoadingSkeleton({ module }: { module: SkeletonModule }) {
  const titles: Record<SkeletonModule,string> = {
    dashboard:"Panel de servicio técnico",orders:"Órdenes de servicio",clients:"Clientes",machines:"Equipos",
    parts:"Repuestos",payments:"Pagos",users:"Usuarios y técnicos",reports:"Reportes",
    "order-form":"Nueva orden de servicio","order-detail":"Orden de servicio",
  };
  const listOnly = ["parts","payments","reports"].includes(module);
  const showStats = ["dashboard","payments","reports"].includes(module);
  const showTable = !["order-form","order-detail"].includes(module);
  return <div className="shell skeleton-shell" role="status" aria-label={`Cargando ${titles[module].toLowerCase()}`}>
    <aside className="sidebar skeleton-sidebar">
      <div className="brand">FERPRO<span>MAQ</span></div>
      <div className="sidebar-navigation"><div className="navlabel">Espacio de trabajo</div>{nav.map(([label,href])=><Link key={href} href={href} className={`navitem navlink ${(module==="dashboard"&&href==="/")||(module==="orders"&&href==="/ordenes")?"active":""}`}><Bar className="skeleton-nav-icon"/><Bar className="skeleton-nav-label"/></Link>)}</div>
      <div className="sidebar-user"><div className="navlabel">Sesión activa</div><Bar className="skeleton-user"/></div>
    </aside>
    <main className="main skeleton-main">
      <header className="topbar"><div><Bar className="skeleton-eyebrow"/><h1 className="heading">{titles[module]}</h1>{module!=="dashboard"&&<Bar className="skeleton-description"/>}</div><Bar className="skeleton-avatar"/></header>
      {showStats&&<div className="stats">{Array.from({length:module==="reports"?4:4},(_,i)=><div className="card skeleton-stat" key={i}><Bar className="skeleton-stat-label"/><Bar className="skeleton-stat-value"/><Bar className="skeleton-stat-foot"/></div>)}</div>}
      {listOnly ? <section className="card skeleton-panel"><div className="skeleton-panel-head"><div><Bar className="skeleton-heading"/><Bar className="skeleton-description"/></div><Bar className="skeleton-search"/></div>{module==="parts"&&<div className="skeleton-tabs">{Array.from({length:5},(_,i)=><Bar key={i}/>)}</div>}<SkeletonTable rows={7} columns={module==="payments"?5:module==="reports"?4:5}/></section> :
      ["order-form","order-detail"].includes(module) ? <div className="card skeleton-form-panel"><Bar className="skeleton-heading"/><div className="skeleton-form-grid">{Array.from({length:module==="order-form"?8:6},(_,i)=><div key={i}><Bar className="skeleton-form-label"/><Bar className="skeleton-input"/></div>)}</div><Bar className="skeleton-action"/></div> :
      <div className="skeleton-module-grid">{!listOnly&&<section className="card skeleton-form-panel"><Bar className="skeleton-heading"/>{Array.from({length:module==="users"?4:5},(_,i)=><div key={i}><Bar className="skeleton-form-label"/><Bar className="skeleton-input"/></div>)}<Bar className="skeleton-action"/></section>}<section className="card skeleton-panel"><div className="skeleton-panel-head"><div><Bar className="skeleton-heading"/><Bar className="skeleton-description"/></div><Bar className="skeleton-search"/></div><SkeletonTable rows={7} columns={module==="clients"?4:module==="machines"?4:5}/></section></div>}
    </main>
    <span className="sr-only">Cargando contenido…</span>
  </div>;
}
