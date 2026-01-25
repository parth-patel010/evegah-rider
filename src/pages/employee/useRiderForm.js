import { useContext } from "react";
import { RiderFormContext } from "./RiderFormContext";

export function useRiderForm() {
  const ctx = useContext(RiderFormContext);
  if (!ctx) throw new Error("useRiderForm must be used inside provider");
  return ctx;
}
