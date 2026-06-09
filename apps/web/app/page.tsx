import { SHARED_OK } from "@xeno/shared";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Xeno CRM</h1>
      <p className="text-muted-foreground text-sm">
        Web console skeleton · <code>@xeno/shared</code> loaded:{" "}
        {String(SHARED_OK)}
      </p>
    </main>
  );
}
