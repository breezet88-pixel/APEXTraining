# Making exercise pictures

The coach page has a **✨ Create image prompt** button on every exercise in the **Exercise library** (and on one-off exercises inside a workout). It builds a prompt from the exercise name, muscles, equipment and form cues, plus one shared "image style" paragraph (editable under *Image style used in every prompt*). Copy it into your image tool, download the result, then upload it on the same exercise card.

## Which image tool

No AI tool is perfect at exercise form, so pick for **consistency** and **instruction-following**, not just beauty. These are the three I would shortlist; rankings change quickly, so run the same 3 exercises through each before committing.

| Tool | Why | Watch out for |
|---|---|---|
| **Google Gemini image model ("Nano Banana")** | Strong at following long, specific prompts and at *editing an existing image*, which is how you keep the same athlete across 100 exercises. | Check hands and feet on every image. |
| **OpenAI image generation (ChatGPT / GPT Image)** | Good at clean illustration styles and at placing no text in the image. Easy to iterate in conversation ("same character, now doing a lunge"). | Same: check limbs and joint angles. |
| **Adobe Firefly** | Trained on licensed content and sold with commercial-use terms, the safest choice if you will sell the app. | Less precise with body positions than the other two. |

Midjourney makes the prettiest pictures, but it is weakest at keeping one character identical and at obeying anatomy instructions, so I would not start there.

**Check the licence/terms of whichever tool you choose for commercial use** before you publish.

## A workflow that keeps the set consistent

1. Generate **one** "hero" image: the athlete standing neutrally, in your chosen style. Keep it.
2. For each exercise, upload the hero image to the tool as a reference and paste the prompt from the coach page, adding: *"Use the attached image as the character and style reference."*
3. Generate 3 to 4 options and pick the one with correct form.
4. **Check every image like a coach would:** neutral spine, knees tracking over toes, correct grip, two arms, two legs, five fingers, and arrows pointing the right way. A wrong-looking picture teaches wrong form, so reject it and regenerate.
5. Upload as PNG, JPG or WebP (under 5 MB). 1200 px wide is plenty.

## The prompt

The prompt is built from **your own exercise library**: each exercise's *image cue* (what the picture should show) and *movement* description, plus your picture rules:

> Show the same adult athlete in two separate panels: starting position and main movement or finishing position. Use additional panels for exercises with several stages. Keep the entire body and equipment visible, with small arrows indicating movement.

Then a quality line (correct anatomy, no text or watermark) and the **picture style** paragraph, which you can change on the coach page (*Picture style used in every prompt*). Default style:

```
Clean flat vector illustration in a consistent style: the same adult athlete in every picture, plain
face, dark grey fitted sportswear, solid white background, soft ground shadow. Small teal (#0f766e)
arrows show the direction of movement. Same character, same line weight and same colours across the
whole series. Landscape 4:3.
```

For exercises with several stages (the halo, burpees, the thruster), your image cue already asks for three or four panels; the prompt passes that on.

## Alternative: real photos or video

If you can film yourself, real photos beat AI pictures on accuracy. Upload them the same way (GIFs also work).
