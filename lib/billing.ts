export type BillingAvailability = {
  configured: boolean;
  provider: "none";
  checkoutUrl: null;
};

// A deliberate seam for a future payment provider. The product must never
// render a checkout promise until server-side billing configuration exists.
export const billing: BillingAvailability = {
  configured: false,
  provider: "none",
  checkoutUrl: null,
};
