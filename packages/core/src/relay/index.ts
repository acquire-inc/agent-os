// relay/index.ts — public surface for the Relay event bus.

export { EVENT_NAMES, isEventName, type EventName } from "./events.js";
export {
  emit,
  type RelayEmitArgs,
  type RelayEvent,
  type RelayActor,
  type ConsentScope,
  type PiiClass,
} from "./emit.js";
export {
  composeRunSummary,
  getRunSummary,
  type ComposeRunSummaryArgs,
  type RunSummary,
} from "./summary.js";
