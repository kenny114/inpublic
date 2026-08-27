/**
 * The reflex: meaning that needs no model.
 *
 * The pipeline's meaning layer is an LLM call, and an LLM call is the reason
 * nothing reaches the canvas until a clause has finished, settled, and
 * survived a debounce. That is the right trade for structure — you cannot
 * work out that rising costs CAUSE consolidation without reading the whole
 * sentence — but it is the wrong trade for the handful of words whose
 * meaning is fixed before the sentence exists.
 *
 * "I" is the first member of that category. Its referent is not a salience
 * question, not an inference, and not something a later clause can revise:
 * it is the person talking, and they are present before a single other word
 * has been said. So it is resolvable by a lookup, in microseconds, from a
 * partial transcript — which is exactly what the source of truth asks for:
 *
 *   "When I say 'I', it immediately shows that I am talking about myself."
 *
 * The second member is what the speaker says they HAVE: "my mother", "our
 * team". A first-person possessive is the same kind of fact as "I" — the
 * determiner names the owner outright, so neither the thing nor its tie to
 * the speaker is waiting on the rest of the clause. Recognising only "I"
 * left the board with one figure and then nothing to do until the settled
 * run arrived seconds later; this is what lets the picture keep growing
 * inside the same breath.
 *
 * This is deliberately a closed list and not a small classifier. Everything
 * it emits is something no later evidence can contradict, which is what
 * makes it safe to draw before the sentence is over. A word whose meaning
 * depends on the rest of the clause does not belong here — it belongs to
 * the extractor, behind the debounce, where being late is the cost of being
 * right. (A general reading of partial speech is a real want, and it is a
 * different mechanism: the anticipation pass in lib/expression/live.ts,
 * which pays for a model call to get it.)
 *
 * Pure and synchronous. No network, no model, no state.
 */

import { firstPersonEntity, SPEAKER_ENTITY_ID, SPEAKER_GROUP_ENTITY_ID, slugify } from "../world/apply";
import type { EntityType, MeaningDelta, Relation } from "../schemas";

/**
 * Things a speaker can say they have, whose KIND is fixed by the word
 * itself.
 *
 * Closed on purpose, and closed on the same test as "I": an entry is here
 * only if no continuation of the sentence can turn it into something else.
 * "my mother" is a person in every sentence that contains it; "my point",
 * "my problem", "my plan" are not here, because what they are is precisely
 * what the speaker is about to say.
 *
 * A `person` becomes the speaker's counterpart (`role_of`); a `group`
 * becomes something the speaker is in (`member_of`). Nothing else is
 * admitted — an owned OBJECT ("my car") is usually a thing the sentence is
 * only passing through, and drawing every one of them would fill a board
 * with props instead of a story.
 */
const POSSESSED: Record<string, EntityType> = {
  // people
  mother: "person", mom: "person", mum: "person", mama: "person",
  father: "person", dad: "person", papa: "person",
  sister: "person", brother: "person", sibling: "person",
  wife: "person", husband: "person", partner: "person", spouse: "person",
  son: "person", daughter: "person", child: "person", kid: "person",
  boss: "person", manager: "person", colleague: "person", coworker: "person",
  friend: "person", founder: "person", mentor: "person",
  teacher: "person", doctor: "person", therapist: "person",
  landlord: "person", neighbour: "person", neighbor: "person",
  // groups
  family: "group", parents: "group", kids: "group", children: "group",
  team: "group", company: "group", business: "group", startup: "group",
  staff: "group", crew: "group", department: "group", organisation: "group",
  organization: "group", club: "group", band: "group", class: "group",
  friends: "group", colleagues: "group", customers: "group", clients: "group",
  users: "group", audience: "group", students: "group", investors: "group",
  community: "group", neighbourhood: "group", neighborhood: "group",
};

/** How far past "my" a possessed noun may sit: "my old boss", "my very first team". */
const POSSESSIVE_REACH = 3;

/**
 * The reflex's read of a partial utterance, or null when it recognised
 * nothing it is certain about — which is most of the time, and is the
 * correct answer.
 *
 * Emits relations only where the WORDS THEMSELVES are the relation. "My
 * mother" states a tie between two things in the same breath as it names
 * them, and no later clause revokes it; that is a different kind of claim
 * from "costs are rising because —", where the connection is exactly what
 * the unfinished half of the sentence is carrying. Inventing one of those
 * to make the picture richer sooner is the failure the debounce exists to
 * prevent, and nothing here does it.
 */
export function reflexDelta(text: string): MeaningDelta | null {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (!words.length) return null;

  const seen = new Map<string, { id: string; label: string; type: EntityType }>();
  const relations: Relation[] = [];
  let last: string | undefined;
  for (let i = 0; i < words.length; i += 1) {
    const person = firstPersonEntity(words[i]);
    if (!person) continue;
    seen.set(person.id, person);
    last = person.id;

    // "my"/"our" is not only the speaker — it is also a pointer at the next
    // thing said. Only a determiner reaches forward; "I" and "we" do not.
    if (words[i] !== "my" && words[i] !== "our") continue;
    const owned = possessedAfter(words, i);
    if (!owned) continue;
    if (!seen.has(owned.id)) seen.set(owned.id, owned);
    last = owned.id;

    // Relation ids are unique within this delta only, the same rule the
    // extractor works under.
    const id = `reflex-${person.id}-${owned.id}`;
    if (relations.some((r) => r.id === id)) continue;
    relations.push(
      owned.type === "person"
        ? { id, source: owned.id, type: "role_of", target: person.id, role: owned.role.slice(0, 32) }
        : { id, source: person.id, type: "member_of", target: owned.id },
    );
  }
  if (!seen.size) return null;

  const entities = [...seen.values()].map((p) => ({ id: p.id, type: p.type, label: p.label }));
  return {
    entities,
    relations,
    claims: [],
    topicEntityId: last,
    // What the reflex actually understood, in the same voice every other
    // interpretation is written in — this is what the debug panel and the
    // session log show, and this is the honest full extent of it.
    interpretation: describe(entities, entities.some((e) => e.id === SPEAKER_ENTITY_ID)),
  };
}

/**
 * The possessed noun a "my"/"our" at `at` points to, or null.
 *
 * Scans forward a few words so an adjective ("my old boss") does not lose
 * the noun behind it, and stops at the next first-person word so "my team
 * and our investors" cannot cross-wire. The label keeps every word the
 * speaker actually said — "my old boss", not "boss" — because that is what
 * they will hear themselves say; the world's own matcher normalises the
 * determiner away, so this still merges with whatever the settled run calls
 * the same thing (lib/expression/world/apply.ts's normalizeMention).
 */
function possessedAfter(
  words: string[],
  at: number,
): { id: string; label: string; type: EntityType; role: string } | null {
  const limit = Math.min(words.length, at + 1 + POSSESSIVE_REACH);
  for (let j = at + 1; j < limit; j += 1) {
    if (firstPersonEntity(words[j])) return null;
    const type = POSSESSED[words[j]];
    if (!type) continue;
    const label = words.slice(at, j + 1).join(" ");
    return { id: slugify(label), label, type, role: words[j] };
  }
  return null;
}

function describe(entities: { id: string; label: string }[], singular: boolean): string {
  const owned = entities.filter((e) => e.id !== SPEAKER_ENTITY_ID && e.id !== SPEAKER_GROUP_ENTITY_ID).map((e) => e.label);
  const self = singular ? "The speaker is talking about themselves" : "The speaker is talking about their own group";
  return owned.length ? `${self} and ${owned.join(" and ")}.` : `${self}.`;
}
