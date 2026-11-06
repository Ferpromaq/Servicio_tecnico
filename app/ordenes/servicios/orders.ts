import { supabase } from "@/lib/supabase";

export type ServiceOrder = {
  id: string;
  order_number: number;
  status: "recepcion" | "diagnostico" | "en_reparacion" | "listas" | "entregadas" | "rechazadas";
  priority: "baja" | "normal" | "alta" | "urgente";
  problem_description: string;
  received_at: string;
  clients: { name: string; rut: string | null } | null;
  machines: { equipment_type: string; brand: string | null; model: string | null; serial_number: string | null } | null;
  assigned: { full_name: string } | null;
};

export const ORDER_STATUSES = [
  { value: "todas", label: "Todas" },
  { value: "recepcion", label: "Recepción" },
  { value: "diagnostico", label: "Diagnóstico" },
  { value: "en_reparacion", label: "En reparación" },
  { value: "listas", label: "Listas" },
  { value: "entregadas", label: "Entregadas" },
  { value: "rechazadas", label: "Rechazadas" },
] as const;

export async function getServiceOrders(): Promise<ServiceOrder[]> {
  if (!supabase) throw new Error("Falta configurar la conexión con Supabase.");
  const { data, error } = await supabase
    .from("service_orders")
    .select("id,order_number,status,priority,problem_description,received_at,clients(name,rut),machines(equipment_type,brand,model,serial_number),assigned:profiles!service_orders_assigned_technician_fkey(full_name)")
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ServiceOrder[];
}

export function orderStatusLabel(status: ServiceOrder["status"]) {
  return ORDER_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function formatOrderDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date(value));
}


export function orderPriorityLabel(priority: ServiceOrder["priority"] | string | null | undefined) {
  const value = String(priority ?? "normal").trim().toLocaleLowerCase("es-CL");
  return value ? value.charAt(0).toLocaleUpperCase("es-CL") + value.slice(1) : "Normal";
}

export function orderPriorityClass(priority: ServiceOrder["priority"] | string | null | undefined) {
  const value = String(priority ?? "normal").trim().toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9_-]/g, "");
  return `priority priority-${value || "normal"}`;
}

export function orderStatusClass(status: ServiceOrder["status"]) {
  const variants: Record<ServiceOrder["status"], string> = {
    recepcion: "neutral",
    diagnostico: "blue",
    en_reparacion: "orange",
    listas: "green",
    entregadas: "green",
    rechazadas: "red",
  };
  return `pill ${variants[status] ?? "neutral"}`;
}
