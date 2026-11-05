import { supabase } from "@/lib/supabase";

export type PartAllocation = { partId: string; amount: number };

export async function registerOrderPayment(input: {
  orderId: string;
  type: "abono" | "repuestos" | "diagnostico" | "instalacion";
  amount: number;
  method: string;
  reference?: string;
  receiptReceived: boolean;
  partAllocations?: PartAllocation[];
}) {
  if (!supabase) throw new Error("Falta configurar la conexión con Supabase.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("El monto debe ser mayor que cero.");
  const allocations = input.partAllocations ?? [];
  if (input.type === "repuestos" && allocations.length === 0) {
    throw new Error("Asocia el pago a uno o más repuestos autorizados.");
  }
  const allocationTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
  if (input.type === "repuestos" && Math.abs(allocationTotal - input.amount) > 0.01) {
    throw new Error("La distribución entre repuestos debe coincidir con el monto del pago.");
  }
  const { data, error } = await supabase.rpc("register_order_payment", {
    p_order_id: input.orderId,
    p_payment_type: input.type,
    p_amount: input.amount,
    p_method: input.method,
    p_reference: input.reference ?? null,
    p_receipt_received: input.receiptReceived,
    p_part_allocations: allocations.map((item) => ({ part_id: item.partId, amount: item.amount })),
  });
  if (error) throw error;
  return data as string;
}
