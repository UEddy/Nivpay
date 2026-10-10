# Recording Mama's 60th on production

A script for the demo video, run on https://nivpay.vercel.app with fresh
accounts on two phones. Everything here is on Monad testnet with test AUSD;
the app says "Test mode" throughout. Nothing in it is hardcoded in the app:
the names, cities and amounts are typed in on camera.

The story: Idara (London), Ubong (Houston) and Aniekan (Uyo) pay for their
mother's party. The pot can only pay the Caterer (up to $700) and the Event
hall (up to $300), and 2 of 3 must say yes. Idara puts in $500, Ubong $400,
Aniekan $100. The Caterer is paid $600 and the hall $280. Idara asks to
close early, Ubong agrees, and each takes their share of the $115.60 left.

## Before you record

* `https://nivpay.vercel.app/api/fund/status` answers `"enabled": true` and
  `"keyMatches": true`, and the funder holds at least 2 MON: a take uses
  0.4 MON of gas grants (4 grants of 0.1, two for Idara and one each for
  Ubong and Aniekan, plus about 0.002 MON to send each), the 2 minute path
  below uses 0.1, and granting stops at a 1 MON floor.
* Agora's faucet has stock: Add test dollars works for one account on either
  phone, or `faucetDripAmount()` and the faucet's AUSD balance read on
  MonadVision.
* Both phones: Chrome, signed in to Google Password Manager (passkeys are
  saved there), screen recording ready, notifications off.
* Fresh accounts for every take (see [Between takes](#between-takes)): an
  account that has sent 10 requests gets no more gas grants, and a full take
  sends 6 from Idara's.
* Links pass between the phones through a chat (WhatsApp to yourself, or
  any chat on both phones). A link pasted into the address bar works too.

## Who is on which phone

| Phone | Accounts, in the order made | City typed in |
| --- | --- | --- |
| A, Galaxy S24 | Idara, then Caterer | London |
| B, Galaxy S10 | Ubong, then Aniekan, then Event hall | Houston, Uyo |

One phone holds several accounts: Account details, Switch account, Add
another account. Each account is its own passkey; when the phone asks which
passkey, pick the one with that account's name. The Caterer and the Event
hall are real accounts, so the video can show the Caterer being paid.

Both phones are in the same time zone, so everyone's local time on the
request screen is the same. That is expected; the cities come from what each
person types.

## 1. Accounts and test dollars (before the camera, about 5 minutes)

The faucet allows one claim a minute for everyone at once, not per account.
Only the three who put money in need test dollars; the payees don't.

| Time | Phone | Do | Expect |
| --- | --- | --- | --- |
| 0:00 | A | Create your account, name **Idara**, save the passkey | Home, balance $0.00 |
| 0:30 | A | Add test dollars | about 10 s for the gas grant and the claim; balance $10,000.00 |
| 0:45 | B | Create your account, **Ubong** | |
| 1:40 | B | Add test dollars (at least 60 s after Idara's claim) | $10,000.00. Too early shows Code 60 with a countdown; wait and tap Try again |
| 1:50 | B | Switch account, Add another account, **Aniekan** | |
| 2:50 | B | Add test dollars (60 s after Ubong's) | $10,000.00 |
| 3:00 | B | Add another account, **Event hall** | no test dollars needed |
| 3:15 | A | Add another account, **Caterer** | no test dollars needed |
| 3:30 | A | Switch account back to **Idara** | |

10,000 test dollars each is far more than needed; they stay for the next
take only if you reuse the accounts, which you shouldn't (see below).

## 2. Make the pot (on camera from here)

| Step | Phone, account | Do | Expect |
| --- | --- | --- | --- |
| 2.1 | A, Idara | Make a pot. Pot name **Mama's 60th** | Draft, not made yet; the lid sits open |
| 2.2 | A, Idara | Who decides: your city **London**, your suggested share **$500**. Invite someone to decide, **Ubong**, Send them a link. Again for **Aniekan**. How many must say yes: **2** of 3 | two invites waiting for a reply |
| 2.3 | A, Idara | Pours only to: Add a place to pay, **Caterer**, up to **$700**, Send them a link. Again for **Event hall**, up to **$300** | |
| 2.4 | A, Idara | Closes: choose **Thu 31 Dec 2026** | "Closes at the end of Thu 31 Dec 2026", the end of that day in London. Early close in section 5 is what the video shows |
| 2.5 | B, Ubong | Open Ubong's invite from the chat, city **Houston**, Make my reply, Send the reply back to phone A | |
| 2.6 | B, Aniekan | Switch account, open Aniekan's invite, city **Uyo**, reply | |
| 2.7 | B, Event hall | Switch account, open the hall's invite, reply | |
| 2.8 | A, Caterer | Switch account, open the Caterer's invite, reply. Open the reply link on phone A: it switches back to Idara by itself | |
| 2.9 | A, Idara | Open each reply link from phone B on phone A. Then in Who decides set Ubong's suggested share to **$400** and Aniekan's to **$100** | "Everyone has replied" |
| 2.10 | A, Idara | Make the pot, check the details, confirm with the fingerprint | a few seconds, then the lid drops and locks at Finalized; Ubong, Aniekan, the Caterer and the Event hall already have it on their Home with no link |

If the app asks to Add the names after the pot is made, confirm once more:
that is a signature over the names, not a request, and sends nothing.

Then Share the pot, send the link to phone B and open it there once. Nobody
needs it to see the pot, which is already on every named person's Home, but
it carries the signed names and suggested shares: without it, phone B shows
people as "Ending 7bC1" on the map and "account ending 7bC1" in sentences,
and the pour starts at $100 instead of the suggested share. Opening it once
on phone B is enough for every account on that phone.

## 3. Pour in

| Step | Phone, account | Do | Expect |
| --- | --- | --- | --- |
| 3.1 | A, Idara | Open Mama's 60th, Pour in **$500** | the coin flies from London, holds at the rim, lands at Finalized; the pot holds **$500** |
| 3.2 | B, Ubong | Switch to Ubong, open the pot from Home, Pour in **$400** | **$900**; phone A shows Ubong's coin arrive within a few seconds |
| 3.3 | B, Aniekan | Switch to Aniekan, Pour in **$100** | **$1,000** |

## 4. Payments

| Step | Phone, account | Do | Expect |
| --- | --- | --- | --- |
| 4.1 | B, Aniekan | Ask for a payment, **Caterer**, **$600** | the sheet shows NivPay fee **$3.00**, left in the pot after **$397.00**, Caterer limit $600 of $700, and "1 more yes pays Caterer" before the fingerprint |
| 4.2 | B, Aniekan | Confirm | the request screen opens; the Caterer's route marches and its ring pulses (Payment asked) |
| 4.3 | B, Ubong | Switch to Ubong. Home shows it under **Waiting for your yes** with no link. Open it | Asked / You / Waiting, fee $3.00 |
| 4.4 | B, Ubong | Say yes and pay Caterer | "That's 2 of 3. Paying Caterer now", then at Finalized the pot tips, the stream runs to the Caterer, the level drops, the Caterer fills with a check; the pot has **$397.00** |
| 4.5 | A, Caterer | Switch to the Caterer, Receive | **$600.00** under Payments in, "From A NivPay pot, paid with its deciders' yes" |
| 4.6 | B, Aniekan | Switch to Aniekan, Ask for a payment, **Event hall**, **$280** | fee **$1.40**, left after **$115.60**, limit $280 of $300 |
| 4.7 | A, Idara | Switch to Idara, Home, Waiting for your yes, open it, Say yes and pay Event hall | the paid motion; the pot has **$115.60** |

Fees are 0.5% of the payment (`feeBps` 50, capped at $50 per payment): $3.00
on $600 and $1.40 on $280, $4.40 in all, taken from the pot on top of each
payment. The Caterer receives exactly $600 and the hall exactly $280.

## 5. Close and take shares

| Step | Phone, account | Do | Expect |
| --- | --- | --- | --- |
| 5.1 | A, Idara | Pot, Closing and your share | if it closed now: Idara **$57.80**, Ubong **$46.24**, Aniekan **$11.56**; "You put in $500, half of the pot, so half of what's left is yours" |
| 5.2 | A, Idara | Ask to close early | the request screen for closing early; nothing moves |
| 5.3 | B, Ubong | Switch to Ubong, Home, Waiting for your yes, Say yes and close it | the pot closes; See the split |
| 5.4 | B, Ubong | See the split | dotted streams to each city, the three amounts appear; "$1,000 went in. $880 was paid out and $4.40 went on fees"; "Closed 10 Oct. Idara asked, you agreed" with today's date |
| 5.5 | B, Ubong | Take my **$46.24** | the coin flies to Houston, waits until Finalized, then a check; "Your $46.24 is in your balance" |
| 5.6 | A, Idara | Take my **$57.80** | the same, to London |
| 5.7 | B, Aniekan | Take my **$11.56** | the pot holds $0.00, to the cent |

Nothing is sent to anyone at close: each person takes their own share. The
narration should not say the money "goes back" by itself.

## 6. The story and the explorer

| Step | Phone, account | Do | Expect |
| --- | --- | --- | --- |
| 6.1 | A, Idara | Pot, See the pot's story | every step, newest first, each with a Receipt link |
| 6.2 | A, Idara | Tap the replay button on the map (the circular arrow, read out as "Replay the pot's story") | the whole story in about 7 s, rows lighting up in step. It only shows once the history has fully loaded, and never with reduced motion on |
| 6.3 | A, Idara | Tap Receipt on "Paid $600 to Caterer" | MonadVision opens the transaction: Ubong's yes, the payout to the Caterer's account and the fee, finalized |
| 6.4 | A, Idara | Account details, View receipt | MonadVision opens Idara's own latest request, the share she took |

Show the explorer once, at 6.3. It is the only screen in the video that names
the chain, and the app links to it only as a receipt.

## Amounts and fees in one take

| Step | Amount | NivPay fee | Pot after |
| --- | ---: | ---: | ---: |
| Idara pours in | $500 | none | $500.00 |
| Ubong pours in | $400 | none | $900.00 |
| Aniekan pours in | $100 | none | $1,000.00 |
| Caterer paid, on Ubong's yes | $600 | $3.00 | $397.00 |
| Event hall paid, on Idara's yes | $280 | $1.40 | $115.60 |
| Closed early, on Ubong's yes | | none | $115.60 |
| Ubong takes his share | $46.24 | none | $69.36 |
| Idara takes her share | $57.80 | none | $11.56 |
| Aniekan takes his share | $11.56 | none | $0.00 |

Only a payment from the pot has a fee. Putting money in, asking, saying
yes, closing and taking a share have none, and the gas behind every request
is covered by the gas grants, never shown. `app/src/docs.test.ts` checks
these figures against the app's own fee and share arithmetic.

## Requests per account in one take

| Account | Requests it sends | Count |
| --- | --- | ---: |
| Idara | Add test dollars, make the pot, pour in $500, the yes that pays the hall, ask to close, take her share | 6 |
| Ubong | Add test dollars, pour in $400, the yes that pays the Caterer, the yes that closes, take his share | 5 |
| Aniekan | Add test dollars, pour in $100, ask for the Caterer, ask for the hall, take his share | 5 |
| Caterer, Event hall | none: replies are links, and being paid sends nothing | 0 |

Every account stays under the gas grant's limit of 10 sent requests; the last
grant anyone needs is asked for with 3 sent (`docs/APP-CONTRACT-MAP.md`
section 11). A retry on the same nonce sends no extra request; one that is
included and fails does, and so does a test dollar claim that loses the
race to another claimer (Code 62).

## Between takes

Use five new accounts for every take. Reusing Idara's account would put her
past 10 sent requests in the second take, and the gas grants would stop.

1. On both phones, Chrome, nivpay.vercel.app, the site settings, Delete data.
   This clears the accounts list, drafts and the saved history on that phone.
   It cannot touch anything on chain: the old pot and its accounts stay
   there, and nobody else can use them.
2. In Google Password Manager, delete the previous take's NivPay passkeys, so
   the passkey picker only offers the new ones. An old account's passkey is
   the only way into it, so delete them only once that take is finished
   with.
3. Check `api/fund/status` again: enabled, and the funder above 2 MON.
4. Start again from section 1. The new pot gets the next number; the old
   one stays visible on MonadVision only.
5. Wait at least 60 s after the last claim of the previous take before the
   first new claim, or it shows Code 60 and counts down.

## The 2 minute bounty path

A separate, shorter recording for Agora's bounty: passkey onboarding, an AUSD
balance, a send and a receive settled at Finalized, and a payment delivered
in another currency through Agora's Instant Settlement. No pot. Two fresh
accounts, one per phone; only the sender needs test dollars, so the
faucet's shared 60 second cooldown matters only if a claim was made in the
minute before.

| Phone | Account | Role |
| --- | --- | --- |
| A, Galaxy S24 | **Idara**, made on camera | sends |
| B, Galaxy S10 | **Ubong**, made before the camera rolls | receives |

Before the camera: on phone B, create **Ubong** and open Receive once, so
its Payments in list starts before anything is sent (it starts about ten
minutes before Receive is first opened on that phone). Check
`api/fund/status` as above.

| Time | Phone, account | Do | Expect |
| --- | --- | --- | --- |
| 0:00 | A | Open nivpay.vercel.app. Your name **Idara**, Create your account, save the passkey to Google Password Manager | the fingerprint prompt, then Home: **Your balance**, Dollars **$0.00**, "Held as AUSD, a digital dollar issued by Agora." |
| 0:15 | A, Idara | Add test dollars | "Getting your account ready…", the fingerprint, "Adding test dollars…", then "Added $10,000 test dollars. Settled in 0.Xs." and Dollars **$10,000.00**. Code 60 with a countdown means someone claimed in the last minute: wait, Try again |
| 0:35 | B, Ubong | Receive, Amount to ask for **25**, Share your request link, send it to phone A through the chat | |
| 0:45 | A, Idara | Open the link | Send dollars: "Ubong asked you to pay them.", Sending to Ubong, How much **25** already filled in |
| 0:50 | A, Idara | Review | Check and send: To Ubong, Amount **$25**, Fee "None. NivPay covers it.", Arrives "In about a second, final once confirmed" |
| 0:55 | A, Idara | Send $25, fingerprint | "Sending…", "Confirming…", then Payment final: "Sent $25 to Ubong. Settled in 0.Xs." and View receipt |
| 1:00 | B, Ubong | Receive is still open | **+$25.00**, "From account ending" and Idara's last 4 characters, "Just arrived", within a second or two; Your balance **$25.00** |
| 1:05 | A, Idara | View receipt | MonadVision opens the transfer of 25 AUSD from Idara's account to Ubong's, finalized. The one explorer moment in this path; go back to the app |
| 1:15 | A, Idara | Done, open the same request link again from the chat, change How much to **10**, They receive: **CTK** | "CTK is a test currency from Agora, settled at a fixed rate the moment your payment is final." |
| 1:25 | A, Idara | Review | Check and send: You send **$10**, They receive **10.00 CTK**, At least 10.00 CTK, Rate "$1 = 1.00 CTK, fixed by Agora", Agora's fee **0.00 CTK**, No NivPay fee, "Includes a one-time setup for sending in other currencies.", "One fingerprint. It settles in 3 steps, each final before the next." |
| 1:30 | A, Idara | Send $10 as CTK, fingerprint once | "Step 1 of 3. One-time setup…", "Step 2 of 3. Getting your dollars ready…", "Step 3 of 3. Sending…", then "Sent $10 to Ubong. They received 10.00 CTK. Settled in 0.Xs." and "Your one-time setup is done." The settled time is the exchange's own, the last step |
| 1:45 | B, Ubong | Receive | **+10.00 CTK**, "From Agora's settlement, paid in another currency" |

Read the rate, the fee and the CTK amounts off the sheet, not this table:
Agora sets them and can change them (on 9 Oct 2026, 1 CTK per AUSD and no
fee). Every "Settled in" figure is measured on the phone; never narrate a
number before it shows.

Requests in one take: Idara sends 5 (the claim, the $25 payment, then the
setup, the allowance and the exchange behind one fingerprint) and gets one
gas grant, before the claim. Ubong sends none: receiving sends nothing. A
second take on the same Idara account would end at 10 sent, the gas grant
limit, and would not show the one-time setup, so every take needs a new
sender. Ubong can stay. Between takes: delete phone A's site data and
Idara's passkey as in [Between takes](#between-takes), and wait 60 s after
the last claim.

## If something goes wrong on camera

| You see | It means | Do |
| --- | --- | --- |
| Code 60 with a countdown | someone claimed from the faucet under a minute ago | wait for it to reach 0, Try again |
| "This is taking longer than it should", Code 51 | the request stalled; nothing moved | Try again: it reuses the same nonce, so it can't happen twice |
| Code 56 | the node turned the request down twice; nothing moved | Try again |
| Code 11 | another request from this account is still being confirmed | wait a few seconds |
| Code 24 or 25 on a yes | over the payee's limit, or the pot can't cover the payment and its fee | check the amounts in this script |
| Code 13 | gas grants are paused, or the funder is at its floor | check `api/fund/status` |
