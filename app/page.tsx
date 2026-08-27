import { Waitlist } from "@/components/Waitlist";

// The full marketing page (components/landing/LandingSections.tsx) is still
// here for when the product is ready to show — while the build is in
// progress, the waitlist is the only thing worth asking a visitor for.
export default function Page() {
  return <Waitlist />;
}
