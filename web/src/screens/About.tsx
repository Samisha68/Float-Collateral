/* What this is, and what it is not.

   A judge forgives a prototype's limits and does not forgive one that hides
   them, so the limits get a section rather than a footnote. */

import { Block, Ledger, Key } from "../components/ui";
import { config } from "../lib/chain";

const LOOP: [string, string][] = [
  ["Verify", "A business is approved and given a credit limit. Its record never moves that number."],
  ["Pledge", "The business hands its pool's creator role to Float, in one transaction Meteora enforces."],
  ["Observe", "Float watches the pool trade before it will project a fee run rate."],
  ["Draw", "USDC out, sized by the projection at the tier the record has earned."],
  ["Collect", "Float claims the pool's creator fees straight into its vault."],
  ["Repay", "The business covers whatever the stream did not. The record gains one."],
  ["Release", "The creator role goes home."],
];

export default function About() {
  return (
    <>
      <div className="eyebrow">How this works</div>
      <h1>Credit against revenue that has not arrived yet.</h1>
      <p className="lede">
        A business that launched a token on Meteora earns trading fees as its pool trades. Those
        fees arrive slowly. Payroll does not. Float lends against the stream and takes the claim
        on it as security, so the fees repay the loan at source rather than on a promise.
      </p>

      <Block title="The loop">
        <Ledger rows={LOOP.map(([k, v]) => [k, <span className="note">{v}</span>])} />
      </Block>

      <Block title="Why the pledge is a lock, not a promise">
        <p>
          Float never holds the pool's tokens. It holds the pool's <em>creator role</em>, which is
          the authority Meteora requires to claim creator trading fees. Once that role has moved,
          the business cannot claim its own pool's fees. Meteora refuses it.
        </p>
        <p className="note">
          That refusal is a test in the repository, not a claim in a deck. The borrower attempts
          the claim on a pledged pool, and the transaction fails.
        </p>
      </Block>

      <Block title="There is no oracle">
        <p>
          Float underwrites pools quoted in USDC and nothing else. The fees accrue in the same
          unit as the debt, so there is no price to fetch, no feed to trust and no staleness to
          handle. A SOL-quoted pool would need all three, which is why this version declines them.
        </p>
      </Block>

      <Block title="What is real, and what stands in">
        <Ledger
          rows={[
            ["The program", <>Deployed on devnet. <Key value={config.programId} /></>],
            ["Meteora", "The real Dynamic Bonding Curve, same address on devnet and mainnet."],
            ["The pool", <>Real, and one we launched. <Key value={config.demoPool} /></>],
            ["USDC", <>A test mint Float controls. Devnet has none to mint. <Key value={config.usdcMint} /></>],
            ["Verification", "Float's own key. An authority check, not a compliance system."],
            ["The records", "Real. Every repayment is a separate transaction."],
          ]}
        />
      </Block>

      <Block title="Known limits">
        <Ledger
          rows={[
            ["Pools must be quoted in USDC", <span className="note">A SOL-quoted pool would need a price feed, and having none is the point.</span>],
            ["The run rate is a forecast", <span className="note">Capped and computed from observed trading, but a forecast.</span>],
            ["One pool per business", <span className="note">Multi-collateral is deliberately out of scope.</span>],
            ["No liquidation", <span className="note">Nothing liquid to seize. Float keeps collecting until the debt clears.</span>],
          ]}
        />
      </Block>
    </>
  );
}
