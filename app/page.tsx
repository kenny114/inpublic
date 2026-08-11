import { SiteHeader } from "@/components/SiteHeader";
import {
  Comparison,
  DemoShowcase,
  FAQ,
  FinalCta,
  Hero,
  HeroDemo,
  HowItWorks,
  LandingFooter,
  Pricing,
  UseCases,
} from "@/components/landing/LandingSections";

export default function Page() {
  return (
    <main className="landing-page">
      <SiteHeader />
      <Hero />
      <HeroDemo />
      <DemoShowcase />
      <Comparison />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <FAQ />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
