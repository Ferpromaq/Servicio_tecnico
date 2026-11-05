import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Usa cookies compartidas con middleware para que la sesión autenticada
// sea reconocida tanto en el navegador como en las rutas del servidor.
export const supabase = url && key ? createBrowserClient(url, key) : null;
