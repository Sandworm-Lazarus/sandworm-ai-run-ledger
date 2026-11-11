# Third-party notices

The application code is covered by the repository's MIT license. The bundled
fonts retain their own SIL Open Font License, Version 1.1, and copyright notices.

## Self-hosted fonts

These unmodified WOFF2 files match the public-facing fonts used at
[sandworm-lazarus.pages.dev](https://sandworm-lazarus.pages.dev/). They are embedded in the local stylesheet as WOFF2 data URLs; no font service or external font request is required.

| Typeface | Bundled weights and subsets | Copyright | License |
| --- | --- | --- | --- |
| Chakra Petch | 700; Thai and Latin | Copyright 2018 The Chakra Petch Project Authors | [SIL OFL 1.1](dist/fonts/Chakra-Petch-OFL.txt) |
| Anuphan | 400 and 600; Thai and Latin | Copyright 2019 The Anuphan Project Authors | [SIL OFL 1.1](dist/fonts/Anuphan-OFL.txt) |
| JetBrains Mono | 400; Latin | Copyright 2020 The JetBrains Mono Project Authors | [SIL OFL 1.1](dist/fonts/JetBrains-Mono-OFL.txt) |

The complete notices are distributed in `dist/fonts/` so a standalone static-site bundle includes the applicable licenses.

License sources:

- [Chakra Petch in Google Fonts](https://github.com/google/fonts/blob/main/ofl/chakrapetch/OFL.txt)
- [Anuphan in Google Fonts](https://github.com/google/fonts/blob/main/ofl/anuphan/OFL.txt)
- [JetBrains Mono in Google Fonts](https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt)

Font files have not been renamed at the typeface level or modified. The theme
implementation is original application code; it uses the reference's color and
typography choices without importing its site scripts or imagery.
