# NivPay error codes

The app shows people a short, neutral code under any failure, like "Code 16".
This table says what each one means. Read the code off the phone and look it
up here. Codes are stable: one is never reused for something else. The source
of truth is `ERROR_CODES` in `app/src/copy.ts`; keep the two in step.

"Nothing was sent" in the message means the person's own request was never
broadcast. A message that says the request was sent but isn't confirmed yet
means it was, and the app is still tracking it.

## Getting ready

| Code | What happened | Where to look |
| --- | --- | --- |
| 10 | Couldn't get the request ready: reading the account, estimating its cost or the fee failed. | RPC reachability from the phone |
| 11 | Another request from this account is still in flight. Wait for it. | The pending write in IndexedDB |

## Gas grant (the setup service, `/api/fund`)

| Code | What happened | Where to look |
| --- | --- | --- |
| 12 | The phone couldn't reach `/api/fund` at all. | Connection, Vercel status |
| 13 | Funding is paused: `FUNDING_ENABLED` is off, or the funder is at its 1 MON floor. | `/api/fund/status` |
| 14 | The funder key is malformed or missing, or `FUNDER_ADDRESS` isn't set. | Vercel env vars; `keyMatches` in `/api/fund/status` |
| 15 | The funder key doesn't belong to `FUNDER_ADDRESS`. | Vercel env vars; `keyMatches` in `/api/fund/status` |
| 16 | The grant couldn't be sent (`SEND_FAILED`). | Vercel function log, `"event":"failed"` |
| 17 | The service couldn't read the chain before granting (`RPC_FAILED`). | Vercel function log, RPC status |
| 18 | The account has sent 10 or more transactions, the per-account limit. | Expected abuse limit |
| 19 | The service refused for another reason: not a personal account, wrong chain, wrong origin, or not found. | Vercel function log, `"event":"refused"` |
| 20 | The grant was sent but wasn't final within 60 seconds. | Funder's recent transactions |
| 21 | The grant was included but reverted. | The grant transaction |

## Passkey

| Code | What happened | Where to look |
| --- | --- | --- |
| 30 | The passkey prompt was cancelled or didn't finish (Mera `PASSKEY_OPERATION_FAILED`). | Usually the person dismissed it |
| 31 | The passkey provider has no PRF support (Mera `PRF_UNAVAILABLE`). Use Google Password Manager or iCloud Keychain. | Which password manager saved the passkey |
| 32 | The browser lacks a crypto primitive Mera needs (Mera `CRYPTO_UNAVAILABLE`). | Browser version |
| 33 | The passkey chosen belongs to a different account than the one in use. | Switch account |
| 34 | The signing session ended before signing (Mera `SESSION_ENDED`). | Try again |
| 35 | Another passkey failure. | Browser console on a USB debug session |
| 36 | Accounts aren't allowed on this hostname (only nivpay.vercel.app and localhost). | The URL being used |

## Sending and confirming

| Code | What happened | Where to look |
| --- | --- | --- |
| 41 | Signing the transaction failed after the passkey step. | Browser console |
| 42 | Saving the signed request to IndexedDB failed, so it was never broadcast. | Storage settings, private browsing |
| 50 | The request was broadcast, but following it to finality failed. The app resumes on reload. | The pending write's hash |
| 51 | Not in any block after 45 seconds, and its nonce is still unused at finalized. Nothing moved; it can be retried on the same nonce. | The pending write |
| 52 | Included and finalized, but reverted. Nothing moved. | The transaction receipt |
| 53 | Its nonce was used by a different transaction. Nothing of this request moved. | The account's transactions |
| 54 | A retry was refused because the earlier attempt may still go through. Wait. | The pending write |
| 55 | Try again was pressed but there was nothing stuck to retry. | |

## Adding test dollars on the AUSD deployment (Agora's faucet)

60 and 61 are found before anything is sent: the app runs the claim as a call
first, so no gas grant or passkey prompt is spent on them.

| Code | What happened | Where to look |
| --- | --- | --- |
| 60 | Cooldown: someone claimed from the faucet less than 60 seconds ago. It is one cooldown for everyone, not per account. Nothing was sent. The phone counts down the seconds left and enables Try again when they reach 0; it never claims without a tap. | `lastDripTimestamp()` on the faucet |
| 61 | Ceiling: the account already holds 100,000 AUSD or more (`maxAmountToOwn()`). Nothing was sent. | The account's AUSD balance |
| 62 | The faucet refused for another reason before sending (out of stock, `0x356680b7`, or an unknown error), or the claim was included and reverted, usually because someone else claimed first. No AUSD moved. | The faucet's AUSD balance; the transaction receipt |

## Other

| Code | What happened | Where to look |
| --- | --- | --- |
| 99 | Anything not covered above. | Browser console on a USB debug session |
