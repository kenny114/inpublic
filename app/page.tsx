import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { DISCORD_URL } from "@/lib/product";

const features = [
  ["Build in public", "Show what you are building without making your face the main focus."],
  ["Teaching", "Make lessons visible as you explain them."],
  ["Meetings", "Help people see what you mean while you are speaking."],
  ["Presentations", "Turn your explanation into a visual presentation."],
  ["Storytelling", "Let simple scenes form as a story unfolds."],
];

const Check = () => <span aria-hidden="true" className="text-indigo-600">✓</span>;

export default function Page() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-5 pb-20 pt-24 text-center sm:pt-32">
        <p className="mb-5 text-sm font-medium text-indigo-600">Voice-to-visual thinking and storytelling</p>
        <h1 className="mx-auto max-w-4xl text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">
          Speak naturally.<br />Watch your ideas take shape.
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-pretty text-lg leading-8 text-zinc-600">
          InPublic listens while you speak and turns your thoughts into live visual explanations, diagrams, and simple sketches.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard" className="rounded-lg bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">Try InPublic</Link>
          <a href="#how-it-works" className="rounded-lg border border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">See how it works</a>
        </div>
        <p className="mt-5 text-sm text-zinc-500">Your voice becomes the starting point. Your ideas become visible.</p>

        <div className="product-frame mt-14">
          <Image src="/product-standard.png" alt="A real InPublic Standard Mode session showing live concepts and relationships on the canvas" width={1440} height={900} priority className="h-auto w-full" />
        </div>
      </section>

      <section id="product" className="border-y border-zinc-200 bg-zinc-50/60 py-20">
        <div className="mx-auto grid max-w-5xl gap-8 px-5 md:grid-cols-2">
          <div><p className="eyebrow">Voice-to-text</p><h2 className="mt-3 text-2xl font-semibold">“Say it, and I’ll type it.”</h2><p className="mt-3 text-zinc-600">Voice-to-text tools help you write faster.</p></div>
          <div><p className="eyebrow text-indigo-600">InPublic</p><h2 className="mt-3 text-2xl font-semibold">“Say it, and I’ll make it visible.”</h2><p className="mt-3 text-zinc-600">InPublic helps you think and explain visually. It begins where voice dictation ends.</p></div>
        </div>
      </section>

      <section id="how-it-works" className="section-shell">
        <div className="section-heading"><p className="eyebrow">How it works</p><h2>From explanation to shareable visual</h2></div>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 md:grid-cols-3">
          {[["01", "Speak", "Explain what you are building, teaching, presenting, or imagining."], ["02", "See", "InPublic turns your words into references, relationships, diagrams, or simple sketches."], ["03", "Share", "Record, export, and share the visual explanation."]].map(([number, title, body]) => (
            <div key={title} className="bg-white p-7"><span className="text-sm font-medium text-indigo-600">{number}</span><h3 className="mt-10 text-xl font-semibold">{title}</h3><p className="mt-2 leading-7 text-zinc-600">{body}</p></div>
          ))}
        </div>
      </section>

      <section id="standard" className="section-shell grid items-center gap-12 lg:grid-cols-[.8fr_1.2fr]">
        <div><p className="eyebrow">Standard Mode</p><h2>Make complex ideas easier to follow.</h2><p className="section-copy">Explain ideas, products, systems, and projects while InPublic organizes the important parts around your words.</p><ul className="feature-list">{["Live transcript", "Titles and references", "Boxes and relationships", "Bound arrows", "Page-based organization", "Reference and return", "Record and export"].map((item) => <li key={item}><Check />{item}</li>)}</ul></div>
        <div className="product-frame"><Image src="/product-standard.png" alt="Real Standard Mode canvas in InPublic" width={1440} height={900} priority className="h-auto w-full" /></div>
      </section>

      <section id="story" className="section-shell grid items-center gap-12 lg:grid-cols-[1.2fr_.8fr]">
        <div className="product-frame lg:order-1"><Image src="/product-story-scene.png" alt="Real Story Mode canvas export with a cat moving from a tree toward water on a sunny day" width={984} height={688} className="h-auto w-full" /></div>
        <div className="lg:order-2"><p className="eyebrow">Story Mode · Evolving</p><h2>Tell a story and see it appear.</h2><p className="section-copy">Watch simple characters, objects, places, and actions appear as you speak. Story Mode uses procedural Excalidraw-style sketches—not realistic AI images.</p><ul className="feature-list">{["Persistent characters and objects", "Pose and action changes", "Scene relationships", "Simple procedural sketches", "Story continuity", "Page-based scenes"].map((item) => <li key={item}><Check />{item}</li>)}</ul></div>
      </section>

      <section className="section-shell"><div className="section-heading"><p className="eyebrow">Built for explaining</p><h2>Keep the idea in focus.</h2></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">{features.map(([title, body]) => <div key={title} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,.03)]"><h3 className="font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-zinc-600">{body}</p></div>)}</div></section>

      <section id="recording" className="section-shell"><div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 sm:p-12"><p className="eyebrow">Recording</p><h2>Record the explanation, not just the transcript.</h2><p className="section-copy max-w-2xl">Capture the live canvas and microphone, with an optional face camera. Pause the recording while InPublic keeps listening and drawing, then export a WebM with its transcript and session state.</p><div className="mt-8 flex flex-wrap gap-2">{["Canvas", "Microphone", "Optional camera", "Standard + Story", "Session metadata", "WebM export"].map((item) => <span key={item} className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700">{item}</span>)}</div></div></section>

      <section className="section-shell grid gap-10 border-y border-zinc-200 lg:grid-cols-2"><div><p className="eyebrow">Product principles</p><h2>Simple visuals. Clear control.</h2></div><ul className="grid gap-3 text-zinc-700">{["The idea stays in focus", "The canvas responds while you speak", "Simple visuals are better than visual noise", "The user remains in control", "Standard and Story Mode have different purposes", "The system makes thinking visible—it does not replace the speaker"].map((item) => <li key={item} className="flex gap-3 border-b border-zinc-100 pb-3"><Check />{item}</li>)}</ul></section>

      <section id="foundation" className="section-shell"><div className="max-w-3xl"><p className="eyebrow">Open visual canvas foundation</p><h2>A familiar canvas, with a live intelligence layer.</h2><p className="section-copy">InPublic is built on an open visual canvas foundation. The hosted product adds the intelligence, recording, organization, and storytelling layer. Self-hosting is planned for a future release.</p></div></section>

      <section id="pricing" className="section-shell"><div className="section-heading"><p className="eyebrow">Early-access pricing</p><h2>One hosted plan. No setup.</h2></div><div className="grid gap-5 lg:grid-cols-2"><div className="pricing-card"><p className="eyebrow">Free trial</p><h3>Try the live canvas</h3><p className="price">$0</p><ul className="feature-list">{["Try Standard Mode", "Limited Story Mode", "Up to 20 minutes per recording", "Up to 5 locally saved sessions", "Limited recording and export usage"].map((item) => <li key={item}><Check />{item}</li>)}</ul><Link href="/dashboard" className="button-secondary mt-8">Try InPublic</Link></div><div className="pricing-card border-indigo-200"><p className="eyebrow text-indigo-600">InPublic Cloud</p><h3>Hosted convenience</h3><p className="price">$10<span>/month</span></p><ul className="feature-list">{["Hosted experience—no API keys", "Standard and Story Mode", "Saved cloud sessions", "Recording and export", "Visual vocabulary", "Discord community", "Usage, AI processing, and storage limits shown before launch"].map((item) => <li key={item}><Check />{item}</li>)}</ul><Link href="/dashboard" className="button-primary mt-8">Start creating</Link></div></div><p className="mt-5 text-sm text-zinc-500">Pricing and usage limits may evolve during early access. Payments are not enabled in this preview. No charge will be made.</p></section>

      <section id="discord" className="section-shell text-center"><div className="rounded-2xl border border-zinc-200 p-10 sm:p-16"><p className="eyebrow">Community</p><h2>Build the future of visual thinking with us.</h2><p className="mx-auto mt-5 max-w-2xl leading-7 text-zinc-600">Join the InPublic Discord to share experiments, report bugs, suggest visual assets, and help shape Standard Mode and Story Mode.</p><a href={DISCORD_URL} target="_blank" rel="noreferrer" className="button-secondary mt-8">Join the Discord</a></div></section>

      <section className="border-t border-zinc-200 px-5 py-24 text-center"><h2 className="text-4xl font-semibold tracking-[-.035em]">Your ideas are already in your head.<br />Make them visible.</h2><Link href="/dashboard" className="button-primary mt-8">Try InPublic</Link></section>
      <footer className="border-t border-zinc-200"><div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between"><span className="font-semibold text-zinc-900">InPublic</span><nav className="flex flex-wrap gap-5"><a href="#product">Product</a><a href="#pricing">Pricing</a><a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link><a href="#foundation">Future self-hosting</a></nav></div></footer>
    </main>
  );
}
