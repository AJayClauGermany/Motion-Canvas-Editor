# Third-party notices

The editor's own code is under the licence in [LICENSE](LICENSE). Its
dependencies keep their own licences; `bun.lock` lists them all. Two were
added for exporting and are worth a note, because one of them is not under a
permissive licence.

## Mediabunny (MPL-2.0)

- Package: `mediabunny` 1.65.2, <https://mediabunny.dev>
- Source: <https://github.com/Vanilagy/mediabunny>
- Licence: [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/)
- Used for: writing MP4 and WebM files and driving the browser's video and
  audio encoders (`src/runtime/export.ts`). Loaded only when an export runs.

It is used **unmodified**, as published on npm. The MPL applies file by file:
it covers Mediabunny's own files, and does not extend to the rest of this
project. A build of the editor (`dist/`, the desktop app) contains Mediabunny
in bundled form; its source is available at the address above, which is what
the licence asks distributors to say. If its files are ever changed here,
those changed files have to be published under the MPL as well.

Why not an MIT-licensed library: the MIT alternatives for writing these files
in a browser are `mp4-muxer` and `webm-muxer`, by the same author. Both are
marked deprecated on npm in favour of Mediabunny ("This library is superseded
by Mediabunny. Please migrate to it."), and they cover muxing only. Building
on libraries their author has retired seemed the worse trade. Everything that
touches Mediabunny is in one function (`renderVideo`), so replacing it later
stays a small change.

## gifenc (MIT)

- Package: `gifenc` 1.0.3, <https://github.com/mattdesl/gifenc>
- Used for: GIF export (`src/runtime/export.ts`). Loaded only when a GIF is
  exported.
