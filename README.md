# Walk Forecast — Campus Schedule Planner

A small local web app. Give it your home location and your class locations/times,
and it tells you when to leave for each class and what the temperature will feel
like on the walk, color-coded from dark blue (cold) to dark red (hot), for the
next 7 days.

No build step, no npm install, no API key. It's three plain files: `index.html`,
`style.css`, `app.js`. Weather comes from the free [Open-Meteo](https://open-meteo.com)
API, called directly from your browser.

## Features

- **Personal preference learning (a real, tiny neural net)**: on the **live
  "This Week" tab only** (not on any climatology/month tab — historical
  averages aren't something you'd want to train your personal taste
  against), every leg has a "⭐ Rate this" button. Click it and rate how
  that *entire weather condition* feels to you, 0 (awful) to 100 (perfect).
  Once you've rated at least 3 conditions, the app trains a small neural
  network from scratch, right in the browser (5 inputs — feels-like temp,
  humidity, wind, chance of rain, rain amount — → 8 hidden tanh units → 1
  sigmoid output, trained via real backpropagation/gradient descent — no
  libraries) and starts showing a "You: X" chip on every live-week leg
  predicting how *you specifically* would rate that exact combination of
  conditions. Using all five factors (not just temperature) matters: the
  model can learn that, say, 80°F feels great when dry but miserable at 90%
  humidity, or that a calm 65°F is great but a 30mph-wind 65°F isn't — a
  temperature-only model can't represent that at all. Since a single random
  initialization of a tiny network can land in a bad local minimum, it
  actually trains 12 independent times from different random starting
  points and keeps whichever fits your ratings best. A summary banner also
  appears once you have enough ratings, showing your learned "ideal"
  feels-like temperature under fair-weather conditions and a one-line read
  on your weather personality (e.g. "🥶 Native polar bear" if you keep
  rating heat badly and cold highly). This is genuinely separate from the
  objective comfort score (which stays NWS-grounded for safety) — think of
  it as a second opinion that's all about *your* taste, not general safety.
  "Clear ratings" wipes this and starts the model over.

- **University proximity check on Home**: setting your home location now
  requires it to be within ~2 miles of a university campus (checked against
  OpenStreetMap's free Overpass API, no key needed). This keeps the app
  scoped to its actual purpose — walking to class — rather than becoming a
  generic "check the climate anywhere" tool. If the check fails, the
  location isn't saved and you'll see why. Editing home and immediately
  clicking Generate (without clicking elsewhere first) is handled
  correctly — it always re-checks whatever is currently in the fields
  rather than reusing a previously-verified location.

- **Feels-like temperature categories**: the colored swatch on each leg now
  shows "feels like" temperature (heat index when hot, wind chill when
  cold) — not the raw forecast number — color-coded across an 11-tier scale
  from Extreme cold (below 0°F) to Extreme (106°F+), with a category label
  under the number (Freezing, Chilly, Comfortable, Hot, etc). If the actual
  raw temperature differs by 3°F or more, it's shown as a small "actual
  X°F" footnote. The color itself is a smooth interpolation across the same
  palette used elsewhere in the app (dark blue → blue → green → yellow →
  red → dark red), just extended to cover the full range.
- **Edit existing classes/stops**: click the ✎ icon next to any class or
  stop to load it back into the form — tweak the name, coordinates, times,
  or days, then hit "Save changes." Especially handy for testing edge cases
  without re-entering everything from scratch (e.g. nudging coordinates to
  see how distance/weather changes, or testing the invalid-distance flag).
  "Cancel" exits edit mode without saving.
- **This Week tab**: live 7-day forecast for your actual schedule, using real
  weather data per location.
- **Jan–Dec tabs**: a "typical week" for that month, built from the last 5
  years of historical weather **for your general area** (based on your home
  location), averaged into a 24-hour climatological profile per month.
  Useful for answering "what will the walk to my 8am feel like in October"
  months before October actually arrives — this is *not* a real forecast,
  it's an average of the past.
  - **You don't need any classes or stops entered to use this** — just set
    your home location and click a month tab; you'll get a simple 4-point
    snapshot of a typical day (morning, midday, afternoon, evening).
  - **If you do have classes/stops**, a toggle appears above the results:
    *"Use class/stop locations & walking distances"* (on by default) shows
    a real walking week with distance/time between each location, same as
    the live forecast. Switch it off to ignore coordinates entirely and
    just see the climate at each class's actual scheduled time, evaluated
    against your home location only — useful if you haven't entered
    accurate building coordinates yet, or just want the time-of-day
    pattern without the walking-distance noise. With the toggle off, there's
    no walk happening, so there's no "departure vs arrival" either — the
    weather shown is always exactly the climate at the scheduled start time,
    full stop, regardless of how long the class/stop lasts.
  - Unlike the live 7-day forecast (which fetches per-building for
    accuracy), climatology uses one shared city-wide profile, since
    campus-distance locations don't have meaningfully different climates —
    and fetching one per building was tripping Open-Meteo's rate limit
    anyway. First click on any month tab triggers one fetch (5 years of
    hourly history); after that, switching between months is instant since
    it's cached until you change your home location, classes, or stops.

## How to run it locally

You need a local web server (not just double-clicking the HTML file) so the
weather fetch works reliably. Pick whichever you have installed:

**Option A — Python (most Macs/Linux have this already)**
```bash
cd campus-walk
python3 -m http.server 8000
```
Then open **http://localhost:8000** in your browser.

**Option B — Node**
```bash
cd campus-walk
npx serve .
```
It'll print a local URL (usually http://localhost:3000) — open that.

To stop the server, go back to the terminal and press `Ctrl+C`.

## How to test it

1. **Set your home location.** Right-click your dorm/apartment on Google Maps,
   click the lat/lon numbers that pop up to copy them, paste into the
   Latitude/Longitude fields. Give it a label like "Jester West".

2. **Add a class.** Same trick for the building's coordinates. Fill in name,
   start/end time, and which days it meets, then click **+ Add class**. Repeat
   for each class.

3. **Add other stops (optional).** Dining hall, gym, library, whatever has a
   fixed arrival/leave time — same fields, different section. These get
   merged into your walking order by time alongside your classes, so a
   12:00–12:30 dining hall stop between two classes shows up exactly where
   it belongs in the day's sequence, with its own walk-time and weather.

4. **Click "Generate 7-day walk forecast."** You should see one card per day
   (only days that actually have a class or stop scheduled), each showing
   the day's **total walking distance** in the header, plus every leg of
   your day (home → class → stop → class → ... → home) with:
   - the time you should leave
   - distance + estimated walk time
   - a color-coded temperature swatch for that moment
   - a **comfort score** (0–100, plus a Great/Good/Fair/Poor/Harsh label) that
     blends temperature (using heat index when it's hot, wind chill when it's
     cold), wind, and chance/amount of precipitation
   - **badges** when conditions are extreme: thunderstorms, heavy rain/snow,
     extreme heat, or extreme cold — plus a practical cold ladder so milder
     cold doesn't slip through unflagged: "Chilly — grab a hoodie" (37–45°F
     feels-like), "Cold — wear a jacket" (32–37°F), "Freezing — serious cold"
     (20–32°F), and "Extreme cold" (below 20°F). These check both your
     departure time *and* arrival time and flag the worse of the two, so a
     storm (or cold front) rolling in mid-walk doesn't get missed.

5. **Try edge cases** to make sure it holds up:
   - Add two classes back-to-back in different buildings — the second leg
     should calculate distance from the *first class*, not home.
   - Set the walking pace very low (e.g. 1 mph) — departure times should get
     earlier.
   - Remove a class with the ✕ button — it should disappear and the next
     forecast run should reflect that.
   - Refresh the page — your home location and classes should still be there
     (saved in your browser's local storage).
   - Enter coordinates for a class that are nowhere near your other
     locations (a different city, or just a typo) — any leg whose walk would
     take over 40 minutes still shows full weather/comfort info (using your
     **home location's climate** as a stand-in, since the real destination
     coordinates are probably a mistake), but gets a separate **⚠ warning**
     telling you the distance looks like a data-entry error and naming which
     two locations to check.
   - Try setting Home to coordinates nowhere near any university (e.g. the
     middle of the ocean, or a random residential address) — it should
     refuse to save and tell you why, instead of silently accepting it.

## Known limitations (this is a first functional pass)

- Distances are **straight-line** (haversine), not actual walking routes —
  real sidewalk distance will usually be a bit longer.
- Weather is now fetched **per unique location** (your home + every distinct
  class building, deduplicated), and each leg uses the origin location's
  forecast for departure and the destination's forecast for arrival — so
  results stay accurate even if your classes are spread across a city (or,
  for testing purposes, different continents).
- The comfort score is a heuristic (50% temperature/feels-like, 30%
  precipitation, 20% wind), but it's capped by the single worst factor —
  e.g. a thunderstorm or extreme temperature will always pull the score down
  to "Poor" or "Harsh," even if the other two factors are mild, so a badge
  and the score can never contradict each other. It's meant to be a quick
  gut-check, not a medical or safety guarantee. Always use real judgment in
  genuinely dangerous conditions.
- "Feels like" is computed per-leg from whichever end of the walk (departure
  or arrival) is more extreme, and the raw temperature shown alongside it is
  always pulled from that *same* snapshot — so you'll never see a physically
  odd pairing like "66°F feels like 86°F" (that combination doesn't exist;
  heat index only applies at 80°F+). Both the **actual temperature** and the
  **feels-like temperature** are always shown side by side as two separately
  color-coded chips — not just when they happen to differ — so it's always
  clear at a glance whether heat index or wind chill is doing anything.
  Relatedly: a leg's time label always shows when you'd *leave*, but if the
  *arrival* end of that walk has worse weather, that's what gets shown
  (since that's the more useful number for deciding what to wear/bring) —
  and now there's an explicit note ("Conditions shown are at arrival, not
  departure") whenever that happens, so a temperature you weren't expecting
  at that departure time doesn't look like an error. Wind also now provides
  a gentle cooling effect across the whole comfortable range (51-79°F) and
  on top of heat index on breezy hot days, not just inside the official
  sub-50°F wind chill range — capped modestly (up to ~10°F) so it stays
  realistic rather than extrapolating into wind-chill-style extremes
  outside its valid range.
- No login/accounts — data is stored only in your browser (`localStorage`),
  per-device.
- Climatology tabs average the last 5 years (not the 30-year WMO standard) —
  a reasonable quick sample, but a genuinely unusual recent year (e.g. one
  major heat wave) will skew that month's average more than a longer window
  would. Climatology also doesn't know about day-of-week — every weekday in
  a given month uses the same typical-day profile, since weather doesn't
  care what day it is, only what month/hour it is.

## Where to go next (if you want to keep building)

- Swap haversine for a real routing API (OSRM) for accurate walk times.
- Geocode addresses instead of requiring manual lat/lon.
- Add a "what to wear" suggestion per leg based on the temperature band.
- Deploy it (e.g. Vercel/Netlify) so you can check it from your phone before
  leaving the dorm.
