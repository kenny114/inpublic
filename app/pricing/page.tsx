import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { billing } from "@/lib/billing";

const plans = [
  { name: "Free trial", price: "$0", description: "Learn the live canvas before choosing a hosted plan.", features: ["Standard Mode", "Limited Story Mode", "20-minute recording limit", "5 locally saved sessions", "Limited exports"] },
  { name: "InPublic Cloud", price: "$10/month", description: "The hosted application with no setup or API-key configuration.", features: ["Standard and Story Mode", "Saved cloud sessions", "Recording and WebM export", "Visual vocabulary", "Discord community", "Published AI, storage, and recording limits before launch"] },
];

export default function PricingPage() {
  return <main className="min-h-screen bg-white"><SiteHeader /><section className="section-shell"><div className="section-heading"><p className="eyebrow">Pricing</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.04em] sm:text-5xl">Hosted convenience, without a complicated tier chart.</h1><p className="section-copy">InPublic Cloud will include managed speech and AI processing. A future self-hosted/BYOK option is planned, but is not available today.</p></div><div className="grid gap-5 lg:grid-cols-2">{plans.map((plan) => <article key={plan.name} className="pricing-card"><p className="eyebrow">{plan.name}</p><h2 className="price">{plan.price}</h2><p className="leading-7 text-zinc-600">{plan.description}</p><ul className="feature-list">{plan.features.map((feature) => <li key={feature}><span className="text-indigo-600">✓</span>{feature}</li>)}</ul><Link href="/dashboard" className={plan.name === "InPublic Cloud" ? "button-primary mt-8" : "button-secondary mt-8"}>{billing.configured ? "Continue" : "Start creating"}</Link></article>)}</div><div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><strong>Early-access preview:</strong> billing is not connected, no payment will be taken, and hosted usage/storage allowances are not final. Limits will be shown before checkout is enabled.</div></section></main>;
}
