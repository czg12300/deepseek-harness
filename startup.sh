#!/usr/bin/env bash
# Prepare this source checkout, then let the dsh Web profile own readiness and shutdown.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

fail() {
  printf '\n[startup] %s\n' "$*" >&2
  exit 1
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  cat <<'HELP'
Usage: ./startup.sh [Web options]

Check prerequisites, install dependencies, build, and start the Web UI.
Requires Node.js 22.19+ (22.x) or 24+, Python 3, make, and a C/C++ compiler.
Missing pnpm is downloaded through Corepack or npx using package.json's version.

  ./startup.sh                  Start on the default port (3080) and open the browser
  ./startup.sh --port 8080      Use another port (0 selects a free port)
  ./startup.sh --no-open        Print the URL without opening the browser

Keep this terminal open; press Ctrl+C to stop the server.
Data and profiles default to this checkout's .dsh-local/ directory.
Set DSH_HOME explicitly to use a different data directory.
HELP
  exit 0
fi

export DSH_HOME="${DSH_HOME:-$PWD/.dsh-local}"
printf '[startup] Source checkout: %s\n[startup] Data and profiles: %s\n' "$PWD" "$DSH_HOME"

printf '[startup] Checking prerequisites...\n'
command -v node >/dev/null 2>&1 || fail 'Node.js is missing. Install Node.js 22.19+ (22.x) or 24+, then rerun ./startup.sh.'
node --input-type=module <<'NODE'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const [major, minor] = process.versions.node.split('.').map(Number)
if (!((major === 22 && minor >= 19) || major >= 24)) {
  console.error(`[startup] Node.js ${process.versions.node} is unsupported; install ${manifest.engines.node}.`)
  process.exit(1)
}
if (process.platform !== 'darwin' && process.platform !== 'linux') {
  console.error('[startup] Use macOS or Linux (including WSL) for this Bash launcher.')
  process.exit(1)
}
const headers = resolve(dirname(process.execPath), '../include/node/node_api.h')
if (!existsSync(headers)) {
  console.error(`[startup] Node development headers are missing: ${headers}. Install Node.js with its development headers.`)
  process.exit(1)
}
NODE

for dependency in python3 make cc c++; do
  command -v "$dependency" >/dev/null 2>&1 || fail "Missing $dependency. On macOS run xcode-select --install; on Debian/Ubuntu install build-essential and python3."
done
cc --version >/dev/null 2>&1 || fail 'The C compiler cannot run. Finish installing the system developer tools.'
if node -e 'process.exit(process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime ? 0 : 1)'; then
  command -v musl-gcc >/dev/null 2>&1 || fail 'musl-gcc is required by the native build on musl Linux. Install the musl development tools.'
fi

package_manager=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager')
pnpm_version=${package_manager#pnpm@}
if command -v pnpm >/dev/null 2>&1 && [[ "$(pnpm --version)" == "$pnpm_version" ]]; then
  pnpm_command=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  pnpm_command=(corepack "$package_manager")
elif command -v npx >/dev/null 2>&1; then
  pnpm_command=(npx --yes "$package_manager")
else
  fail "Install npm or Corepack so $package_manager can be downloaded, then rerun ./startup.sh."
fi

printf '[startup] Checking and installing dependencies with %s...\n' "$package_manager"
"${pnpm_command[@]}" install --frozen-lockfile

printf '\n[startup] Building native modules, packages, and the Web UI...\n'
"${pnpm_command[@]}" run build

printf '\n[startup] Starting Web UI. Open the complete URL printed when ready; Ctrl+C stops the server.\n'
exec "${pnpm_command[@]}" dsh --profile web "$@"
