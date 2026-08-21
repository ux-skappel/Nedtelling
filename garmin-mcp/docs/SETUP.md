# Setup

Three steps: mint a Garmin token on your own machine, deploy to Vercel with that
token in an environment variable, and point an MCP client at the deployment.

Everything below assumes you are in the `garmin-mcp/` directory.

## 1. Mint the Garmin token

```bash
npm install
npm run login
```

The script asks for your Garmin email and password, and for a multi-factor code
if your account uses one. It signs in the same way Garmin's mobile app does,
trades the resulting ticket for a long-lived OAuth1 token, verifies that token
works, and prints:

```
GARMIN_TOKEN=eyJvYXV0aF90b2tlbiI6…
```

Keep that value secret — it grants access to your Garmin account.

**What is and is not stored.** Your password is used once, in this process, and
sent only to `sso.garmin.com`. It is never written to disk and never leaves your
machine in any other form. The token that gets deployed is an OAuth1 token pair;
revoking it means changing your Garmin password.

Options:

```bash
npm run login -- --out .env.local     # append to a file instead of printing
npm run login -- --domain garmin.cn   # accounts on Garmin China
```

`GARMIN_EMAIL` and `GARMIN_PASSWORD` are read from the environment if set, for
scripted use. Prefer the interactive prompts — environment variables leak into
shell history and process listings.

Already using [garth](https://github.com/matin/garth)? Its `garth.client.dumps()`
output is the same format; paste it straight into `GARMIN_TOKEN`.

## 2. Deploy to Vercel

The MCP server is this subdirectory of the repository, so tell Vercel where it
lives.

**From the CLI:**

```bash
npm i -g vercel
vercel link              # answer "garmin-mcp" when asked for the root directory
vercel --prod
```

**From the dashboard:** import the repository, then under *Settings → General*
set **Root Directory** to `garmin-mcp`. Framework preset: *Other*. No build
command or output directory is needed — `api/*.ts` are compiled as functions
automatically.

### Environment variables

Set these for the *Production* environment (and *Preview*, if you will use
preview deployments):

| Variable | Required | Purpose |
| --- | --- | --- |
| `GARMIN_TOKEN` | yes | The blob from step 1 |
| `MCP_AUTH_TOKEN` | yes | Shared secret every client must send. Generate with `openssl rand -hex 32` |
| `GARMIN_DOMAIN` | no | `garmin.com` (default) or `garmin.cn` |
| `GARMIN_OAUTH_CONSUMER` | no | Pin the OAuth consumer credentials as `{"consumer_key":"…","consumer_secret":"…"}` instead of fetching them at runtime |
| `GARMIN_REQUEST_TIMEOUT_MS` | no | Per-request timeout against Garmin. Default 20000, capped at 55000 |
| `MCP_MAX_RESPONSE_BYTES` | no | Soft cap on a single tool result. Default 350000 |

```bash
vercel env add GARMIN_TOKEN production
vercel env add MCP_AUTH_TOKEN production
vercel --prod                            # redeploy so the new values take effect
```

Environment variables are read at cold start, so a change needs a redeploy.

### Check the deployment

```bash
curl https://<your-project>.vercel.app/api/health
```

```json
{ "status": "ok", "server": "garmin-mcp", "version": "0.1.0", "endpoint": "/api/mcp",
  "configured": { "GARMIN_TOKEN": true, "MCP_AUTH_TOKEN": true } }
```

`"status": "misconfigured"` with a `503` means a variable is missing or the
deployment predates it. The endpoint reports only whether each value is set.

Then check the MCP endpoint itself:

```bash
curl -sS https://<your-project>.vercel.app/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

A JSON-RPC result naming `garmin-mcp` means the server is live. A `401` means
the token does not match.

## 3. Connect a client

**Claude Code:**

```bash
claude mcp add --transport http garmin \
  https://<your-project>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Or check a project-scoped `.mcp.json` into a repository — with the token read
from the environment, not written into the file:

```json
{
  "mcpServers": {
    "garmin": {
      "type": "http",
      "url": "https://<your-project>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

Verify with `/mcp` inside Claude Code, then ask for something concrete: *"list my
last five activities"*, or *"show the heart-rate series for my last run."*

**Other MCP clients** need to send the same header. Clients that only accept a
URL and no headers cannot authenticate against this server — it uses a bearer
token rather than an OAuth flow.

## Running locally

```bash
cp .env.local.example .env.local    # then fill in both values
vercel dev
```

`vercel dev` serves `http://localhost:3000/api/mcp` and reads `.env.local`, which
is gitignored. `npm test` needs no credentials and no network — Garmin is stubbed.

## Keeping it working

**Token expiry.** The OAuth1 token lasts about a year; the login script prints
its expiry date. The server mints a fresh one-hour access token from it as
needed, in memory. When the OAuth1 token expires, tools start failing with
`auth_error` and a message saying so — run `npm run login` again and update
`GARMIN_TOKEN`.

**Rotating `MCP_AUTH_TOKEN`.** Set the new value, redeploy, then update every
client. There is no grace period: the old token stops working at the redeploy.

**Changing your Garmin password** invalidates the token. Re-run the login script.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `401` from `/api/mcp` | The `Authorization` header is missing or does not match `MCP_AUTH_TOKEN`. Check for a trailing newline in the Vercel value. |
| `auth_error` in a tool result | The Garmin token expired or was revoked. Re-run `npm run login`. |
| `Missing required environment variable` | The variable is not set for the environment being served, or the deployment predates it. Set it and redeploy. |
| Login fails with `MFA_REQUIRED` handling | Enter the code Garmin sends. If it times out, run the script again — codes are single-use. |
| Login fails with an HTTP 403 | Garmin sometimes blocks sign-ins from unfamiliar networks or datacentre IPs. Run the login script from your normal machine and network. |
| `response_too_large` | Ask for a narrower window: a smaller `limit`, fewer `metrics`, or a shorter date range. Raising `MCP_MAX_RESPONSE_BYTES` is the blunt alternative. |
| A tool times out on a long activity | Lower `maxChartSize`, or raise `GARMIN_REQUEST_TIMEOUT_MS` toward the function's 60-second ceiling. |
| `not_found` for an activity that exists | Check the id against `garmin_list_activities`; ids are per-account. |

## How the auth flow works

Worth knowing if something breaks, since Garmin documents none of it:

1. `npm run login` loads Garmin's mobile sign-in page for its cookies, posts your
   credentials, and handles multi-factor if required. Garmin returns a
   single-use service ticket.
2. The script exchanges that ticket, with an OAuth1-signed request, for an
   OAuth1 token pair valid for about a year. That pair is `GARMIN_TOKEN`.
3. At runtime the server signs an OAuth1 request to
   `/oauth-service/oauth/exchange/user/2.0` and gets a one-hour OAuth2 bearer
   token, which it keeps in memory and reuses until it expires.
4. Every Connect API call carries that bearer token. A rejected token triggers
   one refresh and one retry.

The OAuth1 consumer key and secret are the Garmin mobile app's own. Garmin
rotates them, so they are fetched at runtime from the URL that
[garth](https://github.com/matin/garth) publishes, cached for a day, and can be
pinned with `GARMIN_OAUTH_CONSUMER` if you would rather not depend on that
lookup.
