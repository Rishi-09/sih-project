"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/notifications";

export function PwaRegister() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
