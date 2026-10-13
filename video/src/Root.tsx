import { Composition, staticFile } from "remotion";
import agora from "../timelines/agora-bounty.json" with { type: "json" };
import demo from "../timelines/technical-demo.json" with { type: "json" };
import x from "../timelines/x-launch.json" with { type: "json" };
import { RedactedClip, type RedactedClipProps } from "./Redact.tsx";
import { parseRedactions, timeline, visiblePixels } from "./redactions.ts";
import { problems, totalFrames, type Timeline } from "./timeline.ts";
import { FPS, pieceFrames } from "./timing.ts";
import { TimelineVideo, type VideoProps } from "./Video.tsx";
import { PhonePrototype, PROTOTYPE_FRAMES, type PrototypeProps } from "./phone/Prototype.tsx";
import { AgoraFilm } from "./films/Agora.tsx";
import { BountyFilm } from "./films/Bounty.tsx";
import { TechFilm } from "./films/Tech.tsx";
import { DemoFilm } from "./films/Demo.tsx";
import { filmFrames } from "./films/sound.ts";
import { XLaunch } from "./films/XLaunch.tsx";

export const TIMELINES = [agora, demo, x] as unknown as Timeline[];

/** The map is read from footage/ (the public dir) on this PC, only when a timeline has real footage; it never ships with the bundle. */
async function loadMap(t: Timeline) {
  const real = t.segments.some((s) => s.take?.clip != null || s.takeB?.clip != null);
  return real ? parseRedactions(await (await fetch(staticFile("redactions.json"))).text()) : null;
}

export function Root() {
  return (
    <>
      {/* The films: animated from start to finish, no footage. */}
      <Composition id="film-x" component={XLaunch} fps={FPS} width={1080} height={1080} durationInFrames={filmFrames("x")} />
      <Composition id="film-agora" component={AgoraFilm} fps={FPS} width={1920} height={1080} durationInFrames={filmFrames("agora")} />
      <Composition id="film-demo" component={DemoFilm} fps={FPS} width={1920} height={1080} durationInFrames={filmFrames("demo")} />
      {/* The same look around real recordings of the live app. */}
      <Composition id="film-bounty" component={BountyFilm} fps={FPS} width={1920} height={1080} durationInFrames={filmFrames("bounty")} />
      <Composition id="film-tech" component={TechFilm} fps={FPS} width={1920} height={1080} durationInFrames={filmFrames("tech")} />
      {TIMELINES.map((t) => (
        <Composition
          key={t.id}
          id={t.id}
          component={TimelineVideo}
          fps={FPS}
          width={t.width}
          height={t.height}
          durationInFrames={1}
          defaultProps={{ timeline: t, map: null } satisfies VideoProps}
          calculateMetadata={async ({ props }) => {
            const map = props.map ?? (await loadMap(props.timeline));
            // A rule broken refuses even a preview: a dash, a typed number, a banned word, over the cap.
            const hard = problems(props.timeline, map).hard;
            if (hard.length) throw new Error(hard.join("\n"));
            return { props: { ...props, map }, durationInFrames: totalFrames(props.timeline, map) };
          }}
        />
      ))}
      {(["3d", "css"] as const).map((r) => (
        <Composition
          key={r}
          id={`phone-prototype-${r}`}
          component={PhonePrototype}
          fps={FPS}
          width={1920}
          height={1080}
          durationInFrames={PROTOTYPE_FRAMES}
          defaultProps={{ renderer: r } satisfies PrototypeProps}
        />
      ))}
      <Composition
        id="RedactedClip"
        component={RedactedClip}
        fps={FPS}
        width={1080}
        height={2232}
        durationInFrames={1}
        defaultProps={{ clip: "", from: 0, to: 1, map: null } satisfies RedactedClipProps}
        calculateMetadata={async ({ props }) => {
          const map = props.map ?? parseRedactions(await (await fetch(staticFile("redactions.json"))).text());
          const entry = map.clips[props.clip];
          if (!entry?.reviewed) throw new Error(`clip ${props.clip} has no reviewed entry in redactions.json, so it can't be rendered`);
          const pieces = timeline(entry, props.from, props.to);
          return {
            props: { ...props, map },
            ...visiblePixels(entry),
            durationInFrames: props.hold !== undefined ? Math.round(props.hold * FPS) : pieces.reduce((n, p) => n + pieceFrames(p, props.speed ?? 1), 0),
          };
        }}
      />
    </>
  );
}
