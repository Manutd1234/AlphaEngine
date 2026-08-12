import { NextResponse } from "next/server";

import { deskCookie } from "@/lib/desk-cookie";

/**
 * Drop the desk pass.
 *
 * The session itself is revoked by the browser — GoTrue holds the refresh token
 * and `signOutUser()` awaits its round trip — so this route's only job is the
 * cookie the client cannot touch, because it is httpOnly.
 *
 * Deliberately does NOT redirect. The brief describes this endpoint as clearing
 * the session and redirecting to /login, and splitting those is the better
 * shape: a 303 from here would be followed by `fetch`, which returns the login
 * page's HTML to a caller that wanted a status, and the client still has to
 * navigate afterwards anyway. So this reports the outcome and `AccountChip`
 * navigates — which is also the existing separation `signOutUser()` documents,
 * where the module that ends a session refuses to decide where anyone goes.
 *
 * Idempotent: clearing an absent cookie is a success, so a double-click or a
 * retry cannot produce an error a user has to think about.
 */
export async function POST() {
  const response = NextResponse.json({ status: "signed-out" });
  response.cookies.set({ ...deskCookie(""), value: "", maxAge: 0 });
  return response;
}
