import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Ferpromaq | Servicio técnico", description: "Gestión de órdenes de servicio técnico Ferpromaq" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="es"><body>{children}</body></html>; }