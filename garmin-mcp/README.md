# garmin-mcp

An MCP server that gives Claude read access to your own Garmin Connect data at
the resolution Garmin stores it — every heart-rate sample, every GPS point,
every sleep stage. Nothing is averaged, bucketed, or rounded on the way through.

TypeScript, deployed as Vercel serverless functions. No database: the only state
is a Garmin token in an environment variable, and a short-lived cache inside
whichever function instance happens to be warm.

## Quick start

```bash
cd garmin-mcp
npm install
npm run login                 # signs in to Garmin, prints GARMIN_TOKEN
```

Deploy it, set the two required environment variables, and point Claude at it:

```bash
vercel --prod
vercel env add GARMIN_TOKEN production      # the blob from npm run login
vercel env add MCP_AUTH_TOKEN production    # openssl rand -hex 32

claude mcp add --transport http garmin https://<your-project>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

[docs/SETUP.md](docs/SETUP.md) covers all of this in detail, including
multi-factor sign-in, token rotation, and troubleshooting.

## Tools

**Activities**

| Tool | Returns |
| --- | --- |
| `garmin_list_activities` | Activity summaries, filtered by type or date, paged server-side |
| `garmin_get_activity` | One activity's full summary record |
| `garmin_get_activity_details` | Every recorded sample: heart rate, pace, cadence, power, position, temperature |
| `garmin_get_heart_rate_series` | The heart-rate channel of one activity, per sample |
| `garmin_get_gps_track` | Position samples, or Garmin's map polyline |
| `garmin_get_activity_splits` | Laps, typed splits, or split summaries |
| `garmin_get_activity_hr_zones` | Time in each heart-rate zone |
| `garmin_get_activity_weather` | Conditions recorded for the activity |
| `garmin_get_activity_exercise_sets` | Per-set detail for strength and HIIT |
| `garmin_download_activity_file` | GPX, TCX, KML, CSV, or the original FIT file |
| `garmin_get_activity_types` | The type keys `garmin_list_activities` accepts |

**Health and wellness**

| Tool | Returns |
| --- | --- |
| `garmin_get_sleep` | One night: stages, movement, heart rate, respiration, SpO2, stress, body battery, HRV |
| `garmin_get_daily_heart_rate` | All-day heart-rate samples |
| `garmin_get_stress` | All-day stress, and body battery alongside it |
| `garmin_get_body_battery` | Body battery across a date range, with its events |
| `garmin_get_body_battery_events` | Naps, stress episodes and activities for one date |
| `garmin_get_respiration` | All-day breathing rate |
| `garmin_get_spo2` | Pulse-oximetry readings |
| `garmin_get_hrv` / `garmin_get_hrv_range` | Overnight HRV for one date, or daily summaries over a range |
| `garmin_get_steps` | Steps in fifteen-minute buckets |
| `garmin_get_daily_summary` | Garmin's own daily roll-up |
| `garmin_get_training_readiness` | Readiness score and its inputs |
| `garmin_get_training_status` | Training load, acute/chronic balance, VO2 max |
| `garmin_get_weight` | Weight and body composition entries |

**Account and escape hatch**

| Tool | Returns |
| --- | --- |
| `garmin_get_profile` | The authenticated account, its time zone and units |
| `garmin_get_raw` | Any read-only Connect API path, for metrics no tool covers yet |

## How paging works

Garmin has no server-side paging for sample series — one request returns the
whole activity or the whole day. This server slices instead, so a conversation
pulls only what it asks for:

```jsonc
// garmin_get_activity_details { activityId: 12345, limit: 500 }
{
  "source": { "endpoint": "/activity-service/activity/12345/details", "params": { "maxChartSize": 20000 } },
  "page":   { "offset": 0, "limit": 500, "returned": 500, "total": 8421, "nextOffset": 500, "hasMore": true },
  "data":   { "descriptors": [ … ], "samples": [ … ] }
}
```

Follow `page.nextOffset` while `page.hasMore` is true. If a page would exceed the
response byte budget the server shrinks it and sets `page.limitAdjusted`, so a
client never has to guess a working limit. Two more ways to ask for less:
`metrics` on the stream tools and `fields` on the activity tools both project
onto the channels or fields you name.

Repeated pages of the same activity are served from a per-instance cache while a
function stays warm, so paging costs one upstream fetch, not one per page.

## Data fidelity

Every value is Garmin's own. The only reshaping is:

- **Naming.** Garmin returns samples as positional arrays with a separate
  descriptor list; the tools key each sample by channel name. `format:
  "positional"` returns the untouched arrays instead.
- **Slicing.** Long arrays are cut into pages.
- **Projection.** `metrics` and `fields` return a subset when you ask for one.

No resampling, no unit conversion, no derived statistics. Timestamps stay as
Garmin sends them: `*GMT` fields are UTC, `*Local` fields are the account's time
zone, which `garmin_get_profile` reports.

`garmin_get_activity_details` reports `measurementCount` next to the number of
samples returned. If Garmin downsampled to fit `maxChartSize`, the tool says so
in `notes` and tells you what to raise it to.

## Security

- Both secrets live in Vercel environment variables. Nothing is written to disk,
  and there is no database.
- Every request to `/api/mcp` needs `Authorization: Bearer $MCP_AUTH_TOKEN`,
  compared in constant time. Without it: `401`.
- Your Garmin password is used once, locally, by `npm run login`. It is never
  sent to Vercel and never stored. What gets deployed is an OAuth1 token that
  you can revoke by changing your Garmin password.
- Every tool is read-only. There is no code path that writes to Garmin, and
  `garmin_get_raw` only issues GETs against Connect API service paths.
- `/api/health` reports whether the environment variables are set, never their
  values.

## Development

```bash
npm test          # 45 tests, no network
npm run typecheck
npm run dev       # vercel dev, needs the env vars locally
```

Layout: `api/` holds the two Vercel entry points, `src/garmin/` talks to Garmin
(auth, HTTP, endpoints), `src/mcp/` turns that into tools (paging, projection,
one file per tool group), and `scripts/login.ts` mints the token.

## Limits

Garmin's Connect API is undocumented and unsupported; endpoints can change
without notice. This server is built for one person reading their own account.
Be considerate with request volume — there is no published rate limit, and the
account you would get blocked is your own.
