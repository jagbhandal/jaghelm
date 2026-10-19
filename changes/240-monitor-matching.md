### Changed
- Each Uptime Kuma monitor now marks one container, the best match by name,
  instead of every container whose name resembles it. "Gitea" goes to `gitea`
  and no longer to `gitea-runner` too; "Immich" goes to `immich-server` and no
  longer to its Redis, Postgres and machine-learning containers; a container
  running on two machines gets the monitor on one of them. The containers that
  lose a monitor show their Docker status. To have a monitor mark several
  containers, map each of them to it in Settings > Services. A mapping is by
  container name, so it applies on every machine the container runs on.
- A container mapped to a monitor that Kuma does not have (renamed or deleted)
  now shows no monitor, instead of taking whichever monitor its name
  resembled. JagHelm logs one warning per such mapping after it starts.
- A container with no monitor of its own that stops now leaves a grey "last
  seen" card, even when a monitor with a similar name belongs to another
  container.
### Fixed
- One Kuma monitor going down no longer paints every container that shares a
  word with it red, on every machine, with a push notification for each. It
  marks one card and sends one notification.
- When a monitored container stops and its monitor goes down, the red card is
  the stopped container's, and no longer a running container with a similar
  name.
- Monitors that share a word with another monitor are matched to their own
  containers; they used to be left unmatched.
- JagHelm no longer rewrites `service-registry.json` on cycles where the
  matching has not changed but the containers were listed in a different
  order.
