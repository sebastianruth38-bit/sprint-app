# Sprint Lab

A single-page web app for tracking sprint training. No build step, no server, no account — everything is saved locally in your browser (localStorage + IndexedDB), so it's private and works offline once loaded.

## Run it

Just open `index.html` in a browser. For the camera-recording feature specifically, browsers require a secure context, so serve it locally instead of using `file://`:

```
cd sprint-training-app
python3 -m http.server 8000
# then visit http://localhost:8000
```

Uploading a video file (instead of recording) works fine from `file://` too.

## Sections

- **Form Diagnosis** — record/upload a clip, log what you're diagnosing (shin angle, arm drive, knee drive, etc.), keep a history.
- **Workouts** — assign a sprint session type (speed endurance, tempo, max velocity, etc.) to each day of the week.
- **Weight Room** — a default list of sprint-complementary lifts/plyos with YouTube "how-to" search links, weekly checkboxes, and room to add your own exercises.
- **Times & Goals** — log times per distance, set a big goal, and break it into small goals you check off.
- **Motivation** — a quote generator, links to watch elite sprinters, and a place to save your own favorite videos.

## Data

All data lives in your browser's local storage for that specific origin/profile. It does not sync between devices or browsers. Clearing site data/history will erase it — there's no export feature yet.
