# Apex Training

A **free** workout app. Members view workouts and the exercise library, comment on workouts and download the **workout of the day**. Only the coach can add, change or remove anything.

It runs entirely on **GitHub**, free, with no server to look after:

| Part | Where it lives |
|---|---|
| Website (member app + coach page) | **GitHub Pages**, published from the `site/` folder |
| Exercise library (50 exercises), workouts, workout-of-the-day schedule, donation settings | files in `site/data/` in this repository |
| Exercise pictures | files in `site/images/` in this repository |
| Comments & reviews | this repository's **GitHub Discussions**, shown under each workout with [giscus](https://giscus.app) |

| Who | Can |
|---|---|
| **Anyone** | view workouts, read comments, download or save today's workout of the day, donate (optional). No account needed. |
| **Members with a free GitHub account** | everything above, plus post comments and reactions |
| **The coach** | add, edit and remove everything, from the coach page (`/admin.html`). Saving writes to this repository with the coach's own GitHub key, so GitHub itself guarantees only the coach can change content. |

Free to use for everyone; donations are voluntary and unlock nothing. GitHub's Pages terms allow donation buttons. GitHub Pages has no visitor limit, only a soft 100 GB/month bandwidth guideline (roughly 100,000 workout views a month with pictures).

## One-time setup

1. **Publish the site**: repository *Settings* → *Pages* → *Build and deployment* → Source: **GitHub Actions**. Then *Actions* → *Check and publish* → *Run workflow* (or push any change). The site appears at **https://breezet88-pixel.github.io/APEXTraining/**.
2. **Coach key**: open `…/APEXTraining/admin.html` and follow the steps on screen to create a *fine-grained personal access token* for this repository only (Contents: Read and write; Discussions: Read). Paste it to sign in.
3. **Comments** (optional): coach page → *Comments* tab: switch on Discussions, add a "Workout comments" category, install the giscus app, tap *Find my settings*, save.
4. **Donations** (optional): coach page → *Donations* tab. See [docs/donations.md](docs/donations.md) for South African payment links.

## Everyday use

- **Exercise library**: coach page → *Exercise library*. It holds your 50 HIIT and functional exercises (kettlebell, dumbbell, light barbell, Skillmill, SkiErg, mat and bodyweight) with their movement descriptions, image cues, equipment safety notes and sources. Each one has a **✨ Create image prompt** button built from its image cue ([docs/image-prompts.md](docs/image-prompts.md)); upload the picture **once** there and every workout using that exercise shows it. The list shows how many pictures are still missing.
- **Add or change a workout**: coach page → *Workouts* → pick exercises with *Add from library*, then set sets, reps, rest and optional notes. *One-off exercise* is there for anything not in the library. *Save* publishes to the repository.
- **Workout of the day**: *Make today's workout* on a workout, or schedule days ahead on the *Workout of the day* tab. "Today" follows South African time (change `timezone` in `site/js/config.js`).
- Changes reach members **about a minute** after saving, once GitHub Pages has republished.
- **Moderating comments**: on GitHub → *Discussions*: delete, hide, lock or block.
- **Installing on phones**: members open the site and tap *Install app* (Android, Windows, Mac, Chromebook) or Safari → Share → *Add to Home Screen* (iPhone/iPad).

## Good to know

- The repository must be **public** for free GitHub Pages and comments, so everything in it is public, including workouts marked *hidden* (they are just not shown in the app) and the schedule.
- Pictures: PNG, JPG, WebP or GIF up to 5 MB each; around 300 KB each keeps the site fast.
- Every save is a normal commit, so the full history is kept and any mistake can be undone on GitHub.
- The coach key lives only in your browser. Use *Sign out* on shared devices; if a key is ever exposed, delete it on GitHub (Settings → Developer settings → Personal access tokens).
- **Privacy (POPIA)**: the app itself collects no personal data. Comments are posted with the commenter's own GitHub account under GitHub's privacy terms.

## For developers

No dependencies and no build step: plain HTML, CSS and JavaScript modules.

```
npm start        # preview at http://localhost:8080/ (coach page: /admin.html)
npm test         # data rules, GitHub save logic (against a GitHub stand-in), download, site checks
npm run check    # validates site/data/*.json and pictures, as the publish workflow does
```

```
site/            the published website
  index.html     member app          admin.html   coach page
  js/            app.js, admin.js, github.js (saving), validate.js (data rules), download.js, config.js
  data/          exercises.json (library), workouts.json, schedule.json, settings.json
  images/        exercise pictures
tests/           automated tests     tools/       local preview server, data check
docs/            image prompts, donations
```
