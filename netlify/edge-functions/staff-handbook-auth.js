// Basic-Auth gate for the staff handbook.
//
// Protects /staff-handbook and /staff-handbook.html so only people with the
// shared password can read it. The password is read from the Netlify
// environment variable STAFF_HANDBOOK_PASSWORD (Site settings -> Environment
// variables) and is never stored in the repo.
//
// Fails CLOSED: if the password env var is not set, access is denied rather
// than the handbook being served unprotected.

export default async (request, context) => {
  const expected = Deno.env.get("STAFF_HANDBOOK_PASSWORD");

  // No password configured -> never expose the handbook.
  if (!expected) {
    return new Response(
      "Staff handbook access is not configured yet. Please contact management.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch (_) {
      decoded = "";
    }
    // Credentials are "username:password"; we only check the password so any
    // username works.
    const separator = decoded.indexOf(":");
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (password === expected) {
      return context.next();
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="FSHG Staff Handbook", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    },
  });
};
