import { EventEmitter } from "./EventEmitter";

export const UIEvents = new EventEmitter();

export const UI_EVENT_TYPES = {
  OPEN_DIALER: "OPEN_DIALER",
  NEW_MESSAGE: "NEW_MESSAGE",
};
