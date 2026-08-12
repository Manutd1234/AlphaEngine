import { NextResponse } from "next/server";

import { deskCookie, guestValue } from "@/lib/desk-cookie";

/**
 * Browse the desk without an account.
 *
 * The sign-in page has always offered this, as a low-contrast text link that
 * simply navigated to the workspace — which worked only because the workspace
 * was ungated. Now that it is gated, "continue without an account" has to mint
 * something, and this is it: a random id in an httpOnly cookie, which the
 * middleware accepts as a pass and the sandbox seeds a private desk from.
 *
 * A POST, not a GET, and that is not ceremony. A GET would be followed by any
 * link prefetcher and every crawler that touches the sign-in page, so the act of
 * *rendering* the form would hand out guest passes. It also means a browser
 * cannot be walked into guest mode by a third-party page embedding an image.
 *
 * The id carries no claim about who anyone is. It is a seed and a scope, so two
 * visitors get two desks; it is not an identity and nothing is authorised by it.
 */
export async function POST() {
  const id = crypto.randomUUID();
  const response = NextResponse.json({
    guest: true,
    // Echoed so the client can seed the sandbox from the same value the cookie
    // carries, rather than minting a second id that would disagree with it.
    id,
  });
  response.cookies.set(deskCookie(guestValue(id)));
  return response;
}
