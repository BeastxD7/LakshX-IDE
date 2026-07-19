"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import SectionGlow from "./SectionGlow";
import CtaButton from "./CtaButton";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

const FREE_ITEMS = [
  "The full IDE — every agent mode, checkpoints & undo, voice mode",
  "Bring your own API key from any supported provider — fully unlimited, forever",
  "Or sign in free with Google for the hosted LakshX model, up to a starter trial amount",
  "No credit card required",
];

const PRO_ITEMS = [
  "Everything in Free",
  "The hosted LakshX model with a generous allowance for daily use — no key to manage",
  "Priority access to new features as they ship",
  "Support that goes straight to the team building it",
];

export default function Pricing() {
  return (
    <section className="relative isolate overflow-hidden bg-paper-dim py-24 sm:py-32">
      <SectionGlow variant="b" />

      <div className="mx-auto max-w-5xl px-6 sm:px-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.span
            variants={fadeUp}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-navy/10 bg-white px-4 py-1.5 text-sm font-medium text-ink-navy/70"
          >
            Pricing
          </motion.span>
          <motion.h2
            variants={fadeUp}
            className="mt-5 text-balance font-heading text-3xl font-bold tracking-tight text-ink-navy sm:text-4xl"
          >
            Start free. Stay free, if you bring a key.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-base text-ink-navy/60 sm:text-lg">
            BYOK usage never has a cap. Pro just makes the hosted model your daily driver, no key required.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="mt-16 grid gap-6 sm:grid-cols-2"
        >
          {/* Free plan */}
          <motion.div
            variants={fadeUp}
            className="flex flex-col rounded-3xl border border-ink-navy/[0.07] bg-white p-8 shadow-frame sm:p-10"
          >
            <h3 className="font-heading text-xl font-semibold text-ink-navy">Free</h3>
            <p className="mt-1 text-sm text-ink-navy/50">For BYOK users, and anyone getting started</p>
            <div className="mt-6 flex items-baseline gap-1">
              <span className="font-heading text-4xl font-bold tracking-tight text-ink-navy">$0</span>
              <span className="text-sm text-ink-navy/50">forever</span>
            </div>

            <ul className="mt-8 flex flex-1 flex-col gap-3.5">
              {FREE_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-ink-navy/70">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            <CtaButton href="#top" variant="outline" size="lg" className="mt-8 w-full">
              Download for free
            </CtaButton>
          </motion.div>

          {/* Pro plan */}
          <motion.div
            variants={fadeUp}
            className="relative flex flex-col rounded-3xl border border-pink-400/20 bg-ink-navy p-8 text-white shadow-xl sm:p-10"
          >
            <span className="absolute -top-3 right-8 rounded-full bg-gradient-to-r from-pink-500 to-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-md">
              Coming soon
            </span>
            <h3 className="font-heading text-xl font-semibold">Pro</h3>
            <p className="mt-1 text-sm text-white/50">For daily use on the hosted model</p>
            <div className="mt-6 flex items-baseline gap-1">
              <span className="font-heading text-4xl font-bold tracking-tight">$15</span>
              <span className="text-sm text-white/50">/ month</span>
            </div>

            <ul className="mt-8 flex flex-1 flex-col gap-3.5">
              {PRO_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-white/75">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-pink-300" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            {/*
              No payment integration is wired up on the frontend yet — the
              Dodo Payments backend is being built separately, in parallel.
              This is a deliberate disabled/"coming soon" placeholder so the
              visual affordance for the buy button exists now; once checkout
              exists, swap `disabled` for a real `href`/`onClick` here and
              this becomes a one-line change.
            */}
            <CtaButton variant="accent" size="lg" disabled className="mt-8 w-full">
              Coming soon
            </CtaButton>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
