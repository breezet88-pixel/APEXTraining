# Apex Training

A **free** workout app. The heart of it is the **Workout Library**: every class the coach has run, with its date, club, start time and the YouTube playlist that was played, so members who loved a class can redo it in their own time. Members can **download any workout** or save it for offline use, run the **class timer** the coach used, look up exercises in the **exercise library** (or search Google for anything not in it), and comment. There is no daily workout: classes are added after they are run, sometimes two or three on one day. Every workout is created by the coach. Only the coach can add, change or remove anything.

It runs entirely on **GitHub**, free, with no server to look after:

| Part | Where it lives |
|---|---|
| Website (member app + coach page) | **GitHub Pages**, published from the `site/` folder |
| Workout Library (the coach's classes), class schedule (weekly timetable, ad hoc classes, class type descriptions), exercise library (88 exercises), donation settings | files in `site/data/` in this repository |
| Exercise pictures | files in `site/images/` in this repository |
| Comments & reviews | this repository's **GitHub Discussions**, shown with [giscus](https://giscus.app): a members' **Comments** page for general feedback, plus comments under each workout |

| Who | Can |
|---|---|
| **Anyone** | view workouts, download or save any workout for offline use, run the class timer, read comments, donate (optional). No account needed. |
| **Members with a free GitHub account** | everything above, plus post comments and reactions |
| **The coach** | add, edit and remove everything, from the coach page (`/admin.html`). Saving writes to this repository with the coach's own GitHub key, so GitHub itself guarantees only the coach can change content. |

Free to use for everyone; donations are voluntary and unlock nothing. GitHub's Pages terms allow donation buttons. GitHub Pages has no visitor limit, only a soft 100 GB/month bandwidth guideline (roughly 100,000 workout views a month with pictures).

## One-time setup

1. **Publish the site**: repository *Settings* → *Pages* → *Build and deployment* → Source: **GitHub Actions**. Then *Actions* → *Check and publish* → *Run workflow* (or push any change). The site appears at **https://breezet88-pixel.github.io/APEXTraining/**.
2. **Coach key**: open `…/APEXTraining/admin.html` and follow the steps on screen to create a *fine-grained personal access token* for this repository only (Contents: Read and write; Discussions: Read). Paste it to sign in.
3. **Comments** (optional): coach page → *Comments* tab: switch on Discussions, add a "Workout comments" category, install the giscus app, tap *Find my settings*, save.
4. **Donations** (optional): coach page → *Donations* tab. See [docs/donations.md](docs/donations.md) for South African payment links.

## Everyday use

- **Exercise library**: coach page → *Exercise library*. It holds your 88 HIIT and functional exercises (kettlebell, dumbbell, light barbell, Skillmill, SkiErg, mat and bodyweight) with their movement descriptions, image cues, equipment safety notes and sources. Each one has a **✨ Create image prompt** button built from its image cue ([docs/image-prompts.md](docs/image-prompts.md)); upload the picture **once** there and every workout using that exercise shows it. The list shows how many pictures are still missing.
- **Class schedule**: coach page → *Class schedule*. Your weekly timetable (day, time, class type, club), **ad hoc classes** (date, time, class type, club) and a **short description of each class type** (Grid, Lift Club, Hyrox…), which members see on every workout of that type. It started from the timetable in your income and spending app; change it here any time.
- **Add a class to the Workout Library**: coach page → *Workout Library*. *Your classes* lists today's and yesterday's classes from the schedule: tap **+ Add workout** on one, or *New workout* (which picks the latest class that has no workout yet). The date, time, club, class type and name are **filled in from your schedule**; pick another class with the buttons under *Which class?*.
  1. **⏱ Class timer** (set it first): Intervals (work / rest / rounds, optional longer rest between rounds, circuit or station by station), Tabata, EMOM, AMRAP or For time, plus optional notes and a screenshot of your timer app. Members get a timer that runs it, calling out each exercise, with beeps.
  2. **🎤 Talk it through, or paste your notes**: tap *Start talking* (Chrome, Edge, Safari), type, paste notes, or **upload a text file** from your notes app. Notes work best one exercise per line, e.g. `Timer: 40/20 x 4`, `10 kettlebell swings`, `12 goblet squats`. For handwritten notes or a screenshot, use your phone's "copy text from photo" (Google Lens, or Live Text on iPhone) and paste. Tap **Draft my workout**: exercises are matched to your library with sets, reps, time and rest, timers like "40 on 20 off", "20 minute AMRAP" or "Tabata" are picked up, and it only asks about what it couldn't work out.
  3. **📷 Pictures & screenshots**: add as many as you need (up to 20 per workout, choose several at once): whiteboard, timer, notes, the class. Add captions and put them in order. Big photos are made smaller automatically.
  4. Check and edit everything, add the **YouTube playlist** link(s) you played, then *Save*. You can also build or change a workout by hand: *Add from library*, or *Exercise not in the library* (members get a Google link for those). The drafting runs on the phone or computer itself: no account and no cost.
- Changes reach members **about a minute** after saving, once GitHub Pages has republished.
- **Moderating comments**: on GitHub → *Discussions*: delete, hide, lock or block.
- **Installing on phones**: members open the site and tap *Install app* (Android, Windows, Mac, Chromebook) or Safari → Share → *Add to Home Screen* (iPhone/iPad).

## Good to know

- The repository must be **public** for free GitHub Pages and comments, so everything in it is public, including workouts marked *hidden* (they are just not shown in the app) and your class schedule.
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
  js/            app.js, admin.js, github.js (saving), validate.js (data rules), draft.js (talk/notes → workout),
                 classes.js (class schedule), timer.js (class timer), download.js, config.js
  data/          exercises.json (library), workouts.json, classes.json (class schedule), settings.json
  images/        exercise pictures
tests/           automated tests     tools/       local preview server, data check
docs/            image prompts, donations
```
