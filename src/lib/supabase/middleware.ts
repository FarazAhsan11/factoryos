import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and guards protected
 * routes. Called from the root `middleware.ts`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: keep this right after client init — it is what refreshes an
  // expired session and writes the new cookies onto the response.
  //
  // `getClaims()` rather than `getUser()`: it refreshes the session exactly
  // the same way, then verifies the JWT's signature — locally, against the
  // project's cached signing keys, when the project signs with asymmetric
  // keys, and by falling back to `getUser()` when it doesn't. This runs on
  // every request, so skipping a round trip to Supabase Auth here is felt on
  // every navigation. The pages themselves still authorize through
  // `getFactoryContext`, which asks the Auth server directly.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const path = request.nextUrl.pathname;

  // Unauthenticated users can't reach the app shells.
  const isProtected = path.startsWith("/admin") || path.startsWith("/factory");
  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
