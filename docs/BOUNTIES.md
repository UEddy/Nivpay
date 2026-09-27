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
- Where test AUSD comes from is still open. In Phase 0, check whether the official Monad testnet faucet listed in Agora's docs (0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) holds AUSD and how it is called. I am asking Agora for staging access and test AUSD.
- Send and receive: the demo shows both ends. Someone chips in AUSD, and when the second yes lands, the Caterer's own phone shows the AUSD arriving. The Caterer is a real passkey account on my second phone. Each receipt shows the measured time from submit to finalized, for example "Settled in 0.7s". Measure it; never hardcode it.
- Mobile application: wrap the PWA as an Android app with Bubblewrap (Trusted Web Activity) before submission. Add it as a phase after Phase 4.
- Agora's API (api.agora.finance) needs keys from an Agora organisation account, and its public docs describe no staging environment. Don't build against it until I confirm staging access. If I get it, estimate an "Add money / Cash out" flow using its mint and redeem routes and tell me the effort before building.
- Business viability: the fee on payouts is the revenue. Show it on every payment and in the close summary.
