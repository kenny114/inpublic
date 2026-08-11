import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { CreatorCheckoutButton } from "@/components/CreatorCheckoutButton";
import { features } from "@/lib/features";

const shared = [features.storyMode ? "Standard and Story Mode" : "Standard Mode", "Visualization intelligence", "Camera recording and voice commands", "Editable canvas and every export format", "Identical video quality", "No watermark"];
const plans = [
  { name: "Free", price: "$0", time: "30 visual-speech minutes each UTC calendar month", max: "20-minute maximum session" },
  { name: "Creator", price: "$15/month", time: "200 visual-speech minutes each verified billing period", max: "60-minute maximum session" },
];

export default function PricingPage() {
  return <main className="min-h-screen bg-white"><SiteHeader /><section className="section-shell"><div className="section-heading"><p className="eyebrow">Pricing</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.04em] sm:text-5xl">The same InPublic experience. More time when you need it.</h1><p className="section-copy">Both plans use the same modes, AI models, canvas, recording quality and exports. The only difference is available visual-speech time.</p></div><div className="grid gap-5 lg:grid-cols-2">{plans.map((plan) => <article key={plan.name} className="pricing-card"><p className="eyebrow">{plan.name}</p><h2 className="price">{plan.price}</h2><p className="leading-7 text-zinc-600">{plan.time}. {plan.max}. One active listening session at a time.</p><ul className="feature-list">{shared.map((feature) => <li key={feature}><span className="text-indigo-600">✓</span>{feature}</li>)}</ul>{plan.name === "Creator" ? <CreatorCheckoutButton /> : <Link href="/create?new=1" className="button-secondary mt-8">Start free</Link>}</article>)}</div><p className="mt-8 text-sm leading-6 text-zinc-500">Creator checkout is handled securely by Whop. Returning from checkout does not change access; InPublic waits for a verified membership webhook or server reconciliation.</p></section></main>;
}
