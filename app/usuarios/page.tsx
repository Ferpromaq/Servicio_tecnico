"use client";

import { useEffect, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  full_name: string;
  role: "admin" | "supervisor" | "tecnico";
  active: boolean;
};

export default function UsersPage() {
  const [rows, setRows] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Profile["role"]>("tecnico");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!supabase) return;
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select("id,full_name,role,active")
      .order("full_name");
    if (loadError) setError(loadError.message);
    else setRows(data ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, email, password, role }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(result?.error ?? "No fue posible crear el usuario.");
        return;
      }

      setName("");
      setEmail("");
      setPassword("");
      setRole("tecnico");
      setSuccess("Usuario creado correctamente. Ya puede iniciar sesión con su correo y contraseña.");
      await load();
    } catch {
      setError("No fue posible conectar con el servidor. Inténtalo nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function update(profile: Profile, patch: Partial<Profile>) {
    if (!supabase) return;
    setError("");
    setSuccess("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", profile.id);
    if (updateError) setError(updateError.message);
    else await load();
  }

  return (
    <ModuleShell title="Usuarios y técnicos" description="Perfiles, roles y estado de acceso">
      <div className="module-grid">
        <form className="card module-form" onSubmit={add}>
          <h2>Crear usuario</h2>
          <div className="field">
            <label htmlFor="user-full-name">Nombre completo *</label>
            <input
              id="user-full-name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nombre y apellido"
            />
          </div>
          <div className="field">
            <label htmlFor="user-email">Correo electrónico *</label>
            <input
              id="user-email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@ferpromaq.cl"
            />
          </div>
          <div className="field">
            <label htmlFor="user-password">Contraseña *</label>
            <input
              id="user-password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div className="field">
            <label htmlFor="user-role">Rol</label>
            <select
              id="user-role"
              value={role}
              onChange={e => setRole(e.target.value as Profile["role"])}
            >
              <option value="tecnico">Técnico</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          {success && <p className="success-text" role="status">{success}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "Creando usuario…" : "Crear usuario"}
          </button>
        </form>

        <section className="card module-list">
          <h2>Equipo de trabajo</h2>
          <div className="tablewrap">
            <table className="orders">
              <thead>
                <tr><th>Nombre</th><th>Rol</th><th>Acceso</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {rows.map(profile => (
                  <tr key={profile.id}>
                    <td>{profile.full_name}</td>
                    <td>
                      <select
                        value={profile.role}
                        onChange={e => void update(profile, { role: e.target.value as Profile["role"] })}
                        aria-label={`Rol de ${profile.full_name}`}
                      >
                        <option value="admin">Administrador</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="tecnico">Técnico</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => void update(profile, { active: !profile.active })}
                      >
                        {profile.active ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                    <td>{profile.active ? "Activo" : "Inactivo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ModuleShell>
  );
}
