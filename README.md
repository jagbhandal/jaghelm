<p align="center">
  <img src="public/logo-login.svg" height="120" alt="JagHelm">
</p>
<h1 align="center">JagHelm</h1>
<p align="center">
  <b>Live data, not just links.</b><br>
  A self-hosted dashboard for your home server. It shows what is wrong first, then CPU, memory, disk, containers, UPS and 35+ apps.
</p>
<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-26-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
</p>
<p align="center">
  <img src="docs/images/dashboard.jpg" alt="JagHelm's Overview on demo data: a service down and a failed backup first, then the nodes and the UPS">
</p>

JagHelm reads real numbers from [Prometheus](https://prometheus.io) (a program that collects and stores them) and shows them on one page, worst problems first. It is for one person running their own server, not a team. It does not collect anything itself.

## Try the demo

The demo is a made-up home server with fake data. It needs only Docker and changes nothing on your computer.

```bash
docker run --rm -e DEMO_MODE=true -p 3099:3099 ghcr.io/jagbhandal/jaghelm:1.0.0
```

The first run downloads the image, about a minute. Then open <http://localhost:3099>. You should see a board that says **Critical**, with one service down and one failed backup. Press `Ctrl+C` in the terminal to stop it.

Port 3099 already taken? Use `-p 8080:3099` and open <http://localhost:8080>. Add `-e DEMO_SCENARIO=healthy` for the same board with nothing wrong. More in [docs/DEMO.md](docs/DEMO.md).

## What you need

**To try it:** Docker on Linux, macOS or Windows (Docker Desktop is fine).

**To run it on your own server (the steps below):**

- **A Linux machine that stays on:** a mini PC, an old laptop, a Raspberry Pi or a virtual machine. On Windows or macOS, stop at the demo: the monitoring programs would report Docker's hidden virtual machine, not your computer.
- **Docker with Compose**, and a terminal on that machine. Check both; each must print a version:

  ```bash
  docker --version
  docker compose version
  ```
- **Prometheus plus two small helpers.** `node_exporter` reports the machine's CPU, memory, disk and temperature. `cAdvisor` reports each container's use. The steps below install all three for you. Already run Prometheus? See [Use your own Prometheus](docs/CONFIGURATION.md#use-your-own-prometheus).

**Optional, add later:** Uptime Kuma (up/down checks), a UPS with NUT, and app integrations such as AdGuard or Sonarr.

## Install in 5 steps

Run these in a terminal on the Linux machine.

**1. Get the files and make the two folders JagHelm writes to.** You should end up in a new `jaghelm` folder holding `compose.yaml` and `prometheus.yml`. Linux may ask for your password. <!-- update after #697 -->

```bash
mkdir -p jaghelm/data jaghelm/uploads && cd jaghelm
curl -fsSLO https://raw.githubusercontent.com/jagbhandal/jaghelm/main/docs/examples/quickstart/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/jagbhandal/jaghelm/main/docs/examples/quickstart/prometheus.yml
sudo chown 1000:1000 data uploads
```

**2. Make your settings file.** This writes `.env` with a random secret (the key that locks the passwords you store later) and a random sign-in password. Run it once: running it again makes new ones.

```bash
echo "PROMETHEUS_URL=http://prometheus:9090" > .env
echo "DASH_SECRET=$(openssl rand -hex 32)" >> .env
echo "DASH_USER=admin" >> .env
echo "DASH_PASS=$(openssl rand -hex 12)" >> .env
```

No `openssl`? In the block above, use this in place of `openssl rand -hex 32` (and of `openssl rand -hex 12`):

```bash
docker run --rm --entrypoint node ghcr.io/jagbhandal/jaghelm:1.0.0 -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

**3. Start it.** The first start downloads four images, a few minutes.

```bash
docker compose up -d
docker compose ps
```

You should see four lines, `jaghelm`, `prometheus`, `node-exporter` and `cadvisor`, all `running` or `Up`.

**4. Find your password and open the page.** Print the password, then open `http://localhost:3099`, or `http://SERVER-IP:3099` from another computer (`hostname -I` on the server prints its address).

```bash
grep DASH_PASS .env
```

You should see a sign-in page. The user is `admin`.

**5. Walk through the guided setup.** It opens by itself after you sign in. See the next section. When it ends, the Overview shows your machine with its CPU, memory and disk, and its containers listed under Services.

## First run

The guided setup is a **status checker**. It shows whether JagHelm can reach your sources and lets you name your nodes. It cannot change addresses: the Prometheus and Kuma addresses are values in `.env` (`PROMETHEUS_URL`, `KUMA_URL`), and the UPS is read through Prometheus. Change `.env`, then run `docker compose up -d` again.

1. **Prometheus:** it should say **Answering**. If not, see Troubleshooting.
2. **Nodes:** at first it says "Waiting for your first node". Wait about a minute; `myserver` appears. Rename it or switch it off if you like. Don't save anything in Settings → Integrations until it appears.
3. **Kuma and UPS:** optional. Click Next.
4. **Integrations:** optional. Click **Finish and open the Overview**. **Skip setup** ends it at any step. It shows only once.

## Updating

Your files live in `data/`, so an update keeps them. The quickstart uses `:1.0.0`, a release that never changes. To update, change the version in the `image:` line of `compose.yaml` to a newer one from the [Releases](https://github.com/jagbhandal/jaghelm/releases) page, read its notes, then run:

```bash
docker compose pull
docker compose up -d
```

The tag `:latest` follows the main branch, so it is the newest build, not a release. Use it only if you want that.

## Troubleshooting

**The `jaghelm` container keeps restarting.** Run `docker compose logs jaghelm`. If it says `EACCES: permission denied`, the `data` folder is not writable by user 1000. Run `sudo chown 1000:1000 data uploads`, then `docker compose up -d`. <!-- update after #697 -->

**"Waiting for your first node", or Prometheus is not Answering.** Inside a container, `localhost` means the container itself, so `PROMETHEUS_URL` must be a service name (`http://prometheus:9090`) or the server's LAN address. Check `.env`, then run `docker compose up -d`. If that is right, check that every Prometheus target has a `node` label: JagHelm finds machines by it, and the quickstart's `prometheus.yml` sets it.

**"port is already allocated".** Something else uses port 3099. In `compose.yaml` change `"3099:3099"` to `"8080:3099"`, run `docker compose up -d`, and open port 8080.

**You can sign in but a stored password or token won't save.** `DASH_SECRET` is missing or still an example. Put a real one in `.env` (`openssl rand -hex 32`), run `docker compose up -d`, then enter the credential again.

**You can't install JagHelm on your phone or turn on alerts.** Browsers allow both only on an `https` address (or `localhost`). A plain `http://192.168.x.x:3099` shows the dashboard but nothing more. Put a reverse proxy with a certificate in front of it. Alerts also need three push keys; see [docs/FEATURES.md](docs/FEATURES.md#alerts-on-your-phone). <!-- update after #698 -->

## Where to go next

- [docs/CONFIGURATION.md](docs/CONFIGURATION.md): `.env`, files in `data/`, networking, every setting
- [docs/FEATURES.md](docs/FEATURES.md): what the Overview, Services, Alerts and Settings do
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): connect AdGuard, Sonarr, Proxmox and the rest
- [docs/REPORTING.md](docs/REPORTING.md): cron jobs, config drift and backups reporting in
- [docs/GET-STARTED.md](docs/GET-STARTED.md): several machines, Uptime Kuma, UPS, embedded apps
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [KNOWN-ISSUES.md](KNOWN-ISSUES.md), [CHANGELOG.md](CHANGELOG.md), [docs/RELEASING.md](docs/RELEASING.md)

## Status and license

A single-maintainer hobby project, used daily on my own home server. No SLA, no roadmap. Issues and PRs are welcome. Read [KNOWN-ISSUES.md](KNOWN-ISSUES.md) before putting it on the public internet.

[MIT](LICENSE). The fonts it ships are under the [SIL Open Font License 1.1](https://openfontlicense.org), with the texts in [`src/fonts/licences/`](src/fonts/licences/). The icon picker uses Dashboard Icons (Apache-2.0) and [selfh.st icons](https://selfh.st/icons) by selfh.st, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and shown without modification. Full credits: [docs/ACKNOWLEDGMENTS.md](docs/ACKNOWLEDGMENTS.md).
