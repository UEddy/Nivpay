import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Log } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { shownName, type StoredAccount } from "../lib/accounts.ts";
import { ERC20_READ_ABI } from "../lib/abi.ts";
import { CTK, LOG_PAGE_BLOCKS, POTS_AUSD, POTS_TESTUSD, SETTLEMENT_PAIR } from "../lib/config.ts";
import { DEPLOYMENT, DOLLAR } from "../lib/deployment.ts";
import { PotFeed } from "../lib/feed.ts";
import { idbFeedStore } from "../lib/idb.ts";
import { linkUrl } from "../lib/invites.ts";
import { formatAmount, formatCurrency, parseAmount } from "../lib/money.ts";
import { receiptUrl } from "../lib/receipts.ts";
import { readClient } from "../lib/rpc.ts";
import { incomingFrom, incomingSource, RECEIVE_BACKLOG_BLOCKS, senderKind, withFloor, type Incoming } from "../lib/transfer.ts";
import { Icon, NoticeLine, shareLink, useOnline } from "./ui.tsx";
import { balanceNote } from "../lib/connection.ts";

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
function fromText(from: Address): string {
  const kind = senderKind(from, [POTS_AUSD, POTS_TESTUSD], SETTLEMENT_PAIR);
  return kind === "pot" ? copy.fromAPot : kind === "settlement" ? copy.fromAgoraSettlement : copy.accountEnding(from);
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
  const requested = decimals === null ? null : parseAmount(amountText, decimals);
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
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="25" />
          </label>
          <button type="button" className="pill-btn" onClick={share}>
            <Icon name="share" />
            {copy.shareRequestLink}
          </button>
          {note && <p className="hint">{note}</p>}
          <button type="button" className="btn ghost small" onClick={copyId}>
            {copied ? copy.copied : copy.orShareAccountId}
          </button>
        </div>

        <section className="card enter" style={{ animationDelay: "80ms" }} aria-labelledby="payments-in">
          <p className="eyebrow" id="payments-in">
            {copy.paymentsIn}
          </p>
          {payments.length === 0 && <p className="hint">{copy.noPaymentsYet}</p>}
          <div className="list">
            {payments.map((p) => {
              const isNew = fresh.has(keyOf(p));
              return (
                <div className={`list-row${isNew ? " arrived" : ""}`} key={keyOf(p)}>
                  <div className="grow">
                    <span className="name">+{show(currencies, p)}</span>
                    <span className="meta">{copy.paymentFrom(fromText(p.from))}</span>
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
