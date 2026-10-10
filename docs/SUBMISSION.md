# Submission checklist

What the Monad Metropolis hackathon terms ask of a submission, and where this
repository stands on each, as of 9 Oct 2026. The terms sections this covers
are 4.1, 4.3, 5.3, 7.2, 9.2, 9.4 and 10. [CHECK: put each row's section number
in the first column; they were not matched to rows here because the terms text
is not in the repository.]

Status key: **Done** means it is in the repository and was checked.
**Owner** means only the author can do it: it needs an account, a camera, a
phone or a decision.

## Hackathon terms

| Section | Requirement | Status | Evidence, or what is left |
| --- | --- | --- | --- |
| [CHECK] | Public code repository | Done, push pending | https://github.com/UEddy/Nivpay is public (checked 9 Oct 2026). The newest local commits are not pushed yet: the author pushes. |
| [CHECK] | An open source license | Done | `LICENSE`, MIT, "Copyright (c) 2026 UEddy". Referenced in the README and in `app/package.json` (`"license": "MIT"`). Solidity files carry `SPDX-License-Identifier: MIT`. |
| [CHECK] | A README a third party can run from | Done | `README.md`: the problem and intended user, the pot rules, why Monad, every contract address with its verification, architecture, tech stack, setup and deployment with every environment variable, the gas grant limits. |
| [CHECK] | Commit history covering the build window | Done | Commits from 6 Sep 2026 onward, in small steps, none squashed. See `git log --reverse`. [CHECK: the history was never rewritten.] |
| [CHECK] | Pre-existing work declared | Done | README, "Pre-existing work": nothing predates 1 Sep 2026; first commit `e627991` on 6 Sep 2026. Two [CHECK] items there for the author. |
| [CHECK] | Demo video, 3 minutes at most, public, showing Monad interactions | **Owner** | Record and upload it publicly. Suggested: make an account with a passkey, Add test dollars, make a pot, put money in from a second phone, an approval that pays the caterer, the Caterer's phone receiving it, then Account details, View receipt, to show the finalized transaction on MonadVision. |
| [CHECK] | Contract addresses | Done | README, "Contract addresses": all five on Monad testnet (10143) with explorer links; the three NivPay contracts are exact Sourcify matches. |
| [CHECK] | Disclosure of AI tools | Done, with [CHECK] items | README, "AI disclosure": Claude Code, used across contracts, app, tests and docs, and what the author did. The author must settle every [CHECK] in that section before submitting. |
| [CHECK] | Originality | Done | No file is identical to any file in the author's other repositories (hash comparison, 9 Oct 2026). Third-party code is listed with licenses in the README. |
| [CHECK] | Documentation | Done | README, plus `docs/APP-CONTRACT-MAP.md`, `docs/BUILD-APP.md`, `docs/MOTION.md`, `docs/ERROR-CODES.md`, `docs/BOUNTIES.md`, `BENCHMARK.md`. |
| [CHECK] | One project, one track | **Owner** | Enter NivPay in one track only on the form. The README names Consumer Products and Payments. |
| [CHECK] | No secrets in the repository | Done | Full history scan on 9 Oct 2026: no private key, mnemonic, API key, keystore or `.env` file. `.gitignore` covers `.env*`, keystores, key files and `.vercel/`. See README, "Broadcast receipts are committed on purpose". |
| [CHECK] | The submission form | **Owner** | Fill it in with the repository link, the video link, the live app link (https://nivpay.vercel.app) and the contract addresses. |

## The pot story, screen by screen

| Screen | Status | Evidence, or what is left |
| --- | --- | --- |
| Make a pot | Done | Pot 0 on the AUSD pots was made on testnet on 9 Oct 2026 (18:26 UTC) by the author's account. |
| Pour in your share | Done | Pot 0 holds a pour from a second account. |
| Ask for a payment, and say yes | Built, browser checked, needs the phone test | `app/src/screens/Ask.tsx`, `Request.tsx`, `app/src/lib/payout.ts`, `waiting.ts`. Unit tests for every state; live read-only tests against pot 0. Nothing has been signed on testnet with it yet. |
| The pot's story | Built, browser checked, needs the phone test | `app/src/screens/Timeline.tsx`, `app/src/lib/story.ts`, `blockTimes.ts`. Unit tests for every row kind, ordering and the replay; a live read-only test checks the replay's arithmetic against `funderInfo` on pot 0. A phone that has never opened pot 0 reads about 1,480 pages of history the first time. |
| Close and split | Built, browser checked, needs the phone test | `app/src/screens/Close.tsx`, `app/src/lib/close.ts`, `closeLive.ts`. Unit tests for every state; live read-only tests on pot 0 run its holder's exit, a stranger's, a claim before close and a close request as calls. The contract's own exit and claim tests pass (14). Nothing has been signed on testnet with it yet. |

## The closing date, stated exactly

The contract enforces the closing time (`endTime`, fixed when the pot is
made): from that second nothing can go in, no payment can be asked for or
paid, and no early close can be asked for, whether or not anyone does
anything. Taking your own share out works before and after; taking a share
of what is left needs the pot closed. Nothing is sent to anyone at close:
each person takes their own share, with no deadline, and a share nobody
takes stays in the contract. The app only turns the chosen day into the end
of that day in the maker's time zone, refuses a time under 10 minutes away,
and shows it; it does not enforce the date. Full table: README, The rules,
and `docs/APP-CONTRACT-MAP.md` section 15. Any pitch or video line must not
say the money "goes back" by itself.

## Agora bounty: Best Cross-Border Payments App on Monad

Requirements as given: passkey onboarding, an AUSD balance, and a completed
send and receive of AUSD settled instantly, using Agora's Instant Settlement
on Monad testnet to mock fund movement. Judged on implementation quality,
real world usability and business viability of the payments flow. Details and
the author's notes are in `docs/BOUNTIES.md`.

| Requirement | Status | Evidence, or what is left |
| --- | --- | --- |
| Passkey onboarding | Done | Mera passkey accounts (`app/src/lib/passkey.ts`, `app/src/lib/keys.ts`). |
| An AUSD balance | Done | The home screen reads the AUSD balance at the finalized block; Add test dollars claims from Agora's faucet. |
| A completed send and receive of AUSD, settled instantly | Built, needs the phone test | Send dollars (`app/src/screens/Send.tsx`): to a request link or a confirmed Account ID, a confirm sheet, one fingerprint, success only at Finalized with the measured "Settled in" time and a receipt link. Receive (`app/src/screens/Receive.tsx`): a request link to share and each incoming payment shown once final. Checked on a local fork and with live read-only tests; the two-phone run is for the author. |
| Agora Instant Settlement on Monad testnet | Built, needs the phone test | Send dollars, "They receive: CTK" (`app/src/lib/settle.ts`, `app/src/screens/Send.tsx`): a fresh quote with both amounts, the rate and Agora's fee; a minimum amount out; the one-time setup, the allowance and the exchange behind one fingerprint, each final before the next; the recipient set as the exchange's recipient. Receive lists CTK that arrives. Checked with unit tests, live read-only tests and a full signed run on a local fork. Findings in `docs/BOUNTIES.md`. |
| Mobile application | **Owner**, optional | `docs/BOUNTIES.md` plans an Android wrap of the web app with Bubblewrap before submission. |
| Business viability shown | Done | The payout fee is the revenue, shown on every payment. |

## Only the author can do

1. Settle every [CHECK] in `README.md` and in this file.
2. Push the local commits. The repository is already public.
3. Record and publish the demo video, 3 minutes at most.
4. Fill in the submission form, one track only.
5. Keep `FUNDING_ENABLED`, the funder key and its MON balance healthy on Vercel
   through judging, or turn funding off.
