import { SiteHeader } from "@/components/SiteHeader";
import {
  Comparison,
  ExamplesGallery,
  FAQ,
  FinalCta,
  Hero,
  HowItWorks,
  LandingFooter,
  Pricing,
  ProductProof,
  UseCases,
} from "@/components/landing/LandingSections";

export default function Page() {
  return (
    <main className="landing-page">
      <SiteHeader />
      <Hero />
      <ProductProof />
      <Comparison />
      <HowItWorks />
      <ExamplesGallery />
      <UseCases />
      <Pricing />
      <FAQ />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
