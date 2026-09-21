import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "OB Decision Studio", description: "Individual bonus decisions, class results, and team discussion." };
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
