"use client";
import dynamic from "next/dynamic";

const AuthProvider = dynamic(() => import("./AuthProvider"), {
  ssr: false,
});

export default function MsalWrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
