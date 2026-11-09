"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ModuleShell } from "@/components/layout/module-shell";
import { supabase } from "@/lib/supabase";

type PartRequest = {
  id: string;
  order_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  status: string;
  warranty_covered: boolean;
  created_at: string;
  service_orders?: { order_number: number; clients?: { name: string } | null } | null;
};

type CatalogPart = {
  id: string;
  name: string;
  description: string | null;
  internal_code: string | null;
  brand: string | null;
  model: string | null;
  sale_price: number | null;
  active: boolean;
  created_at: string;
};

type CostRecord = {
  id: string;
  catalog_part_id: string;
  origin: string;
  cost_responsibility: string;
  purchase_cost: number | null;
  note: string | null;
  supersedes_id: string | null;
  recorded_at: string;
  recorded_by: string | null;
  actor_name?: string;
};

type Role = "admin" | "supervisor" | "tecnico";
type Tab = "catalogo" | "solicitudes";

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  autorizado: "Autorizado",
  rechazado: "Rechazado",
  comprado: "Comprado",
};

const originLabels: Record<string, string> = {
  compra_reparacion: "Comprado para reparación",
  existente_ferpromaq: "Ya pertenecía a Ferpromaq",
  garantia_proveedor: "Garantía del proveedor",
  aportado_cliente: "Aportado por el cliente",
  otro: "Otro origen",
};

const responsibilityLabels: Record<string, string> = {
  ferpromaq: "Ferpromaq",
  cliente: "Cliente",
  proveedor: "Proveedor",
  otro: "Otro",
};

const money = (value: number | null | undefined) =>
  value == null
    ? "Sin registrar"
    : new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0,
      }).format(Number(value));

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const emptyPart = {
  name: "",
  description: "",
  internalCode: "",
  brand: "",
  model: "",
  salePrice: "",
  active: true,
};

export default function PartsPage() {
  const [tab, setTab] = useState<Tab>("catalogo");
  const [parts, setParts] = useState<PartRequest[]>([]);
  const [catalog, setCatalog] = useState<CatalogPart[]>([]);
  const [costs, setCosts] = useState<CostRecord[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todas");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingPart, setEditingPart] = useState<CatalogPart | null>(null);
  const [partFormOpen, setPartFormOpen] = useState(false);
  const [partForm, setPartForm] = useState(emptyPart);
  const [costPart, setCostPart] = useState<CatalogPart | null>(null);
  const [costForm, setCostForm] = useState({
    origin: "compra_reparacion",
    responsibility: "ferpromaq",
    purchaseCost: "",
    note: "",
  });

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Falta configurar la conexión con Supabase.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [requestsResult, catalogResult, costsResult, sessionResult] =
        await Promise.all([
          supabase
            .from("parts_requests")
            .select("id,order_id,description,quantity,unit_price,status,warranty_covered,created_at,service_orders(order_number,clients(name))")
            .order("created_at", { ascending: false }),
          supabase
            .from("parts_catalog")
            .select("id,name,description,internal_code,brand,model,sale_price,active,created_at")
            .order("name", { ascending: true }),
          supabase
            .from("parts_catalog_cost_records")
            .select("id,catalog_part_id,origin,cost_responsibility,purchase_cost,note,supersedes_id,recorded_at,recorded_by")
            .order("recorded_at", { ascending: false }),
          supabase.auth.getSession(),
        ]);

      if (requestsResult.error) throw requestsResult.error;
      if (catalogResult.error) throw catalogResult.error;
      if (costsResult.error) throw costsResult.error;

      const costRows = (costsResult.data ?? []) as CostRecord[];
      const actorIds = [...new Set(costRows.map((row) => row.recorded_by).filter((id): id is string => Boolean(id)))];
      const actorsResult = actorIds.length
        ? await supabase.from("profiles").select("id,full_name").in("id", actorIds)
        : { data: [], error: null };
      if (actorsResult.error) throw actorsResult.error;
      const actorNames = new Map((actorsResult.data ?? []).map((actor) => [actor.id, actor.full_name]));

      setParts((requestsResult.data ?? []) as unknown as PartRequest[]);
      setCatalog((catalogResult.data ?? []) as CatalogPart[]);
      setCosts(costRows.map((row) => ({
        ...row,
        actor_name: row.recorded_by ? actorNames.get(row.recorded_by) ?? "Usuario" : "No disponible",
      })));
      const user = sessionResult.data.session?.user;
      if (user) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        setRole((profile?.role as Role) ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los repuestos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRequests = useMemo(
    () => parts.filter((part) =>
      (status === "todas" || part.status === status) &&
      [part.description, part.service_orders?.clients?.name, String(part.service_orders?.order_number ?? "")]
        .join(" ").toLowerCase().includes(query.toLowerCase())
    ),
    [parts, status, query],
  );

  const filteredCatalog = useMemo(
    () => catalog.filter((part) =>
      [part.name, part.description, part.internal_code, part.brand, part.model]
        .join(" ").toLowerCase().includes(query.toLowerCase())
    ),
    [catalog, query],
  );

  const latestCost = (partId: string) => costs.find((record) => record.catalog_part_id === partId);
  const canManageCatalog = role === "admin" || role === "supervisor";

  function startCreate() {
    setEditingPart(null);
    setPartFormOpen(true);
    setPartForm(emptyPart);
    setNotice("");
  }

  function startEdit(part: CatalogPart) {
    setEditingPart(part);
    setPartFormOpen(true);
    setPartForm({
      name: part.name,
      description: part.description ?? "",
      internalCode: part.internal_code ?? "",
      brand: part.brand ?? "",
      model: part.model ?? "",
      salePrice: part.sale_price == null ? "" : String(part.sale_price),
      active: part.active,
    });
    setNotice("");
  }

  async function saveCatalogPart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc("save_parts_catalog_item", {
        p_id: editingPart?.id ?? null,
        p_name: partForm.name,
        p_description: partForm.description || null,
        p_internal_code: partForm.internalCode || null,
        p_brand: partForm.brand || null,
        p_model: partForm.model || null,
        p_sale_price: partForm.salePrice === "" ? null : Number(partForm.salePrice),
        p_active: partForm.active,
      });
      if (saveError) throw saveError;
      setNotice(editingPart ? "Repuesto actualizado." : "Repuesto agregado al catálogo.");
      setEditingPart(null);
      setPartFormOpen(false);
      setPartForm(emptyPart);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el repuesto.");
    } finally {
      setSaving(false);
    }
  }

  function startCost(part: CatalogPart) {
    const previous = latestCost(part.id);
    setCostPart(part);
    setCostForm({
      origin: previous?.origin ?? "compra_reparacion",
      responsibility: previous?.cost_responsibility ?? "ferpromaq",
      purchaseCost: previous?.purchase_cost == null ? "" : String(previous.purchase_cost),
      note: "",
    });
    setNotice("");
  }

  async function saveCost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !costPart) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const previous = latestCost(costPart.id);
      const { error: saveError } = await supabase.rpc("record_parts_catalog_cost", {
        p_catalog_part_id: costPart.id,
        p_origin: costForm.origin,
        p_cost_responsibility: costForm.responsibility,
        p_purchase_cost: costForm.purchaseCost === "" ? null : Number(costForm.purchaseCost),
        p_note: costForm.note || null,
        p_supersedes_id: previous?.id ?? null,
      });
      if (saveError) throw saveError;
      setNotice("Registro de procedencia y costo guardado en el historial.");
      setCostPart(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el costo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleShell title="Repuestos" description="Catálogo, solicitudes y trazabilidad">
      <section className="card module-list">
        <div className="section-head">
          <div>
            <h2>Gestión de repuestos</h2>
            <p>{tab === "catalogo" ? `${catalog.length} repuestos en catálogo` : `${parts.length} solicitudes de órdenes`}</p>
          </div>
          <input
            className="search"
            placeholder={tab === "catalogo" ? "Buscar por nombre, código o marca…" : "Buscar repuesto, cliente u orden…"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="tabs">
          <button className={tab === "catalogo" ? "tab active" : "tab"} onClick={() => { setTab("catalogo"); setQuery(""); }}>Catálogo</button>
          <button className={tab === "solicitudes" ? "tab active" : "tab"} onClick={() => { setTab("solicitudes"); setQuery(""); }}>Solicitudes de órdenes</button>
        </div>

        {error && <div className="notice error">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}

        {tab === "catalogo" && (
          <>
            {canManageCatalog && !editingPart && !costPart && (
              <div className="section-head">
                <span className="muted">Los repuestos del catálogo pueden existir sin estar asociados a una orden.</span>
                <button className="primary" type="button" onClick={startCreate}>Agregar repuesto</button>
              </div>
            )}

            {canManageCatalog && partFormOpen && (
              <form className="card" onSubmit={saveCatalogPart}>
                <h3>{editingPart ? "Editar repuesto" : "Nuevo repuesto"}</h3>
                <div className="detail-columns">
                  <div className="field">
                    <label>Nombre *</label>
                    <input required value={partForm.name} onChange={(e) => setPartForm((v) => ({ ...v, name: e.target.value }))} placeholder="Ej. Rodamiento 6203" />
                  </div>
                  <div className="field">
                    <label>Código interno</label>
                    <input value={partForm.internalCode} onChange={(e) => setPartForm((v) => ({ ...v, internalCode: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Marca</label>
                    <input value={partForm.brand} onChange={(e) => setPartForm((v) => ({ ...v, brand: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Modelo / medida</label>
                    <input value={partForm.model} onChange={(e) => setPartForm((v) => ({ ...v, model: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Precio de venta (CLP, opcional)</label>
                    <input type="number" min="0" step="1" value={partForm.salePrice} onChange={(e) => setPartForm((v) => ({ ...v, salePrice: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Descripción</label>
                    <input value={partForm.description} onChange={(e) => setPartForm((v) => ({ ...v, description: e.target.value }))} />
                  </div>
                </div>
                {editingPart && (
                  <label className="checkline">
                    <input type="checkbox" checked={partForm.active} onChange={(e) => setPartForm((v) => ({ ...v, active: e.target.checked }))} />
                    Repuesto activo
                  </label>
                )}
                <div className="parts-draft-footer">
                  <button className="primary" type="submit" disabled={saving || !partForm.name.trim()}>{saving ? "Guardando…" : editingPart ? "Guardar cambios" : "Crear repuesto"}</button>
                  <button className="secondary" type="button" onClick={() => { setEditingPart(null); setPartFormOpen(false); setPartForm(emptyPart); }}>Cancelar</button>
                </div>
              </form>
            )}

            {costPart && role === "admin" && (
              <form className="card" onSubmit={saveCost}>
                <h3>Registrar procedencia y costo: {costPart.name}</h3>
                <p className="muted">Cada registro queda fechado y asociado al administrador que lo guardó. Una corrección agrega una nueva entrada; no borra el historial.</p>
                <div className="detail-columns">
                  <div className="field">
                    <label>Procedencia</label>
                    <select value={costForm.origin} onChange={(e) => setCostForm((v) => ({ ...v, origin: e.target.value }))}>
                      {Object.entries(originLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>¿Quién asume el costo?</label>
                    <select value={costForm.responsibility} onChange={(e) => setCostForm((v) => ({ ...v, responsibility: e.target.value }))}>
                      {Object.entries(responsibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Costo de compra (CLP, opcional)</label>
                    <input type="number" min="0" step="1" value={costForm.purchaseCost} onChange={(e) => setCostForm((v) => ({ ...v, purchaseCost: e.target.value }))} placeholder="Dejar vacío si no se conoce" />
                  </div>
                  <div className="field">
                    <label>Nota / referencia</label>
                    <input value={costForm.note} onChange={(e) => setCostForm((v) => ({ ...v, note: e.target.value }))} placeholder="Factura, garantía, corrección…" />
                  </div>
                </div>
                <div className="parts-draft-footer">
                  <button className="primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar registro de costo"}</button>
                  <button className="secondary" type="button" onClick={() => setCostPart(null)}>Cancelar</button>
                </div>
              </form>
            )}

            <div className="tablewrap">
              <table className="orders">
                <thead><tr><th>Repuesto</th><th>Código / marca</th><th>Precio venta</th><th>Último costo</th><th>Procedencia</th><th>Responsable</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {filteredCatalog.map((part) => {
                    const latest = latestCost(part.id);
                    return (
                      <tr key={part.id}>
                        <td><strong>{part.name}</strong>{part.description && <div className="subline">{part.description}</div>}{part.model && <div className="subline">{part.model}</div>}</td>
                        <td>{part.internal_code ?? "—"}<div className="subline">{part.brand ?? "Sin marca"}</div></td>
                        <td>{money(part.sale_price)}</td>
                        <td>{money(latest?.purchase_cost)}</td>
                        <td>{latest ? originLabels[latest.origin] ?? latest.origin : "Sin registrar"}</td>
                        <td>{latest ? responsibilityLabels[latest.cost_responsibility] ?? latest.cost_responsibility : "—"}</td>
                        <td><span className={part.active ? "pill green" : "pill neutral"}>{part.active ? "Activo" : "Inactivo"}</span></td>
                        <td>
                          <div className="row-actions">
                            {canManageCatalog && <button className="secondary" type="button" onClick={() => startEdit(part)}>Editar</button>}
                            {role === "admin" && <button className="secondary" type="button" onClick={() => startCost(part)}>Costo / historial</button>}
                          </div>
                          <details className="part-cost-history">
                            <summary>Ver trazabilidad</summary>
                            {costs.filter((record) => record.catalog_part_id === part.id).length === 0
                              ? <p className="muted">Sin registros de procedencia o costo.</p>
                              : costs.filter((record) => record.catalog_part_id === part.id).map((record) => (
                                <div className="subline" key={record.id}>
                                  {dateTime(record.recorded_at)} · {record.actor_name} · {originLabels[record.origin] ?? record.origin} · {responsibilityLabels[record.cost_responsibility] ?? record.cost_responsibility} · {money(record.purchase_cost)}
                                  {record.note ? <div>{record.note}</div> : null}
                                </div>
                              ))}
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {loading && <div className="empty">Cargando…</div>}
              {!loading && filteredCatalog.length === 0 && <div className="empty">No hay repuestos en el catálogo.</div>}
            </div>
          </>
        )}

        {tab === "solicitudes" && (
          <>
            <div className="tabs">
              {["todas", "pendiente", "autorizado", "comprado", "rechazado"].map((value) => (
                <button key={value} className={status === value ? "tab active" : "tab"} onClick={() => setStatus(value)}>
                  {value === "todas" ? "Todas" : statusLabels[value]}
                </button>
              ))}
            </div>
            <div className="tablewrap">
              <table className="orders">
                <thead><tr><th>Repuesto</th><th>Orden / cliente</th><th>Cantidad</th><th>Valor</th><th>Estado</th><th>Garantía</th><th></th></tr></thead>
                <tbody>
                  {filteredRequests.map((part) => (
                    <tr key={part.id}>
                      <td>{part.description}</td>
                      <td>#{part.service_orders?.order_number ?? "—"}<div className="subline">{part.service_orders?.clients?.name ?? ""}</div></td>
                      <td>{part.quantity}</td>
                      <td>{money(part.quantity * part.unit_price)}</td>
                      <td><span className="pill orange">{statusLabels[part.status] ?? part.status}</span></td>
                      <td>{part.warranty_covered ? "Cubierto" : "No cubierto"}</td>
                      <td><Link className="secondary" href={"/ordenes/" + part.order_id}>Ver orden</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && <div className="empty">Cargando…</div>}
              {!loading && filteredRequests.length === 0 && <div className="empty">No hay solicitudes que coincidan.</div>}
            </div>
          </>
        )}
      </section>
    </ModuleShell>
  );
}
