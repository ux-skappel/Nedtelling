/**
 * Mints the Garmin token for `GARMIN_TOKEN`, locally.
 *
 * Run this on your own machine — never on the server. It walks Garmin's mobile
 * sign-in, exchanges the resulting ticket for a long-lived OAuth1 token, and
 * prints the blob to paste into Vercel. Your password is used once, here, and is
 * never stored or sent anywhere but Garmin's sign-in host.
 *
 *   npm run login
 *   npm run login -- --out .env.local
 */

import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { exchangeForAccessToken } from "../src/garmin/auth.js";
import { buildAuthorizationHeader } from "../src/garmin/oauth1.js";
import { serializeTokens, type GarminTokens, type OAuth1Token } from "../src/garmin/tokens.js";

const CLIENT_ID = "GCM_ANDROID_DARK";
const OAUTH_USER_AGENT = "com.garmin.android.apps.connectmobile";
const SSO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Garmin's sign-in is cookie-driven, so the whole flow shares one jar. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

interface Options {
  domain: string;
  out: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { domain: process.env["GARMIN_DOMAIN"] || "garmin.com", out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--domain") options.domain = argv[++index] ?? options.domain;
    else if (arg === "--out") options.out = argv[++index] ?? null;
    else if (arg === "--help" || arg === "-h") {
      stdout.write("Usage: npm run login -- [--domain garmin.com] [--out .env.local]\n");
      process.exit(0);
    }
  }
  return options;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

/**
 * Reads a line from the terminal without echoing it.
 *
 * Avoids readline's own masking hooks — they reach into private fields whose
 * shape varies across Node versions and environments (they don't exist at all
 * on some hosted terminals), so this reads raw keystrokes instead.
 */
async function promptHidden(question: string): Promise<string> {
  stdout.write(question);
  if (!stdin.isTTY) {
    // No real terminal to put in raw mode (e.g. input piped in) — fall back
    // to a plain, visible read rather than failing outright.
    return prompt("");
  }

  return new Promise((resolve) => {
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char: string) => {
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004": // Ctrl-D
          cleanup();
          stdout.write("\n");
          resolve(input);
          break;
        case "\u0003": // Ctrl-C
          cleanup();
          stdout.write("\n");
          process.exit(130);
          break;
        case "\u007f": // Backspace
        case "\b":
          input = input.slice(0, -1);
          break;
        default:
          input += char;
          break;
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    stdin.on("data", onData);
  });
}

interface SsoResponse {
  responseStatus?: { type?: string; message?: string };
  serviceTicketId?: string;
  customerMfaInfo?: { mfaLastMethodUsed?: string };
}

function assertSuccessful(payload: SsoResponse, stage: string): void {
  const type = payload.responseStatus?.type;
  if (type !== "SUCCESSFUL") {
    const message = payload.responseStatus?.message;
    throw new Error(`Garmin rejected ${stage}: ${type ?? "unknown"}${message ? ` — ${message}` : ""}`);
  }
}

async function signIn(options: Options): Promise<{ ticket: string; jar: CookieJar }> {
  const jar = new CookieJar();
  const loginParams = new URLSearchParams({
    clientId: CLIENT_ID,
    locale: "en-US",
    service: `https://mobile.integration.${options.domain}/gcm/android`,
  });

  // 1. Load the sign-in page to pick up the session cookies it sets.
  const page = await fetch(
    `https://sso.${options.domain}/mobile/sso/en/sign-in?clientId=${CLIENT_ID}`,
    { headers: { ...SSO_HEADERS, "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none" } },
  );
  jar.absorb(page);

  const email = process.env["GARMIN_EMAIL"] || (await prompt("Garmin email: "));
  const password = process.env["GARMIN_PASSWORD"] || (await promptHidden("Garmin password: "));
  if (!email || !password) throw new Error("Email and password are both required.");

  // 2. Submit credentials.
  const loginResponse = await fetch(`https://sso.${options.domain}/mobile/api/login?${loginParams}`, {
    method: "POST",
    headers: { ...SSO_HEADERS, "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ username: email, password, rememberMe: false, captchaToken: "" }),
  });
  jar.absorb(loginResponse);
  if (!loginResponse.ok && loginResponse.status !== 200) {
    throw new Error(`Sign-in failed with HTTP ${loginResponse.status}.`);
  }
  const login = (await loginResponse.json()) as SsoResponse;

  if (login.responseStatus?.type === "MFA_REQUIRED") {
    // 3. Garmin sent a code; verify it against the same session.
    const method = login.customerMfaInfo?.mfaLastMethodUsed ?? "email";
    const code = await prompt(`Multi-factor code (sent by ${method}): `);
    const mfaResponse = await fetch(
      `https://sso.${options.domain}/mobile/api/mfa/verifyCode?${loginParams}`,
      {
        method: "POST",
        headers: { ...SSO_HEADERS, "Content-Type": "application/json", Cookie: jar.header() },
        body: JSON.stringify({
          mfaMethod: method,
          mfaVerificationCode: code,
          rememberMyBrowser: false,
          reconsentList: [],
          mfaSetup: false,
        }),
      },
    );
    jar.absorb(mfaResponse);
    const mfa = (await mfaResponse.json()) as SsoResponse;
    assertSuccessful(mfa, "the multi-factor code");
    if (!mfa.serviceTicketId) throw new Error("Garmin accepted the code but returned no ticket.");
    return { ticket: mfa.serviceTicketId, jar };
  }

  assertSuccessful(login, "the sign-in");
  if (!login.serviceTicketId) throw new Error("Garmin accepted the sign-in but returned no ticket.");
  return { ticket: login.serviceTicketId, jar };
}

/** Trades the single-use service ticket for the long-lived OAuth1 token. */
interface Consumer {
  consumer_key: string;
  consumer_secret: string;
}

async function fetchConsumer(): Promise<Consumer> {
  const response = await fetch("https://thegarth.s3.amazonaws.com/oauth_consumer.json", {
    headers: { "User-Agent": OAUTH_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Could not fetch OAuth consumer credentials (HTTP ${response.status}).`);
  }
  return (await response.json()) as Consumer;
}

async function requestOAuth1Token(
  ticket: string,
  jar: CookieJar,
  consumer: Consumer,
  options: Options,
): Promise<OAuth1Token> {

  const url = new URL(`https://connectapi.${options.domain}/oauth-service/oauth/preauthorized`);
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("login-url", `https://mobile.integration.${options.domain}/gcm/android`);
  url.searchParams.set("accepts-mfa-tokens", "true");

  const authorization = buildAuthorizationHeader(
    { consumerKey: consumer.consumer_key, consumerSecret: consumer.consumer_secret },
    { method: "GET", url: url.toString() },
  );

  const response = await fetch(url, {
    headers: { Authorization: authorization, "User-Agent": OAUTH_USER_AGENT, Cookie: jar.header() },
  });
  if (!response.ok) {
    throw new Error(
      `Ticket exchange failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  const parsed = new URLSearchParams(await response.text());
  const token = parsed.get("oauth_token");
  const secret = parsed.get("oauth_token_secret");
  if (!token || !secret) throw new Error("Garmin returned no OAuth1 token pair.");

  const oauth1: OAuth1Token = {
    oauth_token: token,
    oauth_token_secret: secret,
    domain: options.domain,
  };
  const mfaToken = parsed.get("mfa_token");
  if (mfaToken) oauth1.mfa_token = mfaToken;
  return oauth1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  stdout.write(`Signing in to ${options.domain}...\n`);

  const { ticket, jar } = await signIn(options);
  const consumer = await fetchConsumer();
  const oauth1 = await requestOAuth1Token(ticket, jar, consumer, options);

  // Prove the token works before telling anyone to deploy it.
  const oauth2 = await exchangeForAccessToken({ oauth1, oauth2: null }, {
    domain: options.domain,
    login: true,
    consumer,
  });

  const tokens: GarminTokens = { oauth1, oauth2 };
  const blob = serializeTokens(tokens);
  const expires = new Date(oauth2.refresh_token_expires_at * 1000).toISOString().slice(0, 10);

  if (options.out) {
    await writeFile(options.out, `GARMIN_TOKEN=${blob}\n`, { mode: 0o600, flag: "a" });
    stdout.write(`\nWrote GARMIN_TOKEN to ${options.out} (keep it out of git).\n`);
  } else {
    stdout.write(`\nGARMIN_TOKEN=${blob}\n`);
  }

  stdout.write(
    `\nSigned in. This token stays valid until roughly ${expires}; after that, run this again.\n` +
      "Add it to Vercel with:\n" +
      "  vercel env add GARMIN_TOKEN production\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
