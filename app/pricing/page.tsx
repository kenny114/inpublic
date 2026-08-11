import Image from "next/image";
import Link from "next/link";
import { Check, Mic } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/ProductUI";
import { CreatorCheckoutButton } from "@/components/CreatorCheckoutButton";
import { features } from "@/lib/features";

const freeFeatures = [
  features.storyMode ? "Standard and Story Mode" : "Standard Mode",
  "Camera recording and voice commands",
  "Editable canvas and every export format",
  "No credit card required",
];

const creatorFeatures = [
  "Everything in Free",
  "Nearly 7x the monthly visual-speech minutes",
  "Longer sessions for full-length explanations",
  "Same models, canvas and export quality — just more time",
];

export default function PricingPage() {
  return (
    <main className="landing-page min-h-screen bg-white">
      <SiteHeader />

      <section className="pricing-hero">
        <PageContainer>
          <p className="cohesive-eyebrow">Pricing</p>
          <h1>Choose how much time you need to think out loud.</h1>
          <p>
            Free and Creator run the identical product — same visualization intelligence, same canvas, same export
            quality. The only thing you&apos;re buying is more visual-speech time per month.
          </p>
        </PageContainer>
      </section>

      <section className="pricing-proof">
        <PageContainer>
          <div className="real-product-frame">
            <div className="real-product-bar">
              <span><i /> InPublic · Standard Mode</span>
              <span>Live canvas session</span>
            </div>
            <Image
              src="/product-standard.png"
              alt="A real InPublic session with spoken ideas organized into an editable canvas"
              width={1440}
              height={900}
              sizes="(max-width: 1120px) 100vw, 1080px"
            />
            <div className="real-product-caption">
              <span><Mic size={14} /> Listening as the speaker explains</span>
              <span><Check size={14} /> Editable canvas</span>
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="pricing-plans">
        <PageContainer>
          <div className="plan-grid">
            <article className="plan-card">
              <h2>Free</h2>
              <p className="plan-price">$0<span>/month</span></p>
              <p className="plan-summary">Try the live canvas and see a spoken idea become a diagram.</p>
              <div className="plan-highlights">
                <div><strong>30 min</strong><span>visual-speech time / month</span></div>
                <div><strong>20 min</strong><span>maximum session length</span></div>
              </div>
              <ul>{freeFeatures.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
              <Link href="/create?new=1" className="ui-button ui-button-secondary">Start free</Link>
            </article>

            <article className="plan-card featured">
              <span className="plan-badge">For regular use</span>
              <h2>Creator</h2>
              <p className="plan-price">$15<span>/month</span></p>
              <p className="plan-summary">For creators, teachers and founders who explain things every week.</p>
              <div className="plan-highlights">
                <div><strong>200 min</strong><span>visual-speech time / billing period</span></div>
                <div><strong>60 min</strong><span>maximum session length</span></div>
              </div>
              <ul>{creatorFeatures.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
              <CreatorCheckoutButton />
            </article>
          </div>

          <p className="pricing-trust">
            One active listening session at a time on either plan. Creator checkout is handled securely by Whop —
            returning from checkout does not change access; InPublic waits for a verified membership webhook or
            server reconciliation.
          </p>
        </PageContainer>
      </section>
    </main>
  );
}
