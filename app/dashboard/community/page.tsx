import { PageHeader } from "@/components/DashboardUI";
import { DISCORD_URL } from "@/lib/product";
import { features } from "@/lib/features";

const reasons = [
  "Early access and development updates",
  "Product feedback and feature requests",
  "Bug reports",
  ...(features.storyMode ? ["Story Mode experiments"] : []),
  "Creator examples",
  "New visual asset suggestions",
];

export default function CommunityPage() {
  return (
    <div>
      <PageHeader
        title="Help & community"
        description="The Discord is the fastest way to get help, show what you made, and tell us what the canvas should do next."
      />
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">What people use it for</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2.5 text-sm text-zinc-600">
              <span aria-hidden className="text-indigo-500">✓</span>
              {reason}
            </li>
          ))}
        </ul>
        <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="mt-6 inline-flex rounded-lg bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Join the Discord
        </a>
      </div>
    </div>
  );
}
