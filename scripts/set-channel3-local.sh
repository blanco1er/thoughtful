#!/bin/bash
# Store the Channel3 API key in the macOS Keychain for Thoughtful (service "thoughtful-channel3").
# The key is never printed, never written to a file, never passed on a command line.
#   Option 1 (default): paste it, hidden.
#   Option 2: copy it straight from the Mandat Lambda configuration (AWS profile "mandat"), without displaying it.
set -euo pipefail
SERVICE="thoughtful-channel3"; ACCOUNT="thoughtful"
store() { # reads the key on stdin and feeds it to `security -i` through stdin (never in argv, never on screen)
  local key; IFS= read -r key || true
  key="${key//[$'\r\n ']/}"
  if [ -z "$key" ]; then echo "No key received. Nothing was stored."; exit 1; fi
  if ! [[ "$key" =~ ^[A-Za-z0-9._:-]+$ ]]; then echo "The key contains unexpected characters. Nothing was stored."; exit 1; fi
  printf 'add-generic-password -U -s %s -a %s -l "Thoughtful Channel3" -w %s\n' "$SERVICE" "$ACCOUNT" "$key" | /usr/bin/security -i >/dev/null
  unset key
  echo "Stored in your Keychain as \"$SERVICE\". Restart Thoughtful to use it."
}
echo "Thoughtful needs a Channel3 key to show real gift ideas (US retailers)."
echo "  1) Paste the key (hidden)"
echo "  2) Copy it from the Mandat Lambda (AWS profile \"mandat\"), without showing it"
read -r -p "Choice [1/2]: " choice
if [ "${choice:-1}" = "2" ]; then
  FN="${MANDAT_LAMBDA_NAME:-mandat-alexa}"
  aws lambda get-function-configuration --profile "${AWS_PROFILE:-mandat}" --region "${AWS_REGION:-us-east-1}" --function-name "$FN" \
    --query 'Environment.Variables.CHANNEL3_API_KEY' --output text 2>/dev/null | { IFS= read -r k || true; if [ -z "$k" ] || [ "$k" = "None" ]; then echo "No CHANNEL3_API_KEY on Lambda \"$FN\" (set MANDAT_LAMBDA_NAME if it has another name)."; exit 1; fi; printf '%s\n' "$k" | store; }
else
  read -r -s -p "Channel3 API key: " k; echo
  printf '%s\n' "$k" | store; unset k
fi
