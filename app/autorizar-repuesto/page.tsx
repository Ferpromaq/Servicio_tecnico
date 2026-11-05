"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";

function AuthorizationForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function decide(decision: "autorizado" | "rechazado") {
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/client/part-authorization/decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo registrar la decisión.");
      setResult(decision === "autorizado" ? "Has autorizado el repuesto. Ferpromaq continuará con la gestión." : "Has rechazado el repuesto. Ferpromaq ha registrado tu decisión.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ocurrió un error."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card"><div className="auth-mark"><ShieldCheck size={28}/></div><p className="eyebrow">FERPROMAQ · SERVICIO TÉCNICO</p><h1>Autorización de repuesto</h1><p className="muted">Revisa la solicitud y registra tu decisión para que podamos continuar con la orden.</p>{!token ? <div className="notice error">El enlace está incompleto. Revisa el correo recibido.</div> : <><div className="notice">Este enlace es personal, vence en 7 días y solo permite registrar una decisión.</div>{error&&<div className="notice error">{error}</div>}{result ? <div className="notice success"><CheckCircle2 size={18}/>{result}</div> : <div className="auth-actions"><button className="primary" disabled={busy} onClick={()=>void decide("autorizado")}>Autorizar repuesto</button><button className="secondary" disabled={busy} onClick={()=>void decide("rechazado")}>Rechazar repuesto</button></div>}</>}</section></main>;
}

export default function AuthorizePartPage() {
  return <Suspense fallback={<main className="auth-page"><div className="auth-card">Cargando autorización…</div></main>}><AuthorizationForm/></Suspense>;
}
