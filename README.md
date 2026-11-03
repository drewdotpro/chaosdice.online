# Chaos Dice Online!

**https://chaosdice.online**: a free online D6 for D&D and tabletop RPGs whose faces drift into chaos.

Every face (A–F) starts at 0. Each roll shows the face that lands on top. That face then gains 1
and its opposite (A↔F, B↔E, C↔D) loses 1, so over many rolls the numbers run wild.

- Your character name (trimmed, case-insensitive) is the seed. The same name and roll count always
  rebuild the same die, so you can resume on any device.
- Your progress is saved in localStorage (`chaos-dice:v1`).

## Develop

    npm install
    npm run dev      # http://localhost:5173
    npm test         # logic tests
    npm run build    # static site in dist/

## Deploy

The site is fully static and is hosted on Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`

`public/_headers` sets the caching and security headers.

## Social and app images

`design/og-image.html` and `design/icon.html` are the sources for `public/og-image.png` and the
app icons. To regenerate them, open each page on the dev server and screenshot it at its native
size (1200×630 for the share image, `?size=N` for icons).

## Licence

The code is released under the [MIT License](LICENSE).

- Fonts (Cinzel, Marcellus and EB Garamond) are self-hosted through Fontsource under the SIL Open
  Font License.
- Three.js is MIT-licensed.
- The sound effects in `src/assets/` come from Pixabay and are used under the Pixabay Content
  License, not MIT. They may not be redistributed on their own. See
  [`src/assets/SOUNDS.md`](src/assets/SOUNDS.md) for sources and credits.
