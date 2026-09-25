/* What went wrong, in a sentence the borrower can act on.

   Anchor's own messages are written for whoever is reading the program, and
   they are good at that job. "The pool has not been observed for long enough
   to project a fee run rate" is precise and tells a business owner nothing
   about what to do next.

   Worse are the ones that never reach a message at all: a user who rejects a
   signature prompt sees "User rejected the request", and a devnet rate limit
   surfaces as a 429 with a wall of JSON. Neither is the borrower's fault and
   neither should look like a crash.

   So this maps the errors a borrower can actually provoke onto what they
   should do about it, and leaves everything else alone rather than inventing
   a friendly sentence for a bug. An error nobody anticipated is better shown
   raw than paraphrased into something reassuring and wrong. */

const BY_NAME: Record<string, string> = {
  // Timing
  ObservationWindowNotElapsed:
    "Float has not watched this pool for long enough yet. Give it a few more minutes, then draw.",

  // Capacity
  ExceedsApprovedCredit:
    "That is more than your approved credit limit. Your repayment record improves your rate, but never raises this number.",
  InsufficientProjectedFees:
    "Your pool's projected fees do not cover this draw. Let it trade more, or draw a smaller amount.",
  InsufficientCollateralValue:
    "Your collateral does not cover this draw. Escrow more, or draw a smaller amount.",

  // Collateral
  BorrowerDoesNotOwnPool:
    "Your wallet does not hold this pool's creator role, so it is not yours to pledge.",
  PoolAlreadyMigrated:
    "This pool has graduated off the bonding curve. Float lends against curve pools only.",
  PoolHasNeverTraded:
    "This pool has never traded, so there is no fee history to underwrite.",
  PoolPaysCreatorNothing:
    "This pool pays its creator no share of trading fees, so there is nothing to lend against.",
  PoolNotQuotedInUsdc:
    "Float only lends against pools quoted in USDC.",
  PledgeReleased:
    "This pledge has already been released. Pledge the pool again to draw against it.",
  PriceTooStale:
    "Float's price for this token is more than five minutes old. Refresh the page and try again.",
  FloatNoLongerHoldsCreatorRole:
    "Float no longer holds this pool's creator role, so it cannot collect its fees.",

  // State
  LoanAlreadyActive:
    "You already have an advance open. Repay it before drawing again.",
  NoActiveLoan:
    "There is no advance open on this account.",
  LoanStillActive:
    "Your collateral is locked until the advance is repaid.",
  PositionIsHealthy:
    "This position still covers its debt, so it cannot be seized.",
  BusinessNotVerified:
    "This wallet has not been approved for credit yet.",
  TermOutOfRange:
    "Choose a term between 1 and 60 days.",
  AmountMustBePositive:
    "Enter an amount greater than zero.",

  // Authority
  Unauthorized:
    "This wallet is not authorised for that.",
  PledgeNotYours:
    "That collateral belongs to a different wallet.",
  LoanNotYours:
    "That advance belongs to a different wallet.",
};

/* Things that are not program errors at all. Matched on the text because
   wallets and RPCs do not agree on codes. */
const BY_TEXT: [RegExp, string][] = [
  [/user rejected|user denied|request rejected/i,
   "You declined the signature, so nothing was sent."],
  [/429|too many requests|rate limit/i,
   "Devnet is rate-limiting this connection. Wait a moment and try again, or set VITE_RPC_URL to a dedicated endpoint."],
  [/blockhash not found|block height exceeded|transaction expired/i,
   "The transaction expired before it was confirmed. Nothing was charged — try again."],
  [/insufficient (lamports|funds for rent|funds)/i,
   "This wallet does not have enough SOL to pay the network fee."],
  [/wallet not connected|no wallet/i,
   "Connect a wallet first."],
  [/failed to fetch|network ?error|err_internet/i,
   "Could not reach the network. Check your connection and try again."],
];

/** The Anchor error name, if there is one anywhere in this object. */
function anchorName(e: any): string | null {
  const direct = e?.error?.errorCode?.code;
  if (typeof direct === "string") return direct;
  const logs: string[] = e?.logs ?? [];
  for (const line of logs) {
    const m = line.match(/Error Code:\s*([A-Za-z]+)/);
    if (m) return m[1];
  }
  const text = String(e?.message ?? e ?? "");
  const m = text.match(/Error Code:\s*([A-Za-z]+)/);
  return m ? m[1] : null;
}

/* Stringifying a plain object gives "[object Object]", which is not a message
   and must never reach a screen. */
function readable(e: unknown): string {
  const fromAnchor = (e as any)?.error?.errorMessage;
  if (typeof fromAnchor === "string" && fromAnchor.trim()) return fromAnchor;
  const fromMessage = (e as any)?.message;
  if (typeof fromMessage === "string" && fromMessage.trim()) return fromMessage;
  if (typeof e === "string" && e.trim()) return e;
  return "";
}

/** A sentence to put in front of the borrower. */
export function explainError(e: unknown): string {
  const name = anchorName(e);
  if (name && BY_NAME[name]) return BY_NAME[name];

  const text = readable(e);

  for (const [pattern, sentence] of BY_TEXT) {
    if (pattern.test(text)) return sentence;
  }

  /* Anchor's own message is a better fallback than the raw object, and the
     raw object is a better fallback than a friendly lie. */
  const anchorMessage = (e as any)?.error?.errorMessage;
  if (typeof anchorMessage === "string" && anchorMessage) return anchorMessage;

  return text || "Something went wrong.";
}
