/**
 * The desk cookie, defined once for the middleware and the routes that set it.
 *
 * Three places need to agree about this: the guard that reads it, the session
 * route that sets it after validating a JWT, and the guest route that mints one
 * without. Three copies of a cookie name and three copies of its flags is how a
 * `secure` cookie ends up written without `secure` by one of them.
 *
 * Not a security boundary — see the header of `middleware.ts`. It answers "which
 * page do I render", and every data path keeps its own guard behind it.
 */

export const DESK_COOKIE = "ae_desk";

export interface DeskCookieOptions {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
}

/**
 * Cookie attributes for a desk pass.
 *
 * httpOnly: page scripts must not be able to write themselves a pass.
 * sameSite=lax: it has to survive the return trip from an OAuth provider, which
 *   is a cross-site POST-then-GET; `strict` would drop it on exactly that hop
 *   and send a freshly signed-in visitor back to the form.
 * secure in production only: a localhost dev server is http, and a `secure`
 *   cookie there is silently discarded — the class of bug where auth "works in
 *   production and not locally" for no visible reason.
 * No max-age: a desk pass lasts the browser session. The Supabase session in
 *   localStorage is the durable half, and `/api/auth/session` re-mints this from
 *   it on the next visit.
 */
export function deskCookie(value: string): DeskCookieOptions {
  return {
    name: DESK_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/** A guest pass value. The `guest:` prefix is what tells the two apart. */
export function guestValue(id: string): string {
  return `guest:${id}`;
}

/** Whether a desk pass belongs to a guest rather than an account. */
export function isGuest(value: string | undefined): boolean {
  return Boolean(value?.startsWith("guest:"));
}
