# Storyboard

Generated from `timelines/*.json` by `node scripts/storyboard.ts`; do not edit by hand. Times are planned:
they come from the placeholders' lengths now, and from the real in and out points once footage is in.
Captions show `[not measured yet]` where facts.ts has no value yet; a final render refuses until it does.
Shots refer to [SHOTLIST.md](SHOTLIST.md).

## agora-bounty

1920x1080, 30 fps, 106.1 s planned (target 105 to 115 s, cap 120 s).
For the Agora bounty judges. The three things they look for (passkey onboarding, an AUSD balance, a send and a receive settled at once) are each shown by a segment that ends before 90 s; the timeline check fails otherwise.

| Time | Shot | On screen | Caption | Callout |
| --- | --- | --- | --- | --- |
| 0.0 to 5.0 s | card | Opening question card. (card) | What if sending dollars felt like sending a text? / NivPay, in test mode |  |
| 5.0 to 17.4 s | B01 | Phone A, after the account chooser: the passkey sheet for nivpay.vercel.app, fingerprint, Home. (one phone; pushed in; proves passkey) | A brand new account, made with a passkey | No password, nothing to write down. Eddy's phone. |
| 17.4 to 23.4 s | B01 | Phone A, Home: Your balance, Dollars $0.00, Held as AUSD, a digital dollar issued by Agora. (one phone; pushed in) | Its balance is in AUSD, a digital dollar from Agora |  |
| 23.4 to 27.3 s | B02 | Phone A, Add test dollars: Getting your account ready, fingerprint, Adding test dollars. (one phone; Sped up x2) | Add test dollars | Test dollars from Agora's faucet, not real money |
| 27.3 to 28.7 s | B02 | Phone A: Added $10,000 test dollars. Settled in 2.2s. Dollars $10,000.00, as recorded. (one phone; never sped up; proves balance) | $10,000 in AUSD. Settled in 2.2s |  |
| 28.7 to 31.7 s | B02 | Phone A, the recorded frame held: Settled in 2.2s, pushed in. (one phone; Frame held; pushed in) | Settled in 2.2s, as the phone measured it |  |
| 31.7 to 34.7 s | B02 | Phone A, the recorded frame held: Dollars $10,000.00, pushed in. (one phone; Frame held; pushed in) | Balance: $10,000.00 | Held as AUSD |
| 34.7 to 41.4 s | B04 | Phone A, Send dollars: the account ID pasted (blurred), its last four typed to be sure. (one phone; Sped up x2) | Paste the account, then type its last four to be sure |  |
| 41.4 to 49.0 s | B04 | Phone A: Sending to account ending 562C, How much 25, Review, Check and send: Amount $25, Fee None. (one phone) | Sending to the account ending 562C | $25, no fee. NivPay covers it |
| 49.0 to 52.5 s | B05 | A: Send $25, fingerprint, Confirming. B: a recorded frame of Maya's Home at $0.00, held. (both phones side by side; Frame held) Labels: Eddy sends / Maya's balance. | One fingerprint sends it |  |
| 52.5 to 56.1 s | B05 | A: Payment final, Sent $25, Settled in 2.2s, as recorded. B: a recorded frame of Maya's Home at $25.00, held. (both phones side by side; Frame held; never sped up; proves settled) Labels: Eddy sends / Maya's balance. | Sent and received. Settled in 2.2s | Maya's balance: $25.00 |
| 56.1 to 59.1 s | B05 | Phone A, the recorded frame held: Payment final, Settled in 2.2s, pushed in. (one phone; Frame held; pushed in) | Settled in 2.2s, measured on the phone |  |
| 59.1 to 67.1 s | receipt | Receipt card for the take's send, read from Monad testnet. (receipt card read from the chain) | The receipt, read from Monad | One Transfer of $25 in AUSD. No fee taken. |
| 67.1 to 73.1 s | receipt | Receipt card for the README's verified send. (receipt card read from the chain) | An earlier send, read the same way |  |
| 73.1 to 79.1 s | receipt | Receipt card for the README's exchange through Agora's pair. (receipt card read from the chain) | Paying in another currency, through Agora | AUSD in from the sender, CTK out to the recipient |
| 79.1 to 90.1 s | card | What NivPay does, in the README's words. (card) | What NivPay does / Passkey accounts: no password and nothing to write down / Send dollars to another person, and receive them / Deliver a payment in another currency through Agora's Instant Settlement / No fee on a send: NivPay covers it / People see dollars and names, never keys or addresses |  |
| 90.1 to 100.1 s | card | Pots, in the README's words. (card) | Pots: a group purse for one purpose / Money goes in from anyone / It can only come out to destinations fixed when the pot was created / And only when enough of the named approvers agree / Any funder can exit at any time with their share of what is unspent |  |
| 100.1 to 106.1 s | card | End card. (card) | NivPay / Simple payments for what matters / the link |  |

## technical-demo

1920x1080, 30 fps, 101.4 s planned (target 90 to 120 s, cap 120 s).
The product working on the B1 take, the settlement, receipts read from Monad testnet, and how a pot works in the README's own words, with a pot made in an earlier test run. Monad, AUSD and transaction hash may appear in captions; chain words only on the receipt cards.

| Time | Shot | On screen | Caption | Callout |
| --- | --- | --- | --- | --- |
| 0.0 to 5.0 s | card | Opening card. (card) | NivPay, working on Monad testnet / Passkey accounts, dollars held as AUSD, and pots no single person can pocket |  |
| 5.0 to 17.4 s | B01 | Phone A, after the account chooser: the passkey sheet for nivpay.vercel.app, fingerprint, Home. (one phone; pushed in) | A brand new account, made with a passkey | No password, nothing to write down. Eddy's phone. |
| 17.4 to 23.4 s | B01 | Phone A, Home: Your balance, Dollars $0.00, Held as AUSD, a digital dollar issued by Agora. (one phone; pushed in) | Dollars, held as AUSD from Agora |  |
| 23.4 to 27.3 s | B02 | Phone A, Add test dollars: Getting your account ready, fingerprint, Adding test dollars. (one phone; Sped up x2) | Test dollars from Agora's faucet |  |
| 27.3 to 28.7 s | B02 | Phone A: Added $10,000 test dollars. Settled in 2.2s, as recorded. (one phone; never sped up) | $10,000 in. Settled in 2.2s |  |
| 28.7 to 31.7 s | B02 | Phone A, the recorded frame held: Settled in 2.2s, pushed in. (one phone; Frame held; pushed in) | Settled in 2.2s, timed by the phone |  |
| 31.7 to 39.3 s | B04 | Phone A: Sending to account ending 562C, How much 25, Review, Check and send: Amount $25, Fee None. (one phone) | Send $25 to the account ending 562C | No fee. NivPay covers it |
| 39.3 to 42.8 s | B05 | A: Send $25, fingerprint, Confirming. B: a recorded frame of Maya's Home at $0.00, held. (both phones side by side; Frame held) Labels: Eddy sends / Maya's balance. | One fingerprint sends it |  |
| 42.8 to 46.4 s | B05 | A: Payment final, Sent $25, Settled in 2.2s, as recorded. B: a recorded frame of Maya's Home at $25.00, held. (both phones side by side; Frame held; never sped up) Labels: Eddy sends / Maya's balance. | Settled in 2.2s | Maya's balance: $25.00 |
| 46.4 to 49.4 s | B05 | Phone A, the recorded frame held: Payment final, Settled in 2.2s, pushed in. (one phone; Frame held; pushed in) | Final, as the phone measured it |  |
| 49.4 to 57.4 s | receipt | Receipt card for the take's send, read from Monad testnet. (receipt card read from the chain) | The chain's own receipt | One Transfer of $25 in AUSD, in a finalized block |
| 57.4 to 63.4 s | receipt | Receipt card for the README's verified send. (receipt card read from the chain) | The README's verified send, read the same way |  |
| 63.4 to 69.4 s | receipt | Receipt card for the README's exchange through Agora's pair. (receipt card read from the chain) | A payment in another currency, through Agora's pair | AUSD in from the sender, CTK out to the recipient |
| 69.4 to 73.4 s | R01 | A pot from an earlier test run, before it is made: who decides, where it can pour and the limit, when it closes. (one phone) | A pot: who decides, where it can pour, and when it closes | A pot made in an earlier test run of the app |
| 73.4 to 78.4 s | R01 | The same test run: Check it before you make it, None of this can ever change. (one phone; pushed in) | None of this can ever change, not even by you | Money can only come out to destinations fixed when the pot was created |
| 78.4 to 88.4 s | card | How a pot works, in the README's words. (card) | How a pot works / Money goes in from anyone / It can only come out to destinations fixed when the pot was created, and only when enough of the named approvers agree / Any funder can exit at any time with their share of what is unspent / Exits are never blocked by a freeze, a close, a pending proposal, or an approver who has stopped cooperating |  |
| 88.4 to 96.4 s | card | What else the app does, in the README's words. (card) | Also in the app / Send dollars to another person, and receive them / Deliver a payment in another currency through Agora's Instant Settlement / People see dollars and names, never keys or addresses |  |
| 96.4 to 101.4 s | card | End card. (card) | NivPay / Simple payments for what matters / the link |  |

## x-launch

1080x1080, 30 fps, 31.1 s planned (target 30 to 40 s, cap 40 s).
For X: square, consumer words only, no crypto words at all. A new account, a balance, a send and its arrival, then the end frame with the link.

| Time | Shot | On screen | Caption | Callout |
| --- | --- | --- | --- | --- |
| 0.0 to 3.0 s | card | Opening card. (card) | Send dollars like a text |  |
| 3.0 to 9.2 s | B01 | Phone A, after the account chooser: the passkey sheet, fingerprint, Home. (one phone; Sped up x2; pushed in) | A new account with your fingerprint | No password, nothing to write down |
| 9.2 to 12.2 s | B02 | Phone A, the recorded frame held: Added $10,000 test dollars. Settled in 2.2s, pushed in. (one phone; Frame held; pushed in) | $10,000 in test dollars. Settled in 2.2s |  |
| 12.2 to 16.0 s | B04 | Phone A: Sending to account ending 562C, How much 25, Review, Check and send: Amount $25, Fee None. (one phone; Sped up x2) | Send $25. No fee |  |
| 16.0 to 19.5 s | B05 | A: Send $25, fingerprint, Confirming. B: a recorded frame of Maya's Home at $0.00, held. (both phones side by side; Frame held) Labels: Eddy sends / Maya. | One fingerprint |  |
| 19.5 to 23.1 s | B05 | A: Payment final, Settled in 2.2s, as recorded. B: a recorded frame of Maya's Home at $25.00, held. (both phones side by side; Frame held; never sped up) Labels: Eddy sends / Maya. | Sent and received. Settled in 2.2s |  |
| 23.1 to 26.1 s | B05 | Phone A, the recorded frame held: Payment final, Settled in 2.2s, pushed in. (one phone; Frame held; pushed in) | Settled in 2.2s |  |
| 26.1 to 31.1 s | card | End card with the link. (card) | NivPay / Simple payments for what matters / the link |  |
