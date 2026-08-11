import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Mic, Play, Share2 } from "lucide-react";
import { ButtonLink, Logo, PageContainer } from "@/components/ProductUI";
import { features } from "@/lib/features";

export function Hero() {
  return (
    <section className="cohesive-hero">
      <PageContainer>
        <p className="cohesive-eyebrow">Live visual communication</p>
        <h1>Turn speaking into a live visual experience.</h1>
        <p>InPublic listens as you speak and turns your thoughts into diagrams, drawings, text and visual stories—in real time.</p>
        <ButtonLink href="/create?new=1">Start speaking <ArrowRight size={15} /></ButtonLink>
      </PageContainer>
    </section>
  );
}

export function ProductProof() {
  return (
    <section id="product" className="product-proof">
      <PageContainer>
        <div className="real-product-frame">
          <div className="real-product-bar"><span><i /> InPublic · Standard Mode</span><span>Live canvas session</span></div>
          <Image src="/product-standard.png" alt="A real InPublic Standard Mode session with spoken ideas organized on the canvas" width={1440} height={900} priority sizes="(max-width: 1120px) 100vw, 1080px" />
          <div className="real-product-caption"><span><Mic size={14} /> Listening as the speaker explains</span><span><Check size={14} /> Editable canvas</span></div>
        </div>
      </PageContainer>
    </section>
  );
}

export function Comparison() {
  return (
    <section className="cohesive-comparison">
      <PageContainer>
        <p className="cohesive-eyebrow">A different outcome from voice</p>
        <h2>InPublic begins where Wispr Flow ends.</h2>
        <div className="comparison-promises">
          <blockquote><span>Wispr Flow</span><p>“Say it, and I&apos;ll type it.”</p></blockquote>
          <blockquote><span>InPublic</span><p>“Say it, and I&apos;ll express it.”</p></blockquote>
        </div>
      </PageContainer>
    </section>
  );
}

const steps = [
  { number: "01", title: "Start speaking", copy: "Talk through the idea naturally. There is no prompt to engineer and no slide to prepare.", image: "/product-standard.png", position: "left" },
  { number: "02", title: "Watch your idea take shape", copy: "Important concepts, relationships, drawings and scenes appear while your thought develops.", image: "/product-standard.png", position: "center" },
  { number: "03", title: "Refine and share", copy: "Edit the native canvas, continue the thought, or export the session in a useful format.", image: "/product-story-scene.png", position: "right" },
];

export function HowItWorks() {
  return (
    <section className="cohesive-section">
      <PageContainer>
        <div className="cohesive-heading"><p className="cohesive-eyebrow">One continuous flow</p><h2>From thought to something people can follow.</h2></div>
        <div className="proof-steps">
          {steps.map((step) => <article key={step.number}><div className="proof-crop"><Image src={step.image} alt="" fill loading="lazy" sizes="(max-width: 720px) 100vw, 33vw" style={{ objectPosition: step.position }} /></div><span>{step.number}</span><h3>{step.title}</h3><p>{step.copy}</p></article>)}
        </div>
      </PageContainer>
    </section>
  );
}

// Story Mode is parked (lib/features.ts) — the two Story examples keep
// their images (removing them would leave a lopsided 3-column grid) but
// their caption no longer claims it's a mode you can pick today.
const examples = [
  { src: "/product-standard.png", title: "Explain a system", type: "Standard Mode" },
  { src: "/product-story-scene.png", title: "Build a living scene", type: features.storyMode ? "Story Mode" : "Coming soon" },
  { src: "/product-story.png", title: "Tell a visual story", type: features.storyMode ? "Story Mode" : "Coming soon" },
];

export function ExamplesGallery() {
  return (
    <section id="examples" className="cohesive-section examples-section">
      <PageContainer>
        <div className="cohesive-heading"><p className="cohesive-eyebrow">Real InPublic sessions</p><h2>Ideas do not all need the same shape.</h2></div>
        <div className="examples-gallery">{examples.map((example) => <figure key={example.title}><div><Image src={example.src} alt={`${example.title} in InPublic`} fill loading="lazy" sizes="(max-width: 720px) 100vw, 33vw" /></div><figcaption><strong>{example.title}</strong><span>{example.type}</span></figcaption></figure>)}</div>
      </PageContainer>
    </section>
  );
}

export function UseCases() {
  return (
    <section className="cohesive-section use-case-strip"><PageContainer><p className="cohesive-eyebrow">Made for explaining</p><h2>For creators, founders, teachers and people who think out loud.</h2><p>Use InPublic when a talking head is not enough, a slide deck is too slow, or the idea becomes clearer when people can watch it form.</p></PageContainer></section>
  );
}

const pricing = [
  { name: "Free", description: "Try the live canvas and create your first visual sessions.", features: ["Standard Mode", ...(features.storyMode ? ["Limited Story Mode"] : []), "20-minute recording limit", "Editable exports"], href: "/create?new=1", cta: "Start speaking" },
  { name: "Creator", description: "The complete recording and visual-story workflow, currently in early access.", features: [features.storyMode ? "Standard and Story Mode" : "Standard Mode", "Camera and microphone recording", "Session history", "Full canvas exports"], href: "/dashboard", cta: "Start speaking" },
];

export function Pricing() {
  return (
    <section id="pricing" className="cohesive-section"><PageContainer><div className="cohesive-heading"><p className="cohesive-eyebrow">Simple pricing</p><h2>Start with the idea.</h2><p>Billing is not connected in this preview. No payment will be taken.</p></div><div className="cohesive-pricing">{pricing.map((plan) => <article key={plan.name}><h3>{plan.name}</h3><p>{plan.description}</p><ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul><ButtonLink href={plan.href} tone={plan.name === "Free" ? "secondary" : "primary"}>{plan.cta}</ButtonLink></article>)}</div></PageContainer></section>
  );
}

const questions = [
  ["Is InPublic a transcription tool?", "No. InPublic uses live speech as the input, then creates an editable visual explanation from the meaning and relationships inside it."],
  ["Can I edit what InPublic creates?", "Yes. The canvas is made from native editable elements, so you can move, rename, resize and reconnect the result."],
  ["What can I export?", "The current canvas supports PNG, SVG, Excalidraw and JSON. Recordings can be exported as WebM, and the session log can be downloaded."],
  ...(features.storyMode ? [["Does Story Mode generate images?", "No. Story Mode composes persistent, editable canvas drawings and keeps the same characters and objects as a scene changes."]] : []),
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
    <footer className="cohesive-footer"><PageContainer><div><Logo /><p>InPublic turns speaking into a live visual experience.</p></div><nav aria-label="Footer navigation"><a href="#product">Product</a><a href="#examples">Examples</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link><Link href="/dashboard"><Share2 size={13} /> Dashboard</Link></nav></PageContainer></footer>
  );
}
