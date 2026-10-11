# Storyboard

Generated from `timelines/*.json` by `node scripts/storyboard.ts`; do not edit by hand. Times are planned:
they come from the placeholders' lengths now, and from the real in and out points once footage is in.
Captions show `[not measured yet]` where facts.ts has no value yet; a final render refuses until it does.
Shots refer to [SHOTLIST.md](SHOTLIST.md).

## agora-bounty

1920x1080, 30 fps, 107.5 s planned (target 105 to 115 s, cap 120 s).
For the Agora bounty judges. The three things they look for (passkey onboarding, an AUSD balance, a send and a receive settled at once) are each shown by a segment that ends before 90 s; the timeline check fails otherwise.

| Time | Shot | On screen | Caption | Callout |
| --- | --- | --- | --- | --- |
| 0.0 to 3.5 s | card | Opening question card. (card) | What if sending dollars felt like sending a text? / NivPay, in test mode |  |
| 3.5 to 18.5 s | B01 | Phone A, welcome screen: type the name, Create your account, the passkey sheet, fingerprint, Home. (one phone; proves passkey) | A brand new account, made with a passkey | No password, no app to install. Eddy's phone. |
| 18.5 to 24.5 s | B01 | Phone A, Home: Your balance, Dollars $0.00, Held as AUSD, a digital dollar issued by Agora. (one phone) | Its balance is in AUSD, a digital dollar from Agora |  |
| 24.5 to 29.5 s | B02 | Phone A, Add test dollars: Getting your account ready, fingerprint, Adding test dollars. (one phone; Sped up x2) | Add test dollars |  |
| 29.5 to 34.5 s | B02 | Phone A: Added $10,000 test dollars. Settled in 0.Xs. Dollars $10,000.00. (one phone; never sped up; proves balance) | $10,000 in AUSD. Settled in [not measured yet] | Test dollars from Agora's faucet, not real money |
| 34.5 to 42.5 s | B03 | Phone B, Maya's Receive: Amount to ask for 25, Copy link, paste it into the chat to phone A. (one phone) | Maya asks for $25 with a link |  |
| 42.5 to 52.5 s | B04 | Phone A: open the link, Send dollars with 25 filled in, Sending to account ending ####, Review: Amount $25, Fee None. (one phone) | Sending to the account ending [not measured yet] | $25, no fee. NivPay covers it |
| 52.5 to 64.5 s | B05 | Both phones in step: A sends $25 with the fingerprint to Payment final; B shows +$25.00 from account ending, Just arrived. (both phones side by side; never sped up; proves settled) Labels: Eddy sends / Maya receives. | Sent and received. Settled in [not measured yet] | Maya's balance: $25.00 |
| 64.5 to 68.5 s | B05 | Phone A, held on Payment final: Sent $25 to Maya. Settled in 0.Xs. (one phone; never sped up; pushed in) | Settled in [not measured yet], measured on the phone |  |
| 68.5 to 78.5 s | B06 | Phone A, View receipt: MonadVision opens the transfer of 25 AUSD to Maya's account, finalized. (explorer) | The receipt on Monad: $25 in AUSD | Transaction hash [not measured yet] |
| 78.5 to 90.5 s | B07 | Phone A: the same request link, How much 10, They receive CTK, the line on what CTK is, Review. (one phone) | Pay in another currency: CTK | CTK is a test currency from Agora, standing in for a local currency |
| 90.5 to 94.5 s | B08 | Phone A: Send $10 as CTK, one fingerprint, Step 1 of 3, Step 2 of 3, Step 3 of 3. (one phone; Sped up x2) | One fingerprint, three steps, each final before the next |  |
| 94.5 to 102.5 s | B08 | A: Sent $10 to Maya. They received 10.00 CTK. Settled in 0.Xs. B: +10.00 CTK from Agora's settlement. (both phones side by side; never sped up) Labels: Eddy sends $10 / Maya receives CTK. | Maya receives [not measured yet]. Settled in [not measured yet] | Rate [not measured yet], set by Agora |
| 102.5 to 107.5 s | card | End card. (card) | NivPay / A passkey, a dollar balance, a payment that settles while you watch. / the link |  |

## technical-demo

1920x1080, 30 fps, 173.0 s planned (target 165 to 175 s, cap 180 s).
Mama's 60th in the real app, then one explorer segment on the PC. Monad, AUSD and transaction hash may appear in captions; chain words (block, contract, explorer) only on the explorer segments.

| Time | Shot | On screen | Caption | Callout |
| --- | --- | --- | --- | --- |
| 0.0 to 4.0 s | card | Opening question card. (card) | When a family pays for a party, who holds the money? / Mama's 60th, in NivPay |  |
| 4.0 to 20.0 s | M01 | Phone A, Eddy: Make a pot, Mama's 60th, London, $500, invite Maya and Daniel, 2 of 3, Caterer up to $700, Event hall up to $300, Thu 31 Dec 2026. (one phone; Sped up x4) | Eddy makes Mama's 60th. Named people decide, 2 of 3 | It can only ever pay the Caterer, up to $700, and the Event hall, up to $300 |
| 20.0 to 24.0 s | M02 | Phone B: Maya, Daniel and the Event hall each open their invite and reply with a link. (one phone; Sped up x4) | Everyone named replies with a link |  |
| 24.0 to 34.0 s | M03 | Phone A: Everyone has replied, set shares $400 and $100, Make the pot, fingerprint, the lid drops and locks at Finalized. (one phone) | Made. It closes Thu 31 Dec 2026 | The rules are fixed the moment it is made |
| 34.0 to 42.0 s | M04 | Phone A, Eddy: Pour in $500, the coin flies from London and lands at Finalized. (one phone; Sped up x1.5) | Eddy pours in $500 |  |
| 42.0 to 52.0 s | M05 | B: Maya pours in $400. A: Maya's coin arrives on Eddy's map within seconds. (both phones side by side) Labels: Eddy watches / Maya pours in. | Maya pours in $400 from Houston |  |
| 52.0 to 58.0 s | M06 | Phone B, Daniel: Pour in $100, the pot holds $1,000. (one phone; Sped up x2) | Daniel adds $100. The pot holds $1,000 |  |
| 58.0 to 68.0 s | M07 | Phone B, Daniel: Ask for a payment, Caterer, $600: fee $3.00, left $397.00, 1 more yes pays Caterer, fingerprint. (one phone) | Daniel asks to pay the Caterer $600 | NivPay fee $3.00, 0.5% of the payment, shown before anyone says yes |
| 68.0 to 80.0 s | M08 | Phone B, Maya: Waiting for your yes, Say yes and pay Caterer, That's 2 of 3, the stream runs to the Caterer, the pot has $397.00. (one phone; never sped up) | The second yes pays it, in the same step | Only to the Caterer. The pot holds $397.00 |
| 80.0 to 86.0 s | M09 | Phone A, Caterer: Receive, $600.00 under Payments in, From a NivPay pot. (one phone) | The Caterer gets exactly $600 |  |
| 86.0 to 92.0 s | M10 | Phone B, Daniel: Ask for a payment, Event hall, $280: fee $1.40, left $115.60. (one phone; Sped up x2) | Then the Event hall, $280 | Fee $1.40 |
| 92.0 to 100.0 s | M11 | Phone A, Eddy: Waiting for your yes, Say yes and pay Event hall, the pot has $115.60. (one phone) | Eddy says yes. $115.60 is left |  |
| 100.0 to 110.0 s | M12 | Phone A, Eddy: Closing and your share, Eddy $57.80, Maya $46.24, Daniel $11.56, You put in $500, half of the pot, Ask to close early. (one phone) | Close early: what is left is shared by what each put in | Eddy put in $500, half the pot, so half of $115.60 |
| 110.0 to 120.0 s | M13 | Phone B, Maya: Say yes and close it, See the split: streams to each city, $1,000 went in, $880 paid out, $4.40 on fees. (one phone) | $1,000 in. $880 paid out. $4.40 in fees | Closed on Maya's yes |
| 120.0 to 130.0 s | M14 | B: Maya, Take my $46.24, coin to Houston. A: Eddy, Take my $57.80, coin to London. (both phones side by side) Labels: Eddy takes $57.80 / Maya takes $46.24. | Each person takes their own share |  |
| 130.0 to 136.0 s | M15 | Phone B, Daniel: Take my $11.56, the pot holds $0.00. (one phone) | Daniel takes $11.56. Nothing is left, to the cent |  |
| 136.0 to 145.0 s | M16 | Phone A, Eddy: See the pot's story, then the replay button: the whole story in about 7 s. (one phone) | Every step, replayed |  |
| 145.0 to 153.0 s | E01 | PC, MonadVision: the NivPayPots on AUSD contract page that holds the pot just made, verified source. (explorer) | The contract on Monad that holds the pot we just made. No owner, no upgrade | 0xB9E6...9EfB |
| 153.0 to 161.0 s | E02 | PC, MonadVision: the CreatePot transaction of the Mama's 60th just made, from its Receipt link, and its PotCreated log. (explorer) | CreatePot: the pot we just made, Mama's 60th | Transaction hash [not measured yet] |
| 161.0 to 169.0 s | E03 | PC, MonadVision: Eddy's FundWithPermit into the pot just made, from its Receipt link: the Approval, the AUSD Transfer and Funded for $500 in one. (explorer) | FundWithPermit: Eddy's $500 into the pot we just made, with one signature | Transaction hash [not measured yet]. Blocks land about 300 ms apart |
| 169.0 to 173.0 s | card | End card. (card) | NivPay / Pool money with people you trust. Nobody can pocket it. / the link |  |

## x-launch

1080x1080, 30 fps, 40.0 s planned (target 30 to 45 s, cap 45 s).
For X: square, consumer words only, no crypto words at all. A hook in the first 2 seconds on real footage, the "nobody can pocket it" idea on the second yes, then the end frame with the link.

| Time | Shot | On screen | Caption | Callout |
| --- | --- | --- | --- | --- |
| 0.0 to 3.0 s | M06 | Pushed in on the pot as it fills to $1,000, pulling out. (one phone; pushed in) | Who holds the money for Mama's 60th? |  |
| 3.0 to 9.0 s | M01 | Making the pot: the two places it can pay, with their limits. (one phone; Sped up x4) | It can only pay the Caterer and the Event hall |  |
| 9.0 to 15.0 s | M04 | A coin flies in from London and the pot fills. (one phone; Sped up x2) | Everyone puts in. $1,000 together |  |
| 15.0 to 22.0 s | M07 | The ask sheet: 1 more yes pays Caterer. (one phone; pushed in) | Paying needs 2 of 3 to say yes |  |
| 22.0 to 29.0 s | M08 | The second yes: the stream runs to the Caterer and nowhere else. (one phone; pushed in) | Nobody can pocket it. Not even the one who made it. |  |
| 29.0 to 35.0 s | M13 | See the split: streams back to each city with each amount. (one phone) | Close it early and everyone takes their share |  |
| 35.0 to 40.0 s | card | End card. (card) | NivPay / Pool money with people you trust. / the link |  |
