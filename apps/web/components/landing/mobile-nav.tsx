"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

/**
 * Mobile-only section nav for the landing header. Below `md` the desktop anchor row is hidden,
 * so this disclosure keeps the section jumps reachable instead of dropping them on phones.
 * Accessible by default: a labelled toggle with aria-expanded/aria-controls, closes on link
 * select, Escape, or an outside tap. The whole thing is `md:hidden`; desktop keeps its inline nav.
 */

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#artifacts", label: "The artifacts" },
  { href: "#reporting", label: "Reporting" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background/50 text-foreground transition hover:bg-accent active:scale-[0.98]"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Menu className="h-5 w-5" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute inset-x-0 top-16 border-b border-border bg-background shadow-elevated animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <nav className="mx-auto flex max-w-[1200px] flex-col px-6 py-2">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
