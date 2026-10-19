### Added
- `services.yaml` can map a container to a different Uptime Kuma monitor on
  each machine, with `monitor_per_node:` under its entry (keyed by the node
  keys under `nodes:`), and `monitor: false` gives a container no monitor at
  all. `monitor_per_node` wins over `monitor` on its node. JagHelm logs one
  warning for a `monitor_per_node` key that is no node.
### Changed
- Each Uptime Kuma monitor now marks one container, the best match by name,
  instead of every container whose name resembles it. "Gitea" goes to `gitea`
  and no longer to `gitea-runner` too; "Immich" goes to `immich-server` and no
  longer to its Redis, Postgres and machine-learning containers; a container
  running on two machines gets the monitor on the first machine in the board's
  order. The containers that lose a monitor show their Docker status and the
  "unmonitored" label. To have a monitor mark several containers, map each of
  them to it; to keep it on one machine's copy, use `monitor_per_node`.
- A monitor named in a mapping now goes only to the containers mapped to it,
  also while they are stopped or gone, and a container mapped to a monitor that
  Kuma does not have (renamed, deleted or paused) shows no monitor, instead of
  taking whichever monitor its name resembled. JagHelm logs one warning per
  such mapping after it starts.
- A stopped container keeps its monitor only while the monitor is down. Once
  the monitor is up, a running container can have it, and the stopped one
  leaves a grey "last seen" card, as a stopped container with no monitor of its
  own does.
### Fixed
- One Kuma monitor going down no longer paints every container that shares a
  word with it red, on every machine, with a push notification for each. It
  marks one card and sends one notification.
- When a monitored container stops and its monitor goes down, the red card is
  the stopped container's, and no longer a running container with a similar
  name.
- Monitors that share a word with another monitor are matched to their own
  containers; they used to be left unmatched.
- The containers of Gitea Actions jobs (`GITEA-ACTIONS-TASK-…`) no longer show
  on the board while a job runs, take a monitor, or leave a grey "last seen"
  card after it, which turned the global status to degraded.
- JagHelm no longer rewrites `service-registry.json` on cycles where the
  matching has not changed but the containers were listed in a different
  order.
