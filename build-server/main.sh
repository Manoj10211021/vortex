#!/bin/bash
set -e

if [ -z "$GIT_REPOSITORY__URL" ]; then
  echo "ERROR: GIT_REPOSITORY__URL not set"
  exit 1
fi

echo "Cloning $GIT_REPOSITORY__URL ..."
git clone "$GIT_REPOSITORY__URL" /home/app/output

echo "Starting Node.js app..."
exec node script.js
