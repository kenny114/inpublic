/**
 * InPublic STT accuracy corpus.
 *
 * `text` is what gets spoken (TTS or a human reading the line); `reference` is
 * the ground-truth transcript scored against. They differ only where the
 * spoken form needs coaxing out of a synthesiser (e.g. spelling a name).
 *
 * `keyterms` lists the terms whose recall is scored for this line — the
 * proper-noun / important-term metric, separate from overall WER.
 */

export const CATEGORIES = [
  "normal",
  "fast",
  "proper-noun",
  "confusable",
  "technical",
  "numbers",
  "disfluency",
];

export const CORPUS = [
  // --- normal conversational speech ---------------------------------------
  { id: "n1", cat: "normal", text: "So the idea here is that everything you say shows up on the board as you say it." },
  { id: "n2", cat: "normal", text: "Let me walk you through how this actually works in practice." },
  { id: "n3", cat: "normal", text: "We started building this because whiteboards are slow and meetings are not." },
  { id: "n4", cat: "normal", text: "The point is not to write a perfect transcript, it is to keep up with the speaker." },

  // --- fast, continuous, minimal pauses -----------------------------------
  { id: "f1", cat: "fast", rate: 4, text: "Right so the first thing we do is capture the audio and the second thing we do is send it straight to the recogniser and the third thing we do is put it on the page." },
  { id: "f2", cat: "fast", rate: 4, text: "It has to be fast it has to be accurate and it has to keep working when somebody talks over somebody else." },
  { id: "f3", cat: "fast", rate: 3, text: "We are going to cover three things today the pipeline the accuracy and the latency." },

  // --- proper nouns --------------------------------------------------------
  { id: "p1", cat: "proper-noun", text: "Aline is running the session today.", keyterms: ["Aline"] },
  { id: "p2", cat: "proper-noun", text: "I want to show you InPublic.", keyterms: ["InPublic"] },
  { id: "p3", cat: "proper-noun", text: "We render everything through Excalidraw.", keyterms: ["Excalidraw"] },
  { id: "p4", cat: "proper-noun", text: "The speech layer is Deepgram and the reasoning layer is Claude from Anthropic.", keyterms: ["Deepgram", "Claude", "Anthropic"] },
  { id: "p5", cat: "proper-noun", text: "We sell it through Whop.", keyterms: ["Whop"] },
  { id: "p6", cat: "proper-noun", text: "I am from Trinidad and Tobago.", keyterms: ["Trinidad", "Tobago"] },
  { id: "p7", cat: "proper-noun", text: "Aline and Kehmon are both on the call.", keyterms: ["Aline", "Kehmon"] },
  { id: "p8", cat: "proper-noun", text: "Ask Aline about the Deepgram keyterms.", keyterms: ["Aline", "Deepgram"] },

  // --- deliberately confusable --------------------------------------------
  { id: "c1", cat: "confusable", text: "Aline booked the airline ticket.", keyterms: ["Aline"] },
  { id: "c2", cat: "confusable", text: "Their notes are over there and they are not mine." },
  { id: "c3", cat: "confusable", text: "I need four of them for the demo." },
  { id: "c4", cat: "confusable", text: "Claude clawed through the whole document.", keyterms: ["Claude"] },
  { id: "c5", cat: "confusable", text: "The cat ran across the room." },
  { id: "c6", cat: "confusable", text: "Aline said the airline lost her bag.", keyterms: ["Aline"] },

  // --- technical vocabulary ------------------------------------------------
  { id: "t1", cat: "technical", text: "The model streams interim results over a websocket before it finalises the utterance." },
  { id: "t2", cat: "technical", text: "We calculate word error rate as substitutions plus deletions plus insertions over reference length." },
  { id: "t3", cat: "technical", text: "Latency is dominated by endpointing, not by inference." },
  { id: "t4", cat: "technical", text: "The gross margin improves once the annual recurring revenue covers the fixed costs." },
  { id: "t5", cat: "technical", text: "Differentiate the function and set the derivative equal to zero." },

  // --- numbers and mathematics ---------------------------------------------
  { id: "m1", cat: "numbers", text: "Thirty nine times eight." },
  { id: "m2", cat: "numbers", text: "Seventy six times fifty two." },
  { id: "m3", cat: "numbers", text: "Two x plus four equals ten." },
  { id: "m4", cat: "numbers", text: "One hundred and twenty minutes." },
  { id: "m5", cat: "numbers", text: "We went from fifteen percent to forty two percent in one quarter." },

  // --- natural disfluency ---------------------------------------------------
  { id: "d1", cat: "disfluency", text: "So um, the thing is, uh, we need to, we need to ship this first." },
  { id: "d2", cat: "disfluency", text: "It costs about, sorry, it costs around thirty dollars a month." },
  { id: "d3", cat: "disfluency", text: "And then you just, you know, you just say the word and it draws it." },
  { id: "d4", cat: "disfluency", text: "The main thing, the main thing to understand is that" },
];

/** Terms InPublic would plausibly register as user vocabulary. */
export const TEST_KEYTERMS = [
  "Aline",
  "InPublic",
  "Kehmon",
  "Excalidraw",
  "Deepgram",
  "Anthropic",
  "Claude",
  "Whop",
  "Trinidad and Tobago",
];

export function reference(entry) {
  return entry.reference ?? entry.text;
}
