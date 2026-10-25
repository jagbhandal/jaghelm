# JagHelm's data folder: "permission denied" and how to fix it

JagHelm keeps its settings, stored credentials and caches in a **data folder**
(`/app/data` in the container) and uploaded images in an **uploads folder**
(`/app/uploads`). Inside the container JagHelm runs as an ordinary user,
**uid 1000, gid 1000**, not root. It can only write to a folder that user owns.

## What you see

If a folder is missing, is a file, or isn't writable, JagHelm stops at start-up
with one message and exit code 1 (the container restarts or shows `Exited (1)`):

```text
JagHelm cannot start: a folder it needs to write to is not usable.

  data folder /app/data is not writable by the user JagHelm runs as.

JagHelm runs as uid 1000, gid 1000.
...
```

Read it with `docker logs jaghelm`. The message names the folder, who JagHelm
runs as and the fix.

## Why it happens

With the usual `compose.yaml` the folders are **bind mounts** (`./data`,
`./uploads` next to the file). If they don't exist when you first run
`docker compose up`, Docker creates them owned by **root**, and uid 1000 can't
write to a root-owned folder. The same happens when you copy the folders from
another machine or user.

## Fix 1: keep the bind mounts (Linux)

Run this on the host, in the folder with `compose.yaml`, then start again:

```bash
mkdir -p ./data ./uploads && sudo chown 1000:1000 ./data ./uploads
docker compose up -d
```

The numbers are the uid and gid inside the container, not your login's, so
they stay `1000:1000` whoever you are on the host. On Docker Desktop
(Windows, macOS) the folder is shared differently: `chown` doesn't apply, so use
Fix 2.

## Fix 2: let Docker manage the storage (named volumes)

Best for a first install. Docker makes the volumes from the image, which owns
`/app/data` and `/app/uploads` as uid 1000, so there is nothing to chown. Use
[`examples/compose.named-volume.yaml`](examples/compose.named-volume.yaml), or
change the two mounts in your `compose.yaml` and declare the volumes:

```yaml
    volumes:
      - jaghelm-data:/app/data
      - jaghelm-uploads:/app/uploads
# ...
volumes:
  jaghelm-data:
  jaghelm-uploads:
```

A named volume starts empty. To keep settings you already have in `./data`,
use Fix 1 instead, or copy them in first.

## Running without Docker

The message then asks you to make the folder writable by the user running
`node server/index.js`, or to point `JAGHELM_DATA_DIR` at a folder you can write to.
