import { redirect } from "next/navigation";

/** The console is the product's front door. */
export default function Home() {
  redirect("/console");
}
