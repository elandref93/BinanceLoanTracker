export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  setExtraHeadersGetter,
  setAuthFailureHandler,
} from "./custom-fetch";
export type {
  AuthTokenGetter,
  ExtraHeadersGetter,
  AuthFailureHandler,
} from "./custom-fetch";
