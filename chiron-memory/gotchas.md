# gotcha

A non-obvious pitfall or trap, learned the hard way.

## Wait for Postgres over TCP, not the unix socket, on first container start

What: dev-up.sh probes with `pg_isready -h 127.0.0.1` inside the container · Why: on first init the postgres image runs a temporary server that listens only on the unix socket and then restarts, so a socket probe reports "ready" too early and migrations hit a restarting server · Where: scripts/dev-up.sh, docker-compose.yml healthcheck

## Docker commands can hang forever when the daemon is wedged

What: dev-up.sh wraps `docker compose up` and each readiness probe in a portable bash watchdog (`with_timeout`), with the watchdog disowned to avoid "Terminated" noise · Why: with Docker Desktop hung, `docker compose up -d` never returns, so a timeout only on the wait loop would not fire; macOS has no `timeout` binary by default · Where: scripts/dev-up.sh · Learned: any "fail within N seconds" guarantee must cover every external call, not just the polling loop
