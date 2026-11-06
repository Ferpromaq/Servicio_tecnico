"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, ClipboardList, PackagePlus, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authorizePart, getOrderWorkflow, markPartMilestone, requestPart, saveDiagnosis, transitionOrderStatus, updateOrderCosts, updateOrderWarranty, updatePartCoverage, type OrderEvent, type OrderPayment, type PartRequest } from "@/app/ordenes/servicios/order-workflow";
import { registerOrderPayment } from "@/app/ordenes/servicios/payments";
import { orderStatusLabel, type ServiceOrder } from "@/lib/data/orders";

type Role = "admin" | "supervisor" | "tecnico";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [parts, setParts] = useState<PartRequest[]>([]);
  const [payments, setPayments] = useState<OrderPayment[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [tab, setTab] = useState("resumen");
  const [diagnosis, setDiagnosis] = useState("");
  const [repairNotes, setRepairNotes] = useState("");
  const [partDescription, setPartDescription] = useState("");
  const [partQuantity, setPartQuantity] = useState("1");
  const [partPrice, setPartPrice] = useState("0");
  const [fromStock, setFromStock] = useState(false);
  const [paymentType, setPaymentType] = useState<"abono"|"repuestos"|"diagnostico"|"instalacion">("abono");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Transferencia");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentPartId, setPaymentPartId] = useState("");
  const [receiptReceived, setReceiptReceived] = useState(false);
  const [nextStatus, setNextStatus] = useState<"recepcion"|"diagnostico"|"en_reparacion"|"listas"|"entregadas"|"rechazadas">("diagnostico");
  const [forcedDelivery, setForcedDelivery] = useState(false);
  const [forcedReason, setForcedReason] = useState("");
  const [diagnosisAmount, setDiagnosisAmount] = useState("0");
  const [installationAmount, setInstallationAmount] = useState("0");
  const [warrantyEntry, setWarrantyEntry] = useState(false);
  const [warrantyCoversDamage, setWarrantyCoversDamage] = useState(false);
  const [receiptType, setReceiptType] = useState("boleta");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [commissioning, setCommissioning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [warrantyPhotoUrl, setWarrantyPhotoUrl] = useState("");
  const [purchaseInvoicePhotoUrl, setPurchaseInvoicePhotoUrl] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setError("Configura Supabase para consultar esta orden."); return; }
    setBusy(true); setError("");
    try {
      const { data: row, error: orderError } = await supabase.from("service_orders")
        .select("id,order_number,status,priority,problem_description,diagnosis,repair_notes,diagnosis_amount,installation_amount,warranty_entry,warranty_covers_damage,receipt_type,receipt_number,receipt_date,commissioning,intake_type,warranty_photo_path,purchase_invoice_photo_path,diagnosis_receipt_type,diagnosis_receipt_number,forced_delivery,forced_delivery_reason,forced_delivery_at,forced_by:profiles!service_orders_forced_delivery_by_fkey(full_name),received_at,clients(name,rut),machines(equipment_type,brand,model,serial_number),assigned:profiles!service_orders_assigned_technician_fkey(full_name)")
        .eq("id", params.id).single();
      if (orderError) throw orderError;
      setOrder(row as unknown as ServiceOrder);
      setNextStatus(row.status);
      setDiagnosis(row.diagnosis ?? "");
      setDiagnosisAmount(String(row.diagnosis_amount ?? 0));
      setInstallationAmount(String(row.installation_amount ?? 0));
      setWarrantyEntry(Boolean(row.warranty_entry));
      setWarrantyCoversDamage(Boolean(row.warranty_covers_damage));
      setReceiptType(row.receipt_type ?? "boleta");
      setReceiptNumber(row.receipt_number ?? "");
      setReceiptDate(row.receipt_date ?? "");
      setCommissioning(Boolean(row.commissioning));
      setRepairNotes(row.repair_notes ?? "");
      setWarrantyPhotoUrl("");
      setPurchaseInvoicePhotoUrl("");
      if (row.warranty_photo_path) { const { data: file } = await supabase.storage.from("order-documents").createSignedUrl(row.warranty_photo_path, 3600); if (file?.signedUrl) setWarrantyPhotoUrl(file.signedUrl); }
      if (row.purchase_invoice_photo_path) { const { data: file } = await supabase.storage.from("order-documents").createSignedUrl(row.purchase_invoice_photo_path, 3600); if (file?.signedUrl) setPurchaseInvoicePhotoUrl(file.signedUrl); }
      const workflow = await getOrderWorkflow(params.id);
      setParts(workflow.parts); setPayments(workflow.payments); setEvents(workflow.events);
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
        setRole(profile?.role as Role ?? null);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar la orden."); }
    finally { setBusy(false); }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }

  const money = (value: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
  const totalParts = parts.reduce((sum, part) => sum + Number(part.quantity) * Number(part.unit_price), 0);
  const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const eligiblePartsTotal = parts.filter(part => ["autorizado","comprado"].includes(part.status) && !part.warranty_covered).reduce((sum, part) => sum + Number(part.quantity)*Number(part.unit_price), 0);
  const partsPaid = payments.filter(payment => payment.payment_type === "repuestos").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const minimumPartsPayment = eligiblePartsTotal * 0.6;

  if (!order && !error) return <main className="main"><div className="empty">Cargando ficha de la orden…</div></main>;

  return <main className="main detail-page">
    <button className="back-link" onClick={() => router.push("/")}><ArrowLeft size={16}/> Volver a órdenes</button>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success"><Check size={16}/>{notice}</div>}
    {order && <>
      <header className="detail-page-head"><div><div className="eyebrow">FERPROMAQ / ORDEN DE SERVICIO</div><h1 className="heading">Orden #{order.order_number}</h1><p className="muted">{order.clients?.name ?? "Cliente"} · {orderStatusLabel(order.status)}</p></div><button className="secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={15}/> Actualizar</button></header>
      <nav className="detail-tabs">{[["resumen","Resumen"],["diagnostico","Diagnóstico"],["repuestos","Repuestos"],["pagos","Pagos"],["historial","Historial"]].map(([value,label])=><button key={value} className={tab===value?"active":""} onClick={()=>setTab(value)}>{label}</button>)}</nav>

      {tab === "resumen" && <section className="detail-content">
        {(role==="admin"||role==="supervisor") && <div className="card status-control"><div><h2>Gestión del estado</h2><p className="muted">Los cambios se registran automáticamente en el historial.</p></div><div className="status-form"><select value={nextStatus} onChange={e=>{const value=e.target.value as typeof nextStatus;setNextStatus(value);if(value!=="listas")setForcedDelivery(false)}}><option value="recepcion">Recepción</option><option value="diagnostico">Diagnóstico</option><option value="en_reparacion">En reparación</option><option value="listas">Lista para entrega</option><option value="entregadas">Entregada</option><option value="rechazadas">Rechazada</option></select><button className="primary" disabled={busy||nextStatus===order.status||(forcedDelivery&&(nextStatus!=="listas"||!forcedReason.trim()))} onClick={()=>void run(()=>transitionOrderStatus({orderId:order.id,status:nextStatus,forcedDelivery,reason:forcedReason}),"Estado de la orden actualizado")}>Actualizar estado</button></div>{nextStatus==="listas" && <div className="forced-control"><label className="checkline"><input type="checkbox" checked={forcedDelivery} onChange={e=>setForcedDelivery(e.target.checked)}/> Entrega forzada porque el cliente rechazó la reparación</label>{forcedDelivery&&<div className="field"><label>Motivo obligatorio</label><textarea rows={2} value={forcedReason} onChange={e=>setForcedReason(e.target.value)} placeholder="Describe por qué se deja lista para entrega…"/></div>}</div>}</div>}
        <div className="detailgrid"><div className="detailbox"><small>Estado actual</small><strong>{orderStatusLabel(order.status)}</strong></div><div className="detailbox"><small>Prioridad</small><strong>{order.priority}</strong></div><div className="detailbox"><small>Repuestos solicitados</small><strong>{parts.length}</strong></div><div className="detailbox"><small>Pagos registrados</small><strong>{money(totalPaid)}</strong></div></div>
        {(role==="admin"||role==="supervisor") && <div className="detail-columns settings-grid"><article className="card"><h3 className="sectiontitle">Garantía y comprobante</h3><label className="checkline"><input type="checkbox" checked={commissioning} onChange={e=>{setCommissioning(e.target.checked);if(e.target.checked)setWarrantyEntry(true)}}/> Puesta en Marcha</label><label className="checkline"><input type="checkbox" checked={warrantyEntry} onChange={e=>setWarrantyEntry(e.target.checked)} disabled={commissioning}/> Ingreso con garantía</label><label className="checkline"><input type="checkbox" checked={warrantyCoversDamage} onChange={e=>setWarrantyCoversDamage(e.target.checked)}/> Garantía cubre el daño</label><div className="field"><label>Tipo de comprobante</label><select value={receiptType} onChange={e=>setReceiptType(e.target.value)}><option value="boleta">Boleta</option><option value="factura">Factura</option></select></div><div className="field"><label>Número de boleta / factura</label><input value={receiptNumber} onChange={e=>setReceiptNumber(e.target.value)}/></div>{!commissioning && <div className="field"><label>Fecha del comprobante (opcional)</label><input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)}/></div>}
          <p className="muted">Modalidad: <strong>{({warranty:"Con garantía",no_warranty:"Sin garantía",commissioning:"Puesta en marcha"} as Record<string,string>)[(order as ServiceOrder & {intake_type?:string}).intake_type ?? ""] ?? "Sin clasificar"}</strong></p>
          {warrantyPhotoUrl && <p><a href={warrantyPhotoUrl} target="_blank" rel="noreferrer">Ver foto de garantía</a></p>}
          {purchaseInvoicePhotoUrl && <p><a href={purchaseInvoicePhotoUrl} target="_blank" rel="noreferrer">Ver foto de factura de compra</a></p>}
          {(order as ServiceOrder & {diagnosis_receipt_number?:string|null;diagnosis_receipt_type?:string|null}).diagnosis_receipt_number && <p className="muted">Comprobante del diagnóstico: {(order as ServiceOrder & {diagnosis_receipt_type?:string|null}).diagnosis_receipt_type} N° {(order as ServiceOrder & {diagnosis_receipt_number?:string|null}).diagnosis_receipt_number}</p>}<button className="secondary" disabled={busy||(commissioning&&!receiptNumber.trim())} onClick={()=>void run(async()=>{await updateOrderWarranty({orderId:order.id,warrantyEntry,warrantyCoversDamage,receiptType,receiptNumber,receiptDate,commissioning});if(commissioning){const response=await fetch("/api/notifications/commissioning",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:order.id})});if(!response.ok)throw new Error("La garantía se guardó, pero no se pudo enviar el aviso al técnico.");}},"Datos de garantía guardados")}>Guardar garantía</button></article><article className="card"><h3 className="sectiontitle">Costos del servicio</h3><div className="field"><label>Valor del diagnóstico (CLP)</label><input type="number" min="0" value={diagnosisAmount} onChange={e=>setDiagnosisAmount(e.target.value)}/></div><div className="field"><label>Valor de instalación (CLP)</label><input type="number" min="0" value={installationAmount} onChange={e=>setInstallationAmount(e.target.value)}/></div><button className="secondary" disabled={busy||Number(diagnosisAmount)<0||Number(installationAmount)<0} onClick={()=>void run(()=>updateOrderCosts(order.id,Number(diagnosisAmount),Number(installationAmount)),"Costos actualizados")}>Guardar costos</button></article></div>}
        <div className="detail-columns"><article className="card"><h3 className="sectiontitle">Cliente y equipo</h3><p><strong>{order.clients?.name ?? "Sin cliente"}</strong></p><p className="muted">{order.clients?.rut ?? "RUT no registrado"}</p><hr/><p>{[order.machines?.brand,order.machines?.model,order.machines?.equipment_type].filter(Boolean).join(" · ") || "Equipo no especificado"}</p><p className="muted">Serie: {order.machines?.serial_number ?? "No registrada"}</p><p className="muted">Técnico: {order.assigned?.full_name ?? "Sin asignar"}</p></article><article className="card"><h3 className="sectiontitle">Problema informado</h3><p>{order.problem_description}</p><h3 className="sectiontitle">Resumen económico</h3><div className="summary-line"><span>Total repuestos registrados</span><strong>{money(totalParts)}</strong></div><div className="summary-line"><span>Pagos registrados</span><strong>{money(totalPaid)}</strong></div></article></div>{(order as ServiceOrder & {forced_delivery?:boolean;forced_delivery_reason?:string|null;forced_delivery_at?:string|null;forced_by?:{full_name:string}|null}).forced_delivery&&<div className="notice"><strong>Entrega forzada registrada.</strong> Motivo: {(order as ServiceOrder & {forced_delivery_reason?:string|null}).forced_delivery_reason ?? "No indicado"} · {(order as ServiceOrder & {forced_by?:{full_name:string}|null}).forced_by?.full_name ?? "Responsable no disponible"}</div>}
      </section>}

      {tab === "diagnostico" && <section className="card detail-content"><h2>Diagnóstico técnico</h2><p className="muted">El técnico puede registrar hallazgos y notas de reparación. Los cambios quedan en la bitácora.</p><div className="field"><label>Diagnóstico</label><textarea rows={5} value={diagnosis} onChange={e=>setDiagnosis(e.target.value)} placeholder="Describe la falla detectada y sus causas…"/></div><div className="field"><label>Notas de reparación</label><textarea rows={4} value={repairNotes} onChange={e=>setRepairNotes(e.target.value)} placeholder="Trabajo realizado o pendiente…"/></div><button className="primary" disabled={busy || !diagnosis.trim()} onClick={()=>void run(()=>saveDiagnosis(order.id,diagnosis,repairNotes),"Diagnóstico guardado correctamente")}><Save size={15}/> Guardar diagnóstico</button></section>}

      {tab === "repuestos" && <section className="detail-content"><div className="card"><h2>Solicitar repuesto</h2><div className="detail-columns"><div className="field"><label>Descripción</label><input value={partDescription} onChange={e=>setPartDescription(e.target.value)} placeholder="Nombre o descripción"/></div><div className="field"><label>Cantidad</label><input type="number" min="0.01" step="0.01" value={partQuantity} onChange={e=>setPartQuantity(e.target.value)}/></div><div className="field"><label>Precio unitario (CLP)</label><input type="number" min="0" value={partPrice} onChange={e=>setPartPrice(e.target.value)}/></div><label className="checkline"><input type="checkbox" checked={fromStock} onChange={e=>setFromStock(e.target.checked)}/> Disponible desde stock</label></div><button className="primary" disabled={busy || !partDescription.trim()} onClick={()=>void run(async()=>{await requestPart({orderId:order.id,description:partDescription,quantity:Number(partQuantity),unitPrice:Number(partPrice),fromStock});setPartDescription("");setPartQuantity("1");setPartPrice("0");},"Repuesto solicitado") }><PackagePlus size={15}/> Agregar solicitud</button></div>
        <div className="card"><div className="section-head"><div><h2>Repuestos de la orden</h2><p>Total registrado: {money(totalParts)}</p></div></div>{parts.length===0?<div className="empty">Todavía no hay repuestos solicitados.</div>:<div className="part-list">{parts.map(part=><article className="part-row" key={part.id}><div className="part-main"><strong>{part.description}</strong><span>{part.quantity} × {money(Number(part.unit_price))} · {money(Number(part.quantity)*Number(part.unit_price))}</span><small>Estado: {part.status} · {part.warranty_covered?"Cubierto por garantía":"No marcado como garantía"} · {part.from_stock?"Desde stock":"Compra requerida"}</small>{(role==="admin"||role==="supervisor")&&<div className="part-flags"><label><input type="checkbox" checked={part.warranty_covered} onChange={e=>void run(()=>updatePartCoverage(part.id,e.target.checked,part.client_contacted),"Cobertura del repuesto actualizada")}/> Cubierto por garantía</label><label><input type="checkbox" checked={part.client_contacted} onChange={e=>void run(()=>updatePartCoverage(part.id,part.warranty_covered,e.target.checked),"Contacto con cliente actualizado")}/> Cliente contactado</label></div>}</div><div className="part-actions">{role==="admin" && part.status==="pendiente" && <><button className="small-action approve" onClick={()=>void run(()=>authorizePart(part.id,true),"Repuesto autorizado")}>Autorizar</button><button className="small-action reject" onClick={()=>void run(()=>authorizePart(part.id,false),"Repuesto rechazado")}>Rechazar</button></>}{["admin","supervisor"].includes(role??"") && part.status==="pendiente" && <button className="small-action" onClick={()=>void run(async()=>{const response=await fetch("/api/client/part-authorization/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({partId:part.id})});const data=await response.json();if(!response.ok)throw new Error(data.error??"No se pudo enviar el correo.");},"Enlace de autorización enviado al cliente")}>Enviar al cliente</button>}{["admin","supervisor","tecnico"].includes(role??"") && part.status!=="rechazado" && <>{!part.received_at&&<button className="small-action" onClick={()=>void run(()=>markPartMilestone(part.id,"received"),"Recepción registrada")}>Marcar recibido</button>}{part.received_at&&!part.installed_at&&<button className="small-action" onClick={()=>void run(()=>markPartMilestone(part.id,"installed"),"Instalación registrada")}>Marcar instalado</button>}</>}</div></article>)}</div>}</div>
      </section>}

      {tab === "pagos" && <section className="card detail-content"><div className="detailgrid"><div className="detailbox"><small>Total de repuestos</small><strong>{money(totalParts)}</strong></div><div className="detailbox"><small>Total pagado</small><strong>{money(totalPaid)}</strong></div><div className="detailbox"><small>60% mínimo de repuestos</small><strong>{money(minimumPartsPayment)}</strong><span className="subline">Pagado: {money(partsPaid)}</span></div></div>{(role==="admin"||role==="supervisor") && (eligiblePartsTotal>0||Number(diagnosisAmount)>0||Number(installationAmount)>0) && <div className="payment-form"><h2>Registrar pago</h2><div className="detail-columns"><div className="field"><label>Tipo de pago</label><select value={paymentType} onChange={e=>setPaymentType(e.target.value as typeof paymentType)}><option value="abono">Abono</option><option value="repuestos">Repuestos</option><option value="diagnostico">Diagnóstico</option><option value="instalacion">Instalación</option></select></div><div className="field"><label>Monto (CLP)</label><input type="number" min="1" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} placeholder="Ej. 25000"/></div><div className="field"><label>Medio de pago</label><select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option>Transferencia</option><option>Efectivo</option><option>Débito</option><option>Crédito</option><option>Otro</option></select></div><div className="field"><label>Referencia / comprobante</label><input value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="N° de operación (opcional)"/></div>{paymentType==="repuestos" && <div className="field"><label>Repuesto al que se imputa</label><select value={paymentPartId} onChange={e=>setPaymentPartId(e.target.value)}><option value="">Seleccionar repuesto</option>{parts.filter(part=>["autorizado","comprado"].includes(part.status)&&!part.warranty_covered).map(part=><option key={part.id} value={part.id}>{part.description} · {money(Number(part.quantity)*Number(part.unit_price))}</option>)}</select></div>}</div><label className="checkline"><input type="checkbox" checked={receiptReceived} onChange={e=>setReceiptReceived(e.target.checked)}/> Comprobante recibido</label><button className="primary" disabled={busy||!paymentAmount||Number(paymentAmount)<=0||(paymentType==="repuestos"&&!paymentPartId)} onClick={()=>void run(()=>registerOrderPayment({orderId:order.id,type:paymentType,amount:Number(paymentAmount),method:paymentMethod,reference:paymentReference,receiptReceived,partAllocations:paymentType==="repuestos"?[{partId:paymentPartId,amount:Number(paymentAmount)}]:[]}),"Pago registrado correctamente")}>Registrar pago</button></div>}{role==="tecnico" && <p className="muted">El registro de pagos está reservado para administración y supervisión.</p>}<h2>Pagos registrados</h2>{payments.length===0?<div className="empty">No hay pagos registrados para esta orden.</div>:<div className="part-list">{payments.map(payment=><article className="part-row" key={payment.id}><div className="part-main"><strong>{money(Number(payment.amount))}</strong><span>{payment.payment_type} · {payment.method ?? "Medio no indicado"}</span><small>{new Intl.DateTimeFormat("es-CL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(payment.paid_at))} · {payment.receipt_received?"Comprobante recibido":"Sin comprobante"}</small></div></article>)}</div>}<p className="muted">El registro de nuevos pagos y las validaciones de abonos se habilitarán después de completar las reglas financieras.</p></section>}

      {tab === "historial" && <section className="card detail-content"><h2>Actividad de la orden</h2>{events.length===0?<div className="empty">Todavía no hay eventos registrados.</div>:<div className="timeline">{events.map(event=><div className="event" key={event.id}><strong>{event.description}</strong><div className="eyebrow">{new Intl.DateTimeFormat("es-CL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(event.created_at))} · {event.actor?.full_name ?? "Sistema"}</div></div>)}</div>}</section>}
    </>}
  </main>;
}
