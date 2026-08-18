import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Play, Share2 } from "lucide-react";
import { ButtonLink, Logo, PageContainer } from "@/components/ProductUI";
import { VisualDemo, VisualDemoTabs } from "@/components/VisualDemo";
import { VISUAL_DEMOS, visualDemo } from "@/lib/demos";
import { PLAN_DEFINITIONS, minutesOf } from "@/lib/plans";

const FREE_MINUTES = minutesOf(PLAN_DEFINITIONS.free.allowanceSeconds);
const CREATOR_MINUTES = minutesOf(PLAN_DEFINITIONS.creator.allowanceSeconds);

export function Hero() {
  return (
    <section className="cohesive-hero">
      <PageContainer>
        <p className="cohesive-eyebrow">For creators who explain on camera</p>
        <h1>You explain. The board carries the video.</h1>
        <p>Talk through the idea. When a thought has a shape — a process, a because, a from-to — the sentence becomes the drawing, while you&apos;re still talking.</p>
        <ButtonLink href="/create?new=1">Start speaking <ArrowRight size={15} /></ButtonLink>
      </PageContainer>
    </section>
  );
}

/**
 * The first thing below the headline is the product running. A visitor should
 * see speech become structure before they have read a second paragraph, so
 * this is a real recording rather than a screenshot, and it is the only demo
 * on the page that loads eagerly.
 */
export function HeroDemo() {
  return (
    <section id="product" className="product-proof">
      <PageContainer>
        <VisualDemo id="demo-a" priority caption={null} />
      </PageContainer>
    </section>
  );
}

/**
 * The static-vs-live argument, made with a real recording rather than a
 * fabricated side-by-side mockup: this session is InPublic talking about
 * exactly this contrast while the visual layer forms around the words.
 */
export function Transformation() {
  const demo = visualDemo("demo-transform");
  return (
    <section className="cohesive-section transform-section">
      <PageContainer>
        <div className="transform-split">
          <div className="transform-copy">
            <p className="cohesive-eyebrow">What changes</p>
            <h2>Your explanation is already good. It&apos;s just a talking head.</h2>
            <p>
              The usual move is adding diagrams afterward — if you add them at all. InPublic
              builds that layer while you speak, from what you actually say.
            </p>
          </div>
          <VisualDemo id={demo.id} caption={demo.caption} className="transform-video" />
        </div>
      </PageContainer>
    </section>
  );
}

/**
 * Three real sessions behind one selector. Stacking three videos would bury
 * the third and cost three downloads; one large canvas keeps the recording
 * the subject of the section.
 */
export function DemoShowcase() {
  return (
    <section id="examples" className="cohesive-section demo-showcase">
      <PageContainer>
        <div className="cohesive-heading">
          <p className="cohesive-eyebrow">Real recorded sessions</p>
          <h2>See what happens when you speak.</h2>
        </div>
        <VisualDemoTabs />
      </PageContainer>
    </section>
  );
}

const steps = [
  { number: "01", title: "Start speaking", copy: "Talk through the idea naturally. Nothing to prompt, nothing to prepare." },
  { number: "02", title: "Watch it take shape", copy: "Words land immediately. Concepts and the relationships between them follow as the thought finishes." },
  { number: "03", title: "Keep it", copy: "The canvas is editable. Save the session, record it, or export it." },
];

export function HowItWorks() {
  return (
    <section className="cohesive-section">
      <PageContainer>
        <div className="cohesive-heading"><p className="cohesive-eyebrow">One continuous flow</p><h2>From thought to something people can follow.</h2></div>
        <div className="proof-steps">
          {steps.map((step, index) => (
            <article key={step.number}>
              <div className="proof-crop">
                <Image src={VISUAL_DEMOS[index].poster} alt="" fill loading="lazy" sizes="(max-width: 720px) 100vw, 33vw" />
              </div>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}

export function UseCases() {
  const demo = visualDemo("demo-forwho");
  return (
    <section className="cohesive-section use-case-strip">
      <PageContainer>
        <div className="use-case-split">
          <div className="use-case-copy">
            <p className="cohesive-eyebrow">Made for explaining</p>
            <h2>For people who record explanations and are tired of their face being the only visual.</h2>
            <p>Use InPublic when a talking head is not enough and a slide deck is too slow. Mute the video. You should still be able to follow the idea.</p>
            <blockquote className="use-case-quote">
              &ldquo;The problem is not that the ideas are boring. The problem is that the visual layer is missing.&rdquo;
            </blockquote>
          </div>
          <VisualDemo id={demo.id} caption={null} className="use-case-video" />
        </div>
      </PageContainer>
    </section>
  );
}

const pricing = [
  {
    name: "Free",
    description: "Try the live canvas and make your first visual sessions.",
    features: [`${FREE_MINUTES} visual-speech minutes each month`, "20-minute maximum session", "Editable canvas and every export"],
    href: "/create?new=1",
    cta: "Start speaking",
  },
  {
    name: "Creator",
    description: "For people who explain things every week.",
    features: [`${CREATOR_MINUTES} visual-speech minutes each month`, "60-minute maximum session", "Founding 100 keep a larger allowance"],
    href: "/pricing",
    cta: "See Creator",
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="cohesive-section"><PageContainer><div className="cohesive-heading"><p className="cohesive-eyebrow">Simple pricing</p><h2>Start with the idea.</h2><p>Free to begin. Upgrade when you need more live time — the product is identical on both plans.</p></div><div className="cohesive-pricing">{pricing.map((plan) => <article key={plan.name}><h3>{plan.name}</h3><p>{plan.description}</p><ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul><ButtonLink href={plan.href} tone={plan.name === "Free" ? "secondary" : "primary"}>{plan.cta}</ButtonLink></article>)}</div></PageContainer></section>
  );
}

const questions = [
  ["Is InPublic a transcription tool?", "No. InPublic uses live speech as the input, then creates an editable visual explanation from the meaning and relationships inside it."],
  ["Can I edit what InPublic creates?", "Yes. The canvas is made from native editable elements, so you can move, rename, resize and reconnect the result."],
  ["What is a visual-speech minute?", "A minute of live listening. It is only counted while InPublic is actually listening to you speak — editing, reviewing and exporting cost nothing."],
  ["What can I export?", "The current canvas supports PNG, SVG, Excalidraw and JSON. Recordings can be exported as video, and the session log can be downloaded."],
  ["What does InPublic actually draw?", "Structure: headings, emphasis, boxes, arrows and labels that track what you're saying and how the ideas connect — not cinematic animation. Every demo on this page is an unedited recording of that."],
];

export function FAQ() {
  return (
    <section id="faq" className="cohesive-section faq-section"><PageContainer><div className="cohesive-heading"><p className="cohesive-eyebrow">FAQ</p><h2>What to expect when you start.</h2></div><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></PageContainer></section>
  );
}

export function FinalCta() {
  return (
    <section className="cohesive-final"><PageContainer><Play size={24} /><h2>Turn your next explanation into something people can see.</h2><ButtonLink href="/create?new=1">Start speaking <ArrowRight size={15} /></ButtonLink></PageContainer></section>
  );
}

export function LandingFooter() {
  return (
    <footer className="cohesive-footer"><PageContainer><div><Logo /><p>InPublic turns speaking into a live visual experience.</p></div><nav aria-label="Footer navigation"><a href="#product">Product</a><a href="#examples">Examples</a><Link href="/pricing">Pricing</Link><a href="#faq">FAQ</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link><Link href="/dashboard"><Share2 size={13} /> Dashboard</Link></nav></PageContainer></footer>
  );
}
