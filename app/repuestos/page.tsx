"use client";
import "./repuestos.css";
import { useCallback,useEffect,useMemo,useState } from "react";
import Link from "next/link";
import { ModuleShell } from "@/components/layout/module-shell";
import { supabase } from "@/lib/supabase";

type CatalogPart={id:string;name:string;internal_code:string|null;brand:string|null;model:string|null;description:string|null;sale_price:number|null;active:boolean;created_at:string};
type PartRequest={id:string;order_id:string;description:string;quantity:number;unit_price:number;status:string;warranty_covered:boolean;created_at:string;service_orders?:{order_number:number;clients?:{name:string}|null}|null};
type Acquisition={id:string;catalog_part_id:string|null;origin:string;cost_responsibility:string;purchase_cost:number|null;notes:string|null;recorded_at:string;recorded_by:string};
type Form={name:string;internal_code:string;brand:string;model:string;description:string;sale_price:string;active:boolean};
const empty:Form={name:"",internal_code:"",brand:"",model:"",description:"",sale_price:"",active:true};
const statuses:Record<string,string>={pendiente:"Pendiente",autorizado:"Autorizado",rechazado:"Rechazado",comprado:"Comprado"};
const origins:Record<string,string>={compra_reparacion:"Compra para reparación",propiedad_ferpromaq:"Propiedad de Ferpromaq",garantia_proveedor:"Garantía del proveedor",aportado_cliente:"Aportado por cliente",otro:"Otro"};
const costs:Record<string,string>={ferpromaq:"Ferpromaq",cliente:"Cliente",proveedor:"Proveedor",otro:"Otro"};
const money=(n:number)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);

export default function PartsPage(){
 const [tab,setTab]=useState<"catalogo"|"solicitudes">("catalogo");
 const [catalog,setCatalog]=useState<CatalogPart[]>([]),[requests,setRequests]=useState<PartRequest[]>([]);
 const [history,setHistory]=useState<Acquisition[]>([]),[names,setNames]=useState<Record<string,string>>({});
 const [role,setRole]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("todas");
 const [form,setForm]=useState<Form>(empty),[editing,setEditing]=useState<string|null>(null);
 const [historyPart,setHistoryPart]=useState<string|null>(null);
 const [origin,setOrigin]=useState("propiedad_ferpromaq"),[responsible,setResponsible]=useState("ferpromaq"),[cost,setCost]=useState(""),[notes,setNotes]=useState("");
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");

 const load=useCallback(async()=>{
  if(!supabase){setError("Configura Supabase.");setLoading(false);return;}
  setLoading(true);setError("");
  const [c,r,h,s]=await Promise.all([
   supabase.from("parts_catalog").select("id,name,internal_code,brand,model,description,sale_price,active,created_at").order("name"),
   supabase.from("parts_requests").select("id,order_id,description,quantity,unit_price,status,warranty_covered,created_at,service_orders(order_number,clients(name))").order("created_at",{ascending:false}),
   supabase.from("part_acquisition_records").select("id,catalog_part_id,origin,cost_responsibility,purchase_cost,notes,recorded_at,recorded_by").order("recorded_at",{ascending:false}),
   supabase.auth.getSession()
  ]);
  if(c.error)setError("No se pudo cargar el catálogo. Ejecuta primero la migración 0020 en Supabase.");else setCatalog((c.data??[]) as CatalogPart[]);
  if(r.error)setError((v)=>v||r.error.message);else setRequests((r.data??[]) as unknown as PartRequest[]);
  if(!h.error){const rows=(h.data??[]) as Acquisition[];setHistory(rows);const ids=[...new Set(rows.map(x=>x.recorded_by).filter(Boolean))];if(ids.length){const {data}=await supabase.from("profiles").select("id,full_name").in("id",ids);setNames(Object.fromEntries((data??[]).map(x=>[x.id,x.full_name])));}}
  const uid=s.data.session?.user.id;if(uid){const {data}=await supabase.from("profiles").select("role").eq("id",uid).maybeSingle();setRole(data?.role??"");}
  setLoading(false);
 },[]);
 useEffect(()=>{void load()},[load]);
 const filteredCatalog=useMemo(()=>catalog.filter(p=>[p.name,p.internal_code,p.brand,p.model,p.description].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())),[catalog,query]);
 const filteredRequests=useMemo(()=>requests.filter(p=>(status==="todas"||p.status===status)&&[p.description,p.service_orders?.clients?.name,String(p.service_orders?.order_number??"")].join(" ").toLowerCase().includes(query.toLowerCase())),[requests,status,query]);
 const canEdit=role==="admin"||role==="supervisor",canCost=role==="admin";
 const selected=catalog.find(p=>p.id===historyPart),selectedHistory=history.filter(h=>h.catalog_part_id===historyPart);
 function edit(p:CatalogPart){setEditing(p.id);setForm({name:p.name,internal_code:p.internal_code??"",brand:p.brand??"",model:p.model??"",description:p.description??"",sale_price:p.sale_price==null?"":String(p.sale_price),active:p.active});}
 function reset(){setEditing(null);setForm(empty);}
 async function savePart(){
  if(!supabase||!form.name.trim())return setError("El nombre del repuesto es obligatorio.");
  const price=form.sale_price.trim()?Number(form.sale_price):null;if(price!==null&&(!Number.isFinite(price)||price<0))return setError("Precio de venta no válido.");
  setSaving(true);setError("");setNotice("");
  try{const args={p_name:form.name,p_internal_code:form.internal_code||null,p_brand:form.brand||null,p_model:form.model||null,p_description:form.description||null,p_sale_price:price};
   const result=editing?await supabase.rpc("update_catalog_part",{p_part_id:editing,...args,p_active:form.active}):await supabase.rpc("create_catalog_part",args);
   if(result.error)throw result.error;setNotice(editing?"Repuesto actualizado.":"Repuesto agregado al catálogo.");reset();await load();
  }catch(e){setError(e instanceof Error?e.message:"No se pudo guardar.");}finally{setSaving(false);}
 }
 async function saveHistory(){
  if(!supabase||!historyPart)return;const amount=cost.trim()?Number(cost):null;if(amount!==null&&(!Number.isFinite(amount)||amount<0))return setError("Costo de compra no válido.");
  setSaving(true);setError("");setNotice("");
  try{const {error}=await supabase.rpc("record_part_acquisition",{p_catalog_part_id:historyPart,p_part_request_id:null,p_origin:origin,p_cost_responsibility:responsible,p_purchase_cost:amount,p_notes:notes||null});if(error)throw error;setNotice("Procedencia y costo registrados.");setCost("");setNotes("");await load();}
  catch(e){setError(e instanceof Error?e.message:"No se pudo registrar.");}finally{setSaving(false);}
 }
 return <ModuleShell title="Repuestos" description="Catálogo de Ferpromaq, solicitudes y trazabilidad">
  <section className="card module-list parts-module">
   <div className="parts-module-head"><div><h2>Gestión de repuestos</h2><p>Repuestos de la empresa y solicitudes asociadas a órdenes de servicio.</p></div>
    <div className="parts-module-tabs"><button className={tab==="catalogo"?"active":""} onClick={()=>{setTab("catalogo");setQuery("");}}>Catálogo de Ferpromaq</button><button className={tab==="solicitudes"?"active":""} onClick={()=>{setTab("solicitudes");setQuery("");}}>Solicitudes</button></div>
   </div>
   {error&&<div className="notice error">{error}</div>}{notice&&<div className="notice success">{notice}</div>}
   <div className="parts-module-toolbar"><span>{tab==="catalogo"?catalog.length+" repuestos registrados":requests.length+" solicitudes"}</span><input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==="catalogo"?"Buscar nombre, código, marca o modelo…":"Buscar repuesto, cliente u orden…"}/></div>
   {tab==="catalogo"&&<>
    {canEdit&&<div className="catalog-editor"><div className="catalog-editor-head"><div><h3>{editing?"Editar repuesto":"Agregar repuesto de la empresa"}</h3><p>Este catálogo permite reutilizar los repuestos en distintas órdenes. No administra existencias ni descuenta inventario.</p></div>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div>
     <div className="catalog-fields">
      <label>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ej. Rodamiento 6203"/></label>
      <label>Código interno<input value={form.internal_code} onChange={e=>setForm({...form,internal_code:e.target.value})} placeholder="Código / SKU"/></label>
      <label>Marca<input value={form.brand} onChange={e=>setForm({...form,brand:e.target.value})} placeholder="Marca"/></label>
      <label>Modelo<input value={form.model} onChange={e=>setForm({...form,model:e.target.value})} placeholder="Modelo compatible"/></label>
      <label>Precio de venta (CLP)<input type="number" min="0" value={form.sale_price} onChange={e=>setForm({...form,sale_price:e.target.value})} placeholder="Opcional"/></label>
      <label>Descripción<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Detalle / compatibilidad"/></label>
      {editing&&<label className="catalog-active"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Repuesto activo</label>}
     </div><div className="catalog-save"><button className="primary" disabled={saving||!form.name.trim()} onClick={()=>void savePart()}>{saving?"Guardando…":editing?"Guardar cambios":"Agregar al catálogo"}</button></div>
    </div>}
    <div className="tablewrap"><table className="orders"><thead><tr><th>Repuesto</th><th>Código</th><th>Marca / modelo</th><th>Precio de venta</th><th>Estado</th><th>Trazabilidad</th>{canEdit&&<th></th>}</tr></thead><tbody>
     {filteredCatalog.map(p=><tr key={p.id}><td><strong>{p.name}</strong>{p.description&&<div className="subline">{p.description}</div>}</td><td>{p.internal_code||"—"}</td><td>{[p.brand,p.model].filter(Boolean).join(" / ")||"—"}</td><td>{p.sale_price==null?"Sin definir":money(Number(p.sale_price))}</td><td><span className={p.active?"pill orange":"pill"}>{p.active?"Activo":"Inactivo"}</span></td><td><button className="secondary" onClick={()=>setHistoryPart(historyPart===p.id?null:p.id)}>Ver historial</button></td>{canEdit&&<td><button className="secondary" onClick={()=>edit(p)}>Editar</button></td>}</tr>)}
    </tbody></table>{!loading&&filteredCatalog.length===0&&<div className="empty">No hay repuestos que coincidan.</div>}</div>
    {selected&&<section className="catalog-history"><div className="catalog-history-head"><div><h3>Trazabilidad: {selected.name}</h3><p>Historial inmutable de procedencia y costos registrados.</p></div><button className="secondary" onClick={()=>setHistoryPart(null)}>Cerrar</button></div>
     {canCost&&<div className="catalog-history-form">
      <label>Procedencia<select value={origin} onChange={e=>setOrigin(e.target.value)}>{Object.entries(origins).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Responsable del costo<select value={responsible} onChange={e=>setResponsible(e.target.value)}>{Object.entries(costs).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Costo de compra (CLP)<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)} placeholder="Opcional"/></label>
      <label>Observación<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Proveedor, factura, corrección…"/></label>
      <button className="primary" disabled={saving} onClick={()=>void saveHistory()}>{saving?"Guardando…":"Registrar procedencia y costo"}</button>
     </div>}
     {selectedHistory.length===0?<div className="empty">Todavía no hay registros de procedencia o costos.</div>:selectedHistory.map(h=><div className="catalog-history-row" key={h.id}><div><strong>{origins[h.origin]??h.origin}</strong><span>{costs[h.cost_responsibility]??h.cost_responsibility}</span>{h.notes&&<p>{h.notes}</p>}</div><div><strong>{h.purchase_cost==null?"Costo no informado":money(Number(h.purchase_cost))}</strong><span>{new Intl.DateTimeFormat("es-CL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(h.recorded_at))}</span><span>{names[h.recorded_by]??"Usuario"}</span></div></div>)}
    </section>}
   </>}
   {tab==="solicitudes"&&<><div className="tabs">{["todas","pendiente","autorizado","comprado","rechazado"].map(s=><button key={s} className={status===s?"tab active":"tab"} onClick={()=>setStatus(s)}>{s==="todas"?"Todas":statuses[s]}</button>)}</div>
    <div className="tablewrap"><table className="orders"><thead><tr><th>Repuesto</th><th>Orden / cliente</th><th>Cantidad</th><th>Valor</th><th>Estado</th><th>Garantía</th><th></th></tr></thead><tbody>{filteredRequests.map(p=><tr key={p.id}><td>{p.description}</td><td>#{p.service_orders?.order_number??"—"}<div className="subline">{p.service_orders?.clients?.name??""}</div></td><td>{p.quantity}</td><td>{money(Number(p.quantity)*Number(p.unit_price))}</td><td><span className="pill orange">{statuses[p.status]??p.status}</span></td><td>{p.warranty_covered?"Cubierto":"No cubierto"}</td><td><Link className="secondary" href={"/ordenes/"+p.order_id}>Ver orden</Link></td></tr>)}</tbody></table>{!loading&&filteredRequests.length===0&&<div className="empty">No hay solicitudes que coincidan.</div>}</div>
   </>}
   {loading&&<div className="empty">Cargando repuestos…</div>}
  </section>
 </ModuleShell>;
}
