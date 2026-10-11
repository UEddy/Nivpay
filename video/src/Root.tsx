import { Composition, staticFile } from "remotion";
import agora from "../timelines/agora-bounty.json" with { type: "json" };
import demo from "../timelines/technical-demo.json" with { type: "json" };
import x from "../timelines/x-launch.json" with { type: "json" };
import { RedactedClip, type RedactedClipProps } from "./Redact.tsx";
import { parseRedactions, timeline } from "./redactions.ts";
import { problems, totalFrames, type Timeline } from "./timeline.ts";
import { FPS, pieceFrames } from "./timing.ts";
import { TimelineVideo, type VideoProps } from "./Video.tsx";

export const TIMELINES = [agora, demo, x] as unknown as Timeline[];

/** The map is read from footage/ (the public dir) on this PC, only when a timeline has real footage; it never ships with the bundle. */
async function loadMap(t: Timeline) {
  const real = t.segments.some((s) => s.take?.clip != null || s.takeB?.clip != null);
  return real ? parseRedactions(await (await fetch(staticFile("redactions.json"))).text()) : null;
}

export function Root() {
  return (
    <>
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
          const even = (n: number) => Math.round(n / 2) * 2;
          const pieces = timeline(entry, props.from, props.to);
          return {
            props: { ...props, map },
            width: even(entry.width),
            height: even(entry.height * (1 - entry.statusBar - (entry.bottomBar ?? 0))),
            durationInFrames: pieces.reduce((n, p) => n + pieceFrames(p), 0),
          };
        }}
      />
    </>
  );
}
