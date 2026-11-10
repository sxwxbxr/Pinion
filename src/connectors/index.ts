import type { Platform } from "../types.js";
import { blueskyConnector } from "./bluesky.js";
import { devtoConnector } from "./devto.js";
import { linkedinConnector } from "./linkedin.js";
import { redditConnector } from "./reddit.js";
import { threadsConnector } from "./threads.js";
import type { SocialConnector } from "./types.js";
import { xConnector } from "./x.js";

export const connectors: Record<Platform, SocialConnector> = {
  x: xConnector,
  linkedin: linkedinConnector,
  threads: threadsConnector,
  reddit: redditConnector,
  bluesky: blueskyConnector,
  devto: devtoConnector,
};
