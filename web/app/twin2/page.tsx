import "./twin2.css";
import type { Metadata } from "next";
import { Twin2Console } from "@/components/twin2/Twin2Console";

export const metadata: Metadata = {
  title: "Fleet Twin",
  description: "Physics-hybrid engine digital twin: fleet health, diagnosis, survival and mission advisory",
};

export default function Twin2Page() {
  return <Twin2Console />;
}
