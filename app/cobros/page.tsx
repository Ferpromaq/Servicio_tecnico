"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/layout/module-shell";
import { supabase } from "@/lib/supabase";

type Charge = {
  id:string; order_id:string; brand_name:string; service_type:"diagnostico"|"puesta_en_marcha";
  service_date:string; amount:number; status:string; reference:string|null; notes:string|null;
  service_orders?:{order_number:number; clients?:{name:string}|null}|null;
};
type Payment={id:string;charge_id:string;amount:number;paid_at:string;method:string|null;reference:string|null};
const money=(n:number)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);
const statusLabel:Record<string,string>={por_preparar:"Por preparar",enviado:"Enviado a marca",aceptado:"Aceptado",rechazado:"Rechazado",pagado:"Pagado"};
export default function CobrosPage(){
 const [rows,setRows]=useState<Charge[]>([]),[payments,setPayments]=useState<Payment[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [orderId,setOrderId]=useState(""),[brand,setBrand]=useState(""),[service,setService]=useState<"diagnostico"|"puesta_en_marcha">("diagnostico"),[amount,setAmount]=useState(""),[notes,setNotes]=useState("");
 const [selected,setSelected]=useState(""),[paymentAmount,setPaymentAmount]=useState(""),[method,setMethod]=useState("Transferencia"),[reference,setReference]=useState("");
 const [orders,setOrders]=useState<{id:string;order_number:number;machines:{brand:string|null}|null}[]>([]);
 const load=useCallback(async()=>{
  if(!supabase)return;setLoading(true);setError("");
  const [c,p,o]=await Promise.all([
   supabase.from("brand_charges").select("id,order_id,brand_name,service_type,service_date,amount,status,reference,notes,service_orders(order_number,clients(name))").order("created_at",{ascending:false}),
   supabase.from("brand_charge_payments").select("id,charge_id,amount,paid_at,method,reference").order("paid_at",{ascending:false}),
   supabase.from("service_orders").select("id,order_number,machines(brand)").order("received_at",{ascending:false})
  ]);
  if(c.error||p.error||o.error){setError(c.error?.message||p.error?.message||o.error?.message||"No se pudo cargar");}
  else {setRows((c.data??[]) as unknown as Charge[]);setPayments(p.data??[]);setOrders((o.data??[]) as unknown as typeof orders);}
  setLoading(false);
 },[]);
 useEffect(()=>{void load()},[load]);
 const totals=useMemo(()=>rows.reduce((a,r)=>{const paid=payments.filter(p=>p.charge_id===r.id).reduce((s,p)=>s+Number(p.amount),0);a.amount+=Number(r.amount);a.paid+=paid;a.balance+=Math.max(0,Number(r.amount)-paid);return a},{amount:0,paid:0,balance:0}),[rows,payments]);
 async function createCharge(e:React.FormEvent){e.preventDefault();if(!supabase)return;setError("");setNotice("");
  const order=orders.find(o=>o.id===orderId);if(!order){setError("Selecciona una orden válida.");return;}
  const {data:userData}=await supabase.auth.getUser();
  const {data,error}=await supabase.from("brand_charges").insert({order_id:orderId,brand_name:brand.trim()||order.machines?.brand||"Marca no especificada",service_type:service,amount:Number(amount),notes:notes.trim()||null,created_by:userData.user?.id}).select("id").single();
  if(error){setError(error.message);return;}
  await supabase.from("brand_charge_events").insert({charge_id:data.id,event_type:"creado",description:"Cobro creado manualmente para la marca",metadata:{amount:Number(amount),service_type:service}});
  setOrderId("");setBrand("");setAmount("");setNotes("");setNotice("Cobro creado.");await load();
 }
 async function updateStatus(id:string,status:string){if(!supabase)return;const {error}=await supabase.rpc("set_brand_charge_status",{p_charge_id:id,p_status:status});if(error)setError(error.message);else{setNotice("Estado actualizado.");await load();}}
 async function registerPayment(e:React.FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.rpc("register_brand_charge_payment",{p_charge_id:selected,p_amount:Number(paymentAmount),p_method:method,p_reference:reference,p_notes:null});if(error)setError(error.message);else{setNotice("Pago de marca registrado.");setSelected("");setPaymentAmount("");setReference("");await load();}}
 const balance=(r:Charge)=>Number(r.amount)-payments.filter(p=>p.charge_id===r.id).reduce((s,p)=>s+Number(p.amount),0);
 return <ModuleShell title="Cobros" description="Cuentas por cobrar a marcas por diagnósticos y puestas en marcha">
  <div className="stats">
   <div className="card stat-card"><div className="statlabel">Cobros generados</div><div className="statvalue">{rows.length}</div></div>
   <div className="card stat-card"><div className="statlabel">Total por cobrar</div><div className="statvalue">{money(totals.balance)}</div></div>
   <div className="card stat-card"><div className="statlabel">Recibido de marcas</div><div className="statvalue">{money(totals.paid)}</div></div>
  </div>
  {error&&<div className="notice error">{error}</div>}{notice&&<div className="notice">{notice}</div>}
  <section className="card module-list">
   <div className="section-head"><div><h2>Nuevo cobro a marca</h2><p>El monto se define manualmente para cada orden y queda guardado como valor histórico.</p></div></div>
   <form className="form-grid" onSubmit={createCharge}>
    <label className="field"><span>Orden de servicio *</span><select required value={orderId} onChange={e=>{setOrderId(e.target.value);const o=orders.find(x=>x.id===e.target.value);if(o?.machines?.brand)setBrand(o.machines.brand);}}><option value="">Seleccionar orden</option>{orders.map(o=><option key={o.id} value={o.id}>#{o.order_number} · {o.machines?.brand??"Marca sin definir"}</option>)}</select></label>
    <label className="field"><span>Marca *</span><input required value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Marca responsable"/></label>
    <label className="field"><span>Servicio *</span><select value={service} onChange={e=>setService(e.target.value as typeof service)}><option value="diagnostico">Diagnóstico por garantía</option><option value="puesta_en_marcha">Puesta en Marcha (equipo nuevo)</option></select></label>
    <label className="field"><span>Monto a cobrar (CLP) *</span><input required type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Monto acordado"/></label>
    <label className="field full"><span>Observaciones</span><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Referencia, acuerdo o detalle"/></label>
    <div className="form-actions"><button className="primary" type="submit" disabled={!orderId||!brand.trim()||Number(amount)<=0}>Crear cobro</button></div>
   </form>
  </section>
  <section className="card module-list"><div className="section-head"><div><h2>Historial de cobros</h2><p>Los pagos recibidos de marcas se mantienen separados de los pagos de clientes.</p></div><button className="secondary" onClick={()=>void load()}>Actualizar</button></div>
   <div className="tablewrap"><table className="orders"><thead><tr><th>Orden</th><th>Marca</th><th>Servicio</th><th>Monto</th><th>Recibido</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
   {rows.map(r=>{const paid=Number(r.amount)-balance(r);return <tr key={r.id}><td>#{r.service_orders?.order_number??"—"}<div className="subline">{r.service_orders?.clients?.name??""}</div></td><td>{r.brand_name}</td><td>{r.service_type==="diagnostico"?"Diagnóstico":"Puesta en Marcha"}</td><td>{money(Number(r.amount))}</td><td>{money(paid)}</td><td>{money(balance(r))}</td><td><span className="pill neutral">{statusLabel[r.status]??r.status}</span></td><td><div className="table-actions">
    {r.status!=="pagado"&&r.status!=="rechazado"&&<><button className="secondary" onClick={()=>void updateStatus(r.id,"enviado")}>Enviar</button><button className="secondary" onClick={()=>void updateStatus(r.id,"aceptado")}>Aceptar</button><button className="secondary" onClick={()=>{setSelected(r.id);setPaymentAmount(String(balance(r)));}}>Registrar pago</button></>}
    {r.status!=="pagado"&&<button className="secondary" onClick={()=>void updateStatus(r.id,"rechazado")}>Rechazar</button>}
   </div></td></tr>})}
   </tbody></table>{loading&&<div className="empty">Cargando cobros…</div>}{!loading&&!rows.length&&<div className="empty">Aún no hay cobros a marcas.</div>}</div>
  </section>
  {selected&&<div className="modal-backdrop"><form className="card modal" onSubmit={registerPayment}><h2>Registrar pago de marca</h2><label className="field"><span>Monto recibido</span><input required type="number" min="1" max={balance(rows.find(r=>r.id===selected)??rows[0])} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></label><label className="field"><span>Medio</span><select value={method} onChange={e=>setMethod(e.target.value)}><option>Transferencia</option><option>Depósito</option><option>Cheque</option><option>Otro</option></select></label><label className="field"><span>Referencia</span><input value={reference} onChange={e=>setReference(e.target.value)}/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setSelected("")}>Cancelar</button><button className="primary" type="submit">Guardar pago</button></div></form></div>}
 </ModuleShell>;
}
