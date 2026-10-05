/**
 * pm2 process file for the CodeCraft NestJS backend on the 1 GB EC2 box.
 *
 *   cd /home/ubuntu/CodeCraft/backend && npm ci && npm run build
 *   pm2 start /home/ubuntu/CodeCraft/deploy/pm2/ecosystem.config.cjs
 *   pm2 save                     # and `pm2 startup` once, to survive reboots
 *
 * One-time prerequisites (as root):
 *   - /etc/codecraft/backend.env  holds ALL secrets (DATABASE_URL, REDIS_URL,
 *     JWT_SECRET, GOOGLE_*, ...). It lives outside the repo and is never inlined
 *     below. It must be readable by the account that runs pm2 and nobody else:
 *     owned by that account with mode 0600, or root:<its group> with mode 0640.
 *     "root-owned 0600" only works if pm2 itself runs as root; for a pm2 started
 *     as `ubuntu` Node cannot open the file and refuses to start.
 *     Plain KEY=VALUE lines; Node's --env-file reads it at every (re)start.
 *   - install -d -o ubuntu -g ubuntu -m 0750 /var/log/codecraft   (log directory)
 *   - pm2 never rotates logs: run `pm2 install pm2-logrotate` (or add a
 *     logrotate rule with copytruncate), or the disk fills up over time.
 *   - Keep no backend/.env next to the code: main.ts also loads that with dotenv
 *     and it would silently fill any gap in the file above.
 *   - Node >= 20.6 (--env-file); deploy/RUNBOOK.md installs Node 22 (LTS).
 *
 * The values below are sized for 1 GB RAM + 1 GB swap shared with Nginx and the
 * Piston container (which may take up to 640 MB, see deploy/piston).
 */
module.exports = {
  apps: [
    {
      name: 'codecraft-backend',

      // Relative `script` is resolved against `cwd`.
      cwd: '/home/ubuntu/CodeCraft/backend',
      // `nest build` mirrors the project layout, so the entry point is
      // dist/src/main.js. (`npm run start:prod` says dist/main, which does not exist.)
      script: 'dist/src/main.js',

      // ONE process in fork mode. Cluster mode would run several copies of the
      // Node heap on a 1 GB box, and the Socket.IO gateways keep per-process
      // state in memory (for example the contest forfeit timers), which a second
      // instance would split in two.
      exec_mode: 'fork',
      instances: 1,

      node_args: [
        // Secrets come from this file outside the repo, never from the repo. Node
        // itself reads it (--env-file needs Node 20.6 or newer) at every start.
        '--env-file=/etc/codecraft/backend.env',
        // Cap V8's old-generation heap. The default limit scales with system
        // RAM and would let a leak grow into swap and slow the whole machine
        // (Piston and Nginx included) before anything restarts. With a hard
        // cap a leak ends in a quick, visible restart at a known size.
        '--max-old-space-size=256',
      ],

      // Restart gracefully when resident memory passes 350 MB. A full 256 MB
      // heap plus Node's native memory (buffers, compiled code, the database
      // driver) comes to roughly this much, so pm2 normally gets there first and
      // restarts the app cleanly (SIGINT plus kill_timeout) instead of the
      // process dying mid-request with a V8 out-of-memory abort. pm2 only checks
      // about every 30 s, so a very fast leak can still hit the V8 cap first;
      // autorestart covers that case too.
      max_memory_restart: '350M',
      autorestart: true,

      // Crash-loop control (behaviour checked against pm2 7.0.4):
      //  - A start that dies within min_uptime counts as "unstable". After
      //    max_restarts unstable starts in a row pm2 stops restarting the app
      //    instead of looping forever. That is the deploy-time case: a bad
      //    setting makes main.ts exit(1) at once, and an endless loop would
      //    hammer Supabase and Redis Cloud with reconnects and burn the
      //    burstable CPU's credits.
      //  - Unstable starts are only counted for min_uptime x max_restarts (here
      //    300 s) after a start, restart or reload. A loop that begins later,
      //    for example a database outage after days of uptime, is NOT stopped;
      //    there only restart_delay limits the damage.
      //  - restart_delay keeps attempts at least 5 s apart, so a brief outage of
      //    the database or Redis can heal between them.
      //  - Quirk: with restart_delay set, an app pm2 has given up on still shows
      //    as "waiting restart" instead of "errored". The tell-tale is a restart
      //    counter that stops growing and the line "had too many unstable
      //    restarts" in the pm2 daemon log (~/.pm2/pm2.log).
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,

      // On stop/restart pm2 sends SIGINT and, after this many ms, SIGKILL. The
      // app uses enableShutdownHooks(): it stops accepting connections, lets
      // in-flight requests finish and closes Prisma, Redis and the job queue.
      // pm2's default of 1.6 s is too short for that, so a deploy could cut a
      // judged submission in half.
      kill_timeout: 8000,

      // Prefix every log line with a timestamp.
      time: true,
      out_file: '/var/log/codecraft/backend.out.log',
      error_file: '/var/log/codecraft/backend.err.log',
      // Without this pm2 appends the instance id to the names ("backend.out-0.log"),
      // which would not match the paths above or a logrotate rule written for them.
      merge_logs: true,

      // Non-secret settings only. (listenHost() defaults to 127.0.0.1, so the
      // port is reachable only through Nginx.)
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
