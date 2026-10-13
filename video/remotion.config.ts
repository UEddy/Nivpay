import { Config } from "@remotion/cli/config";

// Raw clips and the redaction map are read from footage/ on this PC only.
Config.setEntryPoint("src/index.ts");
Config.setPublicDir("footage");
Config.setVideoImageFormat("jpeg");
// The 3D phone frame is WebGL; ANGLE gives Chrome a GPU-backed context on this PC.
Config.setChromiumOpenGlRenderer("angle");
