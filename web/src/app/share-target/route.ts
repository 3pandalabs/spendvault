import { NextResponse } from "next/server";

// Reached only when the service worker isn't controlling the page yet (first
// share right after install). The files can't be recovered server-side and are
// never read here, so send the user to /share with an explanation.
export function POST(req: Request) {
  return NextResponse.redirect(new URL("/share?error=nosw", req.url), 303);
}

export function GET(req: Request) {
  return NextResponse.redirect(new URL("/share", req.url), 303);
}
