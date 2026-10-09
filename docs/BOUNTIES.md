What this bounty is for
A team must build a mobile application that lets a user send AUSD to another person or across borders, using Mera passkey authentication for onboarding and instant settlement for the transfer itself. Teams should build against Agora's public API documentation and staging environment (internal codebase access is not provided).

Judging criteria
What judges look for
Implementation quality

Real-world usability

Business viability of the payments flow

Deliverables
What to have ready
A working demo showing passkey onboarding, an AUSD balance, and a completed send/receive transaction settled instantly
## My notes on this bounty

- The demo must use AUSD, not TESTUSD: an AUSD balance and a real AUSD send and receive on the AUSD pot (0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB). TESTUSD stays as a fallback for testing only.
- Where test AUSD comes from: resolved. The official faucet listed in Agora's docs (0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) dispenses AUSD and is confirmed live: it was dry in Phase 0 and has since been restocked. It is called with `requestFunds(address)` and pays 10,000 AUSD per claim, refuses anyone already holding 100,000, and allows one claim per 60 seconds shared across everyone, not per account. The app is built on the AUSD pot by default, and "Add test dollars" claims from this faucet with the person's own account. TESTUSD stays as the fallback (build with `VITE_NIVPAY_POTS=testusd`). Staging access from Agora is still worth having, but no longer blocks the demo.
- Send and receive: the demo shows both ends. Someone chips in AUSD, and when the second yes lands, the Caterer's own phone shows the AUSD arriving. The Caterer is a real passkey account on my second phone. Each receipt shows the measured time from submit to finalized, for example "Settled in 0.7s". Measure it; never hardcode it.
- Mobile application: wrap the PWA as an Android app with Bubblewrap (Trusted Web Activity) before submission. Add it as a phase after Phase 4.
- Agora's API (api.agora.finance) needs keys from an Agora organisation account, and its public docs describe no staging environment. Don't build against it until I confirm staging access. If I get it, estimate an "Add money / Cash out" flow using its mint and redeem routes and tell me the effort before building.
- Business viability: the fee on payouts is the revenue. Show it on every payment and in the close summary.

## Agora Instant Settlement: what was checked, and how the app uses it

Checked read only on 9 Oct 2026, then replayed on a local fork of Monad
testnet with impersonated accounts; nothing was sent to the network.

- The pair `0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae` (verified
  implementation `0x1a5d115a87e39fd8d8c9e53b91dbe5e0ec309dd2`) lets only a
  caller holding `APPROVED_SWAPPER` exchange. The recipient can be anyone, so
  the app makes the other person's account the recipient.
- The role is granted only by `WHITELISTER_ROLE`, which the whitelister
  `0x7c10F56d6f04a51376393a1C3670e966863F6BD5` holds. Its
  `setApprovedSwapper(address)` has no caller check on testnet: a fresh
  account can grant itself the role, and so can a passkey account. Agora's
  examples say the same. Nothing blocked the feature.
- Price fixed at 1 CTK per AUSD, purchase fees 0, about 981,616 CTK and
  1,018,384 AUSD in reserve, not paused.
- The CTK faucet address `0xf8A143b3406faF59FD9A34891076104B10200B1D` has no
  code on Monad testnet (it has code on Avalanche Fuji). It isn't needed: the
  app sends AUSD in and the recipient gets CTK.

In the app: Send dollars, then "They receive: CTK". The first time, three
requests behind one confirm and one fingerprint: the one-time setup, letting
the pair take exactly this amount, and the exchange to the recipient with a
minimum amount out. Later payments take two. On the fork: setup 234,218 gas,
allowance 70,237, exchange 207,981 the first time and 190,981 after; the
recipient got exactly 10 CTK for 10 AUSD each time. The admin and its powers
are listed in the README under "Outside this contract: Agora's Instant
Settlement".
