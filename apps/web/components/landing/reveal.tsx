"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Scroll/load-reveal leaf for the marketing page. Content is visible by default; the hidden
 * start state lives in CSS (`.reveal-on [data-reveal]`, globals.css) and is only armed when
 * an inline script confirms JS is running and `prefers-reduced-motion` is off. This component
 * just flips `.is-revealed` via IntersectionObserver, then unobserves — one shot, never again.
 *
 * Because hiding is CSS-gated, no-JS, reduced-motion, and pre-hydration all render fully
 * visible: the reveal can never gate (and so never blanks) the content it wraps.
 *
 * `variant="focus"` adds a bounded blur→sharp "focus pull" for the hero artifact previews.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = "rise",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "rise" | "focus";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No `reveal-on` means motion is off (reduced-motion) — CSS keeps the content visible,
    // so there's nothing to do. Only arm the observer when the reveal is actually staged.
    if (!document.documentElement.classList.contains("reveal-on")) return;

    // If IntersectionObserver is unavailable (very old browsers), reveal-on has already hidden
    // the content — so reveal it immediately rather than leaving it stuck at opacity 0.
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-revealed");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-revealed");
            io.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-reveal={variant}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
      className={className}
    >
      {children}
    </div>
  );
}
