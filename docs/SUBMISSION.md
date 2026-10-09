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
| A completed send and receive of AUSD, settled instantly | In progress | Putting money into a pot and a payout to a destination already settle in AUSD and report the measured time to Finalized. A direct "Send dollars" and "Receive" flow is the next piece of work. |
| Agora Instant Settlement on Monad testnet | Under investigation | Whether a NivPay account may use the pair depends on its whitelist. The finding goes in `docs/BOUNTIES.md`; nothing will be faked. |
| Mobile application | **Owner**, optional | `docs/BOUNTIES.md` plans an Android wrap of the web app with Bubblewrap before submission. |
| Business viability shown | Done | The payout fee is the revenue, shown on every payment. |

## Only the author can do

1. Settle every [CHECK] in `README.md` and in this file.
2. Push the local commits. The repository is already public.
3. Record and publish the demo video, 3 minutes at most.
4. Fill in the submission form, one track only.
5. Keep `FUNDING_ENABLED`, the funder key and its MON balance healthy on Vercel
   through judging, or turn funding off.
