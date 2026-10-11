import { Composition, staticFile } from "remotion";
import { RedactedClip, type RedactedClipProps } from "./Redact.tsx";
import { parseRedactions, timeline } from "./redactions.ts";
import { FPS, pieceFrames } from "./timing.ts";

export function Root() {
  return (
    <Composition
      id="RedactedClip"
      component={RedactedClip}
      fps={FPS}
      width={1080}
      height={2232}
      durationInFrames={1}
      defaultProps={{ clip: "", from: 0, to: 1, map: null } satisfies RedactedClipProps}
      calculateMetadata={async ({ props }) => {
        // The map is read from footage/ (the public dir) on this PC; it never ships with the bundle.
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
  );
}
