# Setting up the phone companion on iOS

PointFight Reactor's phone-as-sensor mode (`/phone`) works without any
configuration on **Android Chrome over plain HTTP** on your LAN. iOS
Safari is stricter: it refuses to grant `DeviceMotionEvent` permission
to any origin that is not served over HTTPS with a certificate the device
already trusts.

This page is the one-time setup an iOS user runs on their laptop so that
`https://<laptop-lan-ip>:5173/phone` works on their iPhone.

If you are on Android, **stop reading — you do not need any of this**.

## Why

iOS Safari (verified iOS 15–17) treats `DeviceMotionEvent.requestPermission`
as a privileged API and silently returns `denied` on insecure origins.
A self-signed certificate is not enough: iOS only honours the permission
prompt when the certificate's root is in the device's trust store. The
cheapest way to get a trusted LAN certificate is
[mkcert](https://github.com/FiloSottile/mkcert).

## What you'll do

1. Install mkcert and create a local certificate authority.
2. Generate a certificate for your laptop's LAN IP.
3. Install the mkcert root CA on your iPhone (one-time, via AirDrop or email).
4. Run Vite with `--https` pointing at the generated cert.
5. Open `https://<laptop-lan-ip>:5173/phone` on the iPhone, accept the
   motion-permission prompt.

After this, the iPhone trusts your laptop's LAN dev server and motion
events flow normally. You only repeat steps 4 and 5 each session.

## 1. Install mkcert

macOS:

```bash
brew install mkcert nss
mkcert -install
```

Linux:

```bash
# Debian/Ubuntu
sudo apt install libnss3-tools
# then install mkcert per upstream instructions, e.g.
curl -L https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 -o mkcert
chmod +x mkcert && sudo mv mkcert /usr/local/bin/
mkcert -install
```

`mkcert -install` creates a local root CA in your laptop's trust store.
This is the CA we'll also install on the iPhone.

## 2. Generate a certificate for your LAN IP

Find your laptop's LAN IP (the one you already entered in PointFight
Reactor → Settings → "Laptop LAN IP" for Phase 2b pairing):

```bash
# macOS
ipconfig getifaddr en0
# Linux
ip route get 1.1.1.1 | awk '{print $7; exit}'
```

Then, in the project root:

```bash
mkdir -p app/.certs
cd app/.certs
mkcert "$LAN_IP" localhost 127.0.0.1
# produces ./<LAN_IP>+2.pem and ./<LAN_IP>+2-key.pem
```

Both files are git-ignored (or should be — they are local CA-signed and
have no value outside your LAN).

## 3. Install the mkcert root CA on the iPhone

```bash
mkcert -CAROOT
# prints the directory holding rootCA.pem
```

Copy `rootCA.pem` to your iPhone (AirDrop is easiest on macOS; for Linux,
email it to yourself). On the iPhone:

1. Open the file — iOS prompts to install a configuration profile.
2. Settings → General → VPN & Device Management → mkcert development CA
   → **Install** (enter your passcode).
3. Settings → General → About → Certificate Trust Settings → toggle
   **mkcert development CA** to **on**.

Without step 3 Safari will still refuse the certificate. Apple changed
the trust-toggle requirement in iOS 10.3 and the prompt is easy to miss.

## 4. Serve Vite with `--https`

In dev:

```bash
cd app
npm run dev -- --https --host \
  --https-cert .certs/<LAN_IP>+2.pem \
  --https-key .certs/<LAN_IP>+2-key.pem
```

For a production build:

```bash
cd app
npm run build
npm run preview -- --host --https \
  --https-cert .certs/<LAN_IP>+2.pem \
  --https-key .certs/<LAN_IP>+2-key.pem
```

If Vite logs `Local: https://localhost:5173/` and
`Network: https://<LAN_IP>:5173/`, the cert is being served.

## 5. Open the companion on the iPhone

On the iPhone, navigate to `https://<LAN_IP>:5173/phone`. Safari should
load the page with the URL-bar lock icon (no certificate warning) — if
you see a warning, recheck steps 3 and 4.

In PointFight Reactor on the iPhone, tap **Enable motion sensor**. iOS
will prompt for motion-and-orientation access. Tap **Allow**. From this
point the page behaves exactly like the Android-on-HTTP path: motion
peaks above the calibrated threshold fire `commit` events over the
WebRTC DataChannel back to the laptop.

## Troubleshooting

- *Safari shows "Not Secure" or a cert warning*: the mkcert root CA is
  not trusted yet on the iPhone. Re-do step 3 — the **Certificate Trust
  Settings** toggle is the part most people miss.
- *Motion permission button does nothing*: iOS requires the permission
  request to come from a direct user gesture (tap). If the page calls
  `requestPermission` after any async hop, iOS rejects it silently.
  The companion only requests the permission inside the **Enable motion
  sensor** click handler — make sure you are tapping that button
  yourself, not triggering it programmatically.
- *Cert expired*: mkcert certificates are short-lived (a few months) by
  design. Re-run `mkcert "$LAN_IP" localhost 127.0.0.1` to refresh.
- *LAN IP changed*: your router probably handed out a new lease.
  Regenerate the cert with the new IP and update the
  **Laptop LAN IP** value in Settings.

## Why we did not automate this

mkcert installation requires the user's keychain password and (on iOS)
manual profile-install steps Apple intentionally cannot be scripted from
a browser. Automating it would mean shipping our own root CA — a much
larger trust-store ask of the user than a single locally-generated dev
cert.

If the iOS setup is too painful for any reason, the fallback is to use
**keyboard or USB foot pedal** as the commit input — those work without
any of the above. Phone-as-sensor is an optional input source in the
spec, not a requirement.
