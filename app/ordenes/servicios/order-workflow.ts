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
  catalog_part_id: string | null;
  received_at: string | null;
  installed_at: string | null;
  created_at: string;
};

export type DiagnosisReport = { id: string; order_id: string; report: string; created_at: string; actor: { full_name: string } | null };

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
  actor_id?: string | null;
  testing_technician?: { full_name: string } | null;
};

async function requireSupabase() {
  if (!supabase) throw new Error("Falta configurar la conexión con Supabase.");
  return supabase;
}

export async function getOrderWorkflow(orderId: string) {
  const client = await requireSupabase();
  // La trazabilidad histórica y los datos operativos no deben depender
  // de que exista la tabla nueva de informes de diagnóstico. Si la migración
  // 0015 aún no está aplicada, mantenemos disponibles los eventos anteriores.
  let partsResult = await client
    .from("parts_requests")
    .select("id,order_id,description,quantity,unit_price,status,warranty_covered,client_contacted,from_stock,catalog_part_id,received_at,installed_at,created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  // Si aún no se aplicó la migración 0020, el campo del catálogo no existe.
  // En ese caso cargamos los repuestos con el esquema anterior para no bloquear
  // la ficha completa de la orden.
  const missingCatalogColumn =
    partsResult.error &&
    (partsResult.error.code === "42703" ||
      partsResult.error.code === "PGRST204" ||
      /catalog_part_id.*(column|schema cache)|(column|schema cache).*catalog_part_id/i.test(
        partsResult.error.message,
      ));

  if (missingCatalogColumn) {
    partsResult = await client
      .from("parts_requests")
      .select("id,order_id,description,quantity,unit_price,status,warranty_covered,client_contacted,from_stock,received_at,installed_at,created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
  }

  const [payments, events] = await Promise.all([
    client.from("payments").select("id,payment_type,amount,method,reference,receipt_received,paid_at").eq("order_id", orderId).order("paid_at", { ascending: false }),
    client.from("order_events").select("id,event_type,description,metadata,created_at,actor_id").eq("order_id", orderId).order("created_at", { ascending: false }),
  ]);
  if (partsResult.error) throw partsResult.error;
  if (payments.error) throw payments.error;
  if (events.error) throw events.error;

  const eventRows = events.data ?? [];
  const reports = await client.from("order_diagnosis_reports")
    .select("id,order_id,report,created_at,created_by")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  // Esta consulta es complementaria: su fallo no debe ocultar la trazabilidad.
  const reportRows = reports.error ? [] : (reports.data ?? []);
  const testingTechnicianIds = eventRows.map((event) => event.metadata?.testing_technician_id).filter((id): id is string => typeof id === "string");
  const actorIds = [...new Set([...eventRows.map((event) => event.actor_id), ...testingTechnicianIds, ...reportRows.map((report) => report.created_by)].filter((id): id is string => Boolean(id)))];
  const actorsResult = actorIds.length
    ? await client.from("profiles").select("id,full_name").in("id", actorIds)
    : { data: [], error: null };
  if (actorsResult.error) throw actorsResult.error;
  const actorNames = new Map((actorsResult.data ?? []).map((actor) => [actor.id, actor.full_name]));

  return {
    parts: (partsResult.data ?? []) as PartRequest[],
    payments: (payments.data ?? []) as OrderPayment[],
    diagnosisReports: reportRows.map((report) => ({ ...report, actor: report.created_by ? { full_name: actorNames.get(report.created_by) ?? "Usuario" } : null })) as DiagnosisReport[],
    events: eventRows.map((event) => ({
      ...event,
      actor: event.actor_id ? { full_name: actorNames.get(event.actor_id) ?? "Usuario" } : null,
      testing_technician: typeof event.metadata?.testing_technician_id === "string"
        ? { full_name: actorNames.get(event.metadata.testing_technician_id) ?? "Técnico" }
        : null,
    })) as unknown as OrderEvent[],
  };
}

export async function confirmCommissioningReady(orderId: string, testingTechnicianId: string) {
  const client = await requireSupabase();
  const { error } = await client.rpc("confirm_commissioning_ready", {
    p_order_id: orderId,
    p_testing_technician_id: testingTechnicianId,
  });
  if (error) throw error;
}

export async function confirmCommissioningDelivery(input: {
  orderId: string;
  deliveredByName: string;
  receivedByName: string;
  deliveryPhotoPath: string;
}) {
  const client = await requireSupabase();
  const { error } = await client.rpc("confirm_commissioning_delivery", {
    p_order_id: input.orderId,
    p_delivered_by_name: input.deliveredByName,
    p_received_by_name: input.receivedByName,
    p_delivery_photo_path: input.deliveryPhotoPath,
  });
  if (error) throw error;
}

export async function saveDiagnosis(
  orderId: string,
  diagnosis: string,
  damageCausedByClient: boolean | null = null,
) {
  const client = await requireSupabase();
  const { error } = await client.rpc("save_order_diagnosis", {
    p_order_id: orderId,
    p_diagnosis: diagnosis,
    p_damage_caused_by_client: damageCausedByClient,
  });
  if (error) throw error;
}

export async function markOrderReadyForDelivery(orderId: string) {
  const client = await requireSupabase();
  const { error } = await client.rpc("mark_order_ready_for_delivery", {
    p_order_id: orderId,
  });
  if (error) throw error;
}

export async function requestParts(input: { orderId: string; items: { description: string; quantity: number; unitPrice: number; fromStock?: boolean; catalogPartId?: string }[] }) {
  const client = await requireSupabase();
  if (!input.items.length) throw new Error("Agrega al menos un repuesto.");
  const { error } = await client.rpc("request_order_parts", {
    p_order_id: input.orderId,
    p_parts: input.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      from_stock: item.fromStock ?? false,
      catalog_part_id: item.catalogPartId ?? null,
    })),
  });
  if (error) throw error;
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
