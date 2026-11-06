"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type ClientRow = { id: string; name: string; rut: string | null };
type TechnicianRow = { id: string; full_name: string };
type IntakeType = "warranty" | "no_warranty" | "commissioning";

export default function NewOrderModal({ onClose, onCreated }: { onClose?: () => void; onCreated?: () => void }) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);
  const [role, setRole] = useState("");
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientRut, setClientRut] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [problem, setProblem] = useState("");
  const [priority, setPriority] = useState("normal");
  const [technicianId, setTechnicianId] = useState("");
  const [intakeType, setIntakeType] = useState<IntakeType>("no_warranty");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [diagnosisReceiptType, setDiagnosisReceiptType] = useState("boleta");
  const [diagnosisReceiptNumber, setDiagnosisReceiptNumber] = useState("");
  const [diagnosisReceiptAmount, setDiagnosisReceiptAmount] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setError("Configura Supabase para crear órdenes."); return; }
    void Promise.all([
      supabase.from("clients").select("id,name,rut").order("name"),
      supabase.from("profiles").select("id,full_name").eq("role", "tecnico").eq("active", true).order("full_name"),
      supabase.auth.getUser()
    ]).then(([clientResult, techResult, userResult]) => {
      if (clientResult.error) setError(clientResult.error.message); else setClients(clientResult.data ?? []);
      if (techResult.error) setError(techResult.error.message); else setTechnicians(techResult.data ?? []);
      if (userResult.data.user) {
        void supabase!.from("profiles").select("role").eq("id", userResult.data.user.id).maybeSingle().then(({ data }) => {
          setRole(data?.role ?? "");
          if (data?.role === "tecnico") router.replace("/");
        });
      }
    });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true); setError("");
    let createdOrderId: string | null = null;
    try {
      const { data, error: rpcError } = await supabase.rpc("create_service_order", {
        p_client_id: clientMode === "existing" ? (clientId || null) : null,
        p_client_name: clientName, p_client_rut: clientRut, p_client_email: clientEmail,
        p_client_phone: clientPhone, p_client_address: clientAddress,
        p_equipment_type: equipmentType, p_brand: brand, p_model: model, p_serial_number: serial,
        p_problem_description: problem, p_priority: priority, p_assigned_technician: technicianId || null
      });
      if (rpcError) throw rpcError;
      createdOrderId = data as string;

      let documentPath: string | null = null;
      if (documentFile) {
        const extension = documentFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const documentName = intakeType === "warranty" ? "garantia" : intakeType === "commissioning" ? "factura-compra" : "comprobante-diagnostico";
        documentPath = createdOrderId + "/" + documentName + "-" + Date.now() + "." + extension;
        const { error: uploadError } = await supabase.storage.from("order-documents").upload(documentPath, documentFile, {
          cacheControl: "3600", upsert: false, contentType: documentFile.type
        });
        if (uploadError) throw new Error("La orden se creó, pero no se pudo subir la fotografía: " + uploadError.message);
      }

      const details = {
        intake_type: intakeType,
        warranty_entry: intakeType === "warranty" || intakeType === "commissioning",
        commissioning: intakeType === "commissioning",
        receipt_type: intakeType === "warranty" || intakeType === "commissioning" ? "factura" : null,
        receipt_number: intakeType === "warranty" || intakeType === "commissioning" ? invoiceNumber.trim() : null,
        receipt_date: null,
        warranty_photo_path: intakeType === "warranty" ? documentPath : null,
        purchase_invoice_photo_path: intakeType === "commissioning" ? documentPath : null,
        diagnosis_receipt_type: intakeType === "no_warranty" ? diagnosisReceiptType : null,
        diagnosis_receipt_number: intakeType === "no_warranty" ? diagnosisReceiptNumber.trim() : null,
        diagnosis_receipt_amount: intakeType === "no_warranty" ? Number(diagnosisReceiptAmount) : null,
        diagnosis_receipt_photo_path: intakeType === "no_warranty" ? documentPath : null,
        diagnosis_amount: intakeType === "commissioning" ? 0 : undefined,
        installation_amount: intakeType === "commissioning" ? 0 : undefined
      };
      const { error: saveError } = await supabase.from("service_orders").update(details).eq("id", createdOrderId);
      if (saveError) throw new Error("La orden se creó, pero faltó guardar sus datos de ingreso: " + saveError.message);
      if (onCreated) onCreated(); else router.replace("/ordenes/" + createdOrderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la orden.");
      if (createdOrderId) setError((current) => current + " Número interno: " + createdOrderId);
    } finally {
      setLoading(false);
    }
  }

  if (role === "tecnico") return null;
  const needsInvoice = intakeType === "warranty" || intakeType === "commissioning";
  const photoLabel = "Foto de la factura de compra";
  const validDocument = Boolean(documentFile && ["image/jpeg","image/png","image/webp"].includes(documentFile.type) && documentFile.size <= 8 * 1024 * 1024);

  return <main className="new-order-overlay">
    <div className="new-order-modal" role="dialog" aria-modal="true" aria-labelledby="new-order-title">
      <header className="new-order-modal-head">
        <div className="new-order-head-copy"><div className="eyebrow">FERPROMAQ / OPERACIONES</div><h1 id="new-order-title">Nueva orden de servicio</h1><p>Completa los datos para registrar el ingreso.</p></div>
        <section className="new-order-head-intake" aria-label="Tipo de ingreso">
          <div className="intake-heading"><h2>Tipo de ingreso</h2><p className="intake-note">{intakeType === "commissioning" ? "La puesta en marcha queda registrada con diagnóstico e instalación en $0." : ""}</p></div>
          <div className="intake-options">
            <label className={intakeType === "no_warranty" ? "intake-option selected" : "intake-option"}><input type="radio" name="intakeType" checked={intakeType === "no_warranty"} onChange={() => { setIntakeType("no_warranty"); setDocumentFile(null); }}/> <span><strong>Sin garantía</strong><small>Comprobante del diagnóstico</small></span></label>
            <label className={intakeType === "warranty" ? "intake-option selected" : "intake-option"}><input type="radio" name="intakeType" checked={intakeType === "warranty"} onChange={() => { setIntakeType("warranty"); setDocumentFile(null); }}/> <span><strong>Con garantía</strong><small>Factura y foto de garantía</small></span></label>
            <label className={intakeType === "commissioning" ? "intake-option selected" : "intake-option"}><input type="radio" name="intakeType" checked={intakeType === "commissioning"} onChange={() => { setIntakeType("commissioning"); setDocumentFile(null); }}/> <span><strong>Puesta en marcha</strong><small>Sin cobro de servicio</small></span></label>
          </div>
        </section>
        <button type="button" className="new-order-close" aria-label="Cerrar" onClick={() => onClose ? onClose() : router.push("/")}><X size={18}/></button>
      </header>
      {error && <div className="notice error new-order-error">{error}</div>}
      <form className="new-order-form" onSubmit={submit}>
        <div className="new-order-modal-body">
      <section className="intake-section">
        {needsInvoice ? <div className="intake-fields">
          <div className="field"><label>Número de Folio *</label><input required value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="N° de Folio"/></div>
          <div className="field upload-field"><label>{photoLabel} *</label><input id="intake-document" className="file-input-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setDocumentFile(e.target.files?.[0] ?? null)}/><label className="upload-control" htmlFor="intake-document"><Upload size={17}/><span><strong>{documentFile ? "Cambiar fotografía" : "Seleccionar fotografía"}</strong><small>{documentFile ? documentFile.name : "JPG, PNG o WEBP · máximo 8 MB"}</small></span></label></div>
        </div> : <div className="intake-fields">
          <div className="field"><label>Tipo de comprobante *</label><select value={diagnosisReceiptType} onChange={e => setDiagnosisReceiptType(e.target.value)}><option value="boleta">Boleta</option><option value="factura">Factura</option></select></div>
          <div className="field"><label>Número de Folio *</label><input required value={diagnosisReceiptNumber} onChange={e => setDiagnosisReceiptNumber(e.target.value)} placeholder="N° de Folio"/></div>
          <div className="field"><label>Monto pagado (CLP) *</label><input required type="number" min="1" step="1" inputMode="numeric" value={diagnosisReceiptAmount} onChange={e => setDiagnosisReceiptAmount(e.target.value)} placeholder="Ej. 25000"/></div>
          <div className="field upload-field"><label>Fotografía de la boleta o factura *</label><input id="intake-document" className="file-input-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setDocumentFile(e.target.files?.[0] ?? null)}/><label className="upload-control" htmlFor="intake-document"><Upload size={17}/><span><strong>{documentFile ? "Cambiar fotografía" : "Seleccionar fotografía"}</strong><small>{documentFile ? documentFile.name : "JPG, PNG o WEBP · máximo 8 MB"}</small></span></label></div>
        </div>}
        {documentFile && !validDocument && <p className="file-selected file-error">El archivo debe ser JPG, PNG o WEBP y pesar máximo 8 MB.</p>}
      </section>
      <section className="client-section">
        <h2>Cliente</h2>
        <div className="tabs"><button type="button" className={clientMode === "existing" ? "tab active" : "tab"} onClick={() => setClientMode("existing")}>Cliente existente</button><button type="button" className={clientMode === "new" ? "tab active" : "tab"} onClick={() => setClientMode("new")}>Nuevo cliente</button></div>
        {clientMode === "existing" ? <div className="field"><label>Seleccionar cliente *</label><select required value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Selecciona un cliente</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.rut ? " · " + client.rut : ""}</option>)}</select>{clients.length === 0 && <small className="muted">No hay clientes registrados. Cambia a Nuevo cliente.</small>}</div> : <div className="form-grid">
          <div className="field"><label>Nombre / razón social *</label><input required value={clientName} onChange={e => setClientName(e.target.value)}/></div>
          <div className="field"><label>RUT</label><input value={clientRut} onChange={e => setClientRut(e.target.value)}/></div>
          <div className="field"><label>Correo</label><input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}/></div>
          <div className="field"><label>Teléfono</label><input value={clientPhone} onChange={e => setClientPhone(e.target.value)}/></div>
          <div className="field full"><label>Dirección</label><input value={clientAddress} onChange={e => setClientAddress(e.target.value)}/></div>
        </div>}
      </section>
      <section className="equipment-section">
        <h2>Equipo y recepción</h2>
        <div className="intake-fields equipment-grid">
          <div className="field"><label>Tipo de equipo *</label><input required value={equipmentType} onChange={e => setEquipmentType(e.target.value)} placeholder="Generador, motosierra…"/></div>
          <div className="field"><label>Marca</label><input value={brand} onChange={e => setBrand(e.target.value)}/></div>
          <div className="field"><label>Modelo</label><input value={model} onChange={e => setModel(e.target.value)}/></div>
          <div className="field"><label>Número de serie</label><input value={serial} onChange={e => setSerial(e.target.value)}/></div>
          <div className="field"><label>Prioridad</label><select value={priority} onChange={e => setPriority(e.target.value)}><option value="baja">Baja</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></div>
          <div className="field"><label>Técnico asignado</label><select value={technicianId} onChange={e => setTechnicianId(e.target.value)}><option value="">Sin asignar</option>{technicians.map(tech => <option key={tech.id} value={tech.id}>{tech.full_name}</option>)}</select></div>
          <div className="field intake-wide"><label>Problema informado *</label><textarea required rows={2} value={problem} onChange={e => setProblem(e.target.value)} placeholder="Describe brevemente lo que informa el cliente…"/></div>
        </div>
      </section>

        </div>
      <div className="form-actions"><button type="button" className="secondary" onClick={() => onClose ? onClose() : router.push("/")}>Cancelar</button><button type="submit" className="primary" disabled={loading || !role || role === "tecnico" || !validDocument || (intakeType === "no_warranty" && (!diagnosisReceiptAmount || Number(diagnosisReceiptAmount) <= 0))}><Save size={14}/>{loading ? "Creando…" : "Crear orden"}</button></div>
      </form>
    </div>
  </main>;
}
