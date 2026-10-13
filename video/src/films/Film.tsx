import type { ComponentType } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { C, Fonts, OVER } from "./kit.tsx";
import { PLANS, sceneStarts, type FilmId, type ScenePlan } from "./sound.ts";

/** Plays a film's scenes in plan order, each wiping over the last, on its music. */
export function Film({ id, scenes, music = 0.5 }: { id: FilmId; scenes: Record<string, ComponentType>; music?: number }) {
  const starts = sceneStarts(id);
  const plan = PLANS[id] as ScenePlan[];
  return (
    <Fonts>
      <AbsoluteFill style={{ background: C.night }}>
        {plan.map((s, i) => {
          const Scene = scenes[s.id];
          if (!Scene) throw new Error(`film ${id} has no scene ${s.id}`);
          const last = i === plan.length - 1;
          return (
            <Sequence key={s.id} name={s.id} from={starts[s.id].from} durationInFrames={starts[s.id].frames + (last ? 0 : OVER)}>
              <Scene />
            </Sequence>
          );
        })}
        <Audio src={staticFile(`sound/music-${id}.wav`)} volume={music} />
      </AbsoluteFill>
    </Fonts>
  );
}
