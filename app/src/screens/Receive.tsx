import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Log } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { otherCurrencyNote } from "../lib/currencyNote.ts";
import { shownName, type StoredAccount } from "../lib/accounts.ts";
import { ERC20_READ_ABI } from "../lib/abi.ts";
import { ALL_POTS, CTK, LOG_PAGE_BLOCKS, SETTLEMENT_PAIR } from "../lib/config.ts";
import { DEPLOYMENT, DOLLAR } from "../lib/deployment.ts";
import { PotFeed } from "../lib/feed.ts";
import { idbFeedStore } from "../lib/idb.ts";
import { linkUrl } from "../lib/invites.ts";
import { amountIn, formatAmount, formatCurrency } from "../lib/money.ts";
import { receiptUrl } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { incomingFrom, incomingSource, RECEIVE_BACKLOG_BLOCKS, senderKind, withFloor, type Incoming } from "../lib/transfer.ts";
import { AmountUnderstood, copyLink, CopyLinkButton, Icon, NoticeLine, shareLink, useOnline } from "./ui.tsx";
import { balanceNote } from "../lib/connection.ts";
import { useUsernames, withUsernameOf } from "./Username.tsx";
import { ContactStore } from "../lib/contacts.ts";
import { describeFailure } from "../lib/errors.ts";
import { inboxEnabled, sendPersonRequest } from "../lib/inboxLive.ts";
import { holderOf, namesOn } from "../lib/names.ts";
import { notifyRequest } from "../lib/notify.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { normalizeUsername, usernameProblem } from "../lib/usernames.ts";
import type { Notice } from "./ui.tsx";

// The signing code loads only when a request is sent.
const passkeys = () => reloadOnce(() => import("../lib/passkey.ts"));
import { Avatar } from "./Avatar.tsx";

const finalized = async () => (await readClient.getBlock({ blockTag: "finalized" })).number;

/** What can arrive: dollars, and on AUSD builds the currency Agora's settlement delivers. */
const WATCHED: Address[] = DEPLOYMENT === "ausd" ? [DOLLAR, CTK] : [DOLLAR];
type Currency = { decimals: number; symbol: string };
type Arrival = Incoming & { asset: Address };
const keyOf = (p: Arrival) => `${p.tx}:${p.logIndex}`;

/**
 * Receiving dollars: a request link to share, and the payments that reached
 * this account, each shown only once its block is finalized. The list starts
 * about ten minutes before the view was first opened on this phone and is
 * kept from then on.
 */
/** "+$25.00" for dollars, "10.00 CTK" for another currency. */
function show(currencies: Record<string, Currency>, p: Arrival): string {
  const c = currencies[p.asset.toLowerCase()];
  if (!c) return "…";
  return c.symbol === "$" ? formatAmount(p.amount, c.decimals, "cents") : formatCurrency(p.amount, c.decimals, c.symbol);
}

/** A payment from a pot, or in another currency from Agora's settlement, is not from a person's account. */
function fromText(from: Address, usernames: Record<string, string> = {}): string {
  const kind = senderKind(from, ALL_POTS, SETTLEMENT_PAIR);
  return kind === "pot" ? copy.fromAPot : kind === "settlement" ? copy.fromAgoraSettlement : withUsernameOf(usernames, from, copy.accountEnding(from));
}

export function ReceiveScreen(props: { account: StoredAccount; banner: ReactNode; onClose: () => void }) {
  const me = props.account.address;
  const [decimals, setDecimals] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceReadAt, setBalanceReadAt] = useState<number | null>(null);
  const online = useOnline();
  const [payments, setPayments] = useState<Arrival[]>([]);
  const [currencies, setCurrencies] = useState<Record<string, Currency>>({});
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState("");
  const [failed, setFailed] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const usernames = useUsernames([me, ...payments.map((p) => p.from)]);
  const myUsername = usernames[me.toLowerCase()];

  useEffect(() => {
    alive.current = true;
    const feeds: PotFeed[] = [];
    const readBalance = async () => {
      const at = { blockNumber: await finalized() } as const;
      const [d, b] = await Promise.all([
        readClient.readContract({ address: DOLLAR, abi: ERC20_READ_ABI, functionName: "decimals", ...at }),
        readClient.readContract({ address: DOLLAR, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [me], ...at }),
      ]);
      if (alive.current) {
        setDecimals(d);
        setBalance(b);
        setBalanceReadAt(Date.now());
      }
      return d;
    };
    const byAsset = new Map<Address, Arrival[]>();
    void (async () => {
      try {
        const d = await readBalance();
        const known: Record<string, Currency> = { [DOLLAR.toLowerCase()]: { decimals: d, symbol: "$" } };
        for (const asset of WATCHED.slice(1)) {
          const [decimals, symbol] = await Promise.all([
            readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "decimals" }),
            readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "symbol" }),
          ]);
          known[asset.toLowerCase()] = { decimals, symbol };
        }
        if (alive.current) setCurrencies(known);
        const floor = (await finalized()) - RECEIVE_BACKLOG_BLOCKS;
        if (!alive.current) return;
        for (const asset of WATCHED) {
          const source = incomingSource(asset, me, finalized, (params) => readClient.request({ method: "eth_getLogs", params: [params] }) as Promise<Log[]>);
          const feed = new PotFeed(source, withFloor(idbFeedStore(`receive:${asset}:${me}`), floor), floor, { pageSize: LOG_PAGE_BLOCKS, parallel: 4, everyMs: 1_000 });
          feeds.push(feed);
          feed.start(
            (all, added) => {
              if (!alive.current) return;
              setFailed(false);
              byAsset.set(asset, incomingFrom(all, me).map((p) => ({ ...p, asset })));
              setPayments([...byAsset.values()].flat().sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1)));
              const arrived = incomingFrom(added, me).map((p) => ({ ...p, asset }));
              if (arrived.length) {
                setFresh((f) => new Set([...f, ...arrived.map(keyOf)]));
                const last = arrived[0]!;
                setAnnounce(copy.receivedAnnounce(show(known, last), fromText(last.from)));
                void readBalance().catch(() => {});
              }
            },
            () => alive.current && setFailed(true),
          );
        }
      } catch {
        if (alive.current) setFailed(true);
      }
    })();
    return () => {
      alive.current = false;
      for (const f of feeds) f.stop();
    };
  }, [me]);

  const stale = balanceNote(failed || !online, balanceReadAt);
  const requested = decimals === null ? null : amountIn(amountText, decimals);
  const url = useMemo(
    () => linkUrl(location.origin, { kind: "pay", deployment: DEPLOYMENT, account: me, name: shownName(props.account), amount: requested ?? 0n }),
    [me, props.account, requested],
  );

  const share = async () => {
    setNote(null);
    const how = await shareLink(url, copy.requestShareText(shownName(props.account)));
    if (how === "copied") setNote(copy.linkCopied);
    if (how === "failed") setNote(copy.copyFailed);
  };
  const copyId = () => {
    navigator.clipboard
      .writeText(me)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="screen">
      <div className="bar">
        <button type="button" className="icon-btn" aria-label={copy.close} onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="bar-title">{copy.receiveTitle}</div>
        <div className="bar-spacer" />
      </div>
      {props.banner}
      <div className="screen-body">
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        <div className="card enter" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="eyebrow">{copy.yourBalance}</p>
          <p className={`balance-amount${stale ? " stale" : ""}`}>{balance === null || decimals === null ? "…" : formatAmount(balance, decimals, "cents")}</p>
          {stale && <p className="hint stale-note">{stale}</p>}
          <p className="hint">{copy.receiveHint}</p>
          <label className="field">
            <span>{copy.requestAmountOptional}</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={copy.amountPlaceholder} />
          </label>
          <AmountUnderstood text={amountText} decimals={decimals} />
          <button type="button" className="pill-btn" onClick={share}>
            <Icon name="share" />
            {copy.shareRequestLink}
          </button>
          <CopyLinkButton
            onCopy={async () => {
              setNote(null);
              const how = await copyLink(url);
              if (how === "failed") setNote(copy.copyFailed);
              return how;
            }}
          />
          {note && <p className="hint">{note}</p>}
          <button type="button" className="btn ghost small" onClick={copyId}>
            {copied ? copy.copied : copy.orShareAccountId}
          </button>
          {myUsername && <p className="hint">{copy.yourUsername(myUsername)}</p>}
          <AskDirectly account={props.account} amount={requested ?? 0n} />
        </div>

        <section className="card enter" style={{ animationDelay: "80ms" }} aria-labelledby="payments-in">
          <p className="eyebrow" id="payments-in">
            {copy.paymentsIn}
          </p>
          {payments.length === 0 && <p className="hint">{copy.noPaymentsYet}</p>}
          {(() => {
            const note = otherCurrencyNote(payments.map((p) => currencies[p.asset.toLowerCase()]?.symbol));
            return note && <p className="hint">{note}</p>;
          })()}
          <div className="list">
            {payments.map((p) => {
              const isNew = fresh.has(keyOf(p));
              return (
                <div className={`list-row${isNew ? " arrived" : ""}`} key={keyOf(p)}>
                  {senderKind(p.from, ALL_POTS, SETTLEMENT_PAIR) === "account" && <Avatar account={p.from} name={copy.accountEnding(p.from)} size={32} reportable />}
                  <div className="grow">
                    <span className="name">+{show(currencies, p)}</span>
                    <span className="meta">{copy.paymentFrom(fromText(p.from, usernames))}</span>
                    {isNew && <span className="meta">{copy.justArrived}</span>}
                  </div>
                  <a className="receipt-link small" href={receiptUrl(p.tx)} target="_blank" rel="noopener noreferrer">
                    {copy.viewReceipt}
                  </a>
                </div>
              );
            })}
          </div>
          {failed && <NoticeLine notice={{ tone: "bad", text: copy.errReceiveRead, code: ERROR_CODES.RECEIVE_READ_FAILED }} />}
        </section>
      </div>
    </div>
  );
}

/** An account to ask, and the name to show it by. */
type Asked = { account: Address; name: string };

/**
 * Ask someone directly (lib/inbox.ts): a contact, or someone by their
 * @username, for the amount above, or for any amount if it is empty. The
 * request is signed with one fingerprint and reaches only their phones.
 * Hidden while requests aren't set up on this site.
 */
function AskDirectly(props: { account: StoredAccount; amount: bigint }) {
  const me = props.account.address;
  const [on, setOn] = useState(false);
  const [who, setWho] = useState<Asked | null>(null);
  const [typed, setTyped] = useState("");
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const contacts = useMemo(() => new ContactStore(localStorage, DEPLOYMENT, me).list(), [me]);
  useEffect(() => {
    let live = true;
    void inboxEnabled(me).then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, [me]);
  if (!on || (contacts.length === 0 && !namesOn)) return null;

  const name = normalizeUsername(typed);
  const find = async () => {
    setNotice(null);
    setWho(null);
    if (!name || usernameProblem(name)) return setNotice({ tone: "bad", text: copy.notAUsername });
    setLooking(true);
    try {
      const holder = await holderOf(name);
      if (!holder) setNotice({ tone: "bad", text: copy.errNameNotFound(name), code: ERROR_CODES.NAME_NOT_FOUND });
      else if (holder.toLowerCase() === me.toLowerCase()) setNotice({ tone: "bad", text: copy.cantAskYourself });
      else setWho({ account: holder, name: `@${name}` });
    } catch {
      setNotice({ tone: "bad", text: copy.errRequestSend, code: ERROR_CODES.REQUEST_SEND_FAILED });
    } finally {
      setLooking(false);
    }
  };
  const ask = async () => {
    if (!who) return;
    setBusy(true);
    setNotice(null);
    try {
      const sign = async (message: string) => (await passkeys()).withSigner(me, (a) => a.signMessage({ message }));
      const sent = await sendPersonRequest({ deployment: DEPLOYMENT, from: me, to: who.account, name: shownName(props.account), amount: props.amount.toString() }, sign);
      void notifyRequest(sent);
      setNotice({ tone: "ok", text: copy.requestSentTo(who.name) });
      setWho(null);
      setTyped("");
    } catch (e) {
      setNotice({ tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ask-directly">
      <p className="eyebrow" id="ask-directly">
        {copy.askDirectly}
      </p>
      <p className="hint">{copy.askDirectlyHint}</p>
      {contacts.length > 0 && (
        <div className="list" aria-label={copy.yourContacts}>
          {contacts.map((c) => (
            <button
              type="button"
              className={`home-pot${who?.account === c.account ? " on" : ""}`}
              aria-pressed={who?.account === c.account}
              key={`ask-${c.account}`}
              onClick={() => {
                setNotice(null);
                setWho({ account: c.account, name: c.name });
              }}
            >
              <span className="grow">
                <span className="name">{c.name}</span>
                <span className="meta">{copy.accountEnding(c.account)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {namesOn && (
        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <label className="field">
            <span>{copy.orTheirUsername}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={40} />
          </label>
          <button type="submit" className="btn small" disabled={!typed.trim() || looking}>
            {looking ? copy.lookingUpUsername : copy.findThem}
          </button>
        </form>
      )}
      {who && (
        <button type="button" className="pill-btn" disabled={busy} aria-busy={busy} onClick={() => void ask()}>
          {busy ? copy.waitingForPasskey : props.amount > 0n ? copy.askThemFor(who.name, formatAmount(props.amount, 6, "cents")) : copy.askThem(who.name)}
        </button>
      )}
      {notice && <NoticeLine notice={notice} />}
    </section>
  );
}
