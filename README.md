# Tapmaan

Climate intelligence for heatwave monitoring, prediction and early warning.

Built for use case **KJS-CES-01**, K. J. Somaiya School of Engineering, Information
Technology.

Twenty-five stations across the seven IMD homogeneous regions, classified against
official India Meteorological Department heatwave criteria, with seven-day
prediction, hotspot identification, stakeholder-specific advisory generation and an
alert dispatch queue.

## Stack

No build step and no dependencies. Static frontend plus Node serverless functions,
which is why it deploys to Vercel unchanged and cannot break during a build.

```
api/                 serverless functions
  _lib/heat.js       IMD criteria, heat index, hotspot scoring
  _lib/provider.js   data acquisition, caching, fallback, scenario mode
  _lib/respond.js    shared response shape
  observations.js    GET  current conditions, classified
  forecast.js        GET  7-day prediction with probability
  hotspots.js        GET  hotspot scores and region aggregation
  advisory.js        GET  stakeholder-specific advisory
  alerts.js          GET  active warning queue
  subscribe.js       POST alert registration
public/              frontend, one page per capability
test/logic.test.js   15 checks over the domain logic
```

## Running locally

```bash
npx vercel dev          # http://localhost:3000
npm test                # domain logic checks
```

## Deploying to Vercel

1. Push this folder to a GitHub repository.
2. At vercel.com, **Add New → Project**, import the repository.
3. Framework preset: **Other**. Leave build command and output directory empty —
   there is no build.
4. **Deploy**.

Optional: set `ANTHROPIC_API_KEY` under Settings → Environment Variables to enable
LLM-drafted advisories. Without it the rule-based generator is used, so nothing
breaks if the key is absent.

## How classification works

A station qualifies for a heatwave once its maximum passes the base threshold for
its terrain — 40°C plains, 37°C coastal, 30°C hilly. Severity then follows the
departure from that station's own long-period normal:

| Departure from normal | Classification |
|---|---|
| under 3.0°C | Normal |
| 3.0 to 4.4°C | Heat watch |
| 4.5 to 6.4°C | Heatwave |
| 6.5°C and above | Severe heatwave |

An absolute maximum of 45°C triggers a heatwave and 47°C a severe heatwave
regardless of departure.

Apparent temperature uses the Rothfusz regression with the standard low- and
high-humidity adjustments, validated against published NWS values and bounded
outside the domain the regression was fitted on.

The hotspot score is deliberately not a temperature ranking. It combines departure
from local normal, persistence of the spell, night-time minimum above 26°C, and the
humidity contribution — because a city that stays at 30°C overnight after 41°C is
more dangerous than one that cools to 22°C after 44°C.

## Data

Live observations and forecasts come from [Open-Meteo](https://open-meteo.com),
which is free and needs no key. Responses are cached for 15 minutes.

If the upstream call fails, a deterministic modelled series is returned and labelled
`dataSource: "fallback"` so the platform degrades instead of breaking.

To move to IMD GRD files, replace `fetchStation` in `api/_lib/provider.js`. Nothing
downstream changes.

## Scenario mode

Outside the pre-monsoon season there are legitimately no heatwaves, which leaves
every screen empty. Adding `?demo=1` to any page or API call substitutes a modelled
peak-summer event so the warning pipeline can be demonstrated year round. A banner
states it whenever it is active — it is never silent.

## Governance

Matching the use case requirements:

- **Human in the loop.** Severe warnings are flagged `requiresApproval` and held for
  meteorologist review rather than dispatched automatically.
- **Factual grounding.** The LLM prompt supplies only verified figures and forbids
  any others. Output is parsed and shape-checked before display.
- **Graceful degradation.** Every external dependency has a fallback path.
- **Data minimisation.** Subscriber contact details are masked before storage and
  are not retained beyond the session.
- **Transparency.** Every classification returns the exact criterion applied, so the
  output can be checked rather than trusted.

## Known limits

- Station normals are representative values, not the official IMD long-period
  averages for each station.
- The heatwave probability is a logistic function over forecast departure, widened
  by lead time. It is inspectable rather than trained; a gradient-boosting model can
  be dropped in behind the same interface.
- The AWS ground-observation layer from the use case is not yet implemented, so
  forecast validation against local sensors is pending.
- Subscriptions use an in-process store that resets on cold start. Swap for Vercel
  KV or Postgres for production.
