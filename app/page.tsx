import { SiteHeader } from "@/components/SiteHeader";
import {
  DemoShowcase,
  FAQ,
  FinalCta,
  Hero,
  HeroDemo,
  HowItWorks,
  LandingFooter,
  Pricing,
  Transformation,
  UseCases,
} from "@/components/landing/LandingSections";

export default function Page() {
  return (
    <main className="landing-page">
      <SiteHeader />
      <Hero />
      <HeroDemo />
      <Transformation />
      <DemoShowcase />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <FAQ />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
