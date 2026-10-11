# Shot list for the fresh recording

Every shot here is recorded fresh on cleaned phones, after the fixes land. The
11 Oct rehearsal clips were for bug review only and are not used in any final
video. Until a shot is recorded, the timelines show a watermarked placeholder
for it, and a final render refuses.

The order below is the recording order. It follows
[docs/SEEDING.md](../docs/SEEDING.md) and [docs/DEMO.md](../docs/DEMO.md):
the main cut first (M01 to M16, one run of fresh accounts), then the PC
explorer shots (E01 to E03, free to retake), then the 2 minute bounty path
(B01 to B08, a second run of fresh accounts). The X launch video needs no shots
of its own: it reuses stretches of M01, M04, M06, M07, M08 and M13.

## How a shot becomes footage in a video

1. Record each phone continuously through a whole block of shots (for example
   M04 to M08). A shot is a stretch of a recording, so one recording per phone
   per block is enough, and fewer starts and stops mean fewer chances to show
   something private.
2. Copy the files into `video/footage/final/` and name them by block and
   phone, for example `main-A-1.mp4`, `main-B-1.mp4`, `bounty-A.mp4`,
   `bounty-B.mp4`, `explorer-pc.mp4`. That name, without `.mp4`, is the clip
   id.
3. Review each clip as before: frames, scan, an entry in
   `footage/redactions.json` with its crops, regions, cuts and holds, marked
   `reviewed`.
4. In `timelines/<video>.json`, for every segment of that shot, set
   `take.clip` to the clip id and `in` and `out` to the seconds in the
   recording. No code changes.
5. Read the measured values off the footage into `src/facts.ts` (see
   [After recording](#after-recording)).

## Before any recording

### Clean-phone checklist

From [SEEDING.md, The cast](../docs/SEEDING.md#the-cast) and
[Phone hygiene](../docs/SEEDING.md#phone-hygiene). Both phones, every block:

- [ ] Old NivPay data gone: Chrome, nivpay.vercel.app, site settings, Delete
      data. Old NivPay passkeys deleted in Google Password Manager (only those
      of runs you are finished with). No account named Leader, Sifon, Idara,
      Ubong or Eddy Test anywhere.
- [ ] A throwaway Google account holds no real name, and it is the only
      Google account on the phone, set as Password Manager's account. Its
      Password Manager PIN is already set, off camera.
- [ ] Unlock by fingerprint, not PIN or pattern.
- [ ] Do not disturb on, no exceptions; notifications off for Chrome, WhatsApp
      and the chat used for links; notification shade cleared.
- [ ] Status bar clear: no flashlight, battery or media chips. Battery above
      50 percent, battery saver off, charger out of shot.
- [ ] Automatic time on, both phones in the same time zone as `timeZone` in
      the preflight config.
- [ ] Clipboard cleared; keyboard suggestions that learned emails or contacts
      cleared, or the suggestion strip off.
- [ ] Chrome: one tab, nivpay.vercel.app. No other tabs, no incognito tabs, no
      download bar.
- [ ] Links pass by Copy link, never the share sheet. The chat used is a chat
      to yourself or between the throwaway accounts, with no other
      conversations on screen.
- [ ] Brightness fixed, font and display size default.
- [ ] Recorder: show taps off, sound off, its own overlay hidden.
- [ ] `node scripts/preflight-take.mjs <take>` passes from `app/`.

### Two phones at once: one on mobile data, one on Wi-Fi

Whenever both phones record together (M05, M14, B05, B08, and the whole of
each block that contains them), put **one phone on mobile data and the other
on Wi-Fi**. The public Monad RPC rate-limits per IP address, and two phones on
the same Wi-Fi share one address and so one budget: the second phone's reads
slow down or fail exactly when the shot needs both to update at once. Phone A
(the S24, the main phone) on Wi-Fi and phone B on mobile data is the simplest
split. The Wi-Fi and carrier names stay out of the footage because the status
bar is always cropped, but do not open Wi-Fi settings or the quick panel on
camera.

### Recording quality per phone

Measured from the 11 Oct rehearsal files:

| Phone | Recorded at | Average frame rate | Bitrate |
| --- | --- | ---: | ---: |
| A, Galaxy S24, Samsung's recorder | 1080x2340 | 27.4 fps | 8.8 Mb/s |
| B, Galaxy S10, Samsung's recorder | 606x1280 | 21.6 fps | 4.5 Mb/s |
| Third phone, a third-party recorder | 576x1280 | 4.8 fps | 0.8 Mb/s |

The S24 is the main phone and needs nothing more than Samsung's recorder at
1080p, show taps off, sound off.

The S10 as recorded is too soft and too choppy beside the S24 in a side by
side shot. Do one of these, in this order of preference:

1. **scrcpy over USB (recommended for phone B).** The PC records the S10's
   screen at full resolution while the phone does its normal work. On the S10:
   Settings, About phone, Software information, tap Build number seven times;
   then Developer options, USB debugging on. Set Display, Screen resolution to
   FHD+ (2280x1080) so the recording matches the S24 closely. On the PC, with
   [scrcpy](https://github.com/Genymobile/scrcpy) installed:

   ```
   scrcpy --no-audio --max-fps=30 --video-bit-rate=16M --record=main-B-1.mp4
   ```

   scrcpy does not draw touches unless asked (`--show-touches`), so leave that
   off. Close scrcpy to finish the file. Turn USB debugging off after the
   session. The USB cable does not change which network the phone uses, so
   the mobile data rule above still applies.
2. **Samsung's recorder at its highest quality.** Settings, Advanced
   features, Screenshots and screen recordings, Video quality: the highest
   setting offered (1080p). Close every other app first. Check one 10 s test
   recording with ffprobe before the session: if it is still under about 25
   fps, use scrcpy instead.
3. **Roles one after another on the S24.** Every one-phone shot of phone B
   (M02, M06, M07, M08, M10, M13, M15, B03) can be recorded on the S24
   instead, with phone B's accounts made on the S24 as well. The two-phone
   shots (M05, M14, B05, B08) still need a second phone recording at the same
   time, so options 1 or 2 are needed for those four in any case.

Do not use the third phone: at 4.8 fps it cannot show anything moving.

## Main cut, run 1: M01 to M16

Seed exactly as [SEEDING.md M1](../docs/SEEDING.md#m1-make-the-pot) (5 fresh
accounts, 3 faucet claims off camera 60 s apart, preflight `main-make`).
Phone A holds Eddy and Caterer; phone B holds Maya, Daniel and Event hall.

Record from 2 s before each shot's first step to the end of its hold.

### M01. Make the pot (draft)

- **Clip:** `main-A-1`. **Phone A, Eddy.**
- **Start:** Eddy's Home, Your balance $10,000.00, no pots.
- **Steps:** DEMO.md 2.1 to 2.4: Make a pot, Mama's 60th; Who decides, city
  London, share $500, invite Maya, Copy link, invite Daniel, Copy link, 2 of 3;
  Pours only to, Caterer up to $700, Copy link, Event hall up to $300, Copy
  link; Closes, Thu 31 Dec 2026.
- **End:** the draft with two invites and two payees waiting for replies,
  "Closes at the end of Thu 31 Dec 2026".
- **Hold:** 3 s on the finished draft.
- **Used in:** technical-demo make-pot (about 64 s at 4 times speed); x-launch
  rules (the stretch showing the two payees and their limits).
- **Not on screen:** the share sheet, the chat app's other conversations, a
  keyboard suggestion with a name or email.

### M02. Replies

- **Clip:** `main-B-1`. **Phone B, Maya, then Daniel, then Event hall.**
- **Start:** phone B on Maya's Home, the chat with the invite links open.
- **Steps:** DEMO.md 2.5 to 2.7: Maya opens her invite, Houston, Make my
  reply, Copy link back; Switch account to Daniel, Uyo, reply; Event hall,
  reply. (2.8, the Caterer's reply on phone A, can be off camera.)
- **End:** the last reply link copied.
- **Hold:** 2 s.
- **Used in:** technical-demo replies (about 16 s at 4 times speed).
- **Not on screen:** the account chooser of the Google account; the share
  sheet.

### M03. The pot is made

- **Clip:** `main-A-1`. **Phone A, Eddy.**
- **Start:** the draft, with the reply links in the chat.
- **Steps:** DEMO.md 2.9 to 2.10: open each reply link, "Everyone has
  replied", Maya's share $400, Daniel's $100, Make the pot, check the details,
  fingerprint. Confirm Add the names if asked. Then off camera: Copy link of
  the pot, open it once on phone B.
- **End:** the lid drops and locks at Finalized.
- **Hold:** 4 s after the lock.
- **Used in:** technical-demo made.
- **Not on screen:** Switch account showing anything but this run's five.

### M04. Eddy pours in $500

- **Clip:** `main-A-2`. **Phone A, Eddy.** Both phones recording from here to
  M08 (mobile data on one).
- **Start:** Mama's 60th open, holding $0.
- **Steps:** DEMO.md 3.1: Pour in $500, fingerprint.
- **End:** the coin lands at Finalized; the pot holds $500.
- **Hold:** 3 s.
- **Used in:** technical-demo pour-eddy; x-launch pours.

### M05. Maya pours in $400 (two phones)

- **Clips:** `main-A-2` and `main-B-2`. **Phone A, Eddy, watching the pot;
  phone B, Maya.**
- **Start:** A on Mama's 60th holding $500; B on Maya's Home.
- **Steps:** DEMO.md 3.2: on B, open the pot, Pour in $400, fingerprint. Keep
  A untouched on the pot.
- **End:** B shows $900; A shows Maya's coin arrive from Houston.
- **Hold:** 4 s after A updates.
- **Used in:** technical-demo pour-maya, side by side (the two stretches must
  be the same length).
- **Not on screen:** a Code banner; a phone that never updates (if A stalls,
  check the network split).

### M06. Daniel pours in $100

- **Clip:** `main-B-2`. **Phone B, Daniel.**
- **Start:** Switch account to Daniel, the pot.
- **Steps:** DEMO.md 3.3: Pour in $100, fingerprint.
- **End:** the pot holds $1,000.
- **Hold:** 4 s on $1,000.
- **Used in:** technical-demo pour-daniel; x-launch hook (the pot filling to
  $1,000, pushed in, so keep the pot centred and still).

### M07. Daniel asks to pay the Caterer

- **Clip:** `main-B-2`. **Phone B, Daniel.**
- **Steps:** DEMO.md 4.1 to 4.2: Ask for a payment, Caterer, $600. Stay on the
  sheet 3 s so fee $3.00, left $397.00 and "1 more yes pays Caterer" can be
  read, then confirm with the fingerprint.
- **End:** the request screen, the Caterer's route marching.
- **Hold:** 3 s.
- **Used in:** technical-demo ask-caterer; x-launch ask.

### M08. Maya's yes pays the Caterer

- **Clip:** `main-B-2`. **Phone B, Maya.**
- **Steps:** DEMO.md 4.3 to 4.4: Switch to Maya, Waiting for your yes, open,
  Say yes and pay Caterer, fingerprint.
- **End:** "That's 2 of 3. Paying Caterer now", the stream to the Caterer, the
  pot at $397.00.
- **Hold:** 4 s after the level drops.
- **Used in:** technical-demo second-yes (never sped up); x-launch pocket.

### M09. The Caterer is paid

- **Clip:** `main-A-3`. **Phone A, Caterer.**
- **Steps:** DEMO.md 4.5: Switch account to Caterer, Receive.
- **End:** $600.00 under Payments in, "From a NivPay pot".
- **Hold:** 4 s.
- **Used in:** technical-demo caterer-paid. Read-only: retake freely.

### M10. Daniel asks to pay the Event hall

- **Clip:** `main-B-3`. **Phone B, Daniel.**
- **Steps:** DEMO.md 4.6: Ask for a payment, Event hall, $280; 3 s on the
  sheet (fee $1.40, left $115.60); fingerprint.
- **Hold:** 2 s.
- **Used in:** technical-demo ask-hall.

### M11. Eddy's yes pays the Event hall

- **Clip:** `main-A-3`. **Phone A, Eddy.**
- **Steps:** DEMO.md 4.7: Switch to Eddy, Waiting for your yes, Say yes and pay
  Event hall, fingerprint.
- **End:** the pot holds $115.60.
- **Hold:** 3 s.
- **Used in:** technical-demo yes-hall.

### M12. Eddy asks to close early

- **Clip:** `main-A-3`. **Phone A, Eddy.**
- **Steps:** DEMO.md 5.1 to 5.2: Pot, Closing and your share; 4 s on Eddy
  $57.80, Maya $46.24, Daniel $11.56 and "You put in $500, half of the pot";
  Ask to close early, fingerprint.
- **Hold:** 2 s.
- **Used in:** technical-demo close-ask.

### M13. Maya's yes closes it; the split

- **Clip:** `main-B-3`. **Phone B, Maya.**
- **Steps:** DEMO.md 5.3 to 5.4: Switch to Maya, Waiting for your yes, Say yes
  and close it, fingerprint, See the split.
- **End:** the streams to each city, the three amounts, "$1,000 went in. $880
  was paid out and $4.40 went on fees".
- **Hold:** 5 s on the split.
- **Used in:** technical-demo close-split; x-launch split.

### M14. Maya and Eddy take their shares (two phones)

- **Clips:** `main-A-3` and `main-B-3`. **Phone B, Maya; phone A, Eddy.**
- **Steps:** DEMO.md 5.5 then 5.6: on B, Take my $46.24, fingerprint; then on
  A, Take my $57.80, fingerprint.
- **End:** both checks; "Your $46.24 is in your balance" and the same for
  $57.80.
- **Hold:** 3 s after the second check.
- **Used in:** technical-demo take-shares, side by side (choose two stretches
  of equal length, one per phone).

### M15. Daniel takes his share

- **Clip:** `main-B-3`. **Phone B, Daniel.**
- **Steps:** DEMO.md 5.7: Switch to Daniel, Take my $11.56, fingerprint.
- **End:** the pot holds $0.00.
- **Hold:** 3 s.
- **Used in:** technical-demo take-daniel.

### M16. The story and its replay

- **Clip:** `main-A-4`. **Phone A, Eddy.**
- **Steps:** DEMO.md 6.1 to 6.2: Pot, See the pot's story; wait until
  "Loading earlier history" is gone; tap Replay the pot's story.
- **End:** the replay finishes (about 7 s).
- **Hold:** 2 s.
- **Used in:** technical-demo replay. Read-only: retake freely. Reduced motion
  must be off, or the replay never shows.
- **Not on screen:** MonadVision tabs (the explorer is the PC's job here).

## Explorer, on the PC: E01 to E03

The explorer shows the Mama's 60th made in this take, not pot 0 (pot 0 stays
in the README as the showcase). Do this right after M16, while phone A is
still on Eddy, so the links are this take's.

### Getting the take's two links to the PC (off camera)

1. Phone A, Eddy: Mama's 60th, See the pot's story. Wait until "Loading
   earlier history" is gone.
2. Find the row for the pot being made (the oldest, at the bottom) and the
   row for Eddy's $500. Each has a **Receipt** link: the app's own link to
   that transaction on MonadVision.
3. Long-press each Receipt link, **Copy link address** (Chrome's own menu, not
   the share sheet), and paste each into the chat to yourself, one message
   per link.
4. On the PC, open that chat (desktop app or web), copy the two links, and
   close the chat window before recording. Each link ends in the
   transaction hash after `/tx/`.
5. Paste each hash into `src/facts.ts` now: `hashes.take.createPot` and
   `hashes.take.fundWithPermit`. Fill the README rows in the same sitting
   ([After recording](#after-recording)).

### Recording the PC

Free to retake. Record the Chrome window only (Windows: Win+Alt+R records the
focused window), 1920x1080, in a **guest window** (no profile, no bookmarks
bar, no extensions, no other tabs). Page zoom 125 percent so text reads at
phone size. Each page loaded before recording starts, then scroll slowly.

### E01. The pot contract

- **Clip:** `explorer-pc`. **PC.**
- **Page:** https://testnet.monadvision.com/address/0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB
- **Steps:** hold on the header with the address; open the contract tab to
  show the verified source.
- **Hold:** 8 s in all.
- **Used in:** technical-demo explorer-contract ("The contract on Monad that
  holds the pot we just made").
- **Not on screen:** a sign-in, the browser's profile picture, other tabs,
  the chat window.

### E02. CreatePot

- **Clip:** `explorer-pc`. **PC.**
- **Page:** the first link from the phone (the pot being made).
- **Steps:** the transaction summary, then its logs with `PotCreated`.
- **Hold:** 8 s.
- **Used in:** technical-demo explorer-create ("the pot we just made").

### E03. FundWithPermit

- **Clip:** `explorer-pc`. **PC.**
- **Page:** the second link from the phone (Eddy's $500).
- **Steps:** the summary, then the logs: the permit's Approval, the AUSD
  Transfer and Funded for $500.
- **Hold:** 8 s.
- **Used in:** technical-demo explorer-fund.

## Bounty path, run 2: B01 to B08

Seed exactly as [SEEDING.md B1](../docs/SEEDING.md#b1-the-2-minute-bounty-path):
fresh Maya on phone B with Receive open, phone A on the welcome screen with no
account, no faucet claim by anyone in the last 60 s, preflight `bounty`
passes. Record both phones from B01 to the end of B08 (mobile data on one).

### B01. A new account with a passkey

- **Clip:** `bounty-A`. **Phone A, no account yet.**
- **Start:** nivpay.vercel.app, the welcome screen.
- **Steps:** Your name Eddy, Create your account, save the passkey to Google
  Password Manager, fingerprint.
- **End:** Home: Your balance, Dollars $0.00, "Held as AUSD, a digital dollar
  issued by Agora."
- **Hold:** 5 s on Home.
- **Used in:** agora-bounty create-account and balance-zero.
- **Not on screen:** the throwaway account's email is printed on the create
  sheet: it is blurred by its region, but if any other account shows in the
  chooser, stop and retake. A PIN screen (a cut and a black hold); with the
  Password Manager PIN set beforehand it should not come up.

### B02. Add test dollars

- **Clip:** `bounty-A`. **Phone A, Eddy.**
- **Steps:** Add test dollars, fingerprint.
- **End:** "Added $10,000 test dollars. Settled in 0.Xs." and Dollars
  $10,000.00.
- **Hold:** 4 s on the Settled in line.
- **Used in:** agora-bounty claim-wait (sped up) and claim-settled (never
  sped up).
- **Not on screen:** Code 60 (someone claimed in the last minute: retake
  after waiting, it costs nothing).

### B03. Maya asks for $25

- **Clip:** `bounty-B`. **Phone B, Maya.**
- **Steps:** Receive, Amount to ask for 25, Copy link, paste into the chat to
  phone A.
- **Hold:** 1 s, then back to Receive and leave it open.
- **Used in:** agora-bounty ask.
- **Not on screen:** other chats; the share sheet.

### B04. Eddy opens the request and reviews

- **Clip:** `bounty-A`. **Phone A, Eddy.**
- **Steps:** open the link from the chat; Send dollars with 25 filled in.
  Stop on **"Sending to account ending ####"** and hold, so the last four
  characters of Maya's account can be read; then Review.
- **End:** the Check and send sheet: Amount $25, Fee "None. NivPay covers
  it."
- **Hold:** 3 s on "Sending to account ending ####", then 3 s on the sheet.
- **Used in:** agora-bounty review ("Sending to the account ending ####", the
  confirm step).
- **Check:** the four characters match the end of Maya's address on phone B
  (Account details), off camera.

### B05. Send and receive (two phones)

- **Clips:** `bounty-A` and `bounty-B`. **Phone A, Eddy; phone B, Maya on
  Receive.**
- **Steps:** on A, Send $25, fingerprint. Do not touch B.
- **End:** A: Payment final, "Sent $25 to Maya. Settled in 0.Xs.", View
  receipt. B: +$25.00, "Just arrived"; Your balance $25.00.
- **Hold:** 6 s on both (the bounty cut pushes in on A's Settled in line).
- **Used in:** agora-bounty send-receive (never sped up) and settled-line.

### B06. The receipt

- **Clip:** `bounty-A`. **Phone A, Eddy.**
- **Steps:** View receipt; MonadVision opens the transfer; scroll slowly
  over the hash, from, to and 25 AUSD; back to the app.
- **Hold:** 8 s on the explorer.
- **Used in:** agora-bounty receipt. Read-only: retake freely.

### B07. Pay in another currency

- **Clip:** `bounty-A`. **Phone A, Eddy.**
- **Steps:** Done; open the same request link again; How much 10; They
  receive CTK; read the line on what CTK is; Review.
- **End:** Check and send with You send $10, They receive, the rate, Agora's
  fee, "One fingerprint. It settles in 3 steps, each final before the next."
- **Hold:** 4 s on the sheet.
- **Used in:** agora-bounty other-currency.

### B08. Send as CTK (two phones)

- **Clips:** `bounty-A` and `bounty-B`. **Phone A, Eddy; phone B, Maya on
  Receive.**
- **Steps:** on A, Send $10 as CTK, one fingerprint.
- **End:** A: "Sent $10 to Maya. They received 10.00 CTK. Settled in 0.Xs."
  and "Your one-time setup is done." B: +10.00 CTK, "From Agora's
  settlement".
- **Hold:** 6 s on both. Then, off camera, View receipt to note the exchange's
  hash.
- **Used in:** agora-bounty other-currency-steps (sped up) and
  other-currency-settled (never sped up).

## What a retake costs

From SEEDING.md, [What can't be undone](../docs/SEEDING.md#what-cant-be-undone)
and [Retakes](../docs/SEEDING.md#retakes). A full main run costs 5 fresh
accounts, 3 faucet claims (30,000 test AUSD) and 4 gas grants (0.4 MON); a
full bounty run costs 2 fresh accounts, 1 claim (10,000) and 1 grant (0.1).

| Shot | Retake costs | Why |
| --- | --- | --- |
| M01, M02 | nothing on chain, before Make the pot | a draft and replies are on the phone only; delete the draft and start again |
| M03 to M08, M10 to M15 | a full main run | a made pot, money poured, a request asked, a yes or a close can't be undone, and a second Mama's 60th would show on Home |
| M09, M16 | nothing | read-only screens |
| E01 to E03 | nothing | public pages |
| B01 | one fresh account, no money | the account exists only once made; delete site data and the passkey |
| B02 | a full bounty run | the claim and its gas grant are spent |
| B03, B04, B06, B07 | nothing | nothing is sent |
| B05, B08 | a full bounty run | the payment shows under Maya's Payments in, and the one-time setup is done once per account |

Plan for one rehearsal and one final run of each cut, as SEEDING.md's session
table does: 14 fresh accounts, 8 claims, 12 grants, and the funder at 2.3 MON
or more before the session.

## After recording

Fill these in `src/facts.ts` from the footage, never from memory, then run
`npm run video:check`:

| Fact | Read from |
| --- | --- |
| `measured.claimSettle` | B02, the Settled in figure, as shown (for example `0.7s`) |
| `measured.sendSettle` | B05, phone A |
| `measured.recipientLastFour` | B04, phone A, "Sending to account ending ####" |
| `measured.otherCurrencyReceived` | B08, phone A, "They received" (for example `10.00 CTK`) |
| `measured.otherCurrencyRate` | B07, the Rate line on Check and send |
| `measured.otherCurrencySettle` | B08, phone A |
| `hashes.take.createPot` | after M16, the Receipt link of the pot being made |
| `hashes.take.fundWithPermit` | after M16, the Receipt link of Eddy's $500 |
| `hashes.take.send` | B06, the transaction hash on MonadVision |
| `hashes.take.swap` | B08, View receipt, off camera |

Every take hash also goes into its row under Monad integration in the README,
in the same sitting: replace the row's `[PLACEHOLDER: ...]` with the hash
linked to `https://testnet.monadvision.com/tx/<hash>`, and fill the block,
the time (UTC) and what it shows, read from MonadVision. The rows:

| Fact | README row |
| --- | --- |
| `hashes.take.createPot` | CreatePot, Mama's 60th in the demo video |
| `hashes.take.fundWithPermit` | FundWithPermit, Eddy's $500 into Mama's 60th in the demo video |
| `hashes.take.send` | Send dollars, a plain AUSD payment to another person |
| `hashes.take.swap` | Send in another currency, the exchange through Agora's pair |

The test `the README and facts.ts agree on every take hash` fails while a hash
is in one and not the other, or differs. (The app's own
`app/src/docs.test.ts` counts the two Send rows' placeholders, so update its
count when those two are filled.)
