import type { Metadata } from "next";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "InPublic — Speak naturally. Watch your ideas take shape.",
  description: "Turn your voice into live visual explanations, diagrams, and simple story sketches.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning is scoped to these two elements and to their own
    // attributes only — children still hydrate normally, so a real mismatch
    // inside the app is still reported. It is here because browser extensions
    // (password managers, Grammarly, focus-visible polyfills) inject attributes
    // such as `data-js-focus-visible`, `cz-shortcut-listen` or `data-new-gr-c-s-check-loaded`
    // onto <html>/<body> before React hydrates. That markup is not ours to
    // control, and React otherwise reports it as a hydration error.
    // data-scroll-behavior opts in to Next's handling of the smooth scrolling
    // globals.css sets, so route transitions do not animate the scroll reset.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
