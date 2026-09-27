# Build the NivPay app

You are building the NivPay web app, a mobile-first PWA, on top of the NivPay contracts already deployed and verified on Monad testnet from this repo. Work in phases. At the end of each phase, report in under 15 lines and wait for my go-ahead.

Read first, in this order: `CLAUDE.md` if it exists (its rules win over this file; if they conflict, stop and ask me), `README.md`, `src/NivPayPots.sol`, `src/NivPayTestDollar.sol`, the tests, the deploy scripts and broadcast receipts, `docs/design/README.md` and the five screens in `docs/design/`, `docs/MOTION.md`, and `docs/BOUNTIES.md` if it exists.

## What NivPay is

A group purse for one purpose that no single person can pocket. A pot has fixed destinations with limits, a rule for how many deciders must approve a payment (for example 2 of 3), and a closing date. Invited people chip in. Money only leaves as an approved payment to a listed destination or as a person's own share. Whatever is left goes back to each person in proportion to what they put in.

The demo story (for the demo video only; never hardcode it in the app): "Mama's 60th". Idara in London, Ubong in Houston, Aniekan in Uyo. The pot pays only the Caterer (limit $700) and the Event hall (limit $300). 2 of 3 must approve. It closes Thu 31 Dec 2026. Idara puts in $500, Ubong $400, Aniekan $100. The Caterer gets $600 (fee $3.00) and the hall $280 (fee $1.40). $115.60 is left, which splits $57.80, $46.24 and $11.56.

## Fixed facts

- Chain: Monad testnet, chain id 10143, RPC `https://testnet-rpc.monad.xyz`. Use `monadTestnet` from `viem/chains` and confirm it exists in the installed viem.
- NivPayPots on AUSD: `0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB`
- NivPayPots on TESTUSD: `0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA`
- TESTUSD (NivPayTestDollar): `0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7`
- AUSD (Agora, testnet): `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals, supports ERC-2612 permit.
- Payment fee: 50 bps with a cap. Read the rate and cap from the contract; don't hardcode them.
- Check every address against the broadcast receipts in this repo. If anything here disagrees with the repo, the repo wins and you tell me.

What Monad's docs say (checked 27 Sep 2026). These shape the app:

- Block tags: `latest` is Proposed, `safe` is Voted, `finalized` is Finalized. Proposed and Voted blocks can in theory be dropped. Finalized blocks cannot be reverted without a hard fork. Anything read from a non-finalized block can change on the next identical request.
- `eth_sendRawTransaction` may accept a transaction with too little gas balance or a nonce gap and fail later. `eth_getTransactionByHash` returns null until the transaction is in a block.
- `eth_getLogs` has a block range limit that depends on the provider (100 blocks on some mainnet endpoints). Measure the testnet limit yourself.
- Full nodes don't serve arbitrary old state, so history comes from events, not old `eth_call`s.
- Monad charges the gas limit, not the gas used. Don't pad gas limits.

## Accounts: Mera passkeys

Use `@category-labs/mera` with `@scure/bip32` and `@scure/bip39`, exactly as its docs describe (https://mera.category.xyz/getting-started/ and https://mera.category.xyz/recipes/send-a-transaction-with-viem/):

- Sign up: `createPasskeyWithPrfOutput({ rp: { id: location.hostname, name: "NivPay" }, user })`, then derive the key: `entropyToMnemonic(prfOutput)`, `mnemonicToSeedSync`, HD path `m/44'/60'/0'/0/0`.
- Sign in: `getPasskeyPrfOutput({ rpId: location.hostname })`.
- Signing: `createSecp256k1SigningSession({ privateKey })`, then `toViemAccount(session)` from `@category-labs/mera/viem`.

Rules:

1. Never store or log the private key, PRF output, mnemonic, seed or session. Store only the address.
2. Open a signing session right before a transaction and call `session.end()` right after signing. Wipe the HD key (`wipePrivateData()` in @scure/bip32, if the installed version has it) and drop every reference.
3. The account is bound to the hostname (the rpId). A passkey made on one hostname can never be used on another, so accounts cannot move domains. Only allow sign-up on the production hostname and on localhost. On any other hostname, such as a preview deploy, refuse with a clear message.
4. Handle `PRF_UNAVAILABLE`, `PASSKEY_OPERATION_FAILED` and `CRYPTO_UNAVAILABLE` in plain words. Mera's support table (https://mera.category.xyz/authenticator-support/) says PRF works with Google Password Manager on Android Chrome and with iCloud Keychain on iOS 18 and later. It does not work with the Chrome desktop profile, Bitwarden or Dashlane. Samsung Pass is not listed: test it, and if it fails, tell people to save the passkey to Google Password Manager.
5. Mera's own threat model says any script running on our domain can take the key. So: no third-party scripts, no analytics, no remote fonts, a strict Content Security Policy, few dependencies at exact versions, and a committed lockfile.

## Invisible gas, visible test dollars

People never see gas or MON.

- A Vercel serverless function at `/api/fund` tops up an address with a small amount of testnet MON from a dedicated funder key. I will create that key myself in a separate terminal and type it only into Vercel's environment settings. It is never the deployer key, never in the repo, never printed. Never ask me for it.
- The function accepts only a valid address, runs only on chain 10143 (and refuses otherwise), funds only when the address holds less than a small minimum and has sent fewer than a small number of transactions, sends a fixed amount sized from measured gas costs, stops at a floor so the funder never runs dry, accepts same-origin requests only, handles two requests arriving together without nonce clashes, and returns the transaction hash. Write its abuse limits down honestly.
- The app waits until the funding transaction is finalized before it sends the person's own transaction.
- TESTUSD mode: a "Get test dollars" button mints TESTUSD to the person (read the mint function and its cap from the contract). Wherever TESTUSD appears, the copy says these are test dollars, not real money. Never label TESTUSD as AUSD. The design's line "Held as AUSD digital dollars" is only true in AUSD mode.
- A pot's token is whatever its NivPayPots contract is bound to. Read it from the contract and label amounts to match.

## Design

- The five screens in `docs/design/` are the spec: make a pot, pour in, approve a pour, the pot's story, close and split. Match layout, copy, colours, type and sizes. Fonts are Besley (600 and italic 400) for headlines and amounts and Work Sans (400, 500, 600) for everything else. Self-host both, for example through Fontsource. No request to Google at runtime.
- Motion follows `docs/MOTION.md` exactly, including the rule that nothing lands before Finalized.
- Add only the screens the flow needs: welcome and sign up, sign in, a home list of pots, joining from an invite link, and loading, empty, error and offline states in the same style.
- The approve and story screens show each person's local time. Keep each person's city and IANA time zone in the pot's labels and format times with `Intl.DateTimeFormat`.
- Money is `bigint` end to end. Never use floats for token amounts. Format amounts with one helper.

## Invites and names

Find out from the contract how an invited person becomes a funder and a decider, and design the invite flow around what the contract actually allows. Tell me which case it is before you build it:

- A. People can be added after the pot exists (invite codes, signatures or an open funder list). The creator makes the pot and shares a link; the invitee signs up and joins.
- B. Every decider's address is needed when the pot is made. A draft pot lives on the creator's phone. Each invitee opens a join link, signs up, and sends their address back as a link over WhatsApp or any chat. When everyone is in, the creator makes the pot.

Names and labels (pot name, people, cities, vendor names): if the contract stores them, read them. If it doesn't, the creator signs a small JSON with their account and it travels in the invite link's `#` fragment, which is never sent to a server. The app accepts the labels only if the signer is the pot's creator on chain. Labels are for display only. Destination addresses and limits always come from the contract, and the payment screen shows the short address next to the vendor's name.

## Live data

- One event feed per pot. Every second, poll `eth_getLogs` up to the finalized block, in pages no bigger than the limit you measured, starting from the block the pot was created in (store it with the pot and put it in the invite link). Keep a cursor per pot in IndexedDB.
- The person's own actions: start the animation when they submit, land it on the finalized receipt, and roll it back if it fails.
- Current numbers (balance, shares, limits used) come from view calls at the finalized block.
- Known limit, which goes in the README: scanning logs is fine for new pots and too slow for old ones. The fix later is an indexer.

## Phases

### Phase 0: read and map (no app code)

- Write `docs/APP-CONTRACT-MAP.md`. Map every action on the five screens to the exact function: its signature, who may call it, its preconditions, the events it emits and its revert reasons. Map every number on screen to a view function or an event. List the gaps, meaning anything in the design the contract doesn't support, and how you'd handle each one without changing the contracts.
- Answer these in the map: how deciders and funders are set; how a payment is asked for, approved and paid, and whether the asker counts as a yes; how requests expire; who can pause and what a pause blocks; how and when a pot closes; whether someone can take their share out before the pot closes; how leftovers are claimed; whether deposits can use permit; how the creator and any names are stored.
- Measure with curl against the testnet RPC: the real `eth_getLogs` block range limit, whether the `finalized` tag works, and the gas used and fee for each action. Put the numbers in the map.
- Run `node -v`, `npm -v` and `forge --version` in your shell. You need Node 20 or newer. If Node is missing or older, stop and tell me. If forge is missing, don't install it; tell me and I'll run the forge checks in PowerShell.
- If `docs/BOUNTIES.md` exists, list each requirement and how the app will meet it.
- Commit the docs. Stop.

### Phase 1: skeleton

- Put the app in an `app/` folder: Vite, React, TypeScript. Allowed dependencies: react, react-dom, viem, @category-labs/mera, @scure/bip32, @scure/bip39 and the font packages. Anything else needs a one-line reason in your report. Use exact versions, commit the lockfile, and run `npm audit`: it passes or you explain each finding.
- Leave the Foundry project alone. `forge build` and `forge test` must still pass.
- Security headers in `vercel.json`: a CSP with `default-src 'self'`, `connect-src 'self'` plus the RPC, `script-src 'self'`, `style-src 'self'` (add `'unsafe-inline'` only if something truly needs it, and say what), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`. Also Referrer-Policy, Permissions-Policy and X-Content-Type-Options.
- A PWA manifest and a service worker that caches the app shell only, never RPC or `/api` responses.
- Stop.

### Phase 2: accounts and gas

- Sign up, sign in, the signing-session helper, `/api/fund`, and the "Get test dollars" flow, working end to end on localhost and on my phone.
- Stop.

### Phase 3: the five screens, with live data and motion

- Build them one at a time, in story order. Each screen must work against a real pot on testnet before you start the next.
- Stop after each screen so I can check it on my phone.

### Phase 4: deploy and prove it

- Deploy to Vercel on the final hostname. This hostname becomes the passkey rpId for good, so confirm the name with me first.
- Write `docs/TESTING.md` as a checklist for running the full Mama's 60th story on testnet across my two phones (Galaxy S24 and Galaxy S10, Chrome, Google Password Manager). I'll run it and tell you what failed; you fix it.
- Check that the live site sends the security headers, that the built bundle contains no secrets, that `/api/fund` refuses bad input and stops at its floor, and that the motion holds 60fps on the S10 as `docs/MOTION.md` asks (Chrome remote debugging over USB).
- Update the README: how to run it, how it works, and the known limits.

### Optional Phase 5 (only if Phases 0 to 4 are done by 9 Oct)

A "try it alone" demo in which two server-held testnet keys play Ubong and Aniekan, so a judge can run the whole story by themselves. Those keys follow the same rules as the funder key.

## Rules for every phase

- Do not modify or redeploy the contracts. If the app needs a contract change, stop and tell me.
- Never ask me for a private key or seed phrase, never print one, never write one to disk. Secrets go into Vercel's dashboard, typed by me.
- TESTUSD is testnet only. Nothing in this app may point at mainnet.
- Small commits with clear messages and no AI attribution lines. Don't push; I push.
- No em dashes or en dashes anywhere in UI copy or docs.
- My setup: you run natively on Windows in `C:\Users\Eddy\dev\nivpay`, with Git Bash and PowerShell. Foundry 1.8.3 is on the Windows PATH. I use WSL only to push over SSH. Keep npm scripts free of bash-only and PowerShell-only syntax so they run in both. I test in Chrome myself.
- Verify before you claim. If you say something works, say how you checked it.

## Timeline

The working deadline is the night of 13 Oct. Submissions close 14 Oct at 04:59 GMT+1.

- 30 Sep: Phases 0 to 2 done
- 7 Oct: all five screens working on testnet
- 9 Oct: deployed and tested on both phones
- 10 to 12 Oct: demo video recorded with a real pot
- 13 Oct: submit
