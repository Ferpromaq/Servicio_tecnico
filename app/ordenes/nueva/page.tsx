"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";

type ClientRow = { id: string; name: string; rut: string | null };
type TechnicianRow = { id: string; full_name: string };

export default function NewOrderPage() {
  const router = useRouter();
  const [clients,setClients] = useState<ClientRow[]>([]);
  const [technicians,setTechnicians] = useState<TechnicianRow[]>([]);
  const [role,setRole] = useState("");
  const [clientMode,setClientMode] = useState<"existing"|"new">("existing");
  const [clientId,setClientId] = useState("");
  const [clientName,setClientName] = useState("");
  const [clientRut,setClientRut] = useState("");
  const [clientEmail,setClientEmail] = useState("");
  const [clientPhone,setClientPhone] = useState("");
  const [clientAddress,setClientAddress] = useState("");
  const [equipmentType,setEquipmentType] = useState("");
  const [brand,setBrand] = useState("");
  const [model,setModel] = useState("");
  const [serial,setSerial] = useState("");
  const [problem,setProblem] = useState("");
  const [priority,setPriority] = useState("normal");
  const [technicianId,setTechnicianId] = useState("");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");

  useEffect(()=>{
    if(!supabase){setError("Configura Supabase para crear órdenes.");return}
    void Promise.all([
      supabase.from("clients").select("id,name,rut").order("name"),
      supabase.from("profiles").select("id,full_name").eq("role","tecnico").eq("active",true).order("full_name"),
      supabase.auth.getUser()
    ]).then(([clientResult,techResult,userResult])=>{
      if(clientResult.error)setError(clientResult.error.message);else setClients(clientResult.data??[]);
      if(techResult.error)setError(techResult.error.message);else setTechnicians(techResult.data??[]);
      if(userResult.data.user){
        void supabase!.from("profiles").select("role").eq("id",userResult.data.user.id).maybeSingle().then(({data})=>{
          setRole(data?.role??"");if(data?.role==="tecnico")router.replace("/");
        });
      }
    });
  },[router]);

  async function submit(event:React.FormEvent){
    event.preventDefault();if(!supabase)return;
    setLoading(true);setError("");
    try{
      const {data,error:rpcError}=await supabase.rpc("create_service_order",{
        p_client_id:clientMode==="existing"?(clientId||null):null,
        p_client_name:clientName,p_client_rut:clientRut,p_client_email:clientEmail,
        p_client_phone:clientPhone,p_client_address:clientAddress,
        p_equipment_type:equipmentType,p_brand:brand,p_model:model,p_serial_number:serial,
        p_problem_description:problem,p_priority:priority,p_assigned_technician:technicianId||null
      });
      if(rpcError)throw rpcError;
      router.replace("/ordenes/"+data);
    }catch(err){setError(err instanceof Error?err.message:"No se pudo crear la orden.");}
    finally{setLoading(false);}
  }

  if(role==="tecnico")return null;
  return <main className="main new-order-page">
    <button className="back-link" onClick={()=>router.push("/")}><ArrowLeft size={16}/> Volver al panel</button>
    <header className="detail-page-head"><div><div className="eyebrow">FERPROMAQ / OPERACIONES</div><h1 className="heading">Nueva orden de servicio</h1><p className="muted">Registra al cliente, su equipo y el problema informado.</p></div></header>
    {error&&<div className="notice error">{error}</div>}
    <form className="card new-order-form" onSubmit={submit}>
      <section><h2>Cliente</h2><div className="tabs"><button type="button" className={clientMode==="existing"?"tab active":"tab"} onClick={()=>setClientMode("existing")}>Cliente existente</button><button type="button" className={clientMode==="new"?"tab active":"tab"} onClick={()=>setClientMode("new")}>Nuevo cliente</button></div>
        {clientMode==="existing"?<div className="field"><label>Seleccionar cliente</label><select required value={clientId} onChange={e=>setClientId(e.target.value)}><option value="">Selecciona un cliente</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}{client.rut?" · "+client.rut:""}</option>)}</select>{clients.length===0&&<small className="muted">No hay clientes registrados. Cambia a Nuevo cliente.</small>}</div>:<div className="form-grid"><div className="field"><label>Nombre / razón social *</label><input required value={clientName} onChange={e=>setClientName(e.target.value)}/></div><div className="field"><label>RUT</label><input value={clientRut} onChange={e=>setClientRut(e.target.value)}/></div><div className="field"><label>Correo</label><input type="email" value={clientEmail} onChange={e=>setClientEmail(e.target.value)}/></div><div className="field"><label>Teléfono</label><input value={clientPhone} onChange={e=>setClientPhone(e.target.value)}/></div><div className="field full"><label>Dirección</label><input value={clientAddress} onChange={e=>setClientAddress(e.target.value)}/></div></div>}
      </section>
      <section><h2>Equipo</h2><div className="form-grid"><div className="field"><label>Tipo de equipo *</label><input required value={equipmentType} onChange={e=>setEquipmentType(e.target.value)} placeholder="Ej. Generador, motosierra…"/></div><div className="field"><label>Marca</label><input value={brand} onChange={e=>setBrand(e.target.value)}/></div><div className="field"><label>Modelo</label><input value={model} onChange={e=>setModel(e.target.value)}/></div><div className="field"><label>Número de serie</label><input value={serial} onChange={e=>setSerial(e.target.value)}/></div></div></section>
      <section><h2>Ingreso al taller</h2><div className="field"><label>Problema informado *</label><textarea required rows={4} value={problem} onChange={e=>setProblem(e.target.value)} placeholder="Describe lo que informa el cliente…"/></div><div className="form-grid"><div className="field"><label>Prioridad</label><select value={priority} onChange={e=>setPriority(e.target.value)}><option value="baja">Baja</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></div><div className="field"><label>Técnico asignado</label><select value={technicianId} onChange={e=>setTechnicianId(e.target.value)}><option value="">Sin asignar</option>{technicians.map(tech=><option key={tech.id} value={tech.id}>{tech.full_name}</option>)}</select></div></div></section>
      <div className="form-actions"><button type="button" className="secondary" onClick={()=>router.push("/")}>Cancelar</button><button type="submit" className="primary" disabled={loading||!role||role==="tecnico"}><Save size={15}/>{loading?"Creando…":"Crear orden"}</button></div>
    </form>
  </main>;
}
