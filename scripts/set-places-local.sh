#!/bin/bash
# Store a Google Places API key in the macOS Keychain for Thoughtful (service "thoughtful-google-places").
# It proposes to reuse the key you already have for StudioPilot, without ever displaying it.
set -euo pipefail
SERVICE="thoughtful-google-places"; ACCOUNT="thoughtful"
SRC="${STUDIOPILOT_PLACES_FILE:-$HOME/Library/Application Support/StudioPilot/secrets/google-places.json}"
store() {
  local key; IFS= read -r key || true
  key="${key//[$'\r\n ']/}"
  if [ -z "$key" ]; then echo "No key found. Nothing was stored."; exit 1; fi
  if ! [[ "$key" =~ ^[A-Za-z0-9._:-]+$ ]]; then echo "The key contains unexpected characters. Nothing was stored."; exit 1; fi
  printf 'add-generic-password -U -s %s -a %s -l "Thoughtful Google Places" -w %s\n' "$SERVICE" "$ACCOUNT" "$key" | /usr/bin/security -i >/dev/null
  unset key
  echo "Stored in your Keychain as \"$SERVICE\". Restart Thoughtful to use it."
}
if [ -f "$SRC" ]; then
  echo "A Google Places key exists for StudioPilot:"
  echo "  $SRC"
  read -r -p "Reuse it for Thoughtful? It will be copied to your Keychain without being shown. [y/N] " yn
  if [ "${yn:-n}" = "y" ] || [ "${yn:-n}" = "Y" ]; then
    /usr/bin/python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
def find(o):
    if isinstance(o,str): return o
    if isinstance(o,dict):
        for k in ("apiKey","api_key","key","GOOGLE_PLACES_KEY","GOOGLE_PLACES_API_KEY","googlePlacesKey"):
            if isinstance(o.get(k),str): return o[k]
        for v in o.values():
            r=find(v)
            if r: return r
    return ""
sys.stdout.write(find(d)+"\n")' "$SRC" | store
    exit 0
  fi
fi
read -r -s -p "Google Places API key (hidden): " k; echo
printf '%s\n' "$k" | store; unset k
