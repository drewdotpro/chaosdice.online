# Chaos Dice

A D6 whose faces (A–F) drift into chaos. Every roll shows the landed face's current
value. Then that face gains 1 and its opposite (A↔F, B↔E, C↔D) loses 1.

- Your character name (trimmed, case-insensitive) is the seed. The same name and roll
  count always rebuild the same die, so you can resume on any device.
- Your progress is saved in localStorage (`chaos-dice:v1`).

## Develop

    npm install
    npm run dev      # http://localhost:5173
    npm test         # logic tests
    npm run build    # static site in dist/ (deploy anywhere static)
