import type { Metadata } from "next";
import { ExpressionLab } from "@/components/ExpressionLab";
import "./express.css";

export const metadata: Metadata = {
  title: "Expression Engine",
  robots: { index: false, follow: false },
};

/**
 * Development-only surface for the Expression Engine. Not linked from
 * anywhere in the product and marked noindex: it exists to answer "can
 * InPublic understand arbitrary meaning and express it visually", which is
 * a question about the engine, not a feature anyone is being sold.
 */
export default function ExpressPage() {
  return <ExpressionLab />;
}
