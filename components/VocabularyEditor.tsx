"use client";

import { useEffect, useState } from "react";

interface Entry { term: string; aliases: string; pronunciation: string; mode: "standard" | "story"; visualType: string; poses: string; color: string; }
const seed: Entry[] = [{ term: "ClickLabs", aliases: "Click Labs, click labs", pronunciation: "click labs", mode: "standard", visualType: "concept", poses: "", color: "#6366f1" }, { term: "cat", aliases: "the cat", pronunciation: "cat", mode: "story", visualType: "character", poses: "sitting, standing, walking, running", color: "#f59e0b" }];

export function VocabularyEditor() {
  const [entries, setEntries] = useState<Entry[]>(seed);
  useEffect(() => { try { const saved = localStorage.getItem("inpublic-vocabulary"); if (saved) setEntries(JSON.parse(saved) as Entry[]); } catch {} }, []);
  const save = (next: Entry[]) => { setEntries(next); localStorage.setItem("inpublic-vocabulary", JSON.stringify(next)); };
  // Story Mode was removed entirely — the Mode column and its "story" option
  // stay hidden rather than removed from the data model, so an existing
  // entry saved with mode:"story" (from before removal) still displays and
  // edits correctly if it's ever seen again; new entries just can't be
  // created as "story" while the picker is hidden.
  return <div className="mt-8 space-y-3">{entries.map((entry, index) => <div key={`${entry.term}-${index}`} className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 md:grid-cols-[1fr_1.4fr_1fr_auto]"><input aria-label="Term" value={entry.term} onChange={(event) => save(entries.map((item, i) => i === index ? { ...item, term: event.target.value } : item))} className="rounded-md border border-zinc-200 px-3 py-2 text-sm" /><input aria-label="Aliases" value={entry.aliases} onChange={(event) => save(entries.map((item, i) => i === index ? { ...item, aliases: event.target.value } : item))} className="rounded-md border border-zinc-200 px-3 py-2 text-sm" /><input aria-label="Visual type or poses" value={entry.mode === "story" ? entry.poses : entry.visualType} onChange={(event) => save(entries.map((item, i) => i === index ? { ...item, [entry.mode === "story" ? "poses" : "visualType"]: event.target.value } : item))} className="rounded-md border border-zinc-200 px-3 py-2 text-sm" /><button type="button" onClick={() => save(entries.filter((_, i) => i !== index))} className="px-2 text-xs text-red-600">Remove</button></div>)}<button type="button" onClick={() => save([...entries, { term: "", aliases: "", pronunciation: "", mode: "standard", visualType: "concept", poses: "", color: "#6366f1" }])} className="button-secondary">Add visual word</button><p className="text-xs leading-5 text-zinc-500">Prepared assets, aliases, pronunciation keyterms, pose variants, and preferred colors are stored locally in this preview. Engine vocabulary sync is planned.</p></div>;
}
