"use client";

import "./order-detail.css";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, ClipboardList, PackagePlus, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authorizePart, getOrderWorkflow, markPartMilestone, saveDiagnosis, requestParts, transitionOrderStatus, updateOrderCosts, updateOrderWarranty, updatePartCoverage, type OrderEvent, type OrderPayment, type PartRequest } from "@/app/ordenes/servicios/order-workflow";
import { registerOrderPayment } from "@/app/ordenes/servicios/payments";
import { orderPriorityClass, orderPriorityLabel, orderStatusLabel, type ServiceOrder } from "@/app/ordenes/servicios/orders";

type Role = "admin" | "supervisor" | "tecnico";

export default function OrderDetailPage({ orderNumber, embedded = false, onClose }: { orderNumber?: string; embedded?: boolean; onClose?: () => void }) {
  const params = useParams<{ id: string }>();
  const resolvedOrderNumber = orderNumber ?? params.id;
  const router = useRouter();
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [parts, setParts] = useState<PartRequest[]>([]);
  const [payments, setPayments] = useState<OrderPayment[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [diagnosisReports, setDiagnosisReports] = useState<{id:string;report:string;created_at:string;actor:{full_name:string}|null}[]>([]);
  const [partDrafts, setPartDrafts] = useState([{description:"",quantity:"1",unitPrice:"0",fromStock:false}]);
  const [role, setRole] = useState<Role | null>(null);
  const [tab, setTab] = useState("resumen");
  const [diagnosis, setDiagnosis] = useState("");
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
    const numericOrderNumber = Number(resolvedOrderNumber);
    if (!Number.isSafeInteger(numericOrderNumber) || numericOrderNumber <= 0) {
      setError("El número de orden de la dirección no es válido.");
      return;
    }
    setBusy(true); setError("");
    try {
      // Cargar primero la fila base sin joins anidados. Así la ficha no depende
      // de que PostgREST resuelva todas las relaciones en una sola consulta.
      const { data: baseRow, error: orderError } = await supabase.from("service_orders")
        .select("*")
        .eq("order_number", numericOrderNumber)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!baseRow) throw new Error("La orden no existe o no tienes permiso para consultarla.");

      const [clientResult, machineResult, assignedResult, forcedByResult] = await Promise.all([
        baseRow.client_id
          ? supabase.from("clients").select("name,rut").eq("id", baseRow.client_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        baseRow.machine_id
          ? supabase.from("machines").select("equipment_type,brand,model,serial_number").eq("id", baseRow.machine_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        baseRow.assigned_technician
          ? supabase.from("profiles").select("full_name").eq("id", baseRow.assigned_technician).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        baseRow.forced_delivery_by
          ? supabase.from("profiles").select("full_name").eq("id", baseRow.forced_delivery_by).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      const relationError = clientResult.error ?? machineResult.error ?? assignedResult.error ?? forcedByResult.error;
      if (relationError) throw relationError;
      const row = {
        ...baseRow,
        clients: clientResult.data,
        machines: machineResult.data,
        assigned: assignedResult.data,
        forced_by: forcedByResult.data,
      };
      setOrder(row as unknown as ServiceOrder);
      setNextStatus(row.status);
      setDiagnosis("");
      setDiagnosisAmount(String(row.diagnosis_amount ?? 0));
      setInstallationAmount(String(row.installation_amount ?? 0));
      setWarrantyEntry(Boolean(row.warranty_entry));
      setWarrantyCoversDamage(Boolean(row.warranty_covers_damage));
      setReceiptType(row.receipt_type ?? "boleta");
      setReceiptNumber(row.receipt_number ?? "");
      setReceiptDate(row.receipt_date ?? "");
      setCommissioning(Boolean(row.commissioning));
      setWarrantyPhotoUrl("");
      setPurchaseInvoicePhotoUrl("");
      if (row.warranty_photo_path) { const { data: file } = await supabase.storage.from("order-documents").createSignedUrl(row.warranty_photo_path, 3600); if (file?.signedUrl) setWarrantyPhotoUrl(file.signedUrl); }
      if (row.purchase_invoice_photo_path) { const { data: file } = await supabase.storage.from("order-documents").createSignedUrl(row.purchase_invoice_photo_path, 3600); if (file?.signedUrl) setPurchaseInvoicePhotoUrl(file.signedUrl); }
      const workflow = await getOrderWorkflow(baseRow.id);
      setParts(workflow.parts); setPayments(workflow.payments); setEvents(workflow.events); setDiagnosisReports(workflow.diagnosisReports);
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", sessionData.session.user.id).maybeSingle();
        setRole(profile?.role as Role ?? null);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar la orden."); }
    finally { setBusy(false); }
  }, [resolvedOrderNumber]);

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

  if (!order && !error) return <main className={embedded ? "detail-drawer-content detail-page" : "main detail-page"}><div className="empty">Cargando ficha de la orden…</div></main>;

  return <main className={embedded ? "detail-drawer-content detail-page" : "main detail-page"}>
    <button className="back-link" onClick={() => onClose ? onClose() : router.push("/ordenes")}><ArrowLeft size={16}/> {embedded ? "Volver al resumen" : "Volver a órdenes"}</button>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success"><Check size={16}/>{notice}</div>}
    {order && <>
      <header className="detail-page-head"><div><div className="eyebrow">FERPROMAQ / ORDEN DE SERVICIO</div><h1 className="heading">Orden #{order.order_number}</h1><p className="muted">{order.clients?.name ?? "Cliente"} · {orderStatusLabel(order.status)}</p></div><button className="secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={15}/> Actualizar</button></header>
      <nav className="detail-tabs">{[["resumen","Resumen"],["diagnostico","Diagnóstico"],["repuestos","Repuestos"],["pagos","Pagos"],["historial","Historial"]].map(([value,label])=><button key={value} className={tab===value?"active":""} onClick={()=>setTab(value)}>{label}</button>)}</nav>

      {tab === "resumen" && <section className="detail-content summary-view">
        <div className="detailgrid summary-metrics">
          <div className="detailbox"><small>Estado actual</small><strong>{orderStatusLabel(order.status)}</strong></div>
          <div className="detailbox"><small>Prioridad</small><span className={orderPriorityClass(order.priority)}>{orderPriorityLabel(order.priority)}</span></div>
          <div className="detailbox"><small>Repuestos solicitados</small><strong>{parts.length}</strong></div>
          <div className="detailbox"><small>Total pagado</small><strong>{money(totalPaid)}</strong></div>
        </div>

        <div className="summary-overview">
          <article className="card summary-info-card">
            <div className="summary-card-heading"><h3 className="sectiontitle">Cliente y equipo</h3><span className="summary-order-date">Ingreso: {new Intl.DateTimeFormat("es-CL",{dateStyle:"medium"}).format(new Date(order.received_at))}</span></div>
            <div className="summary-client-name">{order.clients?.name ?? "Sin cliente"}</div>
            <div className="muted summary-compact-line">RUT: {order.clients?.rut ?? "No registrado"}</div>
            <div className="summary-divider"/>
            <div className="summary-equipment-name">{[order.machines?.brand,order.machines?.model,order.machines?.equipment_type].filter(Boolean).join(" · ") || "Equipo no especificado"}</div>
            <div className="muted summary-compact-line">N° de serie: {order.machines?.serial_number ?? "No registrada"}</div>
            <div className="muted summary-compact-line">Técnico: {order.assigned?.full_name ?? "Sin asignar"}</div>
          </article>

          <article className="card summary-problem-card">
            <h3 className="sectiontitle">Problema informado</h3>
            <p className="summary-problem-text">{order.problem_description || "Sin descripción registrada."}</p>
            <div className="summary-divider"/>
            <div className="summary-money-row"><span>Repuestos registrados</span><strong>{money(totalParts)}</strong></div>
            <div className="summary-money-row"><span>Pagos registrados</span><strong>{money(totalPaid)}</strong></div>
          </article>

          <article className="card summary-documents-card">
            <div className="summary-card-heading"><h3 className="sectiontitle">Documentos de ingreso</h3><span className="summary-intake-type">{({warranty:"Con garantía",no_warranty:"Sin garantía",commissioning:"Puesta en marcha"} as Record<string,string>)[(order as ServiceOrder & {intake_type?:string}).intake_type ?? ""] ?? "Sin clasificar"}</span></div>
            <div className="summary-document-row">
              <div><small>Comprobante del diagnóstico</small><strong>{(order as ServiceOrder & {diagnosis_receipt_type?:string|null}).diagnosis_receipt_type ? String((order as ServiceOrder & {diagnosis_receipt_type?:string|null}).diagnosis_receipt_type).toUpperCase() : "No registrado"} <span>{(order as ServiceOrder & {diagnosis_receipt_number?:string|null}).diagnosis_receipt_number ? `N° ${(order as ServiceOrder & {diagnosis_receipt_number?:string|null}).diagnosis_receipt_number}` : "· Sin número"}</span></strong></div>
            </div>
            <div className="summary-document-preview">
              <div className="summary-document-label"><span>Factura de compra</span>{purchaseInvoicePhotoUrl && <a href={purchaseInvoicePhotoUrl} target="_blank" rel="noreferrer">Abrir original ↗</a>}</div>
              {purchaseInvoicePhotoUrl
                ? <a className="summary-image-link" href={purchaseInvoicePhotoUrl} target="_blank" rel="noreferrer"><img className="summary-invoice-image" src={purchaseInvoicePhotoUrl} alt="Factura de compra de la orden"/></a>
                : <div className="summary-no-image">No se adjuntó una imagen de la factura.</div>}
            </div>
            {warrantyPhotoUrl && <div className="summary-warranty-link"><a href={warrantyPhotoUrl} target="_blank" rel="noreferrer">Ver fotografía del comprobante de garantía ↗</a></div>}
          </article>
        </div>

        {(role==="admin"||role==="supervisor") && <details className="detail-admin-tools">
          <summary>Gestión de la orden, garantía y costos <span>Editar datos administrativos</span></summary>
          <div className="detail-admin-tools-content">
            <div className="card status-control"><div><h2>Gestión del estado</h2><p className="muted">Los cambios se registran automáticamente en el historial.</p></div><div className="status-form"><select value={nextStatus} onChange={e=>{const value=e.target.value as typeof nextStatus;setNextStatus(value);if(value!=="listas")setForcedDelivery(false)}}><option value="recepcion">Recepción</option><option value="diagnostico">Diagnóstico</option><option value="en_reparacion">En reparación</option><option value="listas">Lista para entrega</option><option value="entregadas">Entregada</option><option value="rechazadas">Rechazada</option></select><button className="primary" disabled={busy||nextStatus===order.status||(forcedDelivery&&(nextStatus!=="listas"||!forcedReason.trim()))} onClick={()=>void run(()=>transitionOrderStatus({orderId:order.id,status:nextStatus,forcedDelivery,reason:forcedReason}),"Estado de la orden actualizado")}>Actualizar estado</button></div>{nextStatus==="listas" && <div className="forced-control"><label className="checkline"><input type="checkbox" checked={forcedDelivery} onChange={e=>setForcedDelivery(e.target.checked)}/> Entrega forzada porque el cliente rechazó la reparación</label>{forcedDelivery&&<div className="field"><label>Motivo obligatorio</label><textarea rows={2} value={forcedReason} onChange={e=>setForcedReason(e.target.value)} placeholder="Describe por qué se deja lista para entrega…"/></div>}</div>}</div>
            <div className="detail-columns settings-grid">
              <article className="card"><h3 className="sectiontitle">Garantía y comprobante</h3><label className="checkline"><input type="checkbox" checked={commissioning} onChange={e=>{setCommissioning(e.target.checked);if(e.target.checked)setWarrantyEntry(true)}}/> Puesta en Marcha</label><label className="checkline"><input type="checkbox" checked={warrantyEntry} onChange={e=>setWarrantyEntry(e.target.checked)} disabled={commissioning}/> Ingreso con garantía</label><label className="checkline"><input type="checkbox" checked={warrantyCoversDamage} onChange={e=>setWarrantyCoversDamage(e.target.checked)}/> Garantía cubre el daño</label><div className="field"><label>Tipo de comprobante</label><select value={receiptType} onChange={e=>setReceiptType(e.target.value)}><option value="boleta">Boleta</option><option value="factura">Factura</option></select></div><div className="field"><label>Número de boleta / factura</label><input value={receiptNumber} onChange={e=>setReceiptNumber(e.target.value)}/></div>{!commissioning && <div className="field"><label>Fecha del comprobante (opcional)</label><input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)}/></div>}<button className="secondary" disabled={busy||(commissioning&&!receiptNumber.trim())} onClick={()=>void run(async()=>{await updateOrderWarranty({orderId:order.id,warrantyEntry,warrantyCoversDamage,receiptType,receiptNumber,receiptDate,commissioning});if(commissioning){const response=await fetch("/api/notifications/commissioning",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:order.id})});if(!response.ok)throw new Error("La garantía se guardó, pero no se pudo enviar el aviso al técnico.");}},"Datos de garantía guardados")}>Guardar garantía</button></article>
              <article className="card"><h3 className="sectiontitle">Costos del servicio</h3><div className="field"><label>Valor del diagnóstico (CLP)</label><input type="number" min="0" value={diagnosisAmount} onChange={e=>setDiagnosisAmount(e.target.value)}/></div><div className="field"><label>Valor de instalación (CLP)</label><input type="number" min="0" value={installationAmount} onChange={e=>setInstallationAmount(e.target.value)}/></div><button className="secondary" disabled={busy||Number(diagnosisAmount)<0||Number(installationAmount)<0} onClick={()=>void run(()=>updateOrderCosts(order.id,Number(diagnosisAmount),Number(installationAmount)),"Costos actualizados")}>Guardar costos</button></article>
            </div>
          </div>
        </details>}
        {(order as ServiceOrder & {forced_delivery?:boolean;forced_delivery_reason?:string|null;forced_by?:{full_name:string}|null}).forced_delivery && <div className="notice"><strong>Entrega forzada registrada.</strong> Motivo: {(order as ServiceOrder & {forced_delivery_reason?:string|null}).forced_delivery_reason ?? "No indicado"} · {(order as ServiceOrder & {forced_by?:{full_name:string}|null}).forced_by?.full_name ?? "Responsable no disponible"}</div>}
      </section>}

      {tab === "diagnostico" && <section className="detail-content"><div className="card"><h2>Nuevo informe de diagnóstico</h2><p className="muted">Cada guardado crea un informe nuevo. Los anteriores no se sobrescriben.</p><div className="field"><label>Informe</label><textarea rows={5} value={diagnosis} onChange={e=>setDiagnosis(e.target.value)} placeholder="Describe la falla detectada, las pruebas realizadas y los hallazgos…"/></div><button className="primary" disabled={busy || !diagnosis.trim()} onClick={()=>void run(()=>saveDiagnosis(order.id,diagnosis),"Informe de diagnóstico guardado correctamente")}><Save size={15}/> Guardar informe</button></div><div className="card"><h2>Historial de informes</h2>{diagnosisReports.length===0?<div className="empty">Todavía no hay informes registrados.</div>:<div className="timeline">{diagnosisReports.map(report=><article className="event diagnosis-report" key={report.id}><strong>{new Intl.DateTimeFormat("es-CL",{dateStyle:"medium",timeStyle:"medium",hour12:false}).format(new Date(report.created_at))} · {report.actor?.full_name ?? "Usuario no disponible"}</strong><p>{report.report}</p></article>)}</div>}</div></section>}

      {tab === "repuestos" && <section className="detail-content"><div className="card"><h2>Solicitar repuestos</h2><p className="muted">Agrega todos los repuestos necesarios y registra la solicitud en conjunto.</p><div className="parts-draft-list">{partDrafts.map((item,index)=><div className="parts-draft-row" key={index}><div className="parts-draft-heading"><strong>Repuesto {index+1}</strong>{partDrafts.length>1&&<button type="button" className="small-action reject" onClick={()=>setPartDrafts(current=>current.filter((_,i)=>i!==index))}>Quitar</button>}</div><div className="detail-columns"><div className="field"><label>Nombre / descripción</label><input value={item.description} onChange={e=>setPartDrafts(current=>current.map((row,i)=>i===index?{...row,description:e.target.value}:row))} placeholder="Nombre del repuesto"/></div><div className="field"><label>Cantidad</label><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={e=>setPartDrafts(current=>current.map((row,i)=>i===index?{...row,quantity:e.target.value}:row))}/></div><div className="field"><label>Valor unitario (CLP)</label><input type="number" min="0" step="1" value={item.unitPrice} onChange={e=>setPartDrafts(current=>current.map((row,i)=>i===index?{...row,unitPrice:e.target.value}:row))}/></div><label className="checkline"><input type="checkbox" checked={item.fromStock} onChange={e=>setPartDrafts(current=>current.map((row,i)=>i===index?{...row,fromStock:e.target.checked}:row))}/> Disponible desde stock</label></div><div className="parts-draft-subtotal">Subtotal: <strong>{money((Number(item.quantity)||0)*(Number(item.unitPrice)||0))}</strong></div></div>)}</div><div className="parts-draft-footer"><button type="button" className="secondary" onClick={()=>setPartDrafts(current=>[...current,{description:"",quantity:"1",unitPrice:"0",fromStock:false}])}><PackagePlus size={15}/> Añadir otro repuesto</button><strong>Total: {money(partDrafts.reduce((sum,item)=>sum+(Number(item.quantity)||0)*(Number(item.unitPrice)||0),0))}</strong></div><button className="primary" disabled={busy||partDrafts.some(item=>!item.description.trim()||Number(item.quantity)<=0||Number(item.unitPrice)<0||!Number.isFinite(Number(item.quantity))||!Number.isFinite(Number(item.unitPrice)))} onClick={()=>void run(async()=>{await requestParts({orderId:order.id,items:partDrafts.map(item=>({description:item.description,quantity:Number(item.quantity),unitPrice:Number(item.unitPrice),fromStock:item.fromStock}))});setPartDrafts([{description:"",quantity:"1",unitPrice:"0",fromStock:false}]);},"Repuestos solicitados correctamente")}><PackagePlus size={15}/> Guardar solicitud de repuestos</button></div>
        <div className="card"><div className="section-head"><div><h2>Repuestos de la orden</h2><p>Total registrado: {money(totalParts)}</p></div></div>{parts.length===0?<div className="empty">Todavía no hay repuestos solicitados.</div>:<div className="part-list">{parts.map(part=><article className="part-row" key={part.id}><div className="part-main"><strong>{part.description}</strong><span>{part.quantity} × {money(Number(part.unit_price))} · {money(Number(part.quantity)*Number(part.unit_price))}</span><small className="part-meta"><span>Estado: </span><span className={`semantic-status ${part.status==="pendiente"?"pending":part.status==="autorizado"||part.status==="comprado"?"approved":part.status==="rechazado"?"rejected":"neutral"}`}>{part.status}</span><span> · {part.warranty_covered?"Cubierto por garantía":"No marcado como garantía"} · {part.from_stock?"Desde stock":"Compra requerida"}</span></small>{(role==="admin"||role==="supervisor")&&<div className="part-flags"><label><input type="checkbox" checked={part.warranty_covered} onChange={e=>void run(()=>updatePartCoverage(part.id,e.target.checked,part.client_contacted),"Cobertura del repuesto actualizada")}/> Cubierto por garantía</label><label><input type="checkbox" checked={part.client_contacted} onChange={e=>void run(()=>updatePartCoverage(part.id,part.warranty_covered,e.target.checked),"Contacto con cliente actualizado")}/> Cliente contactado</label></div>}</div><div className="part-actions">{role==="admin" && part.status==="pendiente" && <><button className="small-action approve" onClick={()=>void run(()=>authorizePart(part.id,true),"Repuesto autorizado")}>Autorizar</button><button className="small-action reject" onClick={()=>void run(()=>authorizePart(part.id,false),"Repuesto rechazado")}>Rechazar</button></>}{["admin","supervisor"].includes(role??"") && part.status==="pendiente" && <button className="small-action" onClick={()=>void run(async()=>{const response=await fetch("/api/client/part-authorization/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({partId:part.id})});const data=await response.json();if(!response.ok)throw new Error(data.error??"No se pudo enviar el correo.");},"Enlace de autorización enviado al cliente")}>Enviar al cliente</button>}{["admin","supervisor","tecnico"].includes(role??"") && part.status!=="rechazado" && <>{!part.received_at&&<button className="small-action" onClick={()=>void run(()=>markPartMilestone(part.id,"received"),"Recepción registrada")}>Marcar recibido</button>}{part.received_at&&!part.installed_at&&<button className="small-action" onClick={()=>void run(()=>markPartMilestone(part.id,"installed"),"Instalación registrada")}>Marcar instalado</button>}</>}</div></article>)}</div>}</div>
      </section>}

      {tab === "pagos" && <section className="card detail-content"><div className="detailgrid"><div className="detailbox"><small>Total de repuestos</small><strong>{money(totalParts)}</strong></div><div className="detailbox"><small>Total pagado</small><strong>{money(totalPaid)}</strong></div><div className="detailbox"><small>60% mínimo de repuestos</small><strong>{money(minimumPartsPayment)}</strong><span className="subline">Pagado: {money(partsPaid)}</span></div></div>{(role==="admin"||role==="supervisor") && (eligiblePartsTotal>0||Number(diagnosisAmount)>0||Number(installationAmount)>0) && <div className="payment-form"><h2>Registrar pago</h2><div className="detail-columns"><div className="field"><label>Tipo de pago</label><select value={paymentType} onChange={e=>setPaymentType(e.target.value as typeof paymentType)}><option value="abono">Abono</option><option value="repuestos">Repuestos</option><option value="diagnostico">Diagnóstico</option><option value="instalacion">Instalación</option></select></div><div className="field"><label>Monto (CLP)</label><input type="number" min="1" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} placeholder="Ej. 25000"/></div><div className="field"><label>Medio de pago</label><select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option>Transferencia</option><option>Efectivo</option><option>Débito</option><option>Crédito</option><option>Otro</option></select></div><div className="field"><label>Referencia / comprobante</label><input value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="N° de operación (opcional)"/></div>{paymentType==="repuestos" && <div className="field"><label>Repuesto al que se imputa</label><select value={paymentPartId} onChange={e=>setPaymentPartId(e.target.value)}><option value="">Seleccionar repuesto</option>{parts.filter(part=>["autorizado","comprado"].includes(part.status)&&!part.warranty_covered).map(part=><option key={part.id} value={part.id}>{part.description} · {money(Number(part.quantity)*Number(part.unit_price))}</option>)}</select></div>}</div><label className="checkline"><input type="checkbox" checked={receiptReceived} onChange={e=>setReceiptReceived(e.target.checked)}/> Comprobante recibido</label><button className="primary" disabled={busy||!paymentAmount||Number(paymentAmount)<=0||(paymentType==="repuestos"&&!paymentPartId)} onClick={()=>void run(()=>registerOrderPayment({orderId:order.id,type:paymentType,amount:Number(paymentAmount),method:paymentMethod,reference:paymentReference,receiptReceived,partAllocations:paymentType==="repuestos"?[{partId:paymentPartId,amount:Number(paymentAmount)}]:[]}),"Pago registrado correctamente")}>Registrar pago</button></div>}{role==="tecnico" && <p className="muted">El registro de pagos está reservado para administración y supervisión.</p>}<h2>Pagos registrados</h2>{payments.length===0?<div className="empty">No hay pagos registrados para esta orden.</div>:<div className="part-list">{payments.map(payment=><article className="part-row" key={payment.id}><div className="part-main"><strong>{money(Number(payment.amount))}</strong><span>{payment.payment_type} · {payment.method ?? "Medio no indicado"}</span><small>{new Intl.DateTimeFormat("es-CL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(payment.paid_at))} · {payment.receipt_received?"Comprobante recibido":"Sin comprobante"}</small></div></article>)}</div>}<p className="muted">El registro de nuevos pagos y las validaciones de abonos se habilitarán después de completar las reglas financieras.</p></section>}

      {tab === "historial" && <section className="card detail-content"><h2>Actividad de la orden</h2>{events.length===0?<div className="empty">Todavía no hay eventos registrados.</div>:<div className="timeline">{events.map(event=><div className="event" key={event.id}><strong>{event.description}</strong><div className="eyebrow">{new Intl.DateTimeFormat("es-CL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(event.created_at))} · {event.actor?.full_name ?? "Sistema"}</div></div>)}</div>}</section>}
    </>}
  </main>;
}
