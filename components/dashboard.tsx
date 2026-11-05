"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ClipboardList, Clock3, Package, RefreshCw, Search, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatOrderDate, getServiceOrders, ORDER_STATUSES, orderStatusLabel, type ServiceOrder } from "@/lib/data/orders";

const nav = [
  { label: "Panel general", icon: ClipboardList },
  { label: "Órdenes de servicio", icon: Wrench },
  { label: "Repuestos", icon: Package },
  { label: "Pagos", icon: Clock3 },
];

export function Dashboard() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [active, setActive] = useState<string>("todas");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ServiceOrder | null>(null);
  const [userLabel, setUserLabel] = useState("Equipo de servicio");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await getServiceOrders();
      setOrders(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar las órdenes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    if (!supabase) return;
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle();
      if (profile?.full_name) setUserLabel(profile.full_name);
    });
  }, [loadOrders]);

  const filtered = useMemo(() => orders.filter((order) => {
    const matchesStatus = active === "todas" || order.status === active;
    const machine = [order.machines?.equipment_type, order.machines?.brand, order.machines?.model, order.machines?.serial_number].filter(Boolean).join(" ");
    const text = [order.order_number, order.clients?.name, order.clients?.rut, machine].join(" ").toLowerCase();
    return matchesStatus && text.includes(query.toLowerCase());
  }), [orders, active, query]);

  const count = (status: string) => orders.filter((order) => order.status === status).length;
  const activeCount = orders.filter((order) => !["entregadas", "rechazadas"].includes(order.status)).length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">FERPRO<span>MAQ</span></div>
        <div>
          <div className="navlabel">Espacio de trabajo</div>
          {nav.map(({ label, icon: Icon }, index) => (
            <div key={label} className={`navitem ${index === 0 ? "active" : ""}`}><Icon size={17} />{label}</div>
          ))}
        </div>
        <div className="sidebar-user">
          <div className="navlabel">Sesión activa</div>
          <div className="navitem"><span className="avatar">{userLabel.slice(0, 1).toUpperCase()}</span><span>{userLabel}</span></div>
          <button className="navitem navbutton" onClick={() => void supabase?.auth.signOut().then(() => window.location.assign("/login"))}>↪ Cerrar sesión</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">FERPROMAQ / OPERACIONES</div><h1 className="heading">Panel de servicio técnico</h1></div>
          <div className="user-chip"><div><strong>{userLabel}</strong><div className="eyebrow">Servicio técnico</div></div><div className="avatar">{userLabel.slice(0, 1).toUpperCase()}</div></div>
        </header>

        <section className="stats">
          {[
            ["Órdenes activas", activeCount, "En curso"],
            ["En diagnóstico", count("diagnostico"), "Pendientes de evaluación"],
            ["En reparación", count("en_reparacion"), "Trabajo técnico"],
            ["Listas para entrega", count("listas"), "Esperando al cliente"],
          ].map(([label, value, foot]) => (
            <div className="card stat-card" key={String(label)}><div className="statlabel">{label}</div><div className="statvalue">{loading ? "—" : value}</div><div className="statfoot">{foot}</div></div>
          ))}
        </section>

        <section className="card orders-card">
          <div className="section-head">
            <div><h2>Órdenes de servicio</h2><p>Seguimiento de equipos y trabajos en taller</p></div>
            <button className="secondary" onClick={() => void loadOrders()} disabled={loading}><RefreshCw size={15} /> Actualizar</button>
          </div>
          <div className="toolbar">
            <div className="tabs">{ORDER_STATUSES.map((tab) => <button key={tab.value} onClick={() => setActive(tab.value)} className={`tab ${active === tab.value ? "active" : ""}`}>{tab.label}{tab.value === "todas" ? <span className="tab-count">{orders.length}</span> : <span className="tab-count">{count(tab.value)}</span>}</button>)}</div>
            <label className="search-wrap"><Search size={16}/><input className="search" placeholder="Buscar orden, cliente o equipo…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>

          {error && <div className="notice error"><AlertCircle size={17}/><div><strong>No se pudieron cargar las órdenes</strong><p>{error}</p><button onClick={() => void loadOrders()}>Reintentar</button></div></div>}
          <div className="tablewrap"><table className="orders"><thead><tr><th>Orden</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Prioridad</th><th>Ingreso</th></tr></thead>
            <tbody>{filtered.map((order) => <tr key={order.id} onClick={() => setSelected(order)}>
              <td className="orderid">#{order.order_number}</td>
              <td><div className="client">{order.clients?.name ?? "Cliente sin nombre"}</div><div className="subline">{order.clients?.rut ?? "—"}</div></td>
              <td><div>{[order.machines?.brand, order.machines?.model].filter(Boolean).join(" ") || order.machines?.equipment_type || "Equipo no especificado"}</div><div className="subline">{order.machines?.serial_number ?? ""}</div></td>
              <td><span className={`pill ${order.status === "listas" ? "green" : order.status === "diagnostico" ? "blue" : order.status === "rechazadas" ? "red" : "orange"}`}>{orderStatusLabel(order.status)}</span></td>
              <td><span className={`priority priority-${order.priority}`}>{order.priority}</span></td>
              <td>{formatOrderDate(order.received_at)}</td>
            </tr>)}</tbody>
          </table>
          {!loading && !error && filtered.length === 0 && <div className="empty"><ClipboardList size={28}/><strong>{orders.length === 0 ? "Todavía no hay órdenes registradas" : "No encontramos resultados"}</strong><p>{orders.length === 0 ? "Cuando se registren órdenes en Supabase aparecerán en este listado." : "Prueba con otro término o estado."}</p></div>}
          {loading && <div className="empty"><span className="loader"/>Cargando órdenes desde Supabase…</div>}
          </div>
          <div className="list-footer"><span>{filtered.length} de {orders.length} órdenes</span><span>Datos sincronizados desde Supabase</span></div>
        </section>
        <div className="footer">Ferpromaq · Plataforma de servicio técnico</div>
      </main>

      {selected && <div className="drawerback" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <aside className="drawer compact-drawer"><div className="drawerhead"><div><div className="eyebrow">ORDEN DE SERVICIO</div><h2>#{selected.order_number}</h2></div><button className="close" onClick={() => setSelected(null)}>Cerrar ×</button></div>
          <div className="detailgrid"><div className="detailbox"><small>Estado</small><strong>{orderStatusLabel(selected.status)}</strong></div><div className="detailbox"><small>Prioridad</small><strong>{selected.priority}</strong></div></div>
          <h3 className="sectiontitle">Cliente</h3><p>{selected.clients?.name ?? "Sin información"}</p><p className="muted">{selected.clients?.rut ?? ""}</p>
          <h3 className="sectiontitle">Equipo</h3><p>{[selected.machines?.brand, selected.machines?.model, selected.machines?.equipment_type].filter(Boolean).join(" · ") || "Sin información"}</p><p className="muted">Serie: {selected.machines?.serial_number ?? "No registrada"}</p>
          <h3 className="sectiontitle">Problema informado</h3><p>{selected.problem_description}</p>
          <p className="muted">Ingreso: {formatOrderDate(selected.received_at)}</p>
          <p className="muted">Técnico: {selected.assigned?.full_name ?? "Sin asignar"}</p>
          <a className="primary full-detail-link" href={`/ordenes/${selected.id}`}>Abrir ficha completa de la orden</a>
        </aside>
      </div>}
    </div>
  );
}
