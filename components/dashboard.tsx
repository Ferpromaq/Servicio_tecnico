"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import OrderDetailPage from "@/app/ordenes/componentes/order-detail-page";
import { AlertCircle, CalendarDays, ClipboardList, RefreshCw, Search, Wrench, Users, UserRound, Cog, Package, CreditCard, BarChart3, Hash } from "lucide-react";
import { supabase } from "@/lib/supabase";
import NewOrderModal from "@/app/ordenes/componentes/new-order-modal";
import { formatOrderDate, getServiceOrders, ORDER_STATUSES, orderPriorityClass, orderPriorityLabel, orderStatusClass, orderStatusLabel, type ServiceOrder } from "@/app/ordenes/servicios/orders";
import { getOrderWorkflow, type OrderEvent } from "@/app/ordenes/servicios/order-workflow";

const nav: { label: string; icon: typeof ClipboardList; href: string; admin?: boolean }[] = [
  { label: "Panel general", icon: ClipboardList, href: "/" },
  { label: "Órdenes de servicio", icon: Wrench, href: "/ordenes" },
  { label: "Clientes", icon: Users, href: "/clientes" },
  { label: "Equipos", icon: Cog, href: "/equipos" },
  { label: "Repuestos", icon: Package, href: "/repuestos" },
  { label: "Pagos", icon: CreditCard, href: "/pagos" },
  { label: "Usuarios y técnicos", icon: Users, href: "/usuarios", admin: true },
  { label: "Reportes", icon: BarChart3, href: "/reportes" },
];

export function Dashboard() {
  const pathname = usePathname();
  const isOrdersPage = pathname === "/ordenes";
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [active, setActive] = useState<string>("todas");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ServiceOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [summaryClosing, setSummaryClosing] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [detailClosing, setDetailClosing] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const summaryCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drawerEvents, setDrawerEvents] = useState<OrderEvent[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [userLabel, setUserLabel] = useState("Equipo de servicio");
  const [role, setRole] = useState("");
  const [roleReady, setRoleReady] = useState(false);

  useEffect(() => {
    if (!selected || summaryClosing) {
      setSummaryVisible(false);
      return;
    }
    // Espera a que el drawer se pinte fuera de pantalla antes de iniciar la transición.
    const timer = window.setTimeout(() => setSummaryVisible(true), 40);
    return () => window.clearTimeout(timer);
  }, [selected, summaryClosing]);

  useEffect(() => {
    if (!detailOpen || detailClosing) {
      setDetailVisible(false);
      return;
    }
    // Separa el montaje del cambio de estado para que el navegador anime la entrada.
    const timer = window.setTimeout(() => setDetailVisible(true), 40);
    return () => window.clearTimeout(timer);
  }, [detailOpen, detailClosing]);

  const syncDrawerFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const orderNumber = Number(params.get("orden"));
    if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0) {
      setSummaryClosing(true);
      setDetailClosing(true);
      if (summaryCloseTimer.current) clearTimeout(summaryCloseTimer.current);
      if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
      summaryCloseTimer.current = setTimeout(() => {
        setSelected(null);
        setSummaryClosing(false);
      }, 560);
      detailCloseTimer.current = setTimeout(() => {
        setDetailOpen(false);
        setDetailClosing(false);
      }, 560);
      return;
    }

    if (summaryCloseTimer.current) clearTimeout(summaryCloseTimer.current);
    setSummaryClosing(false);
    const match = orders.find((order) => order.order_number === orderNumber) ?? null;
    setSelected(match);
    const shouldShowDetail = Boolean(match) && params.get("ficha") === "1";
    if (shouldShowDetail) {
      if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
      setDetailClosing(false);
      setDetailOpen(true);
    } else if (detailOpen) {
      setDetailClosing(true);
      if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
      detailCloseTimer.current = setTimeout(() => {
        setDetailOpen(false);
        setDetailClosing(false);
      }, 560);
    } else {
      setDetailClosing(false);
      setDetailOpen(false);
    }
  }, [orders, detailOpen]);

  const openOrderSummary = (order: ServiceOrder) => {
    const url = new URL(window.location.href);
    url.searchParams.set("orden", String(order.order_number));
    url.searchParams.delete("ficha");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    if (summaryCloseTimer.current) clearTimeout(summaryCloseTimer.current);
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
    setSummaryClosing(false);
    setDetailClosing(false);
    setSelected(order);
    setDetailOpen(false);
  };

  const openFullDetail = () => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("orden", String(selected.order_number));
    url.searchParams.set("ficha", "1");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
    setDetailClosing(false);
    setDetailOpen(true);
  };

  const closeFullDetail = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("ficha");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setDetailClosing(true);
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
    detailCloseTimer.current = setTimeout(() => {
      setDetailOpen(false);
      setDetailClosing(false);
    }, 560);
  };

  const closeOrderDrawers = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("orden");
    url.searchParams.delete("ficha");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setSummaryClosing(true);
    if (detailOpen) setDetailClosing(true);
    if (summaryCloseTimer.current) clearTimeout(summaryCloseTimer.current);
    if (detailCloseTimer.current) clearTimeout(detailCloseTimer.current);
    summaryCloseTimer.current = setTimeout(() => {
      setSelected(null);
      setSummaryClosing(false);
    }, 560);
    if (detailOpen) {
      detailCloseTimer.current = setTimeout(() => {
        setDetailOpen(false);
        setDetailClosing(false);
      }, 560);
    } else {
      setDetailOpen(false);
    }
  };

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
    const client = supabase;
    if (!client) return;
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setRoleReady(true); return; }
      const { data: profile } = await client.from("profiles").select("full_name,role").eq("id", data.user.id).maybeSingle();
      if (profile?.full_name) setUserLabel(profile.full_name);
      if (profile?.role) setRole(profile.role);
      setRoleReady(true);
    });
  }, [loadOrders]);

  useEffect(() => {
    if (loading) return;
    syncDrawerFromUrl();
    window.addEventListener("popstate", syncDrawerFromUrl);
    return () => window.removeEventListener("popstate", syncDrawerFromUrl);
  }, [loading, syncDrawerFromUrl]);

  useEffect(() => {
    if (!selected) {
      setDrawerEvents([]);
      setDrawerError("");
      return;
    }

    let cancelled = false;
    setDrawerLoading(true);
    setDrawerError("");
    Promise.all([
      getOrderWorkflow(selected.id),
      supabase
        ? supabase.from("service_orders").select("status").eq("id", selected.id).maybeSingle()
        : Promise.resolve({ data: null, error: new Error("Supabase no está disponible.") }),
    ]).then(([workflow, currentOrder]) => {
      if (cancelled) return;
      if (currentOrder.error) throw currentOrder.error;
      const currentStatus = currentOrder.data?.status;
      if (currentStatus) {
        setSelected((current) => current?.id === selected.id
          ? { ...current, status: currentStatus }
          : current);
      }
      setDrawerEvents(workflow.events.slice(0, 5));
    }).catch((err) => {
      if (!cancelled) setDrawerError(err instanceof Error ? err.message : "No se pudo cargar la trazabilidad.");
    }).finally(() => {
      if (!cancelled) setDrawerLoading(false);
    });

    return () => { cancelled = true; };
  }, [selected?.id]);

  const formatEventDate = (value: string) => new Intl.DateTimeFormat("es-CL", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));

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
        <div className="sidebar-navigation">
            <div className="navlabel">Espacio de trabajo</div>
            {nav.filter(item => roleReady && (role === "admin" || (role === "supervisor" && !item.admin) || (role === "tecnico" && item.href === "/ordenes"))).map(({ label, icon: Icon, href }) => {
              const isActive = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
              return <Link key={label} href={href} className={"navitem navlink " + (isActive ? "active" : "")}><Icon size={17} />{label}</Link>;
            })}
        </div>
        <div className="sidebar-user">
          <div className="navlabel">Sesión activa</div>
          <div className="navitem"><span className="avatar">{userLabel.slice(0, 1).toUpperCase()}</span><span>{userLabel}</span></div>
          <button className="navitem navbutton" onClick={() => void supabase?.auth.signOut().then(() => window.location.assign("/login"))}>↪ Cerrar sesión</button>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Navegación principal">
        {nav.filter(item => roleReady && (role === "admin" || (role === "supervisor" && !item.admin) || (role === "tecnico" && item.href === "/ordenes"))).map(({ label, icon: Icon, href }) => {
          const isActive = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
          return <Link key={label} href={href} className={`mobile-nav-item ${isActive ? "active" : ""}`} aria-current={isActive ? "page" : undefined}>
            <Icon size={19}/><span>{label === "Órdenes de servicio" ? "Órdenes" : label === "Usuarios y técnicos" ? "Usuarios" : label}</span>
          </Link>;
        })}
        <button className="mobile-nav-item mobile-nav-logout" type="button" onClick={() => void supabase?.auth.signOut().then(() => window.location.assign("/login"))}>
          <span aria-hidden="true">↪</span><span>Salir</span>
        </button>
      </nav>
      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">FERPROMAQ / OPERACIONES</div><h1 className="heading">{isOrdersPage ? "Órdenes de servicio" : "Panel de servicio técnico"}</h1></div>
          <div className="user-chip"><div><strong>{userLabel}</strong><div className="eyebrow">Servicio técnico</div></div><div className="avatar">{userLabel.slice(0, 1).toUpperCase()}</div></div>
        </header>

        {!isOrdersPage && <section className="stats">
          {[
            ["Órdenes activas", activeCount, "En curso"],
            ["En diagnóstico", count("diagnostico"), "Pendientes de evaluación"],
            ["En reparación", count("en_reparacion"), "Trabajo técnico"],
            ["Listas para entrega", count("listas"), "Esperando al cliente"],
          ].map(([label, value, foot]) => (
            <div className="card stat-card" key={String(label)}><div className="statlabel">{label}</div><div className="statvalue">{loading ? "—" : value}</div><div className="statfoot">{foot}</div></div>
          ))}
        </section>}

        <section className="card orders-card" id="ordenes">
          <div className="section-head">
            <div><h2>Órdenes de servicio</h2><p>Seguimiento de equipos y trabajos en taller</p></div>
            <div className="section-actions">{(role==="admin"||role==="supervisor")&&<button type="button" className="primary new-order-button" onClick={() => setShowNewOrder(true)}>＋ Nueva orden</button>}<button className="secondary" onClick={() => void loadOrders()} disabled={loading}><RefreshCw size={15} /> Actualizar</button></div>
          </div>
          <div className="toolbar">
            <div className="tabs">{ORDER_STATUSES.map((tab) => <button key={tab.value} onClick={() => setActive(tab.value)} className={`tab ${active === tab.value ? "active" : ""}`}>{tab.label}{tab.value === "todas" ? <span className="tab-count">{orders.length}</span> : <span className="tab-count">{count(tab.value)}</span>}</button>)}</div>
            <label className="search-wrap"><Search size={16}/><input className="search" placeholder="Buscar orden, cliente o equipo…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>

          {error && <div className="notice error"><AlertCircle size={17}/><div><strong>No se pudieron cargar las órdenes</strong><p>{error}</p><button onClick={() => void loadOrders()}>Reintentar</button></div></div>}
          <div className="tablewrap"><table className="orders"><thead><tr><th>Orden</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Prioridad</th><th>Ingreso</th></tr></thead>
            <tbody>{filtered.map((order) => <tr key={order.id} onClick={() => openOrderSummary(order)}>
              <td className="orderid">#{order.order_number}</td>
              <td><div className="client">{order.clients?.name ?? "Cliente sin nombre"}</div><div className="subline">{order.clients?.rut ?? "—"}</div></td>
              <td><div>{[order.machines?.brand, order.machines?.model].filter(Boolean).join(" ") || order.machines?.equipment_type || "Equipo no especificado"}</div><div className="subline">{order.machines?.serial_number ?? ""}</div></td>
              <td><span className={orderStatusClass(order.status)}>{orderStatusLabel(order.status)}</span></td>
              <td><span className={orderPriorityClass(order.priority)}>{orderPriorityLabel(order.priority)}</span></td>
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

      {showNewOrder && <NewOrderModal onClose={() => setShowNewOrder(false)} onCreated={() => { setShowNewOrder(false); void loadOrders(); }} />}

      {selected && <div className={`drawerback ${summaryClosing ? "is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrderDrawers(); }}>
        <aside className="drawer compact-drawer">
          <div className="drawerhead drawer-order-head">
            <div><div className="drawer-kicker">FERPROMAQ <span>·</span> ORDEN DE SERVICIO</div><h2>#{selected.order_number}</h2></div>
            <button className="close" onClick={closeOrderDrawers} aria-label="Cerrar detalle">×</button>
          </div>

          <div className="drawer-status-strip" aria-label="Estado y prioridad de la orden">
            <div className="drawer-status-item">
              <span className="drawer-meta-label">Estado actual</span>
              <span className={orderStatusClass(selected.status)}>{orderStatusLabel(selected.status)}</span>
            </div>
            <span className="drawer-status-divider" aria-hidden="true" />
            <div className="drawer-status-item">
              <span className="drawer-meta-label">Prioridad</span>
              <span className={orderPriorityClass(selected.priority)}>{orderPriorityLabel(selected.priority)}</span>
            </div>
          </div>

          <div className="drawer-info-grid">
            <section className="drawer-info-card">
              <div className="drawer-info-heading"><UserRound size={15}/><span>Cliente</span></div>
              <strong>{selected.clients?.name ?? "Sin información"}</strong>
              <small>{selected.clients?.rut ? `RUT ${selected.clients.rut}` : "RUT no registrado"}</small>
            </section>
            <section className="drawer-info-card">
              <div className="drawer-info-heading"><Wrench size={15}/><span>Equipo</span></div>
              <strong>{[selected.machines?.brand, selected.machines?.model].filter(Boolean).join(" ") || selected.machines?.equipment_type || "Sin información"}</strong>
              <small>Serie: {selected.machines?.serial_number ?? "No registrada"}</small>
            </section>
          </div>

          <section className="drawer-problem">
            <div className="drawer-info-heading"><ClipboardList size={15}/><span>Problema informado</span></div>
            <p>{selected.problem_description || "Sin descripción registrada."}</p>
          </section>

          <div className="drawer-order-meta">
            <span><CalendarDays size={14}/><span>Ingreso <strong>{formatOrderDate(selected.received_at)}</strong></span></span>
            <span><UserRound size={14}/><span>Técnico <strong>{selected.assigned?.full_name ?? "Sin asignar"}</strong></span></span>
          </div>

          <div className="drawer-trace">
            <div className="drawer-trace-head">
              <h3 className="sectiontitle">Historial de actividad</h3>
              <span className="drawer-trace-count">{drawerEvents.length ? `${drawerEvents.length} recientes` : "Actividad"}</span>
            </div>
            {drawerLoading ? <p className="muted drawer-trace-message">Cargando movimientos…</p>
              : drawerError ? <p className="muted drawer-trace-message">{drawerError}</p>
              : drawerEvents.length === 0 ? <p className="muted drawer-trace-message">Solo se registra el ingreso inicial. Aún no hay movimientos posteriores.</p>
              : <div className="timeline drawer-timeline">
                {drawerEvents.map((event) => (
                  <div className="event" key={event.id}>
                    <strong>{event.description}</strong>
                    <small>{formatEventDate(event.created_at)}{event.actor?.full_name ? ` · ${event.actor.full_name}` : ""}</small>
                  </div>
                ))}
              </div>}
          </div>
          <button type="button" className="primary full-detail-link" onClick={openFullDetail}>Abrir ficha completa <span aria-hidden="true">→</span></button>
        </aside>
      </div>}

      {selected && detailOpen && <div className={`detail-drawer-layer ${detailClosing ? "is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeFullDetail(); }}>
        <aside className="detail-drawer-panel" role="dialog" aria-modal="true" aria-label={`Ficha completa de la orden ${selected.order_number}`}>
          <OrderDetailPage orderNumber={String(selected.order_number)} embedded onClose={closeFullDetail} />
        </aside>
      </div>}
    </div>
  );
}
