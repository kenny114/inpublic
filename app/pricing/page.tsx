import Link from "next/link";
import { Check } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/ProductUI";
import { CreatorCheckoutButton } from "@/components/CreatorCheckoutButton";
import { LandingFooter } from "@/components/landing/LandingSections";
import { VisualDemo } from "@/components/VisualDemo";
import { foundingPlacesRemaining } from "@/lib/server/entitlement";
import { FOUNDING_PLACES, FOUNDING_TIERS, PLAN_DEFINITIONS, minutesOf } from "@/lib/plans";

// The founding count is a real database read. Cached for five minutes so a
// public page isn't one query per visitor, and short enough that the number
// is never meaningfully stale.
export const revalidate = 300;

const free = PLAN_DEFINITIONS.free;
const creator = PLAN_DEFINITIONS.creator;

const freeFeatures = [
  "Standard Mode — live visual speaking",
  "Editable canvas and every export format",
  "Session recording",
  "No credit card required",
];

const creatorFeatures = [
  "Everything in Free",
  `${minutesOf(creator.allowanceSeconds) / minutesOf(free.allowanceSeconds)}× the monthly visual-speech minutes`,
  "Hour-long sessions for full explanations and lessons",
  "Same models, canvas and export quality — just more time",
];

const foundingRows = [
  ...FOUNDING_TIERS.map((tier, index) => ({
    range: index === 0 ? `1–${tier.upTo}` : `${FOUNDING_TIERS[index - 1].upTo + 1}–${tier.upTo}`,
    minutes: minutesOf(tier.allowanceSeconds),
  })),
  { range: `After ${FOUNDING_PLACES}`, minutes: minutesOf(creator.allowanceSeconds) },
];

export default async function PricingPage() {
  // Never invent scarcity. If the count can't be resolved, no count is shown.
  const remaining = await foundingPlacesRemaining().catch(() => null);

  return (
    <main className="landing-page min-h-screen bg-white">
      <SiteHeader />

      <section className="pricing-hero">
        <PageContainer>
          <p className="cohesive-eyebrow">Pricing</p>
          <h1>Speak more. Keep everything visual.</h1>
          <p>Try InPublic free. Upgrade when you need more live time.</p>
        </PageContainer>
      </section>

      <section className="pricing-plans">
        <PageContainer>
          <div className="plan-grid">
            <article className="plan-card">
              <h2>Free</h2>
              <p className="plan-price">$0<span>/month</span></p>
              <p className="plan-summary">Try the live canvas and watch a spoken idea become a diagram.</p>
              <div className="plan-highlights">
                <div><strong>{minutesOf(free.allowanceSeconds)} min</strong><span>visual-speech time / month</span></div>
                <div><strong>{minutesOf(free.maxSessionSeconds)} min</strong><span>maximum session length</span></div>
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
                <div><strong>{minutesOf(creator.allowanceSeconds)} min</strong><span>visual-speech time / month</span></div>
                <div><strong>{minutesOf(creator.maxSessionSeconds)} min</strong><span>maximum session length</span></div>
              </div>
              <ul>{creatorFeatures.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
              <CreatorCheckoutButton />
              <p className="plan-fineprint">Checkout is handled securely by Whop. Cancel any time.</p>
            </article>
          </div>
        </PageContainer>
      </section>

      {/* What a visual-speech minute actually buys, shown rather than described. */}
      <section className="pricing-proof">
        <PageContainer>
          <div className="cohesive-heading">
            <p className="cohesive-eyebrow">What the minutes buy</p>
            <h2>This is one spoken explanation, start to finish.</h2>
          </div>
          <VisualDemo id="demo-c" caption={null} />
          <div className="pricing-proof-copy">
            <p><strong>Free gives you {minutesOf(free.allowanceSeconds)} minutes every month.</strong> Enough to try the canvas and make a handful of short explanations.</p>
            <p><strong>Creator gives you {minutesOf(creator.allowanceSeconds)} minutes.</strong> Room for meetings, lessons, full explanations and recordings — in sessions up to an hour.</p>
          </div>
        </PageContainer>
      </section>

      <section className="pricing-founding">
        <PageContainer>
          <div className="founding-card">
            <div className="founding-copy">
              <p className="cohesive-eyebrow">Founding {FOUNDING_PLACES}</p>
              <h2>The first {FOUNDING_PLACES} Creator members keep a larger allowance.</h2>
              <p>Same $15 subscription, same product. Your founding allowance holds for as long as you stay subscribed.</p>
              {remaining !== null && remaining > 0 ? (
                <p className="founding-remaining">{remaining} founding {remaining === 1 ? "place" : "places"} remaining</p>
              ) : null}
            </div>
            <table className="founding-table">
              <tbody>
                {foundingRows.map((row) => (
                  <tr key={row.range}><th scope="row">{row.range}</th><td>{row.minutes} min</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pricing-trust">
            One active listening session at a time on either plan. Returning from checkout does not change access on its
            own — InPublic waits for a verified membership before your allowance moves.
          </p>
        </PageContainer>
      </section>

      <LandingFooter />
    </main>
  );
}
