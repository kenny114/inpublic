import { PageHeader } from "@/components/DashboardUI";
import { VocabularyEditor } from "@/components/VocabularyEditor";

export default function VocabularyPage() {
  return (
    <div>
      <PageHeader
        title="Visual vocabulary"
        description="Teach InPublic the words it should always recognize and how to draw them. Terms, aliases, and pose variants are stored in this browser."
      />
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">How entries are used</h2>
        <ul className="mt-3 grid gap-1.5 text-sm leading-6 text-zinc-500">
          <li>A <span className="font-medium text-zinc-700">term</span> is a word speech recognition should not get wrong — a product or company name.</li>
          <li>An <span className="font-medium text-zinc-700">alias</span> resolves a casual phrase back to the term, so “the company” lands as your company.</li>
        </ul>
      </div>
      <VocabularyEditor />
    </div>
  );
}
