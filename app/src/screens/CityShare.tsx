import { useState } from "react";
import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { cityLabel, loadCities, nearestCity, searchCities, type City } from "../lib/cities.ts";
import { CityChoices, keyFromFragment, removeCity, seal, shareCity } from "../lib/cityShare.ts";
import { DEPLOYMENT } from "../lib/deployment.ts";
import { describeFailure } from "../lib/errors.ts";
import { dateLocale } from "../lib/locale.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import { NoticeLine, type Notice } from "./ui.tsx";

const passkeys = () => reloadOnce(() => import("../lib/passkey.ts"));

/**
 * "Show where you're chipping in from", on a pot's screen: a city, opt in,
 * for the people in this pot only. The phone asks for its position once, at
 * low accuracy, turns it into a city from the bundled list and forgets it; or
 * the person picks a city by hand and shares no position at all. Only the
 * city leaves the phone, encrypted with this pot link's key
 * (lib/cityShare.ts). It can be changed or removed at any time.
 */
export function CityShare(props: { account: Address; potId: string; fragment: string; offer: boolean; onChanged: () => void }) {
  const choices = new CityChoices(localStorage, DEPLOYMENT, props.account);
  const [choice, setChoice] = useState(() => choices.get(props.potId));
  const [mode, setMode] = useState<"idle" | "choose">("idle");
  const [list, setList] = useState<City[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<City | null>(null);
  const [busy, setBusy] = useState<"locating" | "sharing" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const locale = dateLocale();

  const remember = (v: typeof choice) => {
    choices.set(props.potId, v);
    setChoice(v);
  };
  /** The bundled list, loaded the first time it is needed. */
  const cities = async (): Promise<City[]> => {
    if (list) return list;
    const loaded = await loadCities();
    setList(loaded);
    return loaded;
  };
  const sign = async (message: string) => (await passkeys()).withSigner(props.account, (a) => a.signMessage({ message }));

  const locate = () => {
    setNotice(null);
    setBusy("locating");
    // Once, at low accuracy. The position is turned into a city here and never kept or sent.
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const near = nearestCity(await cities(), pos.coords.latitude, pos.coords.longitude);
        setBusy(null);
        if (near) setPicked(near);
        else setNotice({ tone: "bad", text: copy.locationRefused });
      },
      () => {
        setBusy(null);
        setNotice({ tone: "bad", text: copy.locationRefused });
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 20_000 },
    );
  };

  const share = async () => {
    if (!picked) return;
    setBusy("sharing");
    setNotice(null);
    try {
      const key = await keyFromFragment(props.fragment);
      if (!key) throw new Error("no key");
      const sealed = await seal(key, { account: props.account, city: picked[0], country: picked[1], at: Date.now() });
      await shareCity(props.account, DEPLOYMENT, props.potId, sealed, sign);
      remember({ asked: true, shared: { city: picked[0], country: picked[1] } });
      setMode("idle");
      setPicked(null);
      setNotice({ tone: "ok", text: copy.cityShared });
      props.onChanged();
    } catch (e) {
      setNotice(e instanceof Error && /city refused|no key/.test(e.message) ? { tone: "bad", text: copy.errCitySave, code: ERROR_CODES.CITY_SAVE_FAILED } : { tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("sharing");
    setNotice(null);
    try {
      await removeCity(props.account, DEPLOYMENT, props.potId, sign);
      remember({ asked: true, shared: null });
      setNotice({ tone: "ok", text: copy.cityRemovedNote });
      props.onChanged();
    } catch (e) {
      setNotice(e instanceof Error && /city refused/.test(e.message) ? { tone: "bad", text: copy.errCitySave, code: ERROR_CODES.CITY_SAVE_FAILED } : { tone: "bad", ...describeFailure(e) });
    } finally {
      setBusy(null);
    }
  };

  const showing = mode === "choose" || (props.offer && !choice.asked && !choice.shared);
  if (!showing && !choice.shared && !notice) return null;
  const results = list && query ? searchCities(list, query) : [];

  return (
    <section className="card city-share enter" aria-labelledby="city-share">
      <p className="eyebrow" id="city-share">
        {copy.showWhereFrom}
      </p>
      {choice.shared && mode === "idle" && (
        <>
          <p className="name">{copy.yourCityHere(cityLabel(choice.shared.city, choice.shared.country, locale))}</p>
          <div className="new-pot-actions">
            <button type="button" className="btn small" disabled={busy !== null} onClick={() => setMode("choose")}>
              {copy.changeCity}
            </button>
            <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => void remove()}>
              {copy.removeCity}
            </button>
          </div>
        </>
      )}
      {showing && (
        <>
          {picked ? (
            <button type="button" className="btn primary" disabled={busy !== null} aria-busy={busy === "sharing"} onClick={() => void share()}>
              {busy === "sharing" ? copy.sharingCity : copy.shareCityAction(cityLabel(picked[0], picked[1], locale))}
            </button>
          ) : (
            <div className="new-pot-actions">
              {"geolocation" in navigator && (
                <button type="button" className="btn small" disabled={busy !== null} onClick={locate}>
                  {busy === "locating" ? copy.findingCity : copy.useMyLocation}
                </button>
              )}
              <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => void cities()}>
                {copy.pickACity}
              </button>
            </div>
          )}
          {(list || picked) && (
            <label className="field">
              <span>{copy.cityField}</span>
              <input
                value={query}
                onFocus={() => void cities()}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicked(null);
                }}
                autoComplete="off"
                placeholder={copy.cityPlaceholder2}
              />
            </label>
          )}
          {!picked && query.trim().length >= 2 && list && (
            <div className="list">
              {results.length === 0 ? (
                <p className="hint">{copy.cityNoResults}</p>
              ) : (
                results.map((c) => (
                  <button type="button" className="home-pot" key={`${c[0]}-${c[1]}-${c[2]}-${c[3]}`} onClick={() => setPicked(c)}>
                    <span className="grow">
                      <span className="name">{cityLabel(c[0], c[1], locale)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            className="btn ghost small"
            disabled={busy !== null}
            onClick={() => {
              setMode("idle");
              setPicked(null);
              setQuery("");
              if (!choice.shared) remember({ asked: true, shared: null });
            }}
          >
            {mode === "choose" ? copy.back : copy.notNow}
          </button>
        </>
      )}
      <p className="hint">{copy.cityOnlyThisPot}</p>
      {notice && <NoticeLine notice={notice} />}
    </section>
  );
}
