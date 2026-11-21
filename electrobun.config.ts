import type {ElectrobunConfig} from 'electrobun';

// Desktop shell (Electrobun 2, built by Hutch). See docs/desktop-shell.md.
export default {
  app: {
    name: 'Motion Canvas Editor',
    identifier: 'dev.motioncanvaseditor.app',
    version: '0.0.1',
  },
  build: {
    mainProcess: 'bun',
    bun: {
      entrypoint: 'shell/main.ts',
    },
    // The web editor is built by Vite (`bun run build`) and shipped unchanged:
    // dist/ becomes views://editor/ inside the app bundle.
    copy: {
      dist: 'views/editor',
    },
    watchIgnore: ['dist/**'],
    // Kept apart from the repo's own artifacts/ (screenshots, e2e output).
    artifactFolder: 'artifacts/desktop',
    // System webview everywhere: WKWebView, WebView2, WebKitGTK.
    mac: {bundleCEF: false},
    linux: {bundleCEF: false},
    win: {bundleCEF: false},
  },
  scripts: {
    // Refuses to package when the web build (dist/) is missing.
    preBuild: './shell/prebuild.ts',
  },
} satisfies ElectrobunConfig;
