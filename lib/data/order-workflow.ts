import { supabase } from "@/lib/supabase";

export type PartRequest = {
  id: string;
  order_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  status: "pendiente" | "autorizado" | "rechazado" | "comprado";
  warranty_covered: boolean;
  client_contacted: boolean;
  from_stock: boolean;
  received_at: string | null;
  installed_at: string | null;
  created_at: string;
};

export type OrderPayment = {
  id: string;
  payment_type: "abono" | "repuestos" | "diagnostico" | "instalacion";
  amount: number;
  method: string | null;
  reference: string | null;
  receipt_received: boolean;
  paid_at: string;
};

export type OrderEvent = {
  id: string;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { full_name: string } | null;
};

async function requireSupabase() {
  if (!supabase) throw new Error("Falta configurar la conexión con Supabase.");
  return supabase;
}

export async function getOrderWorkflow(orderId: string) {
  const client = await requireSupabase();
  const [parts, payments, events] = await Promise.all([
    client.from("parts_requests").select("id,order_id,description,quantity,unit_price,status,warranty_covered,client_contacted,from_stock,received_at,installed_at,created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    client.from("payments").select("id,payment_type,amount,method,reference,receipt_received,paid_at").eq("order_id", orderId).order("paid_at", { ascending: false }),
    client.from("order_events").select("id,event_type,description,metadata,created_at,actor:profiles!order_events_actor_id_fkey(full_name)").eq("order_id", orderId).order("created_at", { ascending: false }),
  ]);
  if (parts.error) throw parts.error;
  if (payments.error) throw payments.error;
  if (events.error) throw events.error;
  return {
    parts: (parts.data ?? []) as PartRequest[],
    payments: (payments.data ?? []) as OrderPayment[],
    events: (events.data ?? []) as unknown as OrderEvent[],
  };
}

export async function saveDiagnosis(orderId: string, diagnosis: string, repairNotes?: string) {
  const client = await requireSupabase();
  const { error } = await client.rpc("save_order_diagnosis", {
    p_order_id: orderId,
    p_diagnosis: diagnosis,
    p_repair_notes: repairNotes ?? null,
  });
  if (error) throw error;
}

export async function requestPart(input: { orderId: string; description: string; quantity: number; unitPrice: number; fromStock?: boolean }) {
  const client = await requireSupabase();
  const { data, error } = await client.rpc("request_order_part", {
    p_order_id: input.orderId,
    p_description: input.description,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_from_stock: input.fromStock ?? false,
  });
  if (error) throw error;
  return data as string;
}

export async function authorizePart(partId: string, authorized: boolean) {
  const client = await requireSupabase();
  const { error } = await client.rpc("set_part_authorization", { p_part_id: partId, p_authorized: authorized });
  if (error) throw error;
}

export async function markPartMilestone(partId: string, milestone: "received" | "installed") {
  const client = await requireSupabase();
  const { error } = await client.rpc("mark_part_milestone", { p_part_id: partId, p_milestone: milestone });
  if (error) throw error;
}


export async function transitionOrderStatus(input: {
  orderId: string;
  status: "recepcion" | "diagnostico" | "en_reparacion" | "listas" | "entregadas" | "rechazadas";
  forcedDelivery?: boolean;
  reason?: string;
}) {
  const client = await requireSupabase();
  const { error } = await client.rpc("transition_order_status", {
    p_order_id: input.orderId,
    p_new_status: input.status,
    p_forced_delivery: input.forcedDelivery ?? false,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
}


export async function updateOrderWarranty(input: {
  orderId: string; warrantyEntry: boolean; warrantyCoversDamage: boolean;
  receiptType: string; receiptNumber: string; receiptDate: string; commissioning: boolean;
}) {
  const client = await requireSupabase();
  const { error } = await client.rpc("update_order_warranty", {
    p_order_id: input.orderId, p_warranty_entry: input.warrantyEntry,
    p_warranty_covers_damage: input.warrantyCoversDamage, p_receipt_type: input.receiptType,
    p_receipt_number: input.receiptNumber, p_receipt_date: input.receiptDate || null,
    p_commissioning: input.commissioning,
  });
  if (error) throw error;
}

export async function updateOrderCosts(orderId: string, diagnosisAmount: number, installationAmount: number) {
  const client = await requireSupabase();
  const { error } = await client.rpc("update_order_costs", {
    p_order_id: orderId, p_diagnosis_amount: diagnosisAmount, p_installation_amount: installationAmount,
  });
  if (error) throw error;
}


export async function updatePartCoverage(partId: string, warrantyCovered: boolean, clientContacted: boolean) {
  const client = await requireSupabase();
  const { error } = await client.rpc("update_part_coverage", {
    p_part_id: partId, p_warranty_covered: warrantyCovered, p_client_contacted: clientContacted,
  });
  if (error) throw error;
}
