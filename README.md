<p align="center">
  <img src="public/logo-login.svg" height="120" alt="JagHelm">
</p>
<h1 align="center">JagHelm</h1>
<p align="center">
  <b>Live data, not just links.</b><br>
  A self-hosted dashboard for your home server. It shows what is wrong first, then CPU, memory, disk, containers, UPS and 35+ app integrations.
</p>
<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-26-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
</p>
<p align="center">
  <img src="docs/images/dashboard.jpg" alt="JagHelm's Overview on demo data: a service down and a failed backup first, then the nodes and the UPS">
</p>

JagHelm reads real numbers from [Prometheus](https://prometheus.io) (a program that collects and stores them) and shows them on one page, worst problems first. It does not collect anything itself.

It is **not** a hosting platform or a log collector, it only **reads** from your servers (it changes nothing on them), and it is for **one person** running their own server, not a team.

## Try the demo

A made-up home server with fake data. It needs only Docker on an x86-64 computer (Intel or AMD; there is no ARM image yet) and changes nothing on your machine.

```bash
docker run --rm -e DEMO_MODE=true -p 3099:3099 ghcr.io/jagbhandal/jaghelm:1.1.0
```

Wait for the download (about a minute), then open <http://localhost:3099>. You should see a board that says **Critical**, with one service down and one failed backup. Press `Ctrl+C` to stop. Port 3099 taken? Use `-p 8080:3099` and open port 8080. More in [docs/DEMO.md](docs/DEMO.md).

## Install in 5 steps

**Before you start, you need:**

- **A 64-bit Intel/AMD (x86-64) Linux computer that stays on**, such as a mini PC, an old laptop or a virtual machine, and a terminal on it. There is no ARM image yet (no Raspberry Pi). On Windows or macOS, stop at the demo: the monitoring programs would report Docker's hidden virtual machine, not your computer.
- **Docker with Compose.** This must print "Hello from Docker!" and `docker compose version` must print a version:

  ```bash
  docker run --rm hello-world
  docker compose version
  ```

  On Linux, "permission denied ... docker.sock" means your user may not use Docker yet. Run `sudo usermod -aG docker $USER`, log out and in again (or start every `docker` command with `sudo`).
- Prometheus and two small helpers (`node_exporter` for the machine's CPU, memory and disk; `cAdvisor` for containers). The steps install all three. Already run Prometheus? See [Use your own Prometheus](docs/CONFIGURATION.md#use-your-own-prometheus).

Optional, add later: Uptime Kuma (up/down checks), a UPS with NUT, and integrations with apps such as AdGuard or Sonarr.

**1. Get the files and make the two folders JagHelm writes to.** You should end up in a new `jaghelm` folder holding `compose.yaml` and `prometheus.yml`. Linux may ask for your password. The `chown` line prevents the most common failure; skip it and JagHelm stops at start and tells you exactly what to run (see [docs/DATA-DIR.md](docs/DATA-DIR.md)).

```bash
mkdir -p jaghelm/data jaghelm/uploads && cd jaghelm
curl -fsSLO https://raw.githubusercontent.com/jagbhandal/jaghelm/main/docs/examples/quickstart/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/jagbhandal/jaghelm/main/docs/examples/quickstart/prometheus.yml
sudo chown 1000:1000 data uploads
```

**2. Make your settings file.** This writes `.env` with a random secret (the key that locks the passwords you store later) and a random sign-in password, and keeps other users from reading it. Run it once: running it again makes new ones.

```bash
echo "PROMETHEUS_URL=http://prometheus:9090" > .env
echo "DASH_SECRET=$(openssl rand -hex 32)" >> .env
echo "DASH_USER=admin" >> .env
echo "DASH_PASS=$(openssl rand -hex 12)" >> .env
chmod 600 .env
```

No `openssl`? Use this block instead (it needs Docker working, as above):

```bash
echo "PROMETHEUS_URL=http://prometheus:9090" > .env
echo "DASH_SECRET=$(docker run --rm --entrypoint node ghcr.io/jagbhandal/jaghelm:1.1.0 -e "console.log(crypto.randomBytes(32).toString('hex'))")" >> .env
echo "DASH_USER=admin" >> .env
echo "DASH_PASS=$(docker run --rm --entrypoint node ghcr.io/jagbhandal/jaghelm:1.1.0 -e "console.log(crypto.randomBytes(12).toString('hex'))")" >> .env
chmod 600 .env
```

**3. Start it.** The first start downloads four images, a few minutes.

```bash
docker compose up -d
docker compose ps
```

You should see four lines, `jaghelm`, `prometheus`, `node-exporter` and `cadvisor`, all `running` or `Up`.

**4. Find your password and open the page.** Print the password. It is the part after `=`. Then open `http://localhost:3099` if you are sitting at that machine. If you reach the server over SSH, it has no browser: open `http://SERVER-IP:3099` on your own computer instead. `hostname -I` on the server prints its addresses; use the one that looks like `192.168.x.x` or `10.x.x.x`.

```bash
grep DASH_PASS .env
```

You should see a sign-in page. The user is `admin`.

**5. Walk through the guided setup.** It opens by itself after you sign in. See the next section. When it ends, the Overview shows your machine with its CPU, memory and disk, and its containers listed under Services.

## First run

The guided setup is a **status checker**. It shows whether JagHelm can reach your sources and lets you name your nodes. It cannot change addresses: the Prometheus and Kuma addresses are values in `.env` (`PROMETHEUS_URL`, `KUMA_URL`), and the UPS is read through Prometheus. Change `.env`, then run `docker compose up -d` again.

1. **Prometheus:** it should say **Answering**. If not, see Troubleshooting.
2. **Nodes:** at first it says "Waiting for your first node". Wait about a minute; `myserver` appears. Rename it or switch it off if you like. Don't save anything in Settings → Integrations until it appears.
3. **Kuma and NUT** (NUT is how a UPS reports in): optional. Click Next.
4. **Integrations:** optional. Click **Finish and open the Overview**. **Skip setup** ends it at any step. It shows only once.

## Updating

Your files live in `data/`, so an update keeps them. The quickstart uses `:1.1.0`, a release that never changes. To update, change the version in the `image:` line of `compose.yaml` to a newer one from the [Releases](https://github.com/jagbhandal/jaghelm/releases) page, read its notes, then run:

```bash
docker compose pull
docker compose up -d
```

The tag `:latest` follows the main branch, so it is the newest build, not a release. Use it only if you want that.

## Troubleshooting

**The `jaghelm` container keeps restarting.** Run `docker compose logs jaghelm`. It prints "JagHelm cannot start: a folder it needs to write to is not usable" and names the folder and the fix. Usually that is `sudo chown 1000:1000 data uploads`, then `docker compose up -d`. Details: [docs/DATA-DIR.md](docs/DATA-DIR.md).

**"Prometheus is not set", "Waiting for your first node", or Prometheus is not Answering.** Set `PROMETHEUS_URL` in `.env`: JagHelm has no default for it. Inside a container, `localhost` means the container itself, so `PROMETHEUS_URL` must be a service name (`http://prometheus:9090`) or the server's LAN address. Check `.env`, then run `docker compose up -d`. If that is right, check that every Prometheus target has a `node` label: JagHelm finds machines by it, and the quickstart's `prometheus.yml` sets it.

**"port is already allocated".** Something else uses port 3099. In `compose.yaml` change `"3099:3099"` to `"8080:3099"`, run `docker compose up -d`, and open port 8080.

**You can sign in but a stored password or token won't save.** `DASH_SECRET` is missing or still an example. Put a real one in `.env` (`openssl rand -hex 32`), run `docker compose up -d`, then enter the credential again.

**You can't install JagHelm on your phone or turn on alerts.** Browsers allow both only on an `https` address (or `localhost`). A plain `http://192.168.x.x:3099` shows the dashboard but nothing more. Also, over plain `http` your password travels unencrypted: fine on a home network you trust, not across the internet or shared Wi-Fi. Put a reverse proxy with a certificate (HTTPS) in front of it, and don't open the port to the internet. JagHelm makes its own alert key the first time it starts, so there is nothing to set up for that; see [docs/FEATURES.md](docs/FEATURES.md#alerts-on-your-phone).

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
