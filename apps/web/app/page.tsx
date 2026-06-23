import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Eye,
  KeyRound,
  MessageSquareText,
  PencilLine,
  Rocket,
  Sparkles,
  Users,
} from "lucide-react";

import { Reveal } from "@/components/landing/reveal";
import { MobileNav } from "@/components/landing/mobile-nav";
import {
  FunnelPreview,
  LaunchPreview,
  LoomsMark,
  MessagePreview,
  SegmentPreview,
} from "@/components/landing/previews";

export const metadata: Metadata = {
  // `absolute` bypasses the root "%s · Looms" template so the homepage title isn't doubled.
  title: { absolute: "Looms · From plain English to a launch you control" },
  description:
    "An AI-native campaign console for marketing and engagement. State your intent in plain English; review an editable segment, message, and launch; track every send on an honest, append-only log.",
};

const CONSOLE_HREF = "/console";

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {/* First focusable element: lets keyboard/SR users jump past the sticky header. */}
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="scroll-mt-20 outline-none">
        <Hero />
        <Thesis />
        <HowItWorks />
        <Artifacts />
        <Reporting />
        <Principles />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ── Navigation ─────────────────────────────────────────────────────── */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LoomsMark className="block h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">Looms</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#how" className="transition hover:text-foreground">
            How it works
          </a>
          <a href="#artifacts" className="transition hover:text-foreground">
            The artifacts
          </a>
          <a href="#reporting" className="transition hover:text-foreground">
            Reporting
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={CONSOLE_HREF}
            className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition duration-200 hover:bg-primary/90 hover:shadow-elevated active:scale-[0.98]"
          >
            {/* Compact on the narrowest phones so logo + CTA + menu never crowd at 320px. */}
            <span className="sm:hidden">Console</span>
            <span className="hidden sm:inline">Open the console</span>
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 pb-20 pt-16 md:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        {/* Left column paints immediately — no reveal gate on the LCP headline. */}
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
            AI-native campaign console
          </span>

          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
            From plain English to a launch you control.
          </h1>

          <p className="mt-5 max-w-[46ch] text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Looms turns a sentence into an editable audience, message, and
            launch. The AI drafts; you review, edit, and approve every send.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={CONSOLE_HREF}
              className="group inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition duration-200 hover:bg-primary/90 hover:shadow-elevated active:scale-[0.98]"
            >
              Open the console
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background/50 px-5 py-3 text-sm font-medium text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:bg-accent active:scale-[0.98]"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* The hero visual is the real product: the two lead artifacts resolving into focus,
            staggered so they read as the AI's proposal assembling beside the value prop. */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-8 -z-10 rounded-[2rem]"
            style={{
              background:
                "radial-gradient(60% 60% at 70% 20%, var(--primary), transparent 70%)",
              opacity: 0.12,
            }}
          />
          <div className="space-y-4">
            <Reveal variant="focus" delay={80}>
              <SegmentPreview />
            </Reveal>
            <Reveal variant="focus" delay={220} className="mx-auto w-[92%]">
              <MessagePreview />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Thesis ─────────────────────────────────────────────────────────── */

function Thesis() {
  return (
    <section className="border-t border-border/60 bg-card/20">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <h2 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            The drafting is the AI&apos;s job. The keys stay yours.
          </h2>
          <p className="mt-4 max-w-[60ch] text-pretty leading-relaxed text-muted-foreground">
            Both common approaches fail. A manual query builder is too slow and
            technical for a marketer. A fully autonomous AI is not trustworthy
            enough to let near a customer list. Looms splits the difference.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-border bg-background/40 p-6">
              <p className="text-sm font-medium text-muted-foreground">
                What it is not
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/85">
                <li>A query builder you have to learn before you can send.</li>
                <li>A black box that decides who to message on its own.</li>
                <li>A bare chat box that hands back unverifiable prose.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="h-full rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] to-transparent p-6">
              <p className="text-sm font-medium text-brand">What Looms does</p>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/90">
                <li>Reads your intent and proposes structured, editable artifacts.</li>
                <li>Re-counts the audience and previews tokens as you edit.</li>
                <li>Holds the send until you confirm, then tracks it honestly.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── How it works ───────────────────────────────────────────────────── */

const STEPS = [
  {
    verb: "Describe",
    icon: PencilLine,
    body: "Type the audience and the message in plain English. No SQL, no rule builder.",
  },
  {
    verb: "Review",
    icon: Eye,
    body: "The AI returns an editable segment and message. The count re-prices and tokens preview as you adjust them.",
  },
  {
    verb: "Launch and track",
    icon: Rocket,
    body: "Confirm the launch. Watch delivered, opened, read, clicked, and converted on an append-only log.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <h2 className="max-w-[18ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Three moves from idea to tracked send.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.verb} delay={i * 90}>
                <div className="h-full bg-background p-6 md:p-8">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-brand">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">
                    {step.verb}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Artifacts (bento) ──────────────────────────────────────────────── */

const ARTIFACTS = [
  {
    label: "Audience segment",
    icon: Users,
    title: "An auditable rule, not a black box.",
    body: "The AI emits a segment as DSL JSON. Edit any condition and the matching count re-prices live, against a strict field whitelist.",
    span: "md:col-span-7",
    wash: "from-seg/10",
    text: "text-seg",
  },
  {
    label: "Message copy",
    icon: MessageSquareText,
    title: "Per-channel copy with a live preview.",
    body: "Tokens fill from a real customer. Anything that will not resolve is flagged before it sends.",
    span: "md:col-span-5",
    wash: "from-msg/10",
    text: "text-msg",
  },
  {
    label: "Launch",
    icon: Rocket,
    title: "A clear who, what, and where.",
    body: "One plain summary of the send. Nothing irreversible happens without your confirm.",
    span: "md:col-span-5",
    wash: "from-launch/10",
    text: "text-launch",
  },
  {
    label: "Results",
    icon: BarChart3,
    title: "A narrative grounded in real numbers.",
    body: "Read back the funnel and the conversions in plain language, including the figures that are not flattering.",
    span: "md:col-span-7",
    wash: "from-results/10",
    text: "text-results",
  },
] as const;

function Artifacts() {
  return (
    <section id="artifacts" className="scroll-mt-20 border-t border-border/60 bg-card/20">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <h2 className="max-w-[18ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Four artifacts, one quiet system.
          </h2>
          <p className="mt-4 max-w-[58ch] text-pretty leading-relaxed text-muted-foreground">
            Each artifact type carries one desaturated color so the set reads as
            intentional. Color means meaning here, never decoration.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-12">
          {ARTIFACTS.map((a, i) => {
            const Icon = a.icon;
            return (
              <Reveal key={a.label} delay={i * 80} className={a.span}>
                <div
                  className={`h-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br ${a.wash} to-transparent p-6 transition duration-200 hover:-translate-y-1 hover:border-brand/25 hover:shadow-elevated md:p-7`}
                >
                  <div
                    className={`flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider ${a.text}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {a.label}
                  </div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
                    {a.title}
                  </h3>
                  <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-muted-foreground">
                    {a.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Reporting ──────────────────────────────────────────────────────── */

function Reporting() {
  return (
    <section id="reporting" className="scroll-mt-20">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2">
        <Reveal>
          <h2 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Honest numbers, including the ones you would rather not see.
          </h2>
          <p className="mt-4 max-w-[52ch] text-pretty leading-relaxed text-muted-foreground">
            Status is a projection over an append-only event log, never inferred
            from arrival order. So the funnel reports what actually happened: the
            deliveries that bounced, the opens that never came, the stalls. No
            vanity tiles, no confetti.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {["Delivered", "Opened", "Read", "Clicked", "Converted"].map((s) => (
              <span
                key={s}
                className="rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        </Reveal>

        <div className="space-y-4">
          <Reveal delay={80}>
            <FunnelPreview />
          </Reveal>
          <Reveal delay={200}>
            <LaunchPreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── Principles ─────────────────────────────────────────────────────── */

const PRINCIPLES = [
  {
    icon: KeyRound,
    title: "The human holds the keys",
    body: "Every AI output is a proposal you review and edit. Nothing irreversible happens without a confirm.",
  },
  {
    icon: Sparkles,
    title: "Structured over conversational",
    body: "The chat is plumbing. The editable, auditable cards are the product.",
  },
  {
    icon: Eye,
    title: "Honest by default",
    body: "Real results, reported straight, including the failures and the gaps.",
  },
];

function Principles() {
  return (
    <section className="border-t border-border/60 bg-card/20">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-24">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          {PRINCIPLES.map((p, i) => {
            const Icon = p.icon;
            return (
              <Reveal key={p.title} delay={i * 90}>
                <div className="h-full bg-background p-6 md:p-8">
                  <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold tracking-tight">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {p.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Closing CTA ────────────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
          Nothing sends until you confirm a launch.
        </h2>
        <p className="mx-auto mt-5 max-w-[44ch] text-pretty leading-relaxed text-muted-foreground">
          See exactly what the AI built before a single message goes out.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            href={CONSOLE_HREF}
            className="group inline-flex items-center gap-1.5 rounded-xl bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground transition duration-200 hover:bg-primary/90 hover:shadow-elevated active:scale-[0.98]"
          >
            Open the console
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <LoomsMark className="block h-6 w-6" />
          <span className="text-sm text-muted-foreground">
            An AI-native mini CRM for marketing and engagement.
          </span>
        </div>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#how" className="transition hover:text-foreground">
            How it works
          </a>
          <a href="#reporting" className="transition hover:text-foreground">
            Reporting
          </a>
          <Link href={CONSOLE_HREF} className="transition hover:text-foreground">
            Console
          </Link>
        </nav>
      </div>
      <div className="border-t border-border/40">
        <p className="mx-auto max-w-[1200px] px-6 py-5 text-xs text-muted-foreground">
          A demonstration project built in the spirit of Xeno.
        </p>
      </div>
    </footer>
  );
}
