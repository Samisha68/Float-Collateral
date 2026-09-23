/* What this is, and what it is not.

   A judge forgives a prototype's limits and does not forgive a prototype that
   hides them, so the limits get a screen rather than a footnote. */

import { Panel, Rows, SectionTitle, Key } from "../components/ui";
import { config } from "../lib/chain";

export default function About() {
  return (
    <>
      <section>
        <h1>How this works</h1>
        <p className="note" style={{ marginTop: 8, maxWidth: 620 }}>
          A business that launched a token on Meteora earns trading fees as its pool trades.
          Those fees arrive slowly. Payroll does not. Float lends USDC against that stream and
          takes the pool's creator role as security, so the fees repay the loan at source rather
          than on a promise.
        </p>
      </section>

      <section>
        <SectionTitle>The loop</SectionTitle>
        <Panel>
          <Rows
            items={[
              ["Verify", "A business is approved and given a credit limit. Reputation never moves this number."],
              ["Pledge", "The business hands its pool's creator role to Float, in one transaction Meteora enforces."],
              ["Observe", "Float watches the pool trade before it will project a fee run rate."],
              ["Draw", "USDC out, sized by the projection at the tier the record has earned."],
              ["Collect", "Float claims the pool's creator fees straight into its vault."],
              ["Repay", "The business covers whatever the stream did not. The record gains one."],
              ["Release", "The creator role goes home."],
            ]}
          />
        </Panel>
      </section>

      <section>
        <SectionTitle>Why the pledge is a lock and not a promise</SectionTitle>
        <Panel quiet>
          <p style={{ marginBottom: 12 }}>
            Float never holds the pool's tokens. It holds the pool's <em>creator role</em>, which
            is the authority Meteora requires to claim creator trading fees. Once that role has
            moved, the business cannot claim its own pool's fees. Meteora refuses it.
          </p>
          <p className="note">
            That refusal is a test in this repository, not a claim in a pitch deck. The borrower
            attempts the claim on a pledged pool and the transaction fails.
          </p>
        </Panel>
      </section>

      <section>
        <SectionTitle>What is real, and what is a stand-in</SectionTitle>
        <Panel quiet>
          <Rows
            items={[
              ["The program", <>Deployed on devnet. <Key value={config.programId} /></>],
              ["Meteora", "The real Dynamic Bonding Curve program, same address on devnet and mainnet."],
              ["The pool", <>Real, and one we launched for the demo rather than a real business's. <Key value={config.demoPool} /></>],
              ["USDC", <>A six-decimal test mint Float controls. Devnet has no mintable USDC. <Key value={config.usdcMint} /></>],
              ["Verification", "Performed by Float's own key. This is not a compliance system."],
              ["The repayment records", "Real. Every repayment is a separate transaction against this program."],
              ["Prices", "There are none. The collateral is denominated in the currency of the loan, so this program has no oracle."],
            ]}
          />
        </Panel>
      </section>

      <section>
        <SectionTitle>Known limits</SectionTitle>
        <Panel quiet>
          <Rows
            items={[
              ["Pools must be quoted in USDC", "A SOL-quoted pool would need a price feed, and having none is the point."],
              ["The run rate is a forecast", "Projected from observed trading and capped, but a forecast. If volume dies the business repays the difference."],
              ["One pool per business", "Multi-collateral is deliberately out of scope."],
              ["No liquidation", "There is nothing liquid to seize. Float keeps collecting until the debt clears."],
            ]}
          />
        </Panel>
      </section>
    </>
  );
}
