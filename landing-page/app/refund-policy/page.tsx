import DocHeader from "../docs/_components/DocHeader";
import Callout from "../docs/_components/Callout";

export default function RefundPolicyPage() {
  return (
    <article className="docs-prose">
      <DocHeader eyebrow="Legal" title="Refund Policy">
        LakshX doesn&rsquo;t have a live paid plan yet — the hosted model is currently free, within its budget
        caps. This page sets out the refund policy we intend to run once paid plans launch, so it&rsquo;s in
        place from day one rather than written after the fact.
      </DocHeader>

      <Callout variant="note" title="All sales are final">
        Once paid plans launch, <strong>we do not issue refunds</strong> for any subscription charge or
        consumed usage credit, except where applicable law requires otherwise. If you have questions about
        billing, email <a href="mailto:contact@lakshx.in">contact@lakshx.in</a> before you subscribe.
      </Callout>

      <p className="text-sm text-white/50">
        <em>Last updated: July 20, 2026</em>
      </p>

      <h2>1. Current Status: No Paid Plans Yet</h2>
      <p>
        As of this writing, LakshX&rsquo;s hosted AI model is offered free of charge, subject to a per-user
        budget cap and an overall budget ceiling. No payment is currently required to use it, so there is
        nothing to refund today. This policy describes how refunds will work once we introduce paid
        subscriptions and/or usage-based credits.
      </p>

      <h2>2. No Refunds</h2>
      <p>
        <strong>All charges are final and non-refundable</strong> once processed — this applies to
        subscription charges (including your first charge and every renewal) and to usage-based credits,
        whether consumed or unused. We do not offer a money-back window, pro-rated refunds for early
        cancellation, or partial refunds for unused portions of a billing period.
      </p>
      <p>
        If you cancel a subscription, you&rsquo;ll retain access through the end of the billing period you&rsquo;ve
        already paid for, and will not be charged again — but the charge already made is not refunded.
      </p>
      <p>
        The only exception is where applicable law gives you a non-waivable right to a refund (for example,
        certain consumer-protection statutes) or at our sole discretion in a genuinely exceptional case, such
        as a clear billing error on our part (e.g. a duplicate charge) or an extended outage that made the
        Service entirely unusable. These are handled case by case and are not a guarantee.
      </p>
      {/*
        FOUNDER TODO: confirm this no-refunds stance is compliant with the
        consumer-protection rules of whatever jurisdictions you actually sell
        into once real payments launch — some jurisdictions (e.g. certain EU
        cooling-off-period rules) can override a stated no-refunds policy for
        specific cases regardless of what this page says. Have this checked
        alongside the payment-provider/tax review already flagged elsewhere.
      */}

      <h2>3. How to Reach Us</h2>
      <p>
        Before subscribing, if you have any questions about billing, pricing, or what&rsquo;s included, email{" "}
        <a href="mailto:contact@lakshx.in">contact@lakshx.in</a> — we&rsquo;d rather answer a question upfront
        than handle a dispute after the fact.
      </p>

      <h2>5. Chargebacks</h2>
      <p>
        We&rsquo;d rather resolve a billing issue directly — please reach out before filing a chargeback with
        your bank or card provider. Accounts with an open, unresolved chargeback may be suspended while the
        dispute is investigated.
      </p>

      <h2>6. Changes to This Policy</h2>
      <p>
        This policy will be revisited and updated once actual pricing and payment mechanics are finalized, and
        may change thereafter as our plans evolve. We&rsquo;ll update the &ldquo;Last updated&rdquo; date above
        whenever we do.
      </p>
    </article>
  );
}
