/**
 * A hand-authored 30-minute, five-speaker product meeting, deliberately
 * messy: interruptions, pronouns, corrections, topic changes, ordinal
 * references, old-topic recall, agreement/disagreement, suspended ideas,
 * reactivated ideas, rejected ideas, changing metrics, hypotheticals, and
 * decisions that later reverse.
 *
 * This is NOT a MeaningDelta fixture like every other scripts/fixtures/*.mjs
 * file in this repo — it is plain transcript text with speaker/timestamp
 * metadata, run through the REAL extractor (scripts/expression-meeting-
 * stress-replay.mjs), because the entire point of this harness is to see
 * whether the real model + real deterministic pipeline can follow a
 * realistic conversation, not to assert a known-good deterministic path.
 *
 * `minute`/`second` place each line on the meeting's 30-minute timeline —
 * used to decide which turns fall before the 5/10/20/30-minute snapshot
 * marks. `tags` are the author's own notes on what phenomenon each line is
 * meant to exercise; they are read by the report, never by the pipeline.
 */

const m = (minutes, seconds = 0) => minutes * 60 + seconds;

export const SPEAKERS = {
  alex: "Alex (PM)",
  priya: "Priya (Eng lead)",
  sam: "Sam (Design)",
  jordan: "Jordan (Growth)",
  morgan: "Morgan (CEO)",
};

export const MEETING_TRANSCRIPT = [
  // ---- 0:00–5:00 — kickoff, agenda ---------------------------------
  { speaker: "alex", t: m(0, 5), text: "Okay, let's get started. Today we've got three things: the onboarding redesign, pricing, and a quick look at Q3 metrics.", tags: ["topic_change"] },
  { speaker: "morgan", t: m(0, 20), text: "And the incident from last week if we have time.", tags: [] },
  { speaker: "alex", t: m(0, 28), text: "Right, and the incident. Let's start with onboarding. Priya, where are we?", tags: ["topic_change"] },
  { speaker: "priya", t: m(0, 40), text: "So the current flow has a seven-step signup, and we think that's the biggest drop-off point.", tags: [] },
  { speaker: "priya", t: m(0, 55), text: "My proposal is we rebuild it from scratch on the new form framework.", tags: ["decision_pending"] },
  { speaker: "sam", t: m(1, 10), text: "I don't think a full rebuild is the right call right now.", tags: ["disagreement"] },
  { speaker: "sam", t: m(1, 20), text: "It'll take at least six weeks and we don't have design bandwidth for that until August.", tags: [] },
  { speaker: "jordan", t: m(1, 35), text: "Can I jump in—", tags: ["interruption"] },
  { speaker: "priya", t: m(1, 37), text: "—sure, go ahead.", tags: ["interruption"] },
  { speaker: "jordan", t: m(1, 40), text: "We're bleeding people at step four specifically, not the whole flow. What if we just fixed step four first?", tags: ["hypothetical"] },
  { speaker: "sam", t: m(1, 55), text: "That's actually a much smaller change. I like that better than the rebuild.", tags: ["agreement"] },
  { speaker: "alex", t: m(2, 5), text: "Okay so we have three options on the table: Priya's full rebuild, Jordan's fix-step-four idea, and I guess doing nothing.", tags: [] },
  { speaker: "alex", t: m(2, 20), text: "The second one sounds like the pragmatic choice for this quarter.", tags: ["ordinal_reference"] },
  { speaker: "priya", t: m(2, 30), text: "Fine, I'll set the rebuild aside for now. We can revisit it after Q3 if step four alone doesn't move the number.", tags: ["suspend"] },
  { speaker: "morgan", t: m(2, 45), text: "Agreed. Let's go with the step-four fix.", tags: ["agreement", "decision"] },
  { speaker: "sam", t: m(3, 0), text: "I'll have mocks for it by Thursday.", tags: [] },
  { speaker: "alex", t: m(3, 15), text: "Great, decision made — we ship the step-four fix, not the rebuild.", tags: ["decision"] },
  { speaker: "priya", t: m(3, 30), text: "One more thing on this — we should also fix the email verification step, it's related.", tags: [] },
  { speaker: "jordan", t: m(3, 45), text: "Is that the one that sends the code twice sometimes?", tags: [] },
  { speaker: "priya", t: m(3, 52), text: "Yeah, that one. It's a race condition, small fix.", tags: [] },
  { speaker: "alex", t: m(4, 10), text: "Okay, add that to Priya's list. Let's move to metrics.", tags: ["topic_change"] },

  // ---- 5:00–10:00 — metrics review (signups / activation / churn) --
  { speaker: "jordan", t: m(5, 5), text: "Signups this month, we're at about 1,200.", tags: ["metric"] },
  { speaker: "jordan", t: m(5, 15), text: "Last month it was 900, so that's solid growth.", tags: ["metric"] },
  { speaker: "morgan", t: m(5, 30), text: "What's driving that?", tags: [] },
  { speaker: "jordan", t: m(5, 38), text: "Mostly the blog post that went semi-viral. Activation is the real problem though.", tags: [] },
  { speaker: "jordan", t: m(5, 50), text: "Activation rate dropped from 40% to 25% this month.", tags: ["metric"] },
  { speaker: "alex", t: m(6, 5), text: "Wait, 25%? That's a big drop.", tags: [] },
  { speaker: "jordan", t: m(6, 12), text: "Sorry, let me correct that — it's not 25%, it's 32%. I misread the dashboard.", tags: ["correction", "metric"] },
  { speaker: "priya", t: m(6, 25), text: "Still a drop from 40 though.", tags: [] },
  { speaker: "jordan", t: m(6, 32), text: "Right, still a drop. Our target for activation has always been 45%.", tags: ["metric"] },
  { speaker: "morgan", t: m(6, 45), text: "So we're further from target than last month, not closer.", tags: [] },
  { speaker: "jordan", t: m(6, 55), text: "Exactly. I think it's connected to the same step-four problem we just talked about.", tags: ["topic_recall"] },
  { speaker: "sam", t: m(7, 10), text: "That actually makes the step-four fix more urgent, not less.", tags: [] },
  { speaker: "alex", t: m(7, 20), text: "Agreed. What about churn?", tags: ["topic_change", "agreement"] },
  { speaker: "priya", t: m(7, 30), text: "Churn's been flat, around 4% monthly, nothing new there.", tags: ["metric"] },
  { speaker: "morgan", t: m(7, 45), text: "And NPS?", tags: [] },
  { speaker: "jordan", t: m(7, 50), text: "We haven't sent the survey this quarter yet, no number to share.", tags: [] },
  { speaker: "alex", t: m(8, 5), text: "Okay. Let's go back to what Priya said about the rebuild for a second.", tags: ["topic_recall"] },
  { speaker: "priya", t: m(8, 15), text: "I thought we set that aside?", tags: [] },
  { speaker: "alex", t: m(8, 22), text: "We did, I just want it on record that if activation doesn't recover after the step-four fix, the rebuild is back on the table.", tags: [] },
  { speaker: "morgan", t: m(8, 35), text: "Fair. Let's check again in a month.", tags: [] },
  { speaker: "jordan", t: m(8, 50), text: "One more number — traffic to the pricing page is up 60% since the blog post too.", tags: ["metric"] },
  { speaker: "alex", t: m(9, 5), text: "That's a good segue into pricing, actually.", tags: ["topic_change"] },

  // ---- 10:00–15:00 — pricing discussion ----------------------------
  { speaker: "alex", t: m(10, 0), text: "So, pricing. Morgan, you had a proposal.", tags: ["topic_change"] },
  { speaker: "morgan", t: m(10, 10), text: "Yeah — I want to add a $15 a month tier between free and Pro.", tags: [] },
  { speaker: "sam", t: m(10, 25), text: "What would it include?", tags: [] },
  { speaker: "morgan", t: m(10, 32), text: "Basically Pro features but capped at lower usage limits.", tags: [] },
  { speaker: "priya", t: m(10, 45), text: "What if we did usage-based pricing instead of fixed tiers entirely?", tags: ["hypothetical"] },
  { speaker: "morgan", t: m(11, 0), text: "That's interesting but it's a much bigger change to billing. Let's park that one for now and stay focused on the $15 tier.", tags: ["suspend"] },
  { speaker: "priya", t: m(11, 15), text: "Sure, makes sense to keep scope small.", tags: ["agreement"] },
  { speaker: "jordan", t: m(11, 25), text: "I actually disagree with adding a tier at all. It adds decision fatigue at signup.", tags: ["disagreement"] },
  { speaker: "sam", t: m(11, 40), text: "I don't think that's right — the data from the last pricing test showed more tiers converted better, not worse.", tags: ["disagreement"] },
  { speaker: "jordan", t: m(11, 55), text: "Fair, I'll defer to the data on that one.", tags: ["agreement"] },
  { speaker: "morgan", t: m(12, 10), text: "Let's also revisit the free tier while we're here — what if we just got rid of it?", tags: ["hypothetical"] },
  { speaker: "alex", t: m(12, 25), text: "Strongly against that. Free tier is most of our top-of-funnel.", tags: ["disagreement"] },
  { speaker: "priya", t: m(12, 35), text: "Agreed, killing the free tier would tank signups.", tags: ["agreement"] },
  { speaker: "morgan", t: m(12, 45), text: "Okay, forget removing the free tier, that idea's dead.", tags: ["reject"] },
  { speaker: "morgan", t: m(13, 0), text: "Let's just move forward with the $15 tier. Sam, can design have something by end of month?", tags: ["decision"] },
  { speaker: "sam", t: m(13, 15), text: "Should be doable, yeah.", tags: [] },
  { speaker: "alex", t: m(13, 25), text: "Great, decision: we're adding the $15 tier, free tier stays, usage-based billing is on hold.", tags: ["decision"] },
  { speaker: "jordan", t: m(13, 40), text: "Quick thing — the second pricing option Sam mentioned in the doc, the annual discount one, are we doing that too?", tags: ["ordinal_reference"] },
  { speaker: "sam", t: m(13, 55), text: "Yes, that's separate and already approved, that's still happening.", tags: [] },
  { speaker: "alex", t: m(14, 10), text: "Good. Let's move to the incident.", tags: ["topic_change"] },

  // ---- 15:00–20:00 — incident review -------------------------------
  { speaker: "morgan", t: m(15, 0), text: "So last Tuesday we had a P0 — billing charged some customers twice.", tags: [] },
  { speaker: "priya", t: m(15, 15), text: "Root cause was a retry bug in the payment webhook handler.", tags: [] },
  { speaker: "alex", t: m(15, 30), text: "How many customers affected?", tags: [] },
  { speaker: "priya", t: m(15, 38), text: "43 customers, all refunded within four hours.", tags: ["metric"] },
  { speaker: "morgan", t: m(15, 50), text: "We should ship the fix Friday and be done with it.", tags: ["decision"] },
  { speaker: "priya", t: m(16, 5), text: "Actually, hold on — the quick fix only patches the symptom. The real fix means touching the retry logic for the whole webhook system.", tags: [] },
  { speaker: "priya", t: m(16, 20), text: "I'd rather not rush that out Friday under time pressure.", tags: ["disagreement"] },
  { speaker: "morgan", t: m(16, 30), text: "That's fair. Let's not ship Friday then — take the time to do it right.", tags: ["reversal", "decision"] },
  { speaker: "alex", t: m(16, 45), text: "So the decision from a minute ago is reversed — no Friday ship, full fix instead, no fixed date yet.", tags: ["reversal"] },
  { speaker: "priya", t: m(17, 0), text: "I'll have a real timeline by next week once I've scoped the retry logic changes.", tags: [] },
  { speaker: "jordan", t: m(17, 15), text: "Should we tell affected customers proactively?", tags: [] },
  { speaker: "morgan", t: m(17, 25), text: "Yes, definitely. Alex can you draft that email?", tags: ["decision"] },
  { speaker: "alex", t: m(17, 35), text: "On it.", tags: [] },
  { speaker: "sam", t: m(17, 45), text: "Is this related at all to the step-four onboarding issue?", tags: [] },
  { speaker: "priya", t: m(17, 55), text: "No, completely separate systems, just bad timing that they landed the same week.", tags: [] },
  { speaker: "morgan", t: m(18, 10), text: "Good to confirm that. What we were saying earlier about usage-based pricing —", tags: ["topic_recall"] },
  { speaker: "priya", t: m(18, 20), text: "I thought we parked that?", tags: [] },
  { speaker: "morgan", t: m(18, 25), text: "We did, I'm bringing it back for a second — this billing bug actually makes the case for usage-based pricing stronger, since fixed tiers are what made the retry bug so costly.", tags: ["reactivate"] },
  { speaker: "priya", t: m(18, 45), text: "That's a fair point, but I still think it's too big a project for this quarter.", tags: ["disagreement"] },
  { speaker: "morgan", t: m(18, 55), text: "Okay, let's set it aside again then, but flag it for Q4 planning.", tags: ["suspend"] },
  { speaker: "alex", t: m(19, 10), text: "Noting that down. Anything else on the incident?", tags: [] },
  { speaker: "morgan", t: m(19, 20), text: "No, I think that covers it.", tags: [] },
  { speaker: "alex", t: m(19, 30), text: "Let's take a quick break and come back for hiring and wrap-up.", tags: [] },

  // ---- 20:00–25:00 — hiring ------------------------------------------
  { speaker: "alex", t: m(20, 0), text: "Okay, back. Hiring update — where are we on the two open eng roles?", tags: ["topic_change"] },
  { speaker: "priya", t: m(20, 15), text: "One offer out, waiting to hear back by Friday. The other role we're still sourcing for.", tags: [] },
  { speaker: "morgan", t: m(20, 30), text: "Who's the offer out to?", tags: [] },
  { speaker: "priya", t: m(20, 38), text: "A backend engineer named Dana, she'd focus on the billing system actually — good timing given what we just discussed.", tags: [] },
  { speaker: "jordan", t: m(20, 55), text: "Nice. What about the growth marketer role?", tags: [] },
  { speaker: "alex", t: m(21, 5), text: "We paused that one a few weeks ago to focus budget on eng.", tags: ["suspend"] },
  { speaker: "morgan", t: m(21, 20), text: "Given the signup growth Jordan mentioned, maybe we should reopen it.", tags: ["reactivate"] },
  { speaker: "jordan", t: m(21, 35), text: "I'd love that, yes please.", tags: ["agreement"] },
  { speaker: "alex", t: m(21, 45), text: "Okay, reopening the growth marketer req.", tags: ["decision"] },
  { speaker: "sam", t: m(22, 0), text: "Should design get a second headcount too, or is that still off the table?", tags: [] },
  { speaker: "morgan", t: m(22, 15), text: "Still off the table for this quarter, sorry Sam.", tags: ["reject"] },
  { speaker: "sam", t: m(22, 25), text: "Understood, figured I'd ask.", tags: [] },
  { speaker: "alex", t: m(22, 40), text: "Let's go back to Dana for a second — what's the target start date if she accepts?", tags: ["topic_recall"] },
  { speaker: "priya", t: m(22, 55), text: "Two weeks after acceptance, so probably early next month.", tags: [] },
  { speaker: "morgan", t: m(23, 10), text: "Good. Any other hiring items?", tags: [] },
  { speaker: "alex", t: m(23, 20), text: "That's everything on hiring.", tags: [] },

  // ---- 25:00–30:00 — recap and close ---------------------------------
  { speaker: "alex", t: m(25, 0), text: "Let's recap decisions before we close.", tags: ["topic_change"] },
  { speaker: "alex", t: m(25, 15), text: "One — we're doing the step-four onboarding fix, not the full rebuild, mocks by Thursday.", tags: ["decision"] },
  { speaker: "alex", t: m(25, 30), text: "Two — we're adding the $15 pricing tier, free tier stays, usage-based billing is parked for Q4 planning.", tags: ["decision"] },
  { speaker: "alex", t: m(25, 50), text: "Three — the billing incident fix is not shipping Friday, Priya will have a real timeline next week, and we're emailing affected customers.", tags: ["decision"] },
  { speaker: "alex", t: m(26, 10), text: "Four — we're reopening the growth marketer role, design headcount stays off the table.", tags: ["decision"] },
  { speaker: "morgan", t: m(26, 30), text: "That all sounds right to me.", tags: ["agreement"] },
  { speaker: "priya", t: m(26, 40), text: "One correction — the rebuild isn't fully dead, it's back on the table if activation doesn't recover. Just want that captured accurately.", tags: ["correction"] },
  { speaker: "alex", t: m(26, 55), text: "Good catch, noted.", tags: [] },
  { speaker: "jordan", t: m(27, 10), text: "Should we set a specific activation target to decide that by?", tags: [] },
  { speaker: "morgan", t: m(27, 20), text: "Let's say if we're not back above 40% activation in a month, we revisit the rebuild.", tags: ["metric"] },
  { speaker: "alex", t: m(27, 35), text: "Got it, target's 40% activation in a month.", tags: ["metric"] },
  { speaker: "sam", t: m(27, 50), text: "I'll send mocks to the group by Thursday like planned.", tags: [] },
  { speaker: "priya", t: m(28, 5), text: "And I'll have the incident timeline by next week.", tags: [] },
  { speaker: "jordan", t: m(28, 20), text: "I'll get the NPS survey out this week too, so we have a number for next time.", tags: [] },
  { speaker: "morgan", t: m(28, 35), text: "Great meeting, everyone. Thanks all.", tags: [] },
  { speaker: "alex", t: m(28, 45), text: "Thanks everyone, talk soon.", tags: [] },
];
