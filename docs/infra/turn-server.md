# TURN relay for live meetings

FundExecs runs its own TURN server. There is no TURN vendor, no account, and no
per-gigabyte bill — the application mints credentials itself from a secret it
shares with the relay.

This document is the whole set-up: why the relay exists, how to stand one up,
and how to prove it is working.

## Why a relay is not optional

A browser call is peer-to-peer when it can be. Two people on ordinary home or
office networks discover each other's public addresses with STUN and send media
directly, and no relay is involved.

That fails on three networks, and they are common:

- **symmetric NAT**, which allocates a different external port per destination,
  so the address a peer learned is not the address it can send to;
- **corporate firewalls** that permit outbound 443 and nothing else;
- **mobile CGNAT**, where the carrier shares one public address across thousands
  of subscribers.

On these, there is no direct path to find. Media has to travel through a server
that both sides can reach — a TURN relay. Without one, a guest on mobile data
joins the meeting, opens their camera and microphone, and is neither seen nor
heard. The connection looks live because signalling worked; only the media is
missing.

This is how those networks work, not a shortcoming of the application. The only
question is whose relay it is.

## How authentication works here

The naive approach is a username and password per user, which means an account
system inside the TURN server. The standard alternative, and what this uses, is
**ephemeral credentials**: the application and the relay share one secret, and
the application computes short-lived credentials from it locally.

```
username   = "<unix expiry>"  or  "<unix expiry>:<room code>"
credential = base64( HMAC-SHA1( TURN_SECRET, username ) )
```

The relay recomputes the same HMAC from the username it receives and its own
copy of the secret, and refuses anything whose expiry has passed. It never needs
to have heard of the user.

Two consequences worth stating plainly:

- **Nothing is fetched.** There is no request on the meeting-join path that can
  be refused, rate-limited, or time out. The previous vendor spent ten weeks
  answering `401` into a log nobody read.
- **A leaked credential expires.** Default lifetime is 12 hours, clamped to
  between 1 minute and 24 hours by `TURN_TTL_SECONDS`.

SHA-1 is the protocol's choice, not ours. It is used as the hash inside an HMAC
over a short string with a short life, which is not where SHA-1's collision
weaknesses apply. Anything else simply would not authenticate.

## Standing up coturn

Any standards-compliant TURN server works. coturn is the usual one.

**You need:** a host with a **public IPv4 address** (not behind NAT itself), a
DNS name pointing at it, and a TLS certificate for that name. A small VPS is
enough to start; relayed media is the only traffic, and only for the calls that
cannot go direct.

### Ports

| Port | Protocol | Why |
|---|---|---|
| 3478 | UDP + TCP | Standard TURN/STUN |
| 5349 | UDP + TCP | TURN over TLS/DTLS — the one that gets through restrictive firewalls |
| 49152–65535 | UDP | Relay range; each relayed stream takes one |

Open all of them inbound. The relay range is the one people forget, and without
it sessions authenticate and then carry no media — the same symptom as having no
relay at all.

Running `turns:` on **443** as well is worth it if the host does nothing else:
some corporate networks permit no other outbound port.

### Configuration

`/etc/turnserver.conf`:

```conf
listening-port=3478
tls-listening-port=5349

# The host's PUBLIC address. If the machine is behind a NAT (most cloud VMs
# are), set both: the private address it binds to and the public one it is
# reached at. Getting this wrong is the most common cause of a relay that
# authenticates and then relays nothing.
listening-ip=0.0.0.0
external-ip=<public-ip>/<private-ip>

realm=turn.yourdomain.com

# Ephemeral credentials. This is the half that must match the application.
use-auth-secret
static-auth-secret=<same value as TURN_SECRET>

cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem

min-port=49152
max-port=65535

# Refuse to relay to private ranges and to itself: an open relay pointed at
# internal addresses is an SSRF surface, and an open relay pointed at the
# internet is someone else's bandwidth bill.
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255

# Bound what one credential can cost.
user-quota=12
total-quota=1200

fingerprint
stale-nonce=600
no-cli
```

Generate the secret with something that is not a password:

```bash
openssl rand -base64 48
```

## Wiring the application

In Vercel → project → **Settings** → **Environment Variables**, set for
**Production** (and Preview if you want previews relayed):

```
TURN_URLS   = turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349
TURN_SECRET = <the static-auth-secret, byte for byte>
```

`TURN_TTL_SECONDS` is optional; leave it unset for the 12-hour default.

**Then redeploy.** Changing an environment variable does not redeploy anything,
and the running deployment keeps the old values indefinitely.

## Proving it works

**1. The relay answers.** From any machine:

```bash
# Should print the relay's software name and a 401 challenge — a refusal from
# a live server, which is what an unauthenticated request deserves.
turnutils_uclient -v turn.yourdomain.com
```

**2. The application hands out credentials.** Signed in to the app, open:

```
https://www.fundexecs.com/api/meetings/ice-servers
```

| Response | Meaning |
|---|---|
| `"relay": true` with `turn:` URLs carrying `username`/`credential` | Working |
| `"relay": false, "reason": "unconfigured"` | Neither variable is set, or the redeploy has not happened |
| `"relay": false, "reason": "misconfigured"` | One of them is set and unusable — no `turn:` URL, or an empty secret |

**3. The credentials are accepted.** Paste the `username` and `credential` from
step 2 into <https://icetest.info> or Chrome's `webrtc-internals`, or:

```bash
turnutils_uclient -v -u <username> -w <credential> turn.yourdomain.com
```

A successful allocation proves the secret matches. A `401` here with a correct
secret almost always means the value differs by whitespace at one end — check
for a trailing newline in the Vercel field.

**4. A real guest.** Have someone join by invite link **from mobile data, not
office WiFi**. Cellular CGNAT is exactly the network that needed the relay.

## When it is not working

| Symptom | Cause |
|---|---|
| `reason: "unconfigured"` after setting the variables | No redeploy |
| `reason: "misconfigured"` | `TURN_URLS` has only a `stun:` entry, or `TURN_SECRET` is blank |
| Credentials issued, allocation returns 401 | `TURN_SECRET` ≠ `static-auth-secret`; usually stray whitespace |
| Allocation succeeds, media never flows | Relay port range 49152–65535/UDP is closed, or `external-ip` is wrong |
| Works on WiFi, fails on mobile | You are testing the direct path; the relay is not being exercised. Force it with `iceTransportPolicy: "relay"` in `webrtc-internals` |

## What this costs

Only calls that cannot go direct are relayed, and only their media. A relayed
participant streams roughly what they upload — with the per-peer video tiers in
`lib/meetings/send-tiers.ts`, on the order of 1 Mbps for someone being watched
and far less for a thumbnail. Budget bandwidth, not CPU: coturn forwards
packets and does not decode them.
