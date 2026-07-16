// Build the execFileSync (command, argv) pair for running `npx <args>`.
//
// Windows: execFileSync/spawnSync cannot execute the npx.cmd batch file directly
// (spawnSync npx.cmd EINVAL) — a .cmd must be run through the command interpreter.
// `cmd.exe /d /s /c npx …` disables AutoRun (/d), keeps cmd's quote handling
// predictable (/s), and runs the command (/c). Other platforms exec npx directly.
//
// Pure and side-effect free so the argv construction is unit-testable without
// running the backfill script (which exits on a missing CLERK_SECRET_KEY).
export function wranglerInvocation(npxArgs, platform = process.platform) {
  if (platform === 'win32') {
    return { command: 'cmd.exe', argv: ['/d', '/s', '/c', 'npx', ...npxArgs] };
  }
  return { command: 'npx', argv: npxArgs };
}
