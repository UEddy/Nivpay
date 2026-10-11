# Seeding each take

How to put the app and the chain in the exact starting state for every
recording take, so each take looks the same and nothing depends on memory.
It follows [DEMO.md](DEMO.md) take by take: the 3 minute main cut (M1 to M5,
DEMO.md sections 2 to 6), then the 2 minute Agora bounty cut (B1), then the
throwaway close rehearsal (R1).

Everything here is done by hand in the app, with the passkeys on the two
phones. No script signs or sends anything. The one script,
`app/scripts/preflight-take.mjs`, only reads the chain and says whether the
state matches; run it from `app/` in PowerShell before every take:

```
cd app
node scripts/preflight-take.mjs main-make
```

It prints a PASS or FAIL row per check and, for every FAIL, the step in this
file that fixes it. Exit code 0 means ready; 1 means something is off; 2
means the take name or the config is wrong. `--list` prints the takes.

## The cast

Three people, the same in every take and every caption. DEMO.md and the
video's captions use these names and no others.

| Person | Phone | Typed at sign-up | City | In the 3 minute cut | In the 2 minute cut |
| --- | --- | --- | --- | --- | --- |
| Eddy | A, Galaxy S24 | Eddy | London | Makes Mama's 60th, puts in $500, says yes to the hall, asks to close | Sends $25 and $10 as CTK |
| Maya | B, Galaxy S10 | Maya | Houston | Puts in $400, says yes to the Caterer and to closing | Receives |
| Daniel | B, Galaxy S10 | Daniel | Uyo | Puts in $100, asks for both payments | not in it |

The Caterer and the Event hall are businesses, not people: accounts named
**Caterer** (phone A) and **Event hall** (phone B) that only get paid.

Maya and Daniel replace the names used in the 11 Oct rehearsal footage
(Leader on the S10, Sifon on the third phone), which must not appear in a
take. Eddy stays.

### Each recording phone, before the first take

* **Fresh accounts with these names.** The name typed at sign-up stays on
  that phone only (nothing on chain holds it), and it becomes the passkey's
  label in Google Password Manager, so the passkey sheet on camera reads
  "Eddy", "Maya" or "Daniel". Never reuse an account named Leader, Sifon,
  Idara, Ubong or Eddy Test: delete those passkeys first (Retakes, step 2).
* **A throwaway Google account as the passkey provider.** Make a new Google
  account that holds no real name, and on that phone make it the account
  Google Password Manager saves to (Settings, Google, Autofill, Google
  Password Manager). The create sheet prints that account's email under
  "Your screen lock will be used to encrypt your data", and the account
  chooser lists every Google account on the phone: so the throwaway must be
  the only Google account the chooser can offer. Set its Password Manager PIN
  once, off camera, so the PIN screen never comes up during a take.
* **Unlock by fingerprint, not PIN or pattern.** A fingerprint prompt blacks
  the recording out for under a second (0.7 to 0.9 s on the S24); a PIN or
  pattern blacks it out for 3 to 5 s and Samsung's tap circles still show
  where each digit was pressed. Turn **show taps off** in the recorder.
* **Notifications off**, as in [Phone hygiene](#phone-hygiene): Do not
  disturb with no exceptions, and the status bar clear (no flashlight,
  battery or media chips).
* **No real contacts in the share sheet.** Android fills its top row with
  recent chats and contacts. Use Copy link in the app instead of Share
  (every screen with Share has it), and paste into the chat. If Share must
  be filmed, it is cropped or cut: the rehearsal's share sheets show real
  contact names and a phone number.
* **The chat used for links** is a chat to yourself, or a chat between the
  throwaway accounts, with no other conversations on screen.

Addresses come from Account details on each phone. Copy the per-run ones into
`app/scripts/preflight.config.json` (copy `preflight.config.example.json`;
the real file is gitignored). The config holds addresses and pot numbers only:
the script refuses one with anything shaped like a key or a recovery phrase.

Accounts that already exist (pot 0's people, read on chain 11 Oct 2026):

| Account | Phone | Short ID | Address | For |
| --- | --- | --- | --- | --- |
| Phone A account | A, Galaxy S24 | ending 7bC1 | `0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1` | Made pot 0 and is one of its two deciders. Has sent 10 requests (0.0149 MON left); under the limit of 30 it gets gas grants again, but it stays only the payee of "Test close" in R1 |
| Phone B account | B, Galaxy S10 | ending f8b4 | `0x97936c44214231002051A601e2065732382Df8b4` | Pot 0's second decider. 2 sent, $9,850. Makes "Test close" in R1 |
| Third test account | [FILL IN: which phone] | ending 0B61 | `0xa5057F32DB2a6f68F69ad1587014AbF101A20B61` | Pot 0's payee, "Carter". 1 sent, $10,000. Second decider of "Test close" in R1 |

Accounts made fresh for every run (see [Retakes](#retakes)):

| Role | Phone | Name typed | City typed | Short ID | Config key | For |
| --- | --- | --- | --- | --- | --- | --- |
| Eddy | A | Eddy | London | [FILL IN] | `main.eddy` | Makes Mama's 60th, puts in $500, says yes to the hall, asks to close |
| Caterer | A | Caterer | | [FILL IN] | `main.caterer` | Payee, up to $700. Never sends |
| Maya | B | Maya | Houston | [FILL IN] | `main.maya` | Puts in $400, says yes to the Caterer and to closing |
| Daniel | B | Daniel | Uyo | [FILL IN] | `main.daniel` | The third decider. Puts in $100, asks for both payments |
| Event hall | B | Event hall | | [FILL IN] | `main.eventHall` | Payee, up to $300. Never sends |
| Eddy (2 min) | A | Eddy | | made on camera | none | Sends $25 and $10 as CTK |
| Maya (2 min) | B | Maya | | [FILL IN] | `bounty.maya` | Receives. Never sends |

Pots:

| Pot | Number | Config key | For |
| --- | --- | --- | --- |
| Anniversary, the showcase | 0 | fixed | Stays as it is. Never closed, never poured into, never paid from |
| Mama's 60th | made in M1 | `main.pot` | The main cut. A new one every run |
| Test close | made in R1 | `testClose.pot` | Rehearsing early close and take-share only. Never recorded |

## Finding a pot's number

The preflight's first row, "Pots made so far", says the number the next pot
will get: run it just before making a pot and note it. To confirm afterwards,
on the maker's phone: Account details, View receipt, then on MonadVision the
transaction's logs show `PotCreated` with `potId`. Put it in the config as a
plain number, for example `"pot": 3`.

## Pot 0 stays as it is

Pot 0 (Anniversary, $400, 2 of 2, payee Carter up to $100, closes 1 Nov 2026)
is what reviewers can open at any time. Every preflight checks it is still
made, open, not frozen, holding $400, with its date in the future. Its one
request, $100 to Carter asked 10 Oct 2026, is reported but not judged: it
expires on 17 Oct 2026 08:34 UTC.

Never pour into it, never say yes to its request, never ask to close it.
Early close is rehearsed on "Test close" (R1), never on pot 0. If a preflight
shows pot 0 closed or paid, nothing can undo it: stop and point the
reviewers at a different pot in SUBMISSION.md.

## What can't be undone

| Done on chain | Undone by | So a retake needs |
| --- | --- | --- |
| Test dollars claimed, poured, paid, taken | nothing; the money has moved | fresh accounts, or the balances on screen differ |
| A pot made | nothing; it stays on every named person's Home | fresh accounts, or the old pot shows on Home |
| A request asked | nothing in the app; it waits 7 days, then expires | a fresh pot |
| A yes that makes 2 of 3 | nothing; the payment or the close happens at once | a fresh pot |
| A pot closed | nothing; it can't be reopened | a fresh pot |
| A request sent, of any kind | nothing; it counts toward the 30 that end gas grants | a fresh account once near 30 |
| A payment to Maya (2 min) | nothing; it shows under Payments in | a fresh Maya |

Phone side, which can be undone: site data (accounts list, drafts, saved
history) by deleting it; passkeys by deleting them in Google Password Manager.
Neither touches the chain.

## Retakes

Every retake starts from fresh accounts: a fresh Mama's 60th would otherwise
sit next to the old one on Home, and the balances would not match.

1. On both phones: Chrome, nivpay.vercel.app, site settings, Delete data.
2. In Google Password Manager, delete the passkeys of the run you are done
   with (only once you are sure: a passkey is the only way into its account).
3. Seed again from M1 (a main retake) or B1 (a 2 minute retake). A retake of a
   single main section (say M4) still seeds from M1 with fresh accounts and
   runs the earlier sections off camera.
4. Change the addresses and the pot number in the config, and run the take's
   preflight.

What each run uses. Fresh accounts are for what shows on screen (no old pot
on Home, balances that match the script), not for gas: with the limit at 30
sent, no account in a run comes near it.

| Run | Fresh accounts | Faucet claims (test AUSD) | Gas grants (MON) | Most sent by one account |
| --- | ---: | --- | --- | ---: |
| Main cut, full or one section | 5 | 3 (30,000), off camera | 4 (0.4): Eddy 2, Maya 1, Daniel 1 | 6 (Eddy) |
| 2 minute cut | 2 | 1 (10,000), on camera | 1 (0.1) | 5 (Eddy) |
| R1, Test close | 0 | 0 | up to 2 (0.2) | 4 (Phone B account) |

One rehearsal plus one final take of each cut, with R1 once:

| Part | Runs | Fresh accounts | Claims (test AUSD) | Grants (MON) |
| --- | ---: | ---: | --- | --- |
| Main cut | 2 | 10 | 6 (60,000) | 8 (0.8) |
| 2 minute cut | 2 | 4 | 2 (20,000) | 2 (0.2) |
| R1 | 1 | 0 | 0 | up to 2 (0.2) |
| **Session** | | **14** | **8 (80,000)** | **12 (1.2)** |

Each grant also costs the funder about 0.002 MON of its own gas, 0.024 for
12. The funder needs at least 1 MON floor + 1.2 + 0.024 = **2.3 MON** before
the session. 12 grants fit under the 20 an hour the funder makes in all
(anyone's, not only yours); a session with more takes that goes past 20 in
an hour is refused with Code 13 until the hour rolls on. Each further take
of both cuts adds 7 fresh accounts, 4 claims and 5 grants (0.5 MON).

## Test money

Agora's faucet gives 10,000 AUSD per claim and allows one claim a minute for
everyone at once, not per account (`maxDripFrequency` 60). A claim inside the
minute shows Code 60 with a countdown. An account holding 100,000 AUSD or more
can't claim (`maxAmountToOwn`); fresh accounts never get near that.

When to claim:

* Main cut: the three claims are part of seeding M1, off camera, at least 60 s
  apart: Eddy, then Maya 60 s later, then Daniel 60 s after that. Allow 3
  minutes.
* 2 minute cut: the one claim is on camera. Make no claim in the minute
  before rolling; the bounty preflight fails until 60 s have passed since the
  last claim by anyone, and says how many seconds to wait.
* Payees and the 2 minute Maya never claim.
* Don't make next run's accounts early to get their claims out of the way:
  they would show in Switch account during this run.

Faucet stock (about 995 million AUSD on 11 Oct 2026) is checked by the bounty
preflight.

## Gas grants

Every sent request is paid for in MON from a gas grant of 0.1 MON, which the
app asks for when the account holds under 0.075 MON and has sent fewer than
30 requests (`MAX_SENT_TXS` in `app/api/fund/index.ts`). A full take sends at
most 6 from one account, so the limit never decides a take: fresh accounts
are for what shows on screen. Before the session, open
`https://nivpay.vercel.app/api/fund/status`: `"enabled": true`,
`"keyMatches": true`, and the funder balance at least the figure in the table
under [Retakes](#retakes). It held 3.19 MON on 11 Oct 2026 at 11:35 UTC.
The preflight reads the same endpoint and fails below 1 MON floor plus 0.2.

## Phone hygiene

Both phones, before every take:

* Do not disturb on, with no exceptions (no calls, no alarms).
* Notifications off for Chrome, WhatsApp and the chat you pass links through;
  clear the notification shade.
* Battery above 50 percent, battery saver off (it slows animations), charger
  out of shot.
* Clock: automatic time on (the closing date and "Closed 10 Oct" style dates
  come from it), both phones in the same time zone, which must match
  `timeZone` in the config (Africa/Lagos when it names none). The pot closes
  at the end of the chosen day in the zone of the phone that makes it, not in
  the city typed in. Status bar time visible and plausible.
* Airplane mode off. No take in DEMO.md calls for it; turn it on only if you
  add a take that shows being offline.
* Screen recording: Samsung's recorder, sound off or media only, show taps
  off (the rehearsal had it on), 1080p, the recorder's own overlay hidden.
* Clipboard: clear it (Samsung keyboard, clipboard, delete all) so no old
  address or link pops up as a suggestion.
* Chrome: only one tab open, nivpay.vercel.app; no other tabs in the switcher,
  incognito tabs closed, no download bar.
* No personal accounts visible: the passkey sheets show the Google account
  Password Manager uses, so it is the throwaway one (see [The cast](#the-cast)).
  The chat used for links has no other conversations on screen.
* Keyboard: suggestions that learned your email or contacts are cleared, or
  the keyboard's suggestion strip is off.
* Brightness fixed (auto brightness off), font size and display size default.
* The app's own "Test mode" label is on every screen on purpose and stays.
  Leftovers that must not show: old pots on Home, old rows under Payments in,
  an unfinished draft, a Code banner from an earlier try, accounts from other
  runs in Switch account, other runs' passkeys in the picker.

## M1. Make the pot

The 3 minute cut, DEMO.md section 2. Recording straight through sections 2
to 6, this is the only take you need to seed; the later preflights are
checkpoints if you pause between sections, and the seeding for each later take
is what you do off camera for a single section retake.

Starting state:

| Account | AUSD | Sent | On a pot |
| --- | ---: | ---: | --- |
| Eddy | $10,000.00 | 1 | none |
| Maya | $10,000.00 | 1 | none |
| Daniel | $10,000.00 | 1 | none |
| Caterer | $0.00 | 0 | none |
| Event hall | $0.00 | 0 | none |

No Mama's 60th. No requests. Pot 0 as in
[Pot 0 stays as it is](#pot-0-stays-as-it-is).

### Seed it

Phones clean as in [Retakes](#retakes) steps 1 and 2, then DEMO.md section 1:

1. Phone A: Create your account, **Eddy**, save the passkey.
2. Phone A, Eddy: Add test dollars. Note the time.
3. Phone B: Create your account, **Maya**.
4. Phone B, Maya: Add test dollars, at least 60 s after step 2.
5. Phone B: Switch account, Add another account, **Daniel**.
6. Phone B, Daniel: Add test dollars, at least 60 s after step 4.
7. Phone B: Add another account, **Event hall**. No test dollars.
8. Phone A: Add another account, **Caterer**. No test dollars. Then Switch
   account back to **Eddy**.
9. Copy all five addresses from Account details into `main` in the config,
   and set `"pot": null`.
10. `node scripts/preflight-take.mjs main-make`. Note "the next pot made is
    number N".

On screen at the end: phone A, Eddy's Home, Your balance **$10,000.00**, no
pots. Phone B, Maya's Home (switch to that account last), **$10,000.00**, no pots.

Must not be on screen: any pot on Home, "Waiting for your yes", a draft, a
Code banner, accounts other than this run's five in Switch account.

## M2. Pour in

DEMO.md section 3.

Starting state:

| Account | AUSD | Sent |
| --- | ---: | ---: |
| Eddy | $10,000.00 | 2 |
| Maya | $10,000.00 | 1 |
| Daniel | $10,000.00 | 1 |
| Caterer | $0.00 | 0 |
| Event hall | $0.00 | 0 |

Mama's 60th: holds **$0.00**, open, not frozen, 2 of 3 deciders (Eddy,
Maya, Daniel; suggested shares $500, $400, $100), payees Caterer up to $700
paid $0 and Event hall up to $300 paid $0, closes at the end of **Thu 31 Dec
2026** in phone A's time zone, Lagos (31 Dec 2026 23:00 UTC). No requests.

### Seed it

1. Seed M1.
2. DEMO.md steps 2.1 to 2.10: make Mama's 60th exactly as written, with the
   closing date Thu 31 Dec 2026. Confirm Add the names if asked.
3. Share the pot from phone A to phone B and open the link once on phone B.
4. Put the pot's number in `main.pot` ([Finding a pot's number](#finding-a-pots-number)).
5. `node scripts/preflight-take.mjs main-pour`.

On screen at the end: phone A, Eddy, Mama's 60th open, the pot holds
**$0**. Phone B, Maya's Home lists Mama's 60th, and the map shows names and
cities, not "Ending ...".

Must not be on screen: a second Mama's 60th, "Ending ..." in place of a name
(step 3 missed), any request.

## M3. Payments

DEMO.md section 4.

Starting state:

| Account | AUSD | Sent |
| --- | ---: | ---: |
| Eddy | $9,500.00 | 3 |
| Maya | $9,600.00 | 2 |
| Daniel | $9,900.00 | 2 |
| Caterer | $0.00 | 0 |
| Event hall | $0.00 | 0 |

Mama's 60th as in M2 but holding **$1,000.00**: Eddy's share $500.00, Maya's
$400.00, Daniel's $100.00. Caterer paid $0 of $700, hall $0 of $300. No
requests.

### Seed it

1. Seed M2.
2. DEMO.md steps 3.1 to 3.3: Eddy $500, Maya $400, Daniel $100.
3. `node scripts/preflight-take.mjs main-pay`.

On screen at the end: phone B on Daniel, Mama's 60th holds **$1,000**.
Phone A on Eddy's Home.

Must not be on screen: "Waiting for your yes" on anyone's Home.

## M4. Close and take shares

DEMO.md section 5.

Starting state:

| Account | AUSD | Sent |
| --- | ---: | ---: |
| Eddy | $9,500.00 | 4 |
| Maya | $9,600.00 | 3 |
| Daniel | $9,900.00 | 4 |
| Caterer | $600.00 | 0 |
| Event hall | $280.00 | 0 |

Mama's 60th holds **$115.60**, open: Caterer paid $600 of $700 (fee $3.00),
Event hall paid $280 of $300 (fee $1.40). If it closed now: Eddy **$57.80**,
Maya **$46.24**, Daniel **$11.56**. No requests.

### Seed it

1. Seed M3.
2. DEMO.md steps 4.1 to 4.5: Daniel asks for the Caterer, $600; Maya says
   yes. The pot has $397.00.
3. DEMO.md steps 4.6 and 4.7: Daniel asks for the Event hall, $280; Eddy
   says yes. The pot has $115.60.
4. `node scripts/preflight-take.mjs main-close`.

On screen at the end: phone A on Eddy, Mama's 60th, holds **$115.60**.
Phone B on Maya's Home.

Must not be on screen: "Waiting for your yes" (a request left unanswered can't
be withdrawn: see [What can't be undone](#what-cant-be-undone)).

## M5. The story and the explorer

DEMO.md section 6.

Starting state:

| Account | AUSD | Sent |
| --- | ---: | ---: |
| Eddy | $9,557.80 | 6 |
| Maya | $9,646.24 | 5 |
| Daniel | $9,911.56 | 5 |
| Caterer | $600.00 | 0 |
| Event hall | $280.00 | 0 |

Mama's 60th closed, holding **$0.00**, every share taken. No requests.

### Seed it

1. Seed M4.
2. DEMO.md steps 5.1 to 5.7: Eddy asks to close, Maya says yes, each takes
   their share.
3. `node scripts/preflight-take.mjs main-story`.

On screen at the end: phone A on Eddy, Mama's 60th, the story loaded with
"Loading earlier history" gone.

Must not be on screen: MonadVision tabs left open from a dry run.

## B1. The 2 minute bounty path

DEMO.md, The 2 minute bounty path. Record after the main cut, never in the
minute after any faucet claim.

Starting state:

| Account | AUSD | CTK | Sent | On a pot |
| --- | ---: | ---: | ---: | --- |
| Eddy (2 min) | does not exist yet | | | |
| Maya (2 min) | $0.00 | 0 | 0 | none |

Faucet: no claim in the last 60 s, stock for one claim. Agora's pair not
paused, holding at least 10 CTK. Gas grants on.

### Seed it

1. Phones clean as in [Retakes](#retakes) steps 1 and 2. Phone B: Create your
   account, **Maya**. Open Receive once and leave it open. Copy that address
   into `bounty.maya`.
2. Phone A: nivpay.vercel.app on the welcome screen, no account.
3. `node scripts/preflight-take.mjs bounty`. If the faucet row says
   "ready in Ns", wait and run it again.

On screen at the end: phone A, the welcome screen. Phone B, Maya's Receive,
Your balance **$0.00**, nothing under Payments in.

Must not be on screen: old rows under Payments in (a reused Maya), a
NivPay account already on phone A.

After the take: a retake needs a fresh Eddy and a fresh Maya. DEMO.md says
Maya can stay, but the $25 and 10 CTK would show under Payments in and the
balance would start at $25.00, not $0.00.

## R1. Test close (rehearsal only)

Rehearses Ask to close early, the yes, See the split and Take my share on a
throwaway pot, so pot 0 is never closed. Never recorded: the accounts are old
ones with other pots on their Home.

### Who

* Maker and first decider: the Phone B account (ending f8b4). After seeding
  it must have sent 28 requests or fewer, so asking to close and taking its
  share still come under the gas grant limit of 30.
* Second decider: the third test account (ending 0B61), which says yes.
* Payee: the Phone A account (ending 7bC1), labelled **Test payee**, up to
  $10. Being paid sends nothing.

A run of R1 sends 4 from the Phone B account (make the pot, pour in, ask to
close, take its share) and 1 from the third account. From 2 and 1 sent on
11 Oct 2026, R1 can run 7 times before the Phone B account reaches 30.

Starting state: "Test close" holds **$20.00**, all from the Phone B account
(its share $20.00, the third account's $0.00), open, not frozen, 2 of 2,
payee Test payee up to $10 paid $0, closes at the end of Thu 31 Dec 2026. No
requests.

### Seed it

1. On the phone with the Phone B account: Make a pot, name **Test close**.
2. Invite the third test account to decide, 2 of 2; add a place to pay, the
   Phone A account, named **Test payee**, up to **$10**; closes **Thu 31 Dec
   2026**. Pass the invite and payee links and the replies as in DEMO.md
   section 2.
3. Make the pot. Put its number in `testClose.pot`.
4. Pour in **$20** from the Phone B account.
5. `node scripts/preflight-take.mjs test-close`.

Then rehearse DEMO.md section 5: the Phone B account asks to close, the third
account says yes, See the split, the Phone B account takes its $20.00.
